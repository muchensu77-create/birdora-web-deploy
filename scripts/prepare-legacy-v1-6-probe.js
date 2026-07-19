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
    db.exec(`
      PRAGMA foreign_keys = OFF;
      PRAGMA legacy_alter_table = ON;
      PRAGMA busy_timeout = 5000;
      BEGIN IMMEDIATE;
    `);
    transactionStarted = true;
    const postCountBefore = Number(
      db.prepare("SELECT COUNT(*) AS count FROM community_posts").get().count
    );
    const orphanedObservations = Number(db.prepare(`
      SELECT COUNT(*) AS count
      FROM community_posts AS post
      LEFT JOIN observations AS observation ON observation.id = post.observation_id
      WHERE post.observation_id IS NOT NULL AND observation.id IS NULL
    `).get().count);
    if (orphanedObservations) {
      throw new Error(`Legacy probe found ${orphanedObservations} orphaned observation link(s)`);
    }

    db.exec(`
      ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN gender TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN age INTEGER DEFAULT NULL;
      ALTER TABLE users ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
      ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE users ADD COLUMN public_profile INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE community_posts_v17_compat (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        observation_id TEXT DEFAULT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        bird TEXT NOT NULL DEFAULT '观鸟笔记',
        analysis_summary TEXT NOT NULL DEFAULT '',
        analysis_score INTEGER NOT NULL DEFAULT 0,
        analysis_tags TEXT NOT NULL DEFAULT '[]',
        analysis_suggestions TEXT NOT NULL DEFAULT '[]',
        analysis_updated_at TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE RESTRICT
      );

      INSERT INTO community_posts_v17_compat (
        id, user_id, observation_id, title, body, bird,
        analysis_summary, analysis_score, analysis_tags,
        analysis_suggestions, analysis_updated_at, created_at, updated_at
      )
      SELECT
        id, user_id, observation_id, title, body, bird,
        analysis_summary, analysis_score, analysis_tags,
        analysis_suggestions, analysis_updated_at, created_at, updated_at
      FROM community_posts;

      DROP TABLE community_posts;
      ALTER TABLE community_posts_v17_compat RENAME TO community_posts;

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
        AND NOT EXISTS (
          SELECT 1 FROM observations WHERE id = NEW.observation_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
      END;

      CREATE TRIGGER trg_community_posts_observation_update
      BEFORE UPDATE OF observation_id ON community_posts
      FOR EACH ROW
      WHEN NEW.observation_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM observations WHERE id = NEW.observation_id
        )
      BEGIN
        SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
      END;

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
    const postCountAfter = Number(
      db.prepare("SELECT COUNT(*) AS count FROM community_posts").get().count
    );
    if (postCountAfter !== postCountBefore) {
      throw new Error(
        `Legacy probe post count changed: before=${postCountBefore} after=${postCountAfter}`
      );
    }
    const integrity = db.prepare("PRAGMA integrity_check").all();
    if (integrity.some((row) => row.integrity_check !== "ok")) {
      throw new Error("Legacy probe integrity_check failed");
    }
    db.exec("COMMIT");
    transactionStarted = false;
    db.exec("PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;");
    const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyErrors.length) {
      throw new Error(`Legacy probe foreign_key_check found ${foreignKeyErrors.length} violation(s)`);
    }
  } finally {
    if (transactionStarted) {
      try {
        db.exec("ROLLBACK");
      } catch {
        // Preserve the original error; this database is only an isolated probe.
      }
    }
    try {
      db.exec("PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;");
    } catch {
      // The probe will be discarded after any primary failure.
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
