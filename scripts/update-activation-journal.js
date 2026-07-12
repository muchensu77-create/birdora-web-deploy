"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { assertDeploymentLock } = require("../deploy/scripts/switch-release-pointer");

const ACTIVATION_PHASES = Object.freeze([
  "migration-about-to-start",
  "migration-command-complete-awaiting-postflight",
  "database-migrated-candidate-not-yet-verified",
  "runtime-switch-about-to-start",
  "runtime-pointer-switched",
  "candidate-start-about-to-begin",
  "candidate-ready",
  "public-switch-about-to-start",
  "public-pointer-switched",
  "nginx-loopback-verified",
  "maintenance-release-about-to-start",
  "public-readonly-verified",
  "marker-commit-about-to-start",
  "marker-committed",
]);

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseJsonObject(value, name) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be one JSON object`);
  }
  return parsed;
}

function validateAbsolutePath(value, name, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${name} must be a normalized absolute path`);
  }
  return value;
}

function normalizeContext(context) {
  const candidateRuntimeDirectory = validateAbsolutePath(
    context.candidateRuntimeDirectory,
    "context.candidateRuntimeDirectory"
  );
  const previousRuntimeDirectory = validateAbsolutePath(
    context.previousRuntimeDirectory ?? null,
    "context.previousRuntimeDirectory",
    { nullable: true }
  );
  if (previousRuntimeDirectory === candidateRuntimeDirectory) {
    throw new Error("candidate and previous runtime directories must differ");
  }
  if (!/^[0-9a-f]{64}$/u.test(context.candidateArtifactManifestSha256 || "")) {
    throw new Error("context.candidateArtifactManifestSha256 must be a lowercase SHA-256 digest");
  }
  return {
    previousRuntimeDirectory,
    candidateRuntimeDirectory,
    runtimePointer: validateAbsolutePath(context.runtimePointer, "context.runtimePointer"),
    previousPublicDirectory: validateAbsolutePath(
      context.previousPublicDirectory ?? null,
      "context.previousPublicDirectory",
      { nullable: true }
    ),
    candidatePublicDirectory: validateAbsolutePath(
      context.candidatePublicDirectory,
      "context.candidatePublicDirectory"
    ),
    activePublicPointer: validateAbsolutePath(
      context.activePublicPointer,
      "context.activePublicPointer"
    ),
    candidateArtifactManifestSha256: context.candidateArtifactManifestSha256,
  };
}

function fsyncDirectory(directory) {
  // Windows does not permit fsync on a directory handle. Production activation
  // is Linux-only; tests still exercise the state machine and atomic rename.
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function entryExists(filePath) {
  try {
    fs.lstatSync(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readJournalState(pendingPath) {
  const descriptor = fs.openSync(pendingPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 256 * 1024) {
      throw new Error("activation journal must be a bounded regular single-link file");
    }
    if (process.platform === "linux" && (stats.uid !== 0 || (stats.mode & 0o777) !== 0o640)) {
      throw new Error("activation journal must be root-owned with exact mode 0640");
    }
    const bytes = fs.readFileSync(descriptor);
    return {
      stats,
      bytes,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
      journal: parseJsonObject(bytes.toString("utf8"), "activation journal"),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateJournalHistory(journal) {
  const currentPhaseIndex = ACTIVATION_PHASES.indexOf(journal.status);
  if (currentPhaseIndex < 0 || !Array.isArray(journal.phases) || journal.phases.length !== currentPhaseIndex + 1) {
    throw new Error("activation journal phase history length is inconsistent");
  }
  for (let index = 0; index < journal.phases.length; index += 1) {
    const phase = journal.phases[index];
    if (
      !phase
      || phase.status !== ACTIVATION_PHASES[index]
      || typeof phase.recordedAt !== "string"
      || Number.isNaN(Date.parse(phase.recordedAt))
    ) {
      throw new Error("activation journal phase history is not the exact legal prefix");
    }
  }
}

function updateActivationJournal(environment = process.env) {
  assertDeploymentLock(environment);
  const controlDirectory = path.resolve(required(environment, "ACTIVATION_CONTROL_DIR"));
  const pendingPath = path.resolve(required(environment, "ACTIVATION_PENDING_FILE"));
  const expectedPendingPath = path.join(controlDirectory, "activation-pending.json");
  if (pendingPath !== expectedPendingPath) {
    throw new Error(`ACTIVATION_PENDING_FILE must be ${expectedPendingPath}`);
  }
  const revision = required(environment, "CURRENT_REVISION").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("CURRENT_REVISION must be an exact Git commit");
  const attemptId = required(environment, "JOURNAL_ATTEMPT_ID");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/u.test(attemptId)) {
    throw new Error("JOURNAL_ATTEMPT_ID has an invalid format");
  }
  const rollbackBundleDirectory = path.resolve(required(environment, "ROLLBACK_BUNDLE_DIR"));
  const status = required(environment, "JOURNAL_STATUS");
  const requestedPhaseIndex = ACTIVATION_PHASES.indexOf(status);
  if (requestedPhaseIndex < 0) throw new Error(`unknown activation journal status: ${status}`);
  const create = environment.JOURNAL_CREATE === "true";
  const exists = entryExists(pendingPath);

  const controlStats = fs.lstatSync(controlDirectory);
  if (!controlStats.isDirectory() || controlStats.isSymbolicLink()) throw new Error("ACTIVATION_CONTROL_DIR is not a real directory");
  if (process.platform === "linux" && (controlStats.uid !== 0 || (controlStats.mode & 0o022) !== 0)) {
    throw new Error("ACTIVATION_CONTROL_DIR must be root-owned and not group/other writable");
  }
  if (create && exists) throw new Error(`activation journal already exists: ${pendingPath}`);
  if (!create && !exists) throw new Error(`activation journal is missing: ${pendingPath}`);
  let priorState = null;
  if (exists) priorState = readJournalState(pendingPath);

  let journal;
  if (create) {
    if (requestedPhaseIndex !== 0) {
      throw new Error(`a new activation journal must start at ${ACTIVATION_PHASES[0]}`);
    }
    const context = normalizeContext(parseJsonObject(required(environment, "JOURNAL_CONTEXT_JSON"), "JOURNAL_CONTEXT_JSON"));
    journal = {
      formatVersion: 2,
      attemptId,
      createdAt: new Date().toISOString(),
      revision,
      rollbackBundleDirectory,
      rollbackPolicy: "forward-fix-only-do-not-start-legacy-code",
      context,
      phases: [],
    };
  } else {
    journal = priorState.journal;
    if (
      journal.formatVersion !== 2
      || journal.attemptId !== attemptId
      || journal.revision !== revision
      || path.resolve(journal.rollbackBundleDirectory || "") !== rollbackBundleDirectory
    ) {
      throw new Error("activation journal identity differs from the current deployment attempt");
    }
    normalizeContext(journal.context || {});
    validateJournalHistory(journal);
    const currentPhaseIndex = ACTIVATION_PHASES.indexOf(journal.status);
    if (currentPhaseIndex < 0 || requestedPhaseIndex !== currentPhaseIndex + 1) {
      throw new Error(`activation journal transition is not the next legal phase: ${journal.status} -> ${status}`);
    }
  }

  let details = null;
  if (environment.JOURNAL_DETAILS_JSON) {
    details = parseJsonObject(environment.JOURNAL_DETAILS_JSON, "JOURNAL_DETAILS_JSON");
  }
  const phase = {
    status,
    recordedAt: new Date().toISOString(),
    details,
  };
  journal.status = status;
  journal.updatedAt = phase.recordedAt;
  journal.phases = [...(Array.isArray(journal.phases) ? journal.phases : []), phase];
  const serializedJournal = `${JSON.stringify(journal, null, 2)}\n`;
  if (Buffer.byteLength(serializedJournal, "utf8") > 256 * 1024) {
    throw new Error("activation journal exceeds the runtime 256 KiB safety limit");
  }

  const temporaryPath = `${pendingPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporaryPath, serializedJournal, {
      flag: "wx",
      mode: 0o640,
    });
    let descriptor = fs.openSync(temporaryPath, "r+");
    try {
      fs.fchmodSync(descriptor, 0o640);
      if (process.platform === "linux") fs.fchownSync(descriptor, 0, controlStats.gid);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (create) {
      fs.linkSync(temporaryPath, pendingPath);
      fs.unlinkSync(temporaryPath);
    } else {
      const currentState = readJournalState(pendingPath);
      if (
        currentState.stats.dev !== priorState.stats.dev
        || currentState.stats.ino !== priorState.stats.ino
        || currentState.sha256 !== priorState.sha256
      ) {
        throw new Error("activation journal changed concurrently before commit");
      }
      fs.renameSync(temporaryPath, pendingPath);
    }
    fsyncDirectory(controlDirectory);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  return { ok: true, attemptId, status, pendingPath };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(updateActivationJournal())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: "ACTIVATION_JOURNAL_UPDATE_FAILED",
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ACTIVATION_PHASES,
  normalizeContext,
  updateActivationJournal,
};
