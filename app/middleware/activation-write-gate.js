"use strict";

const fs = require("fs");
const path = require("path");

const STARTABLE_STATUSES = new Set([
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
const DEFAULT_CURRENT_RELEASE_FILE = "/var/lib/birdora-control/current-release.json";

function activationPendingPath() {
  const configured = process.env.ACTIVATION_PENDING_FILE;
  if (configured) return path.resolve(configured);
  return process.env.NODE_ENV === "production"
    ? "/var/lib/birdora-control/activation-pending.json"
    : null;
}

function pendingEntryExists(pendingPath) {
  if (!pendingPath) return false;
  try {
    fs.lstatSync(pendingPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function readRegularSingleLinkJson(filePath, description) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  } catch (error) {
    throw new Error(`${description} cannot be opened without following links: ${error.code || error.message}`);
  }
  let value;
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 256 * 1024) {
      throw new Error(`${description} must be a regular single-link file: ${filePath}`);
    }
    if (process.platform === "linux" && (stats.uid !== 0 || (stats.mode & 0o777) !== 0o640)) {
      throw new Error(`${description} must be root-owned with mode 0640`);
    }
    if (
      process.platform === "linux"
      && typeof process.geteuid === "function"
      && process.geteuid() !== 0
      && typeof process.getegid === "function"
      && stats.gid !== process.getegid()
    ) {
      throw new Error(`${description} must be readable through the runtime process group`);
    }
    value = JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${description} must be one JSON object`);
  }
  return value;
}

function readPendingJournal(pendingPath = activationPendingPath()) {
  if (!pendingEntryExists(pendingPath)) return null;
  const journal = readRegularSingleLinkJson(pendingPath, "activation journal");
  if (journal.formatVersion !== 2) throw new Error("activation journal format is unsupported");
  return journal;
}

function currentReleaseFile() {
  return path.resolve(process.env.CURRENT_RELEASE_FILE || DEFAULT_CURRENT_RELEASE_FILE);
}

function releaseIdentityConfigured() {
  const values = [
    process.env.BIRDORA_RELEASE_DIR || "",
    process.env.BIRDORA_RELEASE_REVISION || "",
    process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || "",
    process.env.BIRDORA_ACTIVATION_ATTEMPT_ID || "",
  ];
  if (values.every((value) => !value)) return false;
  if (
    !values.every(Boolean)
    || !path.isAbsolute(values[0])
    || !/^[0-9a-f]{40}$/u.test(values[1])
    || !/^[0-9a-f]{64}$/u.test(values[2])
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/u.test(values[3])
  ) {
    throw new Error("managed release identity must be either fully absent or fully valid");
  }
  return true;
}

function assertCurrentReleaseMarker() {
  const markerPath = currentReleaseFile();
  if (!pendingEntryExists(markerPath)) throw new Error("verified current release marker is missing");
  const marker = readRegularSingleLinkJson(markerPath, "current release marker");
  const expectedAttempt = process.env.BIRDORA_ACTIVATION_ATTEMPT_ID || null;
  if (
    marker.activationVerified !== true
    || marker.formatVersion !== 2
    || marker.revision !== process.env.BIRDORA_RELEASE_REVISION
    || marker.artifactManifestSha256 !== process.env.BIRDORA_RELEASE_MANIFEST_SHA256
    || path.resolve(marker.runtimeReleaseDirectory || "") !== path.resolve(process.env.BIRDORA_RELEASE_DIR || "")
    || (expectedAttempt && marker.activationAttemptId !== expectedAttempt)
  ) {
    throw new Error("current release marker does not authorize this runtime identity");
  }
  return marker;
}

function assertActivationStartupAllowed() {
  const pendingPath = activationPendingPath();
  const journal = readPendingJournal(pendingPath);
  if (!journal) {
    if (releaseIdentityConfigured()) assertCurrentReleaseMarker();
    return { pending: false, pendingPath, markerVerified: releaseIdentityConfigured() };
  }

  const attemptId = process.env.BIRDORA_ACTIVATION_ATTEMPT_ID || "";
  const revision = process.env.BIRDORA_RELEASE_REVISION || "";
  const manifestSha256 = process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || "";
  const releaseDirectory = process.env.BIRDORA_RELEASE_DIR
    ? path.resolve(process.env.BIRDORA_RELEASE_DIR)
    : "";
  const context = journal.context || {};
  if (!attemptId || journal.attemptId !== attemptId) {
    throw new Error("an unresolved activation journal blocks this process: activation attempt identity mismatch");
  }
  if (!STARTABLE_STATUSES.has(journal.status)) {
    throw new Error(`activation journal phase does not allow candidate startup: ${journal.status || "missing"}`);
  }
  if (!revision || journal.revision !== revision) {
    throw new Error("activation journal release revision differs from the candidate process");
  }
  if (!manifestSha256 || context.candidateArtifactManifestSha256 !== manifestSha256) {
    throw new Error("activation journal artifact digest differs from the candidate process");
  }
  if (
    !releaseDirectory
    || path.resolve(context.candidateRuntimeDirectory || "") !== releaseDirectory
  ) {
    throw new Error("activation journal runtime directory differs from the candidate process");
  }
  return {
    pending: true,
    pendingPath,
    attemptId,
    status: journal.status,
    writesEnabled: false,
  };
}

function activationWriteGate(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "").toUpperCase())) {
    next();
    return;
  }
  const pendingPath = activationPendingPath();
  if (!pendingEntryExists(pendingPath)) {
    try {
      if (releaseIdentityConfigured()) assertCurrentReleaseMarker();
      next();
      return;
    } catch {
      // Fail closed below without exposing marker details to the requester.
    }
  }
  res.set("Cache-Control", "no-store");
  res.set("Retry-After", "30");
  res.status(503).json({
    message: "The service is completing a controlled activation. Writes are temporarily unavailable.",
    code: "ACTIVATION_PENDING_READ_ONLY",
  });
}

function getActivationRuntimeState() {
  const pendingPath = activationPendingPath();
  const pending = pendingEntryExists(pendingPath);
  let markerVerified = !releaseIdentityConfigured();
  if (!pending) {
    try {
      if (releaseIdentityConfigured()) assertCurrentReleaseMarker();
      markerVerified = true;
    } catch {
      markerVerified = false;
    }
  }
  return {
    activationPending: pending,
    markerVerified,
    writesEnabled: !pending && markerVerified,
  };
}

module.exports = {
  STARTABLE_STATUSES,
  assertCurrentReleaseMarker,
  activationPendingPath,
  activationWriteGate,
  assertActivationStartupAllowed,
  getActivationRuntimeState,
  pendingEntryExists,
  readRegularSingleLinkJson,
  readPendingJournal,
};
