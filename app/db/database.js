const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  DEFAULT_MIGRATIONS_DIRECTORY,
  inspectMigrationStatus,
  normalizeLegacyJsonImportMode,
  runMigrations,
} = require("./migration-runner");
const {
  createValidatedBackup,
  estimatedBackupPath,
  inspectBackupCapacity,
  normalizeBackupRetention,
  normalizeBoolean,
} = require("./migration-safety");

const defaultDataDirectory = path.join(__dirname, "..", "data");

let database = null;
let activeDatabaseFile = null;
let activeTargetVersion = null;
let activeMigrationLedger = null;
let lastMigrationReport = null;

function normalizeDatabaseFile(databaseFile) {
  return databaseFile === ":memory:" ? databaseFile : path.resolve(databaseFile);
}

function resolveDatabaseOptions(options = {}) {
  const configuredDataDirectory = options.dataDirectory
    ?? process.env.DATA_DIRECTORY
    ?? null;
  const fallbackDataDirectory = path.resolve(
    configuredDataDirectory || defaultDataDirectory
  );
  const databaseFile = normalizeDatabaseFile(
    options.databaseFile
      || process.env.DATABASE_FILE
      || path.join(fallbackDataDirectory, "birdora.sqlite")
  );
  const dataDirectory = configuredDataDirectory
    ? path.resolve(configuredDataDirectory)
    : (databaseFile === ":memory:"
        ? fallbackDataDirectory
        : path.dirname(databaseFile));
  const nodeEnvironment = String(
    options.nodeEnvironment ?? process.env.NODE_ENV ?? "development"
  ).trim().toLowerCase();
  const productionLike = nodeEnvironment === "production"
    || /[\\/]var[\\/]lib[\\/]birdora(?:[\\/]|$)/iu.test(databaseFile)
    || String(process.env.PORT || "") === "3003"
    || /https:\/\/birdora\./iu.test(
      String(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGIN || "")
    );
  const autoMigrateRequested = normalizeBoolean(
    options.autoMigrate ?? process.env.DATABASE_AUTO_MIGRATE,
    !productionLike,
    "DATABASE_AUTO_MIGRATE"
  );
  const migrationCommand = options.migrationCommand === true;
  const productionAutoMigrateRejected = productionLike
    && autoMigrateRequested
    && !migrationCommand;
  const backupDirectory = path.resolve(
    options.backupDirectory
      ?? process.env.DATABASE_BACKUP_DIR
      ?? path.join(
        databaseFile === ":memory:" ? dataDirectory : path.dirname(databaseFile),
        "backups"
      )
  );

  return {
    dataDirectory,
    databaseFile,
    migrationsDirectory: path.resolve(
      options.migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY
    ),
    targetVersion: options.targetVersion,
    autoMigrate: productionAutoMigrateRejected ? false : autoMigrateRequested,
    autoMigrateRequested,
    migrationCommand,
    productionAutoMigrateRejected,
    backupEnabled: normalizeBoolean(
      options.backupEnabled ?? process.env.DATABASE_BACKUP_ENABLED,
      true,
      "DATABASE_BACKUP_ENABLED"
    ),
    backupDirectory,
    backupRetention: normalizeBackupRetention(
      options.backupRetention ?? process.env.DATABASE_BACKUP_RETENTION
    ),
    backupStatfs: options.backupStatfs,
    legacyJsonImportMode: normalizeLegacyJsonImportMode(
      options.legacyJsonImportMode
        || process.env.LEGACY_JSON_IMPORT_MODE
        || "optional"
    ),
    now: options.now,
    nodeEnvironment,
    productionLike,
  };
}

function migrationOptions(resolved) {
  return {
    dataDirectory: resolved.dataDirectory,
    migrationsDirectory: resolved.migrationsDirectory,
    targetVersion: resolved.targetVersion,
    legacyJsonImportMode: resolved.legacyJsonImportMode,
    now: resolved.now,
  };
}

function configureConnection(db, options = {}) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA legacy_alter_table = OFF;
  `);

  if (options.enableWal) {
    db.exec("PRAGMA journal_mode = WAL;");
  }

  const foreignKeys = Number(db.prepare("PRAGMA foreign_keys").get().foreign_keys);
  if (foreignKeys !== 1) {
    throw new Error("SQLite foreign key enforcement could not be enabled");
  }
}

function inspectResolvedDatabase(resolved) {
  const sourceExists = resolved.databaseFile !== ":memory:"
    && fs.existsSync(resolved.databaseFile)
    && fs.statSync(resolved.databaseFile).size > 0;
  const sourceBytes = sourceExists
    ? fs.statSync(resolved.databaseFile, { bigint: true }).size
    : 0n;
  const sourceWalPath = `${resolved.databaseFile}-wal`;
  const sourceWalBytes = sourceExists && fs.existsSync(sourceWalPath)
    ? fs.statSync(sourceWalPath, { bigint: true }).size
    : 0n;
  const inspectionDatabase = sourceExists
    ? new DatabaseSync(resolved.databaseFile, { readOnly: true })
    : new DatabaseSync(":memory:");
  let status;
  let journalMode;
  try {
    status = inspectMigrationStatus(
      inspectionDatabase,
      migrationOptions(resolved)
    );
    journalMode = String(
      inspectionDatabase.prepare("PRAGMA journal_mode").get().journal_mode
    ).toLowerCase();
  } finally {
    inspectionDatabase.close();
  }

  const requiresBackup = status.pendingVersions.length > 0 && !status.databaseEmpty;
  let capacity = null;
  if (requiresBackup && resolved.backupEnabled) {
    capacity = inspectBackupCapacity(
      resolved.databaseFile,
      resolved.backupDirectory,
      { statfs: resolved.backupStatfs }
    );
  }
  const safeToApply = !requiresBackup
    || (resolved.backupEnabled && capacity?.sufficient === true);
  const now = typeof resolved.now === "function" ? resolved.now() : new Date();

  return {
    readOnly: true,
    databasePath: resolved.databaseFile,
    databaseExists: sourceExists,
    databaseBytes: sourceBytes.toString(),
    databaseWalBytes: sourceWalBytes.toString(),
    journalMode,
    ...status,
    autoMigrate: resolved.autoMigrate,
    autoMigrateRequested: resolved.autoMigrateRequested,
    productionAutoMigrateRejected: resolved.productionAutoMigrateRejected,
    productionLike: resolved.productionLike,
    requiresBackup,
    safeToApply,
    explicitMigrationAllowed: safeToApply,
    serverStartupAllowed: status.pendingVersions.length === 0
      || (resolved.autoMigrate && safeToApply),
    backup: {
      enabled: resolved.backupEnabled,
      directory: resolved.backupDirectory,
      retention: resolved.backupRetention,
      estimatedPath: requiresBackup
        ? estimatedBackupPath(resolved, status, now)
        : null,
      capacity,
    },
    backupScope: {
      includes: ["SQLite schema and rows"],
      excludes: ["community and observation media files stored outside SQLite"],
      mediaBackupRequiredSeparately: true,
    },
  };
}

function preflightDatabase(options = {}) {
  return inspectResolvedDatabase(resolveDatabaseOptions(options));
}

function acquireMigrationLock(databaseFile, timeoutMs = 30_000) {
  if (databaseFile === ":memory:") return null;
  const lockPath = `${databaseFile}.migration.lock`;
  const deadline = Date.now() + timeoutMs;
  const waitArray = new Int32Array(new SharedArrayBuffer(4));
  while (true) {
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, "wx", 0o600);
      try {
        fs.writeFileSync(descriptor, `${JSON.stringify({
          pid: process.pid,
          acquiredAt: new Date().toISOString(),
        })}\n`);
        fs.fsyncSync(descriptor);
        return { descriptor, lockPath };
      } catch (error) {
        fs.closeSync(descriptor);
        fs.rmSync(lockPath, { force: true });
        throw error;
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for database migration lock: ${lockPath}`);
      }
      Atomics.wait(waitArray, 0, 0, 100);
    }
  }
}

function releaseMigrationLock(lock) {
  if (!lock) return;
  try {
    fs.closeSync(lock.descriptor);
  } finally {
    fs.rmSync(lock.lockPath, { force: true });
  }
}

function createDatabaseSnapshot(options = {}) {
  if (database) {
    throw new Error("Close the active application database before creating a rollback snapshot");
  }
  const resolved = resolveDatabaseOptions(options);
  if (
    resolved.databaseFile === ":memory:"
    || !fs.existsSync(resolved.databaseFile)
    || fs.statSync(resolved.databaseFile).size <= 0
  ) {
    return {
      snapshotRequired: false,
      databasePath: resolved.databaseFile,
      reason: "database-missing-or-empty",
    };
  }

  let lock = null;
  let source = null;
  try {
    lock = acquireMigrationLock(resolved.databaseFile);
    source = new DatabaseSync(resolved.databaseFile, { readOnly: true });
    source.exec("PRAGMA busy_timeout = 5000;");
    const status = inspectMigrationStatus(source, migrationOptions(resolved));
    const schemaObjectCount = Number(source.prepare(`
      SELECT COUNT(*) AS count
      FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%'
    `).get().count);
    if (schemaObjectCount === 0) {
      return {
        snapshotRequired: false,
        databasePath: resolved.databaseFile,
        reason: "database-has-no-schema",
      };
    }
    if (!resolved.backupEnabled) {
      throw new Error("Database snapshot requires DATABASE_BACKUP_ENABLED=true");
    }
    const backup = createValidatedBackup(source, status, resolved, {
      statfs: resolved.backupStatfs,
      now: typeof resolved.now === "function" ? resolved.now() : new Date(),
    });
    return { snapshotRequired: true, ...backup };
  } finally {
    try {
      if (source) source.close();
    } finally {
      releaseMigrationLock(lock);
    }
  }
}

function initializeDatabase(options = {}) {
  // Service-layer callers intentionally call getDatabase() without repeating
  // startup configuration. Only an explicit option object represents a
  // request to select or verify another database target.
  if (database && Object.keys(options).length === 0) {
    return database;
  }

  const resolved = resolveDatabaseOptions(options);
  if (resolved.productionAutoMigrateRejected) {
    throw new Error(
      "DATABASE_AUTO_MIGRATE=true is forbidden for production server startup; stop old instances and use the explicit db:migrate command"
    );
  }
  if (database) {
    if (resolved.databaseFile !== activeDatabaseFile) {
      throw new Error(
        `Database is already initialized at ${activeDatabaseFile}; requested ${resolved.databaseFile}`
      );
    }
    return database;
  }

  let candidate = null;
  let migrationLock = null;
  try {
    let readOnlyStatus = inspectResolvedDatabase(resolved);
    if (readOnlyStatus.pendingVersions.length && !resolved.autoMigrate) {
      throw new Error(
        `Database migrations are pending (${readOnlyStatus.pendingVersions.join(", ")}) and automatic migration is disabled. Stop old instances, run npm run db:preflight, then run npm run db:migrate before starting the server.`
      );
    }
    if (readOnlyStatus.pendingVersions.length && resolved.databaseFile !== ":memory:") {
      fs.mkdirSync(path.dirname(resolved.databaseFile), { recursive: true });
      migrationLock = acquireMigrationLock(resolved.databaseFile);
      // Another explicit migrator may have completed while this process waited.
      // Recompute the snapshot and backup decision while holding the lock.
      readOnlyStatus = inspectResolvedDatabase(resolved);
    }
    if (!readOnlyStatus.safeToApply) {
      const capacity = readOnlyStatus.backup.capacity;
      const detail = capacity
        ? ` required=${capacity.requiredBytes} available=${capacity.availableBytes}`
        : "";
      throw new Error(
        `Database migration backup gate is not satisfied.${detail}`
      );
    }

    if (resolved.databaseFile !== ":memory:") {
      fs.mkdirSync(path.dirname(resolved.databaseFile), { recursive: true });
    }
    candidate = new DatabaseSync(resolved.databaseFile);
    candidate.exec("PRAGMA busy_timeout = 5000;");
    const sourceStatus = inspectMigrationStatus(
      candidate,
      migrationOptions(resolved)
    );
    if (sourceStatus.pendingVersions.length && !resolved.autoMigrate) {
      throw new Error(
        `Database migrations became pending during startup (${sourceStatus.pendingVersions.join(", ")}); automatic migration is disabled. Retry preflight and run npm run db:migrate explicitly.`
      );
    }
    if (
      sourceStatus.pendingVersions.length
      && resolved.databaseFile !== ":memory:"
      && !migrationLock
    ) {
      throw new Error(
        "Database migration state changed after preflight; retry so the migration lock and backup gate can be established"
      );
    }
    let backupManifest = null;
    if (sourceStatus.pendingVersions.length && !sourceStatus.databaseEmpty) {
      backupManifest = createValidatedBackup(candidate, sourceStatus, resolved, {
        statfs: resolved.backupStatfs,
        now: typeof resolved.now === "function" ? resolved.now() : new Date(),
      });
    }
    // journal_mode is persistent. It is changed only for a new empty database
    // or after a validated source backup has been durably written.
    configureConnection(candidate, {
      enableWal: sourceStatus.databaseEmpty || Boolean(backupManifest),
    });
    const migrationResult = sourceStatus.pendingVersions.length
      ? runMigrations(candidate, migrationOptions(resolved))
      : {
          currentVersion: sourceStatus.targetVersion,
          appliedNow: [],
          ledger: sourceStatus.ledger,
          checks: sourceStatus.checks,
        };

    database = candidate;
    activeDatabaseFile = resolved.databaseFile;
    activeTargetVersion = migrationResult.currentVersion;
    activeMigrationLedger = migrationResult.ledger;
    lastMigrationReport = {
      databasePath: resolved.databaseFile,
      previousSchemaVersion: sourceStatus.currentVersion,
      targetSchemaVersion: migrationResult.currentVersion,
      pendingBefore: sourceStatus.pendingVersions,
      appliedNow: migrationResult.appliedNow,
      backup: backupManifest,
    };
    return database;
  } catch (error) {
    if (candidate) {
      try {
        candidate.close();
      } catch {
        // Initialization already failed; never publish this connection.
      }
    }
    database = null;
    activeDatabaseFile = null;
    activeTargetVersion = null;
    activeMigrationLedger = null;
    lastMigrationReport = null;
    throw error;
  } finally {
    releaseMigrationLock(migrationLock);
  }
}

function getDatabase(options = {}) {
  return initializeDatabase(options);
}

function closeDatabase() {
  if (!database) return;
  database.close();
  database = null;
  activeDatabaseFile = null;
  activeTargetVersion = null;
  activeMigrationLedger = null;
}

function getDatabaseHealth() {
  if (!database) {
    return {
      ready: false,
      schemaVersion: null,
      targetSchemaVersion: null,
      ledgerVerified: false,
    };
  }

  try {
    database.prepare("SELECT 1 AS ok").get();
    const ledger = database.prepare(`
      SELECT version, name, checksum, applied_at
      FROM schema_migrations
      ORDER BY version ASC
    `).all().map((migration) => ({ ...migration }));
    const schemaVersion = ledger.at(-1)?.version || null;
    const ledgerVerified = Boolean(
      activeMigrationLedger
      && JSON.stringify(ledger) === JSON.stringify(activeMigrationLedger)
    );
    return {
      ready: Boolean(
        activeTargetVersion
        && schemaVersion === activeTargetVersion
        && ledgerVerified
      ),
      schemaVersion,
      targetSchemaVersion: activeTargetVersion,
      ledgerVerified,
    };
  } catch {
    return {
      ready: false,
      schemaVersion: null,
      targetSchemaVersion: activeTargetVersion,
      ledgerVerified: false,
    };
  }
}

function getLastMigrationReport() {
  return lastMigrationReport;
}

function mapUserRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    bio: row.bio || "",
    gender: row.gender || "",
    age: Number.isInteger(row.age) ? row.age : null,
    avatarUrl: row.avatar_url || "",
    emailNotifications: Boolean(row.email_notifications),
    publicProfile: Boolean(row.public_profile),
    accountStatus: row.account_status || "active",
    deletionRequestedAt: row.deletion_requested_at || null,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  closeDatabase,
  createDatabaseSnapshot,
  getDatabaseHealth,
  getDatabase,
  getLastMigrationReport,
  initializeDatabase,
  mapUserRow,
  preflightDatabase,
  resolveDatabaseOptions,
};
