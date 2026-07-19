require("dotenv").config({ quiet: true });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { backup, DatabaseSync } = require("node:sqlite");
const {
  closeDatabase,
  getDatabaseHealth,
  getLastMigrationReport,
  initializeDatabase,
  preflightDatabase,
} = require("../app/db/database");
const { assertExclusiveDatabaseLifecycleLock } = require("../app/runtime/database-lifecycle-lock");
const {
  addCanonicalV16Compatibility,
  assertExpectedGap,
  assertRegularSingleLink,
} = require("./prepare-legacy-v1-6-probe");

const APPROVAL = "APPLY_VERIFIED_LEGACY_V1_6_ADOPTION";
const PRODUCTION_DATABASE = "/var/lib/birdora/birdora.sqlite";
const PRODUCTION_BACKUP_ROOT = "/var/lib/birdora-protected/backups";
const TEST_ROOT = "/root/birdora-staging";

function requiredAbsolutePath(name) {
  const value = String(process.env[name] || "").trim();
  if (!value || !path.isAbsolute(value)) throw new Error(`${name} must be an absolute path`);
  return path.resolve(value);
}

function isWithin(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertApplyPaths(databaseFile, backupDirectory) {
  const testMode = process.env.NODE_ENV === "test"
    && process.env.BIRDORA_LEGACY_ADOPTION_TEST_MODE === "true";
  if (testMode) {
    if (!isWithin(TEST_ROOT, databaseFile) || !isWithin(TEST_ROOT, backupDirectory)) {
      throw new Error("Legacy adoption test paths must stay under the staging root");
    }
    return { testMode: true };
  }
  if (databaseFile !== PRODUCTION_DATABASE) {
    throw new Error(`Production legacy adoption is fixed to ${PRODUCTION_DATABASE}`);
  }
  if (!isWithin(PRODUCTION_BACKUP_ROOT, backupDirectory)) {
    throw new Error(`Production legacy backups must stay under ${PRODUCTION_BACKUP_ROOT}`);
  }
  return { testMode: false };
}

function assertPrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0) {
    throw new Error(`${directory} must be a physical private directory`);
  }
}

function assertPort3003NotListening() {
  for (const procFile of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const lines = fs.readFileSync(procFile, "utf8").trim().split("\n").slice(1);
    for (const line of lines) {
      const fields = line.trim().split(/\s+/u);
      const localAddress = fields[1] || "";
      const state = fields[3] || "";
      const portHex = localAddress.split(":").at(-1)?.toUpperCase();
      if (portHex === "0BBB" && state === "0A") {
        throw new Error("Legacy adoption requires TCP port 3003 to have no listener");
      }
    }
  }
}

function assertDatabaseHasNoOtherOpeners(databaseFile) {
  const identities = [databaseFile, `${databaseFile}-wal`, `${databaseFile}-shm`]
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => fs.statSync(candidate, { bigint: true }));
  for (const processName of fs.readdirSync("/proc")) {
    if (!/^\d+$/u.test(processName) || Number(processName) === process.pid) continue;
    let descriptors;
    try {
      descriptors = fs.readdirSync(`/proc/${processName}/fd`);
    } catch {
      continue;
    }
    for (const descriptor of descriptors) {
      try {
        const stats = fs.statSync(`/proc/${processName}/fd/${descriptor}`, { bigint: true });
        if (identities.some((identity) => identity.dev === stats.dev && identity.ino === stats.ino)) {
          throw new Error(`Legacy adoption database is still open by PID ${processName}`);
        }
      } catch (error) {
        if (error.message.startsWith("Legacy adoption database is still open")) throw error;
      }
    }
  }
}

function assertLegacyWriterStopped(databaseFile, testMode) {
  if (testMode) return;
  assertPort3003NotListening();
  assertDatabaseHasNoOtherOpeners(databaseFile);
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function verifyDatabaseFile(databaseFile) {
  assertRegularSingleLink(databaseFile, "database snapshot");
  const db = new DatabaseSync(databaseFile, { readOnly: true });
  try {
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.some((row) => row.integrity_check !== "ok")) {
      throw new Error("Database snapshot integrity_check failed");
    }
    const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) {
      throw new Error(`Database snapshot foreign_key_check found ${foreignKeyErrors.length} violation(s)`);
    }
  } finally {
    db.close();
  }
}

function writeManifest(manifestPath, manifest) {
  const descriptor = fs.openSync(manifestPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  const directoryDescriptor = fs.openSync(path.dirname(manifestPath), "r");
  try {
    fs.fsyncSync(directoryDescriptor);
  } finally {
    fs.closeSync(directoryDescriptor);
  }
}

async function createRawBackup(databaseFile, backupDirectory) {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/gu, "");
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const backupPath = path.join(
    backupDirectory,
    `birdora-pre-legacy-adoption-${timestamp}-${suffix}.sqlite`
  );
  const manifestPath = `${backupPath}.manifest.json`;
  let source = null;
  try {
    source = new DatabaseSync(databaseFile, { readOnly: true });
    await backup(source, backupPath);
  } finally {
    if (source) source.close();
  }
  fs.chmodSync(backupPath, 0o600);
  verifyDatabaseFile(backupPath);
  const stats = fs.statSync(backupPath);
  const sha256 = sha256File(backupPath);
  writeManifest(manifestPath, {
    formatVersion: 1,
    kind: "birdora-legacy-v1.6-pre-adoption-backup",
    createdAt: new Date().toISOString(),
    sourceDatabase: databaseFile,
    backupPath,
    bytes: stats.size,
    sha256,
  });
  return { backupPath, manifestPath, sha256, bytes: stats.size };
}

function rehearseFullMigration(rawBackup, backupDirectory) {
  const rehearsalPath = `${rawBackup.backupPath}.rehearsal.sqlite`;
  fs.copyFileSync(rawBackup.backupPath, rehearsalPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(rehearsalPath, 0o600);
  try {
    assertExpectedGap(rehearsalPath, backupDirectory);
    addCanonicalV16Compatibility(rehearsalPath);
    const preflight = preflightDatabase({
      databaseFile: rehearsalPath,
      backupDirectory,
      autoMigrate: false,
      backupEnabled: true,
      legacyJsonImportMode: "disabled",
      nodeEnvironment: "development",
    });
    if (!preflight.safeToApply || preflight.targetVersion !== "V009") {
      throw new Error("Legacy adoption rehearsal preflight did not authorize V009");
    }
    initializeDatabase({
      databaseFile: rehearsalPath,
      dataDirectory: path.dirname(rehearsalPath),
      backupDirectory,
      autoMigrate: true,
      migrationCommand: true,
      backupEnabled: true,
      legacyJsonImportMode: "disabled",
      nodeEnvironment: "development",
    });
    const health = getDatabaseHealth();
    if (!health.ready || health.schemaVersion !== "V009") {
      throw new Error("Legacy adoption rehearsal did not reach V009 readiness");
    }
  } finally {
    closeDatabase();
    fs.rmSync(rehearsalPath, { force: true });
  }
}

async function main() {
  process.umask(0o077);
  if (process.platform !== "linux") throw new Error("Legacy adoption apply requires Linux");
  if (process.env.BIRDORA_LEGACY_V1_6_APPLY_APPROVED !== APPROVAL) {
    throw new Error("Legacy adoption apply approval token is missing");
  }
  const databaseFile = requiredAbsolutePath("DATABASE_FILE");
  const backupDirectory = requiredAbsolutePath("DATABASE_BACKUP_DIR");
  const mode = assertApplyPaths(databaseFile, backupDirectory);
  assertRegularSingleLink(databaseFile, "DATABASE_FILE");
  assertPrivateDirectory(backupDirectory);
  const lock = assertExclusiveDatabaseLifecycleLock();

  assertExpectedGap(databaseFile, backupDirectory);
  assertLegacyWriterStopped(databaseFile, mode.testMode);
  const rawBackup = await createRawBackup(databaseFile, backupDirectory);
  rehearseFullMigration(rawBackup, backupDirectory);

  // No source mutation occurs before the raw backup and full V009 rehearsal pass.
  assertExpectedGap(databaseFile, backupDirectory);
  assertLegacyWriterStopped(databaseFile, mode.testMode);
  addCanonicalV16Compatibility(databaseFile);
  const normalized = preflightDatabase({
    databaseFile,
    backupDirectory,
    autoMigrate: false,
    backupEnabled: true,
    legacyJsonImportMode: "disabled",
    nodeEnvironment: mode.testMode ? "development" : "production",
  });
  if (!normalized.safeToApply || normalized.targetVersion !== "V009") {
    throw new Error("Normalized production database did not authorize V009 migration");
  }

  try {
    initializeDatabase({
      databaseFile,
      dataDirectory: path.dirname(databaseFile),
      backupDirectory,
      autoMigrate: true,
      migrationCommand: true,
      backupEnabled: true,
      legacyJsonImportMode: "disabled",
      nodeEnvironment: mode.testMode ? "development" : "production",
    });
    const health = getDatabaseHealth();
    const report = getLastMigrationReport();
    if (!health.ready || health.schemaVersion !== "V009") {
      throw new Error("Legacy adoption apply did not reach V009 readiness");
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: mode.testMode ? "test-apply" : "production-apply",
      lockMode: lock.mode,
      schemaVersion: health.schemaVersion,
      appliedNow: report?.appliedNow || [],
      rawBackup,
      migrationBackupPath: report?.backup?.backupPath || null,
      migrationBackupSha256: report?.backup?.sha256 || null,
    })}\n`);
  } finally {
    closeDatabase();
  }
}

main().catch((error) => {
  closeDatabase();
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "LEGACY_V1_6_APPLY_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
});
