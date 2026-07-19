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
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      DROP TABLE community_posts;
      CREATE TABLE community_posts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        bird TEXT NOT NULL DEFAULT '观鸟笔记',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        analysis_summary TEXT NOT NULL DEFAULT '',
        analysis_score INTEGER NOT NULL DEFAULT 0,
        analysis_tags TEXT NOT NULL DEFAULT '[]',
        analysis_suggestions TEXT NOT NULL DEFAULT '[]',
        analysis_updated_at TEXT NOT NULL DEFAULT '',
        observation_id TEXT DEFAULT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_community_posts_created_at
        ON community_posts(created_at DESC);
      CREATE INDEX idx_community_posts_user_id_created_at
        ON community_posts(user_id, created_at DESC);
      CREATE INDEX idx_community_posts_observation_id
        ON community_posts(observation_id);
      CREATE TRIGGER trg_community_posts_observation_insert
      BEFORE INSERT ON community_posts
      FOR EACH ROW
      WHEN NEW.observation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM observations WHERE id = NEW.observation_id)
      BEGIN
        SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
      END;
      CREATE TRIGGER trg_community_posts_observation_update
      BEFORE UPDATE OF observation_id ON community_posts
      FOR EACH ROW
      WHEN NEW.observation_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM observations WHERE id = NEW.observation_id)
      BEGIN
        SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
      END;
      PRAGMA legacy_alter_table = OFF;
      PRAGMA foreign_keys = ON;
    `);
    db.exec(`
      ALTER TABLE users DROP COLUMN bio;
      ALTER TABLE users DROP COLUMN gender;
      ALTER TABLE users DROP COLUMN age;
      ALTER TABLE users DROP COLUMN avatar_url;
      ALTER TABLE users DROP COLUMN email_notifications;
      ALTER TABLE users DROP COLUMN public_profile;
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
  assert.deepEqual(
    source.prepare("PRAGMA table_info(users)").all().map((column) => column.name),
    ["id", "email", "nickname", "password_hash", "created_at", "updated_at"]
  );
  source.close();

  const probe = new DatabaseSync(probePath, { readOnly: true });
  assert.equal(tableExists(probe, "community_post_videos"), true);
  assert.equal(tableExists(probe, "schema_migrations"), false);
  assert.equal(probe.prepare("PRAGMA table_info(users)").all().length, 12);
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
