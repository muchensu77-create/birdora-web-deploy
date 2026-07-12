const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DEFAULT_MIGRATIONS_DIRECTORY = path.join(__dirname, "migrations");
const LEDGER_COLUMNS = ["version", "name", "checksum", "applied_at"];
const LEGACY_JSON_IMPORT_MODES = new Set(["disabled", "optional", "required"]);

function normalizeLegacyJsonImportMode(value = "optional") {
  const normalized = String(value || "optional").trim().toLowerCase();
  if (!LEGACY_JSON_IMPORT_MODES.has(normalized)) {
    throw new Error(
      `Invalid LEGACY_JSON_IMPORT_MODE=${value}; expected disabled, optional, or required`
    );
  }
  return normalized;
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function tableExists(db, tableName) {
  return Boolean(
    db.prepare(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(tableName)
  );
}

function validateMigrationLedger(db) {
  if (!tableExists(db, "schema_migrations")) return false;

  const columns = db.prepare("PRAGMA table_info(schema_migrations)").all();
  const names = columns.map((column) => column.name);
  const validNames = names.length === LEDGER_COLUMNS.length
    && names.every((name, index) => name === LEDGER_COLUMNS[index]);
  const byName = new Map(columns.map((column) => [column.name, column]));
  const validShape = validNames
    && String(byName.get("version")?.type || "").toUpperCase() === "TEXT"
    && byName.get("version")?.pk === 1
    && String(byName.get("name")?.type || "").toUpperCase() === "TEXT"
    && byName.get("name")?.notnull === 1
    && String(byName.get("checksum")?.type || "").toUpperCase() === "TEXT"
    && byName.get("checksum")?.notnull === 1
    && String(byName.get("applied_at")?.type || "").toUpperCase() === "TEXT"
    && byName.get("applied_at")?.notnull === 1;

  if (!validShape) {
    throw new Error(
      "Invalid schema_migrations table; expected version/name/checksum/applied_at ledger"
    );
  }

  return true;
}

function checksumFile(filePath) {
  // Git may materialize text files with platform-specific line endings. The
  // migration's semantic content is immutable, while LF/CRLF alone must not
  // make the same release fail after moving between Linux and Windows.
  const normalizedSource = fs.readFileSync(filePath, "utf8")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  return crypto.createHash("sha256").update(normalizedSource, "utf8").digest("hex");
}

function loadMigrations(migrationsDirectory = DEFAULT_MIGRATIONS_DIRECTORY) {
  const files = fs.readdirSync(migrationsDirectory)
    .filter((fileName) => /^\d{3}[-_].+\.js$/u.test(fileName))
    .sort((left, right) => left.localeCompare(right, "en"));

  if (!files.length) {
    throw new Error(`No database migrations found in ${migrationsDirectory}`);
  }

  const migrations = files.map((fileName) => {
    const filePath = path.join(migrationsDirectory, fileName);
    const resolvedPath = require.resolve(filePath);
    delete require.cache[resolvedPath];
    const migration = require(resolvedPath);

    if (
      !migration
      || !/^V\d{3,}$/u.test(migration.version)
      || typeof migration.name !== "string"
      || !migration.name.trim()
      || typeof migration.up !== "function"
    ) {
      throw new Error(`Invalid database migration module: ${fileName}`);
    }

    return {
      ...migration,
      fileName,
      filePath,
      checksum: checksumFile(filePath),
    };
  });

  const versions = new Set();
  const names = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) {
      throw new Error(`Duplicate database migration version: ${migration.version}`);
    }
    if (names.has(migration.name)) {
      throw new Error(`Duplicate database migration name: ${migration.name}`);
    }
    versions.add(migration.version);
    names.add(migration.name);
  }

  return migrations;
}

function readAppliedMigrations(db) {
  if (!validateMigrationLedger(db)) return [];
  return db.prepare(`
    SELECT version, name, checksum, applied_at
    FROM schema_migrations
    ORDER BY version ASC
  `).all();
}

function verifyAppliedMigrations(appliedMigrations, migrations) {
  const availableByVersion = new Map(
    migrations.map((migration) => [migration.version, migration])
  );

  for (const applied of appliedMigrations) {
    const migration = availableByVersion.get(applied.version);
    if (!migration) {
      throw new Error(`Applied database migration ${applied.version} is missing from disk`);
    }
    if (applied.name !== migration.name) {
      throw new Error(
        `Database migration ${applied.version} name mismatch: ledger=${applied.name}, file=${migration.name}`
      );
    }
    if (applied.checksum !== migration.checksum) {
      throw new Error(
        `Database migration ${applied.version} checksum mismatch; applied migration files are immutable`
      );
    }
  }
}

function verifyDatabaseIntegrity(db) {
  const integrityRows = db.prepare("PRAGMA integrity_check").all();
  const integrityErrors = integrityRows
    .map((row) => row.integrity_check)
    .filter((result) => result !== "ok");
  if (integrityErrors.length) {
    throw new Error(`SQLite integrity_check failed: ${integrityErrors.join("; ")}`);
  }

  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) {
    const preview = foreignKeyErrors.slice(0, 5).map((row) => (
      `${row.table}[rowid=${row.rowid}] -> ${row.parent}`
    ));
    throw new Error(`SQLite foreign_key_check failed: ${preview.join("; ")}`);
  }

  return {
    integrityCheck: "ok",
    foreignKeyViolations: 0,
  };
}

function listUserTables(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
}

function readUserTableCounts(db, tableNames = listUserTables(db)) {
  return Object.fromEntries(tableNames.map((tableNameValue) => {
    const row = db.prepare(`
      SELECT CAST(COUNT(*) AS TEXT) AS count
      FROM ${quoteIdentifier(tableNameValue)}
    `).get();
    return [tableNameValue, String(row.count)];
  }));
}

function inspectMigrationStatus(db, options = {}) {
  // These checks are intentionally first and read-only. A damaged source must
  // never be "fixed" or backed up as though it were safe to migrate.
  const checks = verifyDatabaseIntegrity(db);
  const migrations = loadMigrations(
    options.migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY
  );
  const targetVersion = options.targetVersion || migrations.at(-1).version;
  const targetIndex = migrations.findIndex(
    (migration) => migration.version === targetVersion
  );
  if (targetIndex === -1) {
    throw new Error(`Unknown target database migration: ${targetVersion}`);
  }

  const appliedMigrations = readAppliedMigrations(db);
  verifyAppliedMigrations(appliedMigrations, migrations);
  const expectedAppliedPrefix = migrations.slice(0, appliedMigrations.length);
  if (
    appliedMigrations.some((migration, index) => (
      migration.version !== expectedAppliedPrefix[index]?.version
    ))
  ) {
    throw new Error("Database migration ledger is not a contiguous version prefix");
  }

  const targetMigrations = migrations.slice(0, targetIndex + 1);
  const targetVersions = new Set(targetMigrations.map((migration) => migration.version));
  const beyondTarget = appliedMigrations.find(
    (migration) => !targetVersions.has(migration.version)
  );
  if (beyondTarget) {
    throw new Error(
      `Database is already beyond requested target ${targetVersion}: ${beyondTarget.version}`
    );
  }

  const context = {
    dataDirectory: options.dataDirectory,
    legacyJsonImportMode: normalizeLegacyJsonImportMode(
      options.legacyJsonImportMode
    ),
    now: typeof options.now === "function" ? options.now : () => new Date(),
    targetVersion,
  };
  const appliedVersions = new Set(appliedMigrations.map((migration) => migration.version));
  for (const migration of targetMigrations) {
    if (!appliedVersions.has(migration.version)) continue;
    if (typeof migration.validate === "function") {
      migration.validate(db, context);
    }
  }

  const userTables = listUserTables(db);
  const applicationTables = userTables.filter(
    (tableNameValue) => !["schema_migrations", "data_migrations"].includes(tableNameValue)
  );
  const databaseEmpty = applicationTables.length === 0;
  const pendingMigrations = targetMigrations.filter(
    (migration) => !appliedVersions.has(migration.version)
  );
  if (!databaseEmpty && pendingMigrations.length && appliedMigrations.length === 0) {
    const firstPending = pendingMigrations[0];
    if (typeof firstPending.preflight !== "function") {
      throw new Error(
        `Cannot safely adopt unversioned schema before ${firstPending.version}`
      );
    }
    firstPending.preflight(db, context);
  }

  return {
    currentVersion: appliedMigrations.at(-1)?.version || null,
    targetVersion,
    pendingVersions: pendingMigrations.map((migration) => migration.version),
    ledger: appliedMigrations.map((migration) => ({ ...migration })),
    databaseEmpty,
    userTables,
    userTableCounts: readUserTableCounts(db, userTables),
    checks,
  };
}

function runMigration(db, migration, context) {
  const foreignKeysBefore = Number(
    db.prepare("PRAGMA foreign_keys").get().foreign_keys
  );

  if (migration.foreignKeysOff) {
    db.exec("PRAGMA foreign_keys = OFF");
    const foreignKeysAfter = Number(
      db.prepare("PRAGMA foreign_keys").get().foreign_keys
    );
    if (foreignKeysAfter !== 0) {
      throw new Error(`Could not disable foreign keys for ${migration.version}`);
    }
  }

  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    // Another process may have applied this migration while this process was
    // waiting for the SQLite write lock. Re-read the ledger under the lock so
    // concurrent startup is idempotent instead of re-running stale work.
    if (validateMigrationLedger(db)) {
      const alreadyApplied = db.prepare(`
        SELECT version, name, checksum, applied_at
        FROM schema_migrations
        WHERE version = ?
      `).get(migration.version);
      if (alreadyApplied) {
        verifyAppliedMigrations([alreadyApplied], [migration]);
        db.exec("COMMIT");
        transactionStarted = false;
        return false;
      }
    }

    migration.up(db, context);
    if (!validateMigrationLedger(db)) {
      throw new Error(`${migration.version} did not create schema_migrations`);
    }
    if (typeof migration.validate === "function") {
      migration.validate(db, context);
    }
    verifyDatabaseIntegrity(db);
    db.prepare(`
      INSERT INTO schema_migrations (version, name, checksum, applied_at)
      VALUES (?, ?, ?, ?)
    `).run(
      migration.version,
      migration.name,
      migration.checksum,
      context.now().toISOString()
    );
    db.exec("COMMIT");
    transactionStarted = false;
    return true;
  } catch (error) {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the migration error; the connection is discarded by initializeDatabase.
      }
    }
    throw new Error(
      `Database migration ${migration.version} (${migration.name}) failed: ${error.message}`,
      { cause: error }
    );
  } finally {
    if (migration.foreignKeysOff && foreignKeysBefore !== 0) {
      db.exec("PRAGMA foreign_keys = ON");
    }
  }
}

function runMigrations(db, options = {}) {
  // Low-level/internal runner for the database orchestrator and isolated tests.
  // Deployment code must use initializeDatabase/db:migrate so the read-only
  // preflight and validated-backup gate cannot be bypassed.
  // Always audit the source before the first migration transaction. The
  // database orchestrator performs the same inspection on a read-only
  // connection before backup; keeping this gate here also protects direct use.
  inspectMigrationStatus(db, options);
  const migrations = loadMigrations(
    options.migrationsDirectory || DEFAULT_MIGRATIONS_DIRECTORY
  );
  const targetVersion = options.targetVersion || migrations.at(-1).version;
  const targetIndex = migrations.findIndex(
    (migration) => migration.version === targetVersion
  );
  if (targetIndex === -1) {
    throw new Error(`Unknown target database migration: ${targetVersion}`);
  }

  const appliedMigrations = readAppliedMigrations(db);
  verifyAppliedMigrations(appliedMigrations, migrations);

  const targetMigrations = migrations.slice(0, targetIndex + 1);
  const targetVersions = new Set(targetMigrations.map((migration) => migration.version));
  const beyondTarget = appliedMigrations.find(
    (migration) => !targetVersions.has(migration.version)
  );
  if (beyondTarget) {
    throw new Error(
      `Database is already beyond requested target ${targetVersion}: ${beyondTarget.version}`
    );
  }

  const appliedVersions = new Set(appliedMigrations.map((migration) => migration.version));
  const context = {
    dataDirectory: options.dataDirectory,
    legacyJsonImportMode: normalizeLegacyJsonImportMode(
      options.legacyJsonImportMode
    ),
    now: typeof options.now === "function" ? options.now : () => new Date(),
    targetVersion,
  };
  const appliedNow = [];

  for (const migration of targetMigrations) {
    if (appliedVersions.has(migration.version)) continue;
    if (runMigration(db, migration, context)) {
      appliedNow.push(migration.version);
    }
  }

  const finalApplied = readAppliedMigrations(db);
  verifyAppliedMigrations(finalApplied, migrations);
  for (const migration of targetMigrations) {
    if (typeof migration.validate === "function") {
      migration.validate(db, context);
    }
  }
  const checks = verifyDatabaseIntegrity(db);

  return {
    currentVersion: targetVersion,
    appliedNow,
    ledger: finalApplied.map((migration) => ({ ...migration })),
    checks,
  };
}

module.exports = {
  DEFAULT_MIGRATIONS_DIRECTORY,
  inspectMigrationStatus,
  loadMigrations,
  listUserTables,
  normalizeLegacyJsonImportMode,
  quoteIdentifier,
  readUserTableCounts,
  runMigrations,
  tableExists,
  validateMigrationLedger,
  verifyDatabaseIntegrity,
};
