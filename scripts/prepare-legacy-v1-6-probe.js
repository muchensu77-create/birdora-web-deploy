require("dotenv").config({ quiet: true });

const fs = require("fs");
const path = require("path");
const { backup, DatabaseSync } = require("node:sqlite");
const { preflightDatabase } = require("../app/db/database");

const EXPECTED_GAP = "Unknown legacy database schema: missing=[community_post_videos], unknown=[]";

function requiredAbsolutePath(name) {
  const value = String(process.env[name] || "").trim();
  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return path.resolve(value);
}

function assertRegularSingleLink(filePath, label) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`${label} must be a regular single-link file`);
  }
}

function assertPrivateProbeParent(probePath) {
  const parent = path.dirname(probePath);
  const stats = fs.lstatSync(parent);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("LEGACY_PROBE_DATABASE_FILE parent must be a physical directory");
  }
  if (process.platform !== "win32" && (stats.mode & 0o077) !== 0) {
    throw new Error("LEGACY_PROBE_DATABASE_FILE parent must not be accessible by group or other users");
  }
  return fs.realpathSync(parent);
}

function assertExpectedGap(databaseFile, backupDirectory) {
  try {
    preflightDatabase({
      databaseFile,
      backupDirectory,
      autoMigrate: false,
      backupEnabled: true,
      legacyJsonImportMode: "disabled",
      nodeEnvironment: "production",
    });
  } catch (error) {
    if (error.message === EXPECTED_GAP) return;
    throw error;
  }
  throw new Error("Legacy probe refused: the source no longer has the expected v1.6 schema gap");
}

function addCanonicalV16Compatibility(databaseFile) {
  const db = new DatabaseSync(databaseFile);
  let transactionStarted = false;
  try {
    db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; BEGIN IMMEDIATE;");
    transactionStarted = true;
    db.exec(`
      ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN age INTEGER DEFAULT NULL;
      ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE community_post_videos (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL UNIQUE,
        storage_path TEXT NOT NULL,
        original_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
      );
      CREATE INDEX idx_community_post_videos_post_id
        ON community_post_videos(post_id);
    `);
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.some((row) => row.integrity_check !== "ok")) {
      throw new Error("Legacy probe integrity_check failed");
    }
    const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) {
      throw new Error(`Legacy probe foreign_key_check found ${foreignKeyErrors.length} violation(s)`);
    }
    db.exec("COMMIT");
    transactionStarted = false;
  } finally {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error; this database is only an isolated probe.
      }
    }
    db.close();
  }
}

async function main() {
  process.umask(0o077);
  const sourcePath = requiredAbsolutePath("DATABASE_FILE");
  const probePath = requiredAbsolutePath("LEGACY_PROBE_DATABASE_FILE");
  const backupDirectory = path.resolve(
    process.env.DATABASE_BACKUP_DIR || path.join(path.dirname(probePath), "backups")
  );

  if (sourcePath === probePath || path.dirname(sourcePath) === path.dirname(probePath)) {
    throw new Error("Legacy probe must be outside the production database directory");
  }
  assertRegularSingleLink(sourcePath, "DATABASE_FILE");
  const physicalProbeParent = assertPrivateProbeParent(probePath);
  if (fs.existsSync(probePath)) {
    throw new Error("LEGACY_PROBE_DATABASE_FILE must not already exist");
  }
  if (path.dirname(fs.realpathSync(sourcePath)) === physicalProbeParent) {
    throw new Error("Legacy probe physical parent must differ from the source database parent");
  }

  assertExpectedGap(sourcePath, backupDirectory);

  let source = null;
  let created = false;
  try {
    source = new DatabaseSync(sourcePath, { readOnly: true });
    await backup(source, probePath);
    created = true;
    source.close();
    source = null;
    fs.chmodSync(probePath, 0o600);
    assertRegularSingleLink(probePath, "legacy probe database");

    // Re-check the consistent SQLite snapshot before changing only the probe.
    assertExpectedGap(probePath, backupDirectory);
    addCanonicalV16Compatibility(probePath);

    const status = preflightDatabase({
      databaseFile: probePath,
      backupDirectory,
      autoMigrate: false,
      backupEnabled: true,
      legacyJsonImportMode: "disabled",
      nodeEnvironment: "production",
    });
    if (!status.safeToApply || !status.pendingVersions.length) {
      throw new Error("Legacy probe did not reach a safe pending-migration state");
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "isolated-probe",
      sourceModified: false,
      probePath,
      currentVersion: status.currentVersion,
      targetVersion: status.targetVersion,
      pendingVersions: status.pendingVersions,
      safeToApply: status.safeToApply,
    })}\n`);
  } catch (error) {
    if (created) {
      try {
        fs.rmSync(probePath, { force: true });
      } catch {
        // Keep the original failure; the root-only staging directory remains isolated.
      }
    }
    throw error;
  } finally {
    if (source) source.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "LEGACY_V1_6_PROBE_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
});
