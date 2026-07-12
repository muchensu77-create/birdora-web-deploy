const assert = require("assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const {
  closeDatabase,
  getDatabaseHealth,
  getLastMigrationReport,
  initializeDatabase,
  preflightDatabase,
  resolveDatabaseOptions,
} = require("../app/db/database");
const { assertBackupCapacity } = require("../app/db/migration-safety");

const publishedSchema = fs.readFileSync(
  path.join(__dirname, "fixtures", "published-v1.7-schema.sql"),
  "utf8"
);
const projectRoot = path.resolve(__dirname, "..");
const testServerPort = String(40_000 + (process.pid % 20_000));
const tests = [];
const ALL_MIGRATIONS = ["V001", "V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009"];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(String(address.port));
      });
    });
  });
}

function test(name, operation) {
  tests.push({ name, operation });
}

function withTempDirectory(prefix, operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return operation(directory);
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function seedPublishedDatabase(databaseFile, options = {}) {
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(publishedSchema);
  db.prepare(`
    INSERT INTO users (
      id, email, nickname, password_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "published-user",
    "published@example.com",
    "Published user",
    "published-password-hash",
    "2026-07-01T00:00:00.000Z",
    "2026-07-01T00:00:00.000Z"
  );
  db.prepare(`
    INSERT INTO user_point_events (id, user_id, points, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    "published-points",
    "published-user",
    88,
    "2026-07-02T00:00:00.000Z"
  );
  if (options.orphan) {
    db.exec("PRAGMA foreign_keys = OFF;");
    db.prepare(`
      INSERT INTO community_post_comments (
        id, post_id, user_id, body, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "orphan-comment",
      "missing-post",
      "missing-user",
      "orphan",
      "2026-07-03T00:00:00.000Z",
      "2026-07-03T00:00:00.000Z"
    );
  }
  db.close();
}

function migrationSettings(directory, databaseFile, extra = {}) {
  return {
    databaseFile,
    dataDirectory: directory,
    autoMigrate: true,
    backupEnabled: true,
    backupDirectory: path.join(directory, "backups"),
    backupRetention: 5,
    legacyJsonImportMode: "disabled",
    ...extra,
  };
}

test("read-only preflight leaves a published database byte-for-byte unchanged", () => {
  withTempDirectory("birdora-preflight-readonly-", (directory) => {
    const databaseFile = path.join(directory, "published.sqlite");
    seedPublishedDatabase(databaseFile);
    const beforeHash = hashFile(databaseFile);
    const beforeMtime = fs.statSync(databaseFile).mtimeMs;
    const status = preflightDatabase(migrationSettings(directory, databaseFile));
    assert.equal(status.readOnly, true);
    assert.equal(status.currentVersion, null);
    assert.equal(status.targetVersion, "V009");
    assert.deepEqual(status.pendingVersions, ALL_MIGRATIONS);
    assert.equal(status.checks.integrityCheck, "ok");
    assert.equal(status.userTableCounts.users, "1");
    assert.equal(status.userTableCounts.user_point_events, "1");
    assert.equal(status.requiresBackup, true);
    assert.equal(status.safeToApply, true);
    assert.equal(status.journalMode, "delete");
    assert.match(status.backup.estimatedPath, /<unique>\.sqlite$/u);
    assert.equal(status.backupScope.mediaBackupRequiredSeparately, true);
    assert.deepEqual(status.backupScope.excludes, [
      "community and observation media files stored outside SQLite",
    ]);
    assert.equal(hashFile(databaseFile), beforeHash);
    assert.equal(fs.statSync(databaseFile).mtimeMs, beforeMtime);
    assert.equal(fs.existsSync(status.backup.directory), false);
  });
});

test("non-empty migration creates a durable validated backup and preserves rows", () => {
  withTempDirectory("birdora-backup-restore-", (directory) => {
    const databaseFile = path.join(directory, "published.sqlite");
    const settings = migrationSettings(directory, databaseFile);
    seedPublishedDatabase(databaseFile);

    const migrated = initializeDatabase(settings);
    const report = getLastMigrationReport();
    assert.deepEqual(report.pendingBefore, ALL_MIGRATIONS);
    assert.deepEqual(report.appliedNow, ALL_MIGRATIONS);
    assert.ok(report.backup);
    assert.equal(fs.existsSync(report.backup.backupPath), true);
    assert.equal(fs.existsSync(report.backup.manifestPath), true);
    assert.match(report.backup.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(report.backup.sourceJournalMode, "delete");
    assert.equal(report.backup.userTableCounts.users, "1");
    assert.equal(report.backup.userTableCounts.user_point_events, "1");
    assert.equal(report.backup.backupScope.mediaBackupRequiredSeparately, true);
    assert.deepEqual(report.backup.backupScope.excludes, [
      "community and observation media files stored outside SQLite",
    ]);
    assert.equal(
      migrated.prepare("SELECT points FROM user_point_events").get().points,
      88
    );
    assert.deepEqual(getDatabaseHealth(), {
      ready: true,
      schemaVersion: "V009",
      targetSchemaVersion: "V009",
      ledgerVerified: true,
    });

    const manifest = JSON.parse(fs.readFileSync(report.backup.manifestPath, "utf8"));
    assert.equal(manifest.sha256, hashFile(report.backup.backupPath));
    assert.equal(manifest.sourceWalBytes, "0");
    assert.equal(manifest.preMigrationSchemaVersion, null);
    assert.equal(manifest.targetSchemaVersion, "V009");

    const restoredFile = path.join(directory, "restored.sqlite");
    fs.copyFileSync(report.backup.backupPath, restoredFile);
    const restored = new DatabaseSync(restoredFile, { readOnly: true });
    try {
      assert.equal(
        restored.prepare("SELECT nickname FROM users WHERE id = ?")
          .get("published-user").nickname,
        "Published user"
      );
      assert.equal(
        restored.prepare("SELECT points FROM user_point_events").get().points,
        88
      );
      assert.equal(
        restored.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'")
          .get(),
        undefined
      );
      assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(restored.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      restored.close();
    }

    closeDatabase();
    initializeDatabase({ ...settings, autoMigrate: false });
    assert.equal(getLastMigrationReport().backup, null);
    assert.deepEqual(getLastMigrationReport().appliedNow, []);
    assert.equal(
      fs.readdirSync(settings.backupDirectory)
        .filter((fileName) => fileName.endsWith(".manifest.json")).length,
      1
    );
  });
});

test("production-style startup rejects pending migrations without changing the source", () => {
  withTempDirectory("birdora-production-gate-", (directory) => {
    const databaseFile = path.join(directory, "pending.sqlite");
    seedPublishedDatabase(databaseFile);
    const beforeHash = hashFile(databaseFile);
    const settings = migrationSettings(directory, databaseFile, {
      autoMigrate: false,
      nodeEnvironment: "production",
    });
    assert.throws(
      () => initializeDatabase(settings),
      /automatic migration is disabled.*db:preflight.*db:migrate/u
    );
    assert.throws(
      () => initializeDatabase({ ...settings, autoMigrate: true }),
      /DATABASE_AUTO_MIGRATE=true is forbidden for production server startup/u
    );
    assert.equal(hashFile(databaseFile), beforeHash);
    assert.equal(fs.existsSync(settings.backupDirectory), false);
    const serverAttempt = spawnSync(process.execPath, ["server.js"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: testServerPort,
        DATABASE_FILE: databaseFile,
        DATA_DIRECTORY: directory,
        DATABASE_AUTO_MIGRATE: "false",
        DATABASE_BACKUP_ENABLED: "true",
        DATABASE_BACKUP_DIR: settings.backupDirectory,
        DATABASE_BACKUP_RETENTION: "5",
        LEGACY_JSON_IMPORT_MODE: "disabled",
        JWT_SECRET: "database-safety-test-secret-at-least-32-characters",
        CORS_ORIGIN: "https://birdora.example.test",
        ALLOWED_ORIGINS: "https://birdora.example.test",
      },
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true,
    });
    assert.equal(serverAttempt.status, 1);
    assert.match(
      `${serverAttempt.stdout}\n${serverAttempt.stderr}`,
      /database lifecycle locking|required shared FLOCK|birdora-db-maintenance/u
    );
    assert.equal(hashFile(databaseFile), beforeHash);
    assert.equal(fs.existsSync(settings.backupDirectory), false);
    const check = new DatabaseSync(databaseFile, { readOnly: true });
    try {
      assert.equal(
        check.prepare("SELECT 1 FROM sqlite_master WHERE name = 'schema_migrations'")
          .get(),
        undefined
      );
    } finally {
      check.close();
    }
  });
});

test("server starts normally once the explicit migration is complete in local test mode", async () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "birdora-production-server-")
  );
  try {
    const databaseFile = path.join(directory, "ready.sqlite");
    const availablePort = await getFreePort();
    const settings = migrationSettings(directory, databaseFile);
    seedPublishedDatabase(databaseFile);
    initializeDatabase(settings);
    closeDatabase();

    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["server.js"], {
        cwd: projectRoot,
        env: {
          ...process.env,
          NODE_ENV: "test",
          PORT: availablePort,
          DATABASE_FILE: databaseFile,
          DATA_DIRECTORY: directory,
          DATABASE_AUTO_MIGRATE: "false",
          DATABASE_BACKUP_ENABLED: "true",
          DATABASE_BACKUP_DIR: settings.backupDirectory,
          DATABASE_BACKUP_RETENTION: "5",
          LEGACY_JSON_IMPORT_MODE: "disabled",
          JWT_SECRET: "database-safety-test-secret-at-least-32-characters",
          CORS_ORIGIN: "http://127.0.0.1",
          ALLOWED_ORIGINS: "http://127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      let stdout = "";
      let stderr = "";
      let listening = false;
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error(`Production server startup timed out\n${stdout}\n${stderr}`));
      }, 10_000);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!listening && stdout.includes("Birdora auth API listening")) {
          listening = true;
          child.kill("SIGTERM");
        }
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (status, signal) => {
        clearTimeout(timeout);
        const stoppedAfterVerification = status === 0 || signal === "SIGTERM";
        if (!listening || !stoppedAfterVerification) {
          reject(new Error(
            `Production server did not start/stop cleanly (status=${status}, signal=${signal})\n${stdout}\n${stderr}`
          ));
          return;
        }
        resolve();
      });
    });
  } finally {
    closeDatabase();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("production preflight is read-only and explicit db:migrate reports its backup", () => {
  withTempDirectory("birdora-production-cli-", (directory) => {
    const databaseFile = path.join(directory, "production.sqlite");
    const backupDirectory = path.join(directory, "backups");
    seedPublishedDatabase(databaseFile);
    const beforeHash = hashFile(databaseFile);
    const productionEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_FILE: databaseFile,
      DATA_DIRECTORY: directory,
      DATABASE_AUTO_MIGRATE: "false",
      DATABASE_BACKUP_ENABLED: "true",
      DATABASE_BACKUP_DIR: backupDirectory,
      DATABASE_BACKUP_RETENTION: "5",
      LEGACY_JSON_IMPORT_MODE: "disabled",
    };
    const localMaintenanceEnv = {
      ...productionEnv,
      NODE_ENV: "test",
      PORT: "0",
      ALLOWED_ORIGINS: "http://127.0.0.1",
      CORS_ORIGIN: "http://127.0.0.1",
    };

    const preflight = spawnSync(process.execPath, ["scripts/database-preflight.js"], {
      cwd: projectRoot,
      env: productionEnv,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(preflight.status, 0, preflight.stderr);
    const status = JSON.parse(preflight.stdout);
    assert.equal(status.ok, true);
    assert.equal(status.mode, "read-only");
    assert.equal(status.autoMigrate, false);
    assert.equal(status.explicitMigrationAllowed, true);
    assert.equal(status.serverStartupAllowed, false);
    assert.deepEqual(status.pendingVersions, ALL_MIGRATIONS);
    assert.equal(hashFile(databaseFile), beforeHash);
    assert.equal(fs.existsSync(backupDirectory), false);

    const unauthorizedMigrate = spawnSync(process.execPath, ["scripts/migrate-database.js"], {
      cwd: projectRoot,
      env: productionEnv,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(unauthorizedMigrate.status, 1);
    assert.match(unauthorizedMigrate.stderr, /database maintenance locking|activation journal|required exclusive FLOCK/u);
    assert.equal(hashFile(databaseFile), beforeHash);

    const migrate = spawnSync(process.execPath, ["scripts/migrate-database.js"], {
      cwd: projectRoot,
      env: localMaintenanceEnv,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(migrate.status, 0, migrate.stderr);
    const report = JSON.parse(migrate.stdout.trim());
    assert.equal(report.ok, true);
    assert.equal(report.schemaVersion, "V009");
    assert.deepEqual(report.appliedNow, ALL_MIGRATIONS);
    assert.equal(fs.existsSync(report.backupPath), true);
    assert.equal(fs.existsSync(report.manifestPath), true);
    assert.match(report.backupSha256, /^[a-f0-9]{64}$/u);
    assert.equal(report.backupSha256, hashFile(report.backupPath));

    const sourceHashBeforeStandaloneBackup = hashFile(databaseFile);
    const standaloneBackup = spawnSync(
      process.execPath,
      ["scripts/backup-database.js"],
      {
        cwd: projectRoot,
        env: localMaintenanceEnv,
        encoding: "utf8",
        windowsHide: true,
      }
    );
    assert.equal(standaloneBackup.status, 0, standaloneBackup.stderr);
    const standaloneReport = JSON.parse(standaloneBackup.stdout.trim());
    assert.equal(standaloneReport.ok, true);
    assert.equal(standaloneReport.snapshotRequired, true);
    assert.equal(standaloneReport.schemaVersion, "V009");
    assert.deepEqual(standaloneReport.pendingVersions, []);
    assert.equal(fs.existsSync(standaloneReport.backupPath), true);
    assert.equal(fs.existsSync(standaloneReport.manifestPath), true);
    assert.equal(
      standaloneReport.backupSha256,
      hashFile(standaloneReport.backupPath)
    );
    assert.equal(hashFile(databaseFile), sourceHashBeforeStandaloneBackup);
    const standaloneSnapshot = new DatabaseSync(
      standaloneReport.backupPath,
      { readOnly: true }
    );
    try {
      assert.equal(
        standaloneSnapshot.prepare("SELECT nickname FROM users WHERE id = ?")
          .get("published-user").nickname,
        "Published user"
      );
      assert.equal(
        standaloneSnapshot.prepare("SELECT points FROM user_point_events").get().points,
        88
      );
      assert.equal(
        standaloneSnapshot.prepare("PRAGMA integrity_check").get().integrity_check,
        "ok"
      );
      assert.deepEqual(standaloneSnapshot.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      standaloneSnapshot.close();
    }
  });
});

test("backup-only reports snapshotRequired=false for a missing or truly empty database", () => {
  withTempDirectory("birdora-empty-backup-", (directory) => {
    const backupDirectory = path.join(directory, "backups");
    const baseEnv = {
      ...process.env,
      NODE_ENV: "test",
      PORT: "0",
      ALLOWED_ORIGINS: "http://127.0.0.1",
      CORS_ORIGIN: "http://127.0.0.1",
      DATABASE_AUTO_MIGRATE: "false",
      DATABASE_BACKUP_ENABLED: "true",
      DATABASE_BACKUP_DIR: backupDirectory,
      DATABASE_BACKUP_RETENTION: "5",
      LEGACY_JSON_IMPORT_MODE: "disabled",
    };
    const missingFile = path.join(directory, "missing.sqlite");
    const missing = spawnSync(process.execPath, ["scripts/backup-database.js"], {
      cwd: projectRoot,
      env: { ...baseEnv, DATABASE_FILE: missingFile, DATA_DIRECTORY: directory },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(missing.status, 0, missing.stderr);
    assert.deepEqual(JSON.parse(missing.stdout.trim()), {
      ok: true,
      snapshotRequired: false,
      reason: "database-missing-or-empty",
      schemaVersion: null,
      targetSchemaVersion: null,
      pendingVersions: [],
      backupPath: null,
      manifestPath: null,
      backupSha256: null,
    });
    assert.equal(fs.existsSync(missingFile), false);

    const emptyFile = path.join(directory, "empty.sqlite");
    const empty = new DatabaseSync(emptyFile);
    empty.close();
    const emptyHash = hashFile(emptyFile);
    const emptyResult = spawnSync(process.execPath, ["scripts/backup-database.js"], {
      cwd: projectRoot,
      env: { ...baseEnv, DATABASE_FILE: emptyFile, DATA_DIRECTORY: directory },
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(emptyResult.status, 0, emptyResult.stderr);
    assert.equal(JSON.parse(emptyResult.stdout.trim()).snapshotRequired, false);
    assert.equal(hashFile(emptyFile), emptyHash);
    assert.equal(fs.existsSync(backupDirectory), false);
  });
});

test("a disabled or failed backup gate cannot be used to bypass source protection", () => {
  withTempDirectory("birdora-backup-gate-", (directory) => {
    const disabledDatabase = path.join(directory, "disabled.sqlite");
    seedPublishedDatabase(disabledDatabase);
    const disabledHash = hashFile(disabledDatabase);
    assert.throws(
      () => initializeDatabase(migrationSettings(directory, disabledDatabase, {
        backupEnabled: false,
      })),
      /backup gate is not satisfied/u
    );
    assert.equal(hashFile(disabledDatabase), disabledHash);

    const failedDatabase = path.join(directory, "failed.sqlite");
    seedPublishedDatabase(failedDatabase);
    const failedHash = hashFile(failedDatabase);
    const invalidBackupPath = path.join(directory, "not-a-directory");
    fs.writeFileSync(invalidBackupPath, "blocked");
    assert.throws(
      () => initializeDatabase(migrationSettings(directory, failedDatabase, {
        backupDirectory: invalidBackupPath,
      })),
      /Backup path parent is not a directory/u
    );
    assert.equal(hashFile(failedDatabase), failedHash);
  });
});

test("unknown, physically corrupt, and foreign-key-broken sources fail closed", () => {
  withTempDirectory("birdora-preflight-failclosed-", (directory) => {
    const unknownFile = path.join(directory, "unknown.sqlite");
    const unknown = new DatabaseSync(unknownFile);
    unknown.exec("CREATE TABLE unexpected_table (id TEXT PRIMARY KEY);");
    unknown.close();
    const unknownHash = hashFile(unknownFile);
    assert.throws(
      () => preflightDatabase(migrationSettings(directory, unknownFile)),
      /Unknown legacy database schema/u
    );
    assert.equal(hashFile(unknownFile), unknownHash);

    const corruptFile = path.join(directory, "corrupt.sqlite");
    fs.writeFileSync(corruptFile, "this is not a sqlite database");
    const corruptHash = hashFile(corruptFile);
    assert.throws(
      () => preflightDatabase(migrationSettings(directory, corruptFile)),
      /file is not a database|database disk image is malformed/iu
    );
    assert.equal(hashFile(corruptFile), corruptHash);

    const brokenFile = path.join(directory, "broken.sqlite");
    seedPublishedDatabase(brokenFile, { orphan: true });
    const brokenHash = hashFile(brokenFile);
    assert.throws(
      () => preflightDatabase(migrationSettings(directory, brokenFile)),
      /foreign_key_check failed/u
    );
    assert.equal(hashFile(brokenFile), brokenHash);
  });
});

test("backup capacity includes WAL bytes and fails with required/available detail", () => {
  withTempDirectory("birdora-backup-capacity-", (directory) => {
    const databaseFile = path.join(directory, "capacity.sqlite");
    fs.writeFileSync(databaseFile, Buffer.alloc(1024));
    fs.writeFileSync(`${databaseFile}-wal`, Buffer.alloc(2048));
    assert.throws(
      () => assertBackupCapacity(databaseFile, path.join(directory, "backups"), {
        safetyMarginBytes: 4096,
        statfs: () => ({ bsize: 1n, bavail: 100n }),
      }),
      /required=7168 available=100/u
    );
  });
});

test("backup retention prunes only older validated backup pairs", () => {
  withTempDirectory("birdora-backup-retention-", (directory) => {
    const sharedBackupDirectory = path.join(directory, "shared-backups");
    const firstDirectory = path.join(directory, "first");
    const secondDirectory = path.join(directory, "second");
    fs.mkdirSync(firstDirectory);
    fs.mkdirSync(secondDirectory);
    const firstDatabase = path.join(firstDirectory, "birdora.sqlite");
    const secondDatabase = path.join(secondDirectory, "birdora.sqlite");
    seedPublishedDatabase(firstDatabase);
    seedPublishedDatabase(secondDatabase);

    initializeDatabase(migrationSettings(firstDirectory, firstDatabase, {
      backupDirectory: sharedBackupDirectory,
      backupRetention: 1,
    }));
    const firstReport = getLastMigrationReport();
    const firstBackupPath = firstReport.backup.backupPath;
    const firstManifestPath = firstReport.backup.manifestPath;
    closeDatabase();

    initializeDatabase(migrationSettings(secondDirectory, secondDatabase, {
      backupDirectory: sharedBackupDirectory,
      backupRetention: 1,
    }));
    const secondReport = getLastMigrationReport();
    assert.notEqual(secondReport.backup.backupPath, firstBackupPath);
    assert.equal(fs.existsSync(secondReport.backup.backupPath), true);
    assert.equal(fs.existsSync(secondReport.backup.manifestPath), true);
    assert.equal(fs.existsSync(firstBackupPath), false);
    assert.equal(fs.existsSync(firstManifestPath), false);
    assert.equal(
      fs.readdirSync(sharedBackupDirectory)
        .filter((fileName) => fileName.endsWith(".manifest.json")).length,
      1
    );
  });
});

test("DATABASE_FILE defaults legacy JSON lookup to the database directory", () => {
  withTempDirectory("birdora-data-directory-", (directory) => {
    const databaseFile = path.join(directory, "nested", "birdora.sqlite");
    const dataDirectory = path.dirname(databaseFile);
    fs.mkdirSync(dataDirectory, { recursive: true });
    fs.writeFileSync(path.join(dataDirectory, "users.json"), JSON.stringify([{
      id: "adjacent-user",
      email: "adjacent@example.com",
      nickname: "Adjacent",
      passwordHash: "optional-legacy-hash",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    }]));
    fs.writeFileSync(path.join(dataDirectory, "revoked-tokens.json"), "[]");
    const resolved = resolveDatabaseOptions({
      databaseFile,
      autoMigrate: true,
      legacyJsonImportMode: "optional",
    });
    assert.equal(resolved.dataDirectory, dataDirectory);
    const db = initializeDatabase({
      databaseFile,
      autoMigrate: true,
      legacyJsonImportMode: "optional",
    });
    assert.equal(
      db.prepare("SELECT email FROM users WHERE id = 'adjacent-user'").get().email,
      "adjacent@example.com"
    );
  });
});

async function main() {
  let failures = 0;
  for (const { name, operation } of tests) {
    try {
      await operation();
      console.log(`ok - ${name}`);
    } catch (error) {
      failures += 1;
      console.error(`not ok - ${name}`);
      console.error(error.stack || error);
    }
  }

  if (failures) {
    console.error(`${failures} database safety test(s) failed`);
    process.exitCode = 1;
  } else {
    console.log(`${tests.length} database safety tests passed`);
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
