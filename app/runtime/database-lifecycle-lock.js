"use strict";

const fs = require("fs");
const path = require("path");
const { readPendingJournal } = require("../middleware/activation-write-gate");

const DATABASE_LIFECYCLE_LOCK = "/var/lock/birdora-db-maintenance.lock";
const ACTIVATION_PENDING_FILE = "/var/lib/birdora-control/activation-pending.json";

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function parseProcLocks(contents) {
  const locks = [];
  for (const line of String(contents || "").split("\n")) {
    if (line.includes("->")) continue;
    const fields = line.trim().split(/\s+/u);
    const flockIndex = fields.indexOf("FLOCK");
    if (flockIndex < 0 || fields.length < flockIndex + 7) continue;
    const mode = fields[flockIndex + 2];
    const pid = Number(fields[flockIndex + 3]);
    const identity = fields[flockIndex + 4] || "";
    const inodeText = identity.split(":").at(-1);
    if (!["READ", "WRITE"].includes(mode) || !Number.isSafeInteger(pid) || !/^\d+$/u.test(inodeText)) continue;
    const deviceParts = identity.split(":");
    if (deviceParts.length < 3) continue;
    const deviceMajorText = deviceParts.at(-3);
    const deviceMinorText = deviceParts.at(-2);
    if (!/^[0-9a-f]+$/iu.test(deviceMajorText) || !/^[0-9a-f]+$/iu.test(deviceMinorText)) continue;
    locks.push({
      mode,
      pid,
      deviceMajor: BigInt(`0x${deviceMajorText}`),
      deviceMinor: BigInt(`0x${deviceMinorText}`),
      inode: BigInt(inodeText),
      raw: line,
    });
  }
  return locks;
}

function assertLockFile() {
  const stats = fs.lstatSync(DATABASE_LIFECYCLE_LOCK, { bigint: true });
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1n) {
    throw new Error(`${DATABASE_LIFECYCLE_LOCK} must be a regular single-link file`);
  }
  if (stats.uid !== 0n || (stats.mode & 0o777n) !== 0o660n) {
    throw new Error(`${DATABASE_LIFECYCLE_LOCK} must be root-owned with mode 0660`);
  }
  return stats;
}

function linuxDeviceIdentity(device) {
  const value = BigInt(device);
  return {
    major: ((value & 0x00000000000fff00n) >> 8n)
      | ((value & 0xfffff00000000000n) >> 32n),
    minor: (value & 0x00000000000000ffn)
      | ((value & 0x00000ffffff00000n) >> 12n),
  };
}

function readDescriptorLocks(descriptorNumber) {
  const contents = fs.readFileSync(`/proc/self/fdinfo/${descriptorNumber}`, "utf8");
  return parseProcLocks(contents
    .split("\n")
    .filter((line) => line.startsWith("lock:"))
    .map((line) => line.slice("lock:".length).trim())
    .join("\n"));
}

function lockMatchesStats(lock, stats) {
  const device = linuxDeviceIdentity(stats.dev);
  return lock.inode === stats.ino
    && lock.deviceMajor === device.major
    && lock.deviceMinor === device.minor;
}

function assertSharedDatabaseLifecycleLock() {
  if (process.platform !== "linux") {
    throw new Error("production database lifecycle locking requires Linux /proc/locks");
  }
  const lockStats = assertLockFile();
  let holdingDescriptor = null;
  for (const descriptorName of fs.readdirSync("/proc/self/fd")) {
    try {
      if (sameFile(lockStats, fs.statSync(`/proc/self/fd/${descriptorName}`, { bigint: true }))) {
        const descriptorLocks = readDescriptorLocks(Number(descriptorName));
        if (descriptorLocks.some((lock) => (
          lock.mode === "READ" && lock.pid === process.pid && lockMatchesStats(lock, lockStats)
        ))) {
          holdingDescriptor = Number(descriptorName);
          break;
        }
      }
    } catch {
      // Descriptor may close while enumerating.
    }
  }
  if (holdingDescriptor === null) {
    throw new Error("production API process does not hold the required shared FLOCK on its lock descriptor");
  }
  return { ok: true, mode: "shared", pid: process.pid, descriptor: holdingDescriptor, lockPath: DATABASE_LIFECYCLE_LOCK };
}

function assertExclusiveDatabaseLifecycleLock() {
  if (process.platform !== "linux") {
    throw new Error("production database maintenance locking requires Linux /proc/locks");
  }
  const lockStats = assertLockFile();
  const descriptorNumber = Number(process.env.BIRDORA_DATABASE_LOCK_FD);
  if (!Number.isSafeInteger(descriptorNumber) || descriptorNumber < 3) {
    throw new Error("BIRDORA_DATABASE_LOCK_FD must identify the inherited exclusive lock descriptor");
  }
  let inheritedStats;
  try {
    inheritedStats = fs.fstatSync(descriptorNumber, { bigint: true });
  } catch {
    throw new Error("the declared database maintenance lock descriptor is not open");
  }
  if (!sameFile(lockStats, inheritedStats)) {
    throw new Error("the inherited database maintenance descriptor points to another file");
  }
  const active = readDescriptorLocks(descriptorNumber).find((lock) => (
    lock.mode === "WRITE" && lockMatchesStats(lock, lockStats)
  ));
  if (!active) throw new Error("the inherited descriptor does not carry the required exclusive FLOCK");
  return { ok: true, mode: "exclusive", descriptor: descriptorNumber, lockOwnerPid: active.pid, lockPath: DATABASE_LIFECYCLE_LOCK };
}

function assertMigrationActivationAuthorization() {
  const lock = assertExclusiveDatabaseLifecycleLock();
  const journal = readPendingJournal(ACTIVATION_PENDING_FILE);
  if (!journal) throw new Error("migration requires an activation journal");
  const attemptId = process.env.BIRDORA_ACTIVATION_ATTEMPT_ID || "";
  const revision = process.env.BIRDORA_RELEASE_REVISION || "";
  const manifestSha256 = process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || "";
  const releaseDirectory = process.env.BIRDORA_RELEASE_DIR || "";
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/u.test(attemptId)
    || !/^[0-9a-f]{40}$/u.test(revision)
    || !/^[0-9a-f]{64}$/u.test(manifestSha256)
    || !path.isAbsolute(releaseDirectory)
  ) {
    throw new Error("migration release identity environment is incomplete or invalid");
  }
  if (
    journal.formatVersion !== 2
    || journal.status !== "migration-about-to-start"
    || journal.attemptId !== attemptId
    || journal.revision !== revision
    || journal.context?.candidateArtifactManifestSha256 !== manifestSha256
    || path.resolve(journal.context?.candidateRuntimeDirectory || "")
      !== path.resolve(releaseDirectory)
  ) {
    throw new Error("migration activation journal does not authorize this release attempt");
  }
  return { ...lock, attemptId: journal.attemptId, revision: journal.revision };
}

module.exports = {
  ACTIVATION_PENDING_FILE,
  DATABASE_LIFECYCLE_LOCK,
  assertExclusiveDatabaseLifecycleLock,
  assertMigrationActivationAuthorization,
  assertSharedDatabaseLifecycleLock,
  parseProcLocks,
  linuxDeviceIdentity,
  lockMatchesStats,
  readDescriptorLocks,
  sameFile,
};
