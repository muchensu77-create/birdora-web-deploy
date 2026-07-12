"use strict";

const fs = require("fs");
const path = require("path");
const {
  ALLOWED_AUTOMATED_STATES,
  LegacyInventoryError,
  canonicalJson,
  evaluateEvidence,
  parseJsonObject,
  readBoundedRegularFile,
  validateEvidenceShape,
} = require("../deploy/scripts/legacy-inventory-lib");

const MAX_EVIDENCE_BYTES = 16 * 1024 * 1024;
const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9.-]{2,95}$/u;

function evaluationError(message, code = "LEGACY_EVIDENCE_EVALUATION_FAILED", exitCode = 65) {
  return new LegacyInventoryError(message, code, exitCode);
}

function resolveLocalEvidencePath(inputPath) {
  if (
    typeof inputPath !== "string"
    || inputPath.length === 0
    || inputPath.length > 4096
    || inputPath === "-"
    || /[\u0000-\u001f\u007f]/u.test(inputPath)
    || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(inputPath)
    || inputPath.startsWith("\\\\")
    || inputPath.startsWith("//")
    || !path.isAbsolute(inputPath)
  ) {
    throw evaluationError(
      "legacy evidence must be supplied as one explicit absolute local file path",
      "LEGACY_EVIDENCE_PATH_INVALID",
      64
    );
  }

  const resolvedPath = path.resolve(inputPath);
  let before;
  try {
    before = fs.lstatSync(resolvedPath, { bigint: true });
  } catch {
    throw evaluationError(
      "legacy evidence file is unavailable",
      "LEGACY_EVIDENCE_FILE_UNAVAILABLE",
      66
    );
  }
  let physicalPath;
  try { physicalPath = fs.realpathSync(resolvedPath); } catch { physicalPath = null; }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || physicalPath !== resolvedPath) {
    throw evaluationError(
      "legacy evidence must be one regular non-linked file",
      "LEGACY_EVIDENCE_FILE_UNSAFE",
      74
    );
  }
  return { resolvedPath, before };
}

function readEvidenceFile(inputPath) {
  const { resolvedPath, before } = resolveLocalEvidencePath(inputPath);
  const { bytes, stats } = readBoundedRegularFile(resolvedPath, MAX_EVIDENCE_BYTES, {
    description: "legacy evidence",
  });
  if (stats.dev !== before.dev || stats.ino !== before.ino || stats.size !== before.size) {
    throw evaluationError(
      "legacy evidence changed during validation",
      "LEGACY_EVIDENCE_CONCURRENT_CHANGE",
      75
    );
  }
  return validateEvidenceShape(parseJsonObject(bytes, "legacy evidence"));
}

function assertSafeIdentifierArray(value, name, maximumItems) {
  if (
    !Array.isArray(value)
    || value.length > maximumItems
    || value.some((item) => typeof item !== "string" || !SAFE_ID_PATTERN.test(item))
    || new Set(value).size !== value.length
  ) {
    throw evaluationError(
      `${name} is not safe to export`,
      "LEGACY_EVIDENCE_DECISION_INVALID",
      70
    );
  }
}

function assertSafeDecision(decision) {
  if (
    !decision
    || typeof decision !== "object"
    || !ALLOWED_AUTOMATED_STATES.has(decision.automatedState)
    || decision.authorizesMutation !== false
    || decision.authorizesAdoption !== false
  ) {
    throw evaluationError(
      "legacy evidence evaluator crossed its authorization boundary",
      "LEGACY_EVIDENCE_DECISION_INVALID",
      70
    );
  }
  assertSafeIdentifierArray(decision.blockingCheckIds, "blocking check identifiers", 512);
  assertSafeIdentifierArray(decision.pendingManualConfirmationIds, "manual confirmation identifiers", 128);
  assertSafeIdentifierArray(decision.rejectedManualConfirmationIds, "rejected manual confirmation identifiers", 128);
  return decision;
}

function createEvaluationEnvelope(evidence, decision) {
  return {
    kind: "birdora-legacy-adoption-evaluation",
    schemaVersion: evidence.schemaVersion,
    sourceReportId: evidence.reportId,
    automatedState: decision.automatedState,
    blockingCheckIds: decision.blockingCheckIds,
    pendingManualConfirmationIds: decision.pendingManualConfirmationIds,
    rejectedManualConfirmationIds: decision.rejectedManualConfirmationIds,
    authorization: {
      inventoryOnly: true,
      adoptionAuthorized: false,
      mutationAuthorized: false,
    },
    notice: "This offline result is evidence for human review only and never authorizes production adoption or mutation.",
  };
}

function evaluateEvidenceFile(inputPath) {
  const evidence = readEvidenceFile(inputPath);
  const decision = assertSafeDecision(evaluateEvidence(evidence));
  return createEvaluationEnvelope(evidence, decision);
}

function run(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  if (!Array.isArray(argv) || argv.length !== 1) {
    throw evaluationError(
      "usage: node scripts/evaluate-legacy-adoption-evidence.js <absolute-evidence-file>",
      "LEGACY_EVIDENCE_USAGE",
      64
    );
  }
  const envelope = evaluateEvidenceFile(argv[0]);
  io.stdout.write(`${canonicalJson(envelope)}\n`);
  return envelope.automatedState === "BLOCKED" ? 2 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    const knownError = error instanceof LegacyInventoryError;
    const code = knownError ? error.code : "LEGACY_EVIDENCE_EVALUATION_FAILED";
    const exitCode = knownError ? error.exitCode : 70;
    process.stderr.write(`${canonicalJson({
      error: { code, message: "Legacy evidence evaluation failed closed." },
      authorization: {
        inventoryOnly: true,
        adoptionAuthorized: false,
        mutationAuthorized: false,
      },
    })}\n`);
    process.exitCode = exitCode;
  }
}

module.exports = {
  MAX_EVIDENCE_BYTES,
  assertSafeDecision,
  createEvaluationEnvelope,
  evaluateEvidenceFile,
  readEvidenceFile,
  resolveLocalEvidencePath,
  run,
};
