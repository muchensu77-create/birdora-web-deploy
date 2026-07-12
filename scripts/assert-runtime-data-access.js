"use strict";

const fs = require("fs");
const path = require("path");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertPhysicalDirectory(directory, description, { writable = false } = {}) {
  const resolved = path.resolve(directory);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(resolved) !== resolved) {
    throw new Error(`${description} must be one physical directory: ${resolved}`);
  }
  fs.accessSync(resolved, fs.constants.R_OK | fs.constants.X_OK | (writable ? fs.constants.W_OK : 0));
  return { resolved, stats };
}

function assertRuntimeOwnedDataFile(filePath, description, runtimeUid) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${description} must be one regular single-link file`);
  }
  if (stats.uid !== runtimeUid || (stats.mode & 0o600) !== 0o600 || (stats.mode & 0o007) !== 0) {
    throw new Error(`${description} must be runtime-owned, owner-readable/writable, and inaccessible to other users`);
  }
  fs.accessSync(filePath, fs.constants.R_OK | fs.constants.W_OK);
  return stats;
}

function assertActivationJournalReadable(filePath, runtimeGid) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (
      !stats.isFile()
      || stats.nlink !== 1
      || stats.size <= 0
      || stats.size > 256 * 1024
      || stats.uid !== 0
      || stats.gid !== runtimeGid
      || (stats.mode & 0o777) !== 0o640
    ) {
      throw new Error("activation journal is not a root-owned, runtime-group-readable mode-0640 file");
    }
    JSON.parse(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function main() {
  if (process.platform !== "linux" || typeof process.geteuid !== "function" || process.geteuid() === 0) {
    throw new Error("runtime data-access proof must run as the non-root Linux service account");
  }
  const runtimeUid = process.geteuid();
  const runtimeGid = process.getegid();
  const dataDirectory = assertPhysicalDirectory(required("DATA_DIRECTORY"), "runtime data root", { writable: true });
  if (dataDirectory.stats.uid !== runtimeUid || (dataDirectory.stats.mode & 0o777) !== 0o700) {
    throw new Error("runtime data root must be owned by the service uid with exact mode 0700");
  }

  const releaseDirectory = assertPhysicalDirectory(required("BIRDORA_RELEASE_DIR"), "candidate release").resolved;
  for (const relativePath of ["server.js", "package.json", "node_modules/.modules.yaml"]) {
    const runtimeFile = path.join(releaseDirectory, relativePath);
    const stats = fs.lstatSync(runtimeFile);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error(`candidate runtime file is unsafe: ${relativePath}`);
    }
    fs.accessSync(runtimeFile, fs.constants.R_OK);
  }

  const databaseFile = path.resolve(required("DATABASE_FILE"));
  if (path.dirname(databaseFile) !== dataDirectory.resolved) {
    throw new Error("database must be a direct file in the runtime data root");
  }
  const databaseStats = assertRuntimeOwnedDataFile(databaseFile, "production database", runtimeUid);
  if (databaseStats.size <= 0) throw new Error("production database is empty");

  const sidecars = [];
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    const sidecarPath = `${databaseFile}${suffix}`;
    try {
      fs.lstatSync(sidecarPath);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const stats = assertRuntimeOwnedDataFile(sidecarPath, `SQLite sidecar ${suffix}`, runtimeUid);
    sidecars.push({ suffix, bytes: stats.size });
  }

  const journalRequired = process.env.REQUIRE_ACTIVATION_JOURNAL === "true";
  if (journalRequired) {
    assertActivationJournalReadable(required("ACTIVATION_PENDING_FILE"), runtimeGid);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    runtimeUid,
    runtimeGid,
    databaseBytes: databaseStats.size,
    sidecars,
    activationJournalReadable: journalRequired,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "RUNTIME_DATA_ACCESS_PROOF_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
