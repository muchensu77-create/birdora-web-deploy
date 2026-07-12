const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  listUserTables,
  readUserTableCounts,
  verifyDatabaseIntegrity,
} = require("./migration-runner");

const DEFAULT_BACKUP_RETENTION = 10;
const MINIMUM_BACKUP_MARGIN_BYTES = 64n * 1024n * 1024n;

function normalizeBoolean(value, defaultValue, variableName) {
  if (value === undefined || value === null || value === "") return defaultValue;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${variableName} must be true or false`);
}

function normalizeBackupRetention(value = DEFAULT_BACKUP_RETENTION) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1000) {
    throw new Error("DATABASE_BACKUP_RETENTION must be an integer from 1 to 1000");
  }
  return parsed;
}

function safeName(value) {
  return String(value || "none").replace(/[^A-Za-z0-9._-]+/gu, "-");
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/gu, "").replace(".", "-");
}

function backupFilePrefix(databaseFile) {
  return `${safeName(path.basename(databaseFile, path.extname(databaseFile)))}.migration-`;
}

function estimatedBackupPath(settings, status, now = new Date()) {
  const prefix = backupFilePrefix(settings.databaseFile);
  return path.join(
    settings.backupDirectory,
    `${prefix}${safeName(status.currentVersion || "legacy")}-to-${safeName(status.targetVersion)}-${compactTimestamp(now)}-<unique>.sqlite`
  );
}

function actualBackupPath(settings, status, now = new Date()) {
  const prefix = backupFilePrefix(settings.databaseFile);
  const unique = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  return path.join(
    settings.backupDirectory,
    `${prefix}${safeName(status.currentVersion || "legacy")}-to-${safeName(status.targetVersion)}-${compactTimestamp(now)}-${unique}.sqlite`
  );
}

function nearestExistingDirectory(directory) {
  let candidate = path.resolve(directory);
  while (!fs.existsSync(candidate)) {
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  const stats = fs.statSync(candidate);
  if (!stats.isDirectory()) {
    throw new Error(`Backup path parent is not a directory: ${candidate}`);
  }
  return candidate;
}

function inspectBackupCapacity(databaseFile, backupDirectory, options = {}) {
  const sourceBytes = fs.statSync(databaseFile, { bigint: true }).size;
  const walPath = `${databaseFile}-wal`;
  const sourceWalBytes = fs.existsSync(walPath)
    ? fs.statSync(walPath, { bigint: true }).size
    : 0n;
  const sourceSnapshotBytes = sourceBytes + sourceWalBytes;
  const proportionalMargin = sourceSnapshotBytes / 5n;
  const safetyMarginBytes = options.safetyMarginBytes === undefined
    ? (proportionalMargin > MINIMUM_BACKUP_MARGIN_BYTES
        ? proportionalMargin
        : MINIMUM_BACKUP_MARGIN_BYTES)
    : BigInt(options.safetyMarginBytes);
  const requiredBytes = sourceSnapshotBytes + safetyMarginBytes;
  const capacityRoot = nearestExistingDirectory(backupDirectory);
  const statfs = options.statfs || ((target) => fs.statfsSync(target, { bigint: true }));
  const stats = statfs(capacityRoot);
  const blockSize = BigInt(stats.bsize);
  const availableBlocks = BigInt(stats.bavail ?? stats.bfree);
  const availableBytes = blockSize * availableBlocks;
  return {
    capacityRoot,
    sourceBytes: sourceBytes.toString(),
    sourceWalBytes: sourceWalBytes.toString(),
    sourceSnapshotBytes: sourceSnapshotBytes.toString(),
    safetyMarginBytes: safetyMarginBytes.toString(),
    requiredBytes: requiredBytes.toString(),
    availableBytes: availableBytes.toString(),
    sufficient: availableBytes >= requiredBytes,
  };
}

function assertBackupCapacity(databaseFile, backupDirectory, options = {}) {
  const capacity = inspectBackupCapacity(databaseFile, backupDirectory, options);
  if (!capacity.sufficient) {
    throw new Error(
      `Insufficient backup space: required=${capacity.requiredBytes} available=${capacity.availableBytes}`
    );
  }
  return capacity;
}

function hashFileSync(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function fsyncFile(filePath) {
  const descriptor = fs.openSync(filePath, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, "r");
    fs.fsyncSync(descriptor);
  } catch (error) {
    // Windows does not expose a portable directory FlushFileBuffers call.
    // Both files are still individually flushed before this point.
    if (process.platform !== "win32") throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function compareSnapshot(sourceStatus, backupTables, backupCounts) {
  if (JSON.stringify(backupTables) !== JSON.stringify(sourceStatus.userTables)) {
    throw new Error("Validated backup table list does not match the source snapshot");
  }
  for (const tableNameValue of sourceStatus.userTables) {
    if (backupCounts[tableNameValue] !== sourceStatus.userTableCounts[tableNameValue]) {
      throw new Error(
        `Validated backup row count mismatch for ${tableNameValue}: source=${sourceStatus.userTableCounts[tableNameValue]} backup=${backupCounts[tableNameValue]}`
      );
    }
  }
}

function cleanupIncompleteBackup(backupPath, manifestPath) {
  for (const candidate of [manifestPath, backupPath]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    try {
      fs.rmSync(candidate, { force: true });
    } catch {
      try {
        fs.renameSync(candidate, `${candidate}.incomplete-${Date.now()}`);
      } catch {
        // The original failure is more actionable; the non-.sqlite suffix
        // keeps any residue from being mistaken for a validated backup.
      }
    }
  }
}

function pruneValidatedBackups(settings, protectedManifestPath) {
  const prefix = backupFilePrefix(settings.databaseFile);
  const directory = path.resolve(settings.backupDirectory);
  const manifests = fs.readdirSync(directory)
    .filter((fileName) => (
      fileName.startsWith(prefix) && fileName.endsWith(".sqlite.manifest.json")
    ))
    .map((fileName) => ({
      fileName,
      path: path.join(directory, fileName),
      mtimeMs: fs.statSync(path.join(directory, fileName)).mtimeMs,
    }))
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const protectedPath = path.resolve(protectedManifestPath);
  const retained = new Set([protectedPath]);
  for (const candidate of manifests) {
    if (retained.size >= settings.backupRetention) break;
    retained.add(path.resolve(candidate.path));
  }

  const warnings = [];
  for (const stale of manifests.filter(
    (candidate) => !retained.has(path.resolve(candidate.path))
  )) {
    const backupPath = stale.path.slice(0, -".manifest.json".length);
    if (
      path.dirname(backupPath) !== directory
      || !path.basename(backupPath).startsWith(prefix)
    ) {
      warnings.push(`Refused unsafe retention path: ${backupPath}`);
      continue;
    }
    try {
      fs.rmSync(backupPath, { force: true });
      fs.rmSync(stale.path, { force: true });
    } catch (error) {
      // Retention cleanup never invalidates the newly verified/durable backup.
      // Keeping an extra old backup is safer than blocking the migration after
      // the replacement snapshot has already been committed to disk.
      warnings.push(`${stale.fileName}: ${error.message}`);
    }
  }
  return warnings;
}

function createValidatedBackup(db, sourceStatus, settings, options = {}) {
  if (!settings.backupEnabled) {
    throw new Error(
      "Pending migrations on a non-empty database require DATABASE_BACKUP_ENABLED=true"
    );
  }
  if (settings.databaseFile === ":memory:") {
    throw new Error("Cannot create a recoverable migration backup for an in-memory database");
  }

  const capacity = assertBackupCapacity(
    settings.databaseFile,
    settings.backupDirectory,
    options
  );
  fs.mkdirSync(settings.backupDirectory, { recursive: true, mode: 0o700 });
  const createdAt = (options.now || new Date()).toISOString();
  const backupPath = actualBackupPath(
    settings,
    sourceStatus,
    new Date(createdAt)
  );
  const manifestPath = `${backupPath}.manifest.json`;
  const sourceJournalMode = String(
    db.prepare("PRAGMA journal_mode").get().journal_mode
  ).toLowerCase();

  try {
    if (fs.existsSync(backupPath) || fs.existsSync(manifestPath)) {
      throw new Error(`Refusing to overwrite existing migration backup: ${backupPath}`);
    }
    db.prepare("VACUUM INTO ?").run(backupPath);
    fs.chmodSync(backupPath, 0o600);
    fsyncFile(backupPath);
    const backupStats = fs.statSync(backupPath);
    if (!backupStats.isFile() || backupStats.size <= 0) {
      throw new Error("SQLite VACUUM INTO did not create a non-empty backup file");
    }

    const backup = new DatabaseSync(backupPath, { readOnly: true });
    let backupChecks;
    let backupTables;
    let backupCounts;
    let backupJournalMode;
    try {
      backupChecks = verifyDatabaseIntegrity(backup);
      backupTables = listUserTables(backup);
      backupCounts = readUserTableCounts(backup, backupTables);
      backupJournalMode = String(
        backup.prepare("PRAGMA journal_mode").get().journal_mode
      ).toLowerCase();
    } finally {
      backup.close();
    }
    compareSnapshot(sourceStatus, backupTables, backupCounts);

    const manifest = {
      formatVersion: 1,
      createdAt,
      sourceDatabasePath: settings.databaseFile,
      backupPath,
      manifestPath,
      sourceDatabaseBytes: capacity.sourceBytes,
      sourceWalBytes: capacity.sourceWalBytes,
      backupBytes: String(backupStats.size),
      sha256: hashFileSync(backupPath),
      sourceJournalMode,
      backupJournalMode,
      preMigrationSchemaVersion: sourceStatus.currentVersion,
      targetSchemaVersion: sourceStatus.targetVersion,
      pendingVersions: sourceStatus.pendingVersions,
      integrity: backupChecks,
      userTableCounts: backupCounts,
      capacity,
      backupScope: {
        includes: ["SQLite schema and rows"],
        excludes: ["community and observation media files stored outside SQLite"],
        mediaBackupRequiredSeparately: true,
      },
    };
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 }
    );
    fsyncFile(manifestPath);
    fsyncDirectory(settings.backupDirectory);
    const retentionWarnings = pruneValidatedBackups(settings, manifestPath);
    return { ...manifest, retentionWarnings };
  } catch (error) {
    cleanupIncompleteBackup(backupPath, manifestPath);
    throw new Error(`Migration backup failed: ${error.message}`, { cause: error });
  }
}

module.exports = {
  DEFAULT_BACKUP_RETENTION,
  assertBackupCapacity,
  createValidatedBackup,
  estimatedBackupPath,
  inspectBackupCapacity,
  normalizeBackupRetention,
  normalizeBoolean,
};
