const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { DatabaseSync } = require("node:sqlite");
const baseline = require("../app/db/migrations/001-baseline");
const {
  closeDatabase,
  getDatabaseHealth,
  initializeDatabase,
} = require("../app/db/database");

const projectRoot = path.resolve(__dirname, "..");

function tableExists(db, tableName) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function createV16Shape(databaseFile, { removeExtraTable = false } = {}) {
  const db = new DatabaseSync(databaseFile);
  try {
    db.exec("PRAGMA foreign_keys = ON;");
    baseline.up(db, { targetVersion: "V001" });
    db.exec(`
      DROP TABLE community_post_videos;
      DROP TABLE schema_migrations;
    `);
    if (removeExtraTable) db.exec("DROP TABLE community_post_comments;");
  } finally {
    db.close();
  }
}

function runProbe(sourcePath, probePath, backupDirectory) {
  return spawnSync(process.execPath, ["scripts/prepare-legacy-v1-6-probe.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_FILE: sourcePath,
      LEGACY_PROBE_DATABASE_FILE: probePath,
      DATABASE_BACKUP_DIR: backupDirectory,
      DATABASE_AUTO_MIGRATE: "false",
      DATABASE_BACKUP_ENABLED: "true",
      LEGACY_JSON_IMPORT_MODE: "disabled",
    },
    encoding: "utf8",
  });
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-v16-probe-test-"));
try {
  const sourcePath = path.join(directory, "source", "birdora.sqlite");
  const probeDirectory = path.join(directory, "probe");
  const probePath = path.join(probeDirectory, "birdora-probe.sqlite");
  const backupDirectory = path.join(probeDirectory, "backups");
  fs.mkdirSync(path.dirname(sourcePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(probeDirectory, { recursive: true, mode: 0o700 });
  createV16Shape(sourcePath);
  const sourceHashBefore = sha256(sourcePath);

  const result = runProbe(sourcePath, probePath, backupDirectory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout.trim());
  assert.equal(report.ok, true);
  assert.equal(report.sourceModified, false);
  assert.equal(sha256(sourcePath), sourceHashBefore);
  assert.deepEqual(report.pendingVersions, [
    "V001", "V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009",
  ]);

  const source = new DatabaseSync(sourcePath, { readOnly: true });
  assert.equal(tableExists(source, "community_post_videos"), false);
  source.close();

  const probe = new DatabaseSync(probePath, { readOnly: true });
  assert.equal(tableExists(probe, "community_post_videos"), true);
  assert.equal(tableExists(probe, "schema_migrations"), false);
  probe.close();

  initializeDatabase({
    databaseFile: probePath,
    dataDirectory: probeDirectory,
    backupDirectory,
    autoMigrate: true,
    migrationCommand: true,
    backupEnabled: true,
    legacyJsonImportMode: "disabled",
    nodeEnvironment: "development",
  });
  assert.equal(getDatabaseHealth().schemaVersion, "V009");
  closeDatabase();

  const badSourcePath = path.join(directory, "bad-source", "birdora.sqlite");
  const badProbeDirectory = path.join(directory, "bad-probe");
  const badProbePath = path.join(badProbeDirectory, "birdora-probe.sqlite");
  fs.mkdirSync(path.dirname(badSourcePath), { recursive: true, mode: 0o700 });
  fs.mkdirSync(badProbeDirectory, { recursive: true, mode: 0o700 });
  createV16Shape(badSourcePath, { removeExtraTable: true });
  const rejected = runProbe(badSourcePath, badProbePath, path.join(badProbeDirectory, "backups"));
  assert.notEqual(rejected.status, 0);
  assert.equal(fs.existsSync(badProbePath), false);

  console.log("Legacy v1.6 isolated probe tests passed.");
} finally {
  closeDatabase();
  fs.rmSync(directory, { recursive: true, force: true });
}
