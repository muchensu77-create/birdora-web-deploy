"use strict";

const VERSION = "V003";
const NAME = "operational-foundation";

const REQUIRED_TABLE_COLUMNS = Object.freeze({
  outbox_events: [
    "id", "event_type", "aggregate_type", "aggregate_id", "payload_json", "dedupe_key",
    "attempts", "available_at", "lock_owner", "locked_until", "processed_at", "dead_lettered_at",
    "last_error", "created_at",
  ],
  account_deletion_jobs: [
    "id", "user_id", "user_id_snapshot", "mode", "status", "total_items", "completed_items",
    "requested_at", "completed_at", "last_error",
  ],
  account_deletion_job_items: [
    "id", "job_id", "media_id", "provider", "storage_key", "expected_hash", "status", "attempts",
    "completed_at", "last_error",
  ],
  post_drafts: [
    "id", "user_id", "observation_id", "title", "body", "bird", "location_text", "visibility",
    "version", "consumed_at", "created_at", "updated_at",
  ],
  media_assets: [
    "id", "owner_user_id", "bound_draft_id", "bound_post_id", "bound_avatar_user_id",
    "bound_observation_id", "sort_order", "kind", "purpose", "provider", "storage_key", "mime_type",
    "size_bytes", "sha256", "width", "height", "duration_ms", "status", "expires_at", "created_at",
    "updated_at",
  ],
});

const REQUIRED_INDEXES = Object.freeze([
  "idx_outbox_events_available",
  "idx_account_deletion_jobs_user",
  "idx_account_deletion_job_items_job",
  "idx_post_drafts_user_updated",
  "idx_media_assets_owner_status",
  "idx_media_assets_draft_sort",
  "idx_media_assets_post_sort",
  "idx_media_assets_avatar_unique",
]);

function tableColumns(db, tableName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().map((row) => row.name);
}

function validate(db) {
  const userColumns = new Set(tableColumns(db, "users"));
  for (const column of ["account_status", "deletion_requested_at"]) {
    if (!userColumns.has(column)) throw new Error(`V003 users.${column} is missing`);
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_TABLE_COLUMNS)) {
    const actual = new Set(tableColumns(db, tableName));
    if (actual.size === 0) throw new Error(`V003 table ${tableName} is missing`);
    const missing = requiredColumns.filter((column) => !actual.has(column));
    if (missing.length) throw new Error(`V003 ${tableName} columns are missing: ${missing.join(", ")}`);
  }

  const indexNames = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  const missingIndexes = REQUIRED_INDEXES.filter((name) => !indexNames.has(name));
  if (missingIndexes.length) throw new Error(`V003 indexes are missing: ${missingIndexes.join(", ")}`);

  const invalidAccountStates = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    WHERE account_status NOT IN ('active', 'deleting', 'deleted')
  `).get();
  if (Number(invalidAccountStates.count) !== 0) throw new Error("V003 users contain an invalid account_status");

  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) throw new Error(`V003 foreign_key_check found ${foreignKeyErrors.length} violation(s)`);
}

function up(db) {
  db.exec(`
    ALTER TABLE users
      ADD COLUMN account_status TEXT NOT NULL DEFAULT 'active'
      CHECK (account_status IN ('active', 'deleting', 'deleted'));
    ALTER TABLE users ADD COLUMN deletion_requested_at TEXT DEFAULT NULL;

    CREATE TABLE outbox_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT NOT NULL UNIQUE,
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      available_at TEXT NOT NULL,
      lock_owner TEXT DEFAULT NULL,
      locked_until TEXT DEFAULT NULL,
      processed_at TEXT DEFAULT NULL,
      dead_lettered_at TEXT DEFAULT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE account_deletion_jobs (
      id TEXT PRIMARY KEY,
      user_id TEXT DEFAULT NULL,
      user_id_snapshot TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('delete', 'anonymize')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
      total_items INTEGER NOT NULL DEFAULT 0 CHECK (total_items >= 0),
      completed_items INTEGER NOT NULL DEFAULT 0 CHECK (completed_items >= 0 AND completed_items <= total_items),
      requested_at TEXT NOT NULL,
      completed_at TEXT DEFAULT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );

    CREATE TABLE account_deletion_job_items (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      media_id TEXT DEFAULT NULL,
      provider TEXT NOT NULL,
      storage_key TEXT NOT NULL,
      expected_hash TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'missing')),
      attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      completed_at TEXT DEFAULT NULL,
      last_error TEXT NOT NULL DEFAULT '',
      UNIQUE (job_id, storage_key),
      FOREIGN KEY (job_id) REFERENCES account_deletion_jobs(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE SET NULL
    );

    CREATE TABLE post_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      observation_id TEXT DEFAULT NULL,
      title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      bird TEXT NOT NULL DEFAULT '观鸟笔记',
      location_text TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      consumed_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE RESTRICT
    );

    CREATE TABLE media_assets (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT DEFAULT NULL,
      bound_draft_id TEXT DEFAULT NULL,
      bound_post_id TEXT DEFAULT NULL,
      bound_avatar_user_id TEXT DEFAULT NULL,
      bound_observation_id TEXT DEFAULT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
      purpose TEXT NOT NULL CHECK (purpose IN ('avatar', 'draft', 'post', 'observation')),
      provider TEXT NOT NULL DEFAULT 'local',
      storage_key TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      sha256 TEXT NOT NULL,
      width INTEGER DEFAULT NULL CHECK (width IS NULL OR width > 0),
      height INTEGER DEFAULT NULL CHECK (height IS NULL OR height > 0),
      duration_ms INTEGER DEFAULT NULL CHECK (duration_ms IS NULL OR duration_ms >= 0),
      status TEXT NOT NULL CHECK (status IN ('temporary', 'processing', 'ready', 'attached', 'quarantined', 'deleting', 'deleted')),
      expires_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (bound_draft_id IS NOT NULL) + (bound_post_id IS NOT NULL)
        + (bound_avatar_user_id IS NOT NULL) + (bound_observation_id IS NOT NULL) <= 1
      ),
      CHECK (
        status <> 'attached'
        OR (bound_draft_id IS NOT NULL) + (bound_post_id IS NOT NULL)
          + (bound_avatar_user_id IS NOT NULL) + (bound_observation_id IS NOT NULL) = 1
      ),
      FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (bound_draft_id) REFERENCES post_drafts(id) ON DELETE SET NULL,
      FOREIGN KEY (bound_post_id) REFERENCES community_posts(id) ON DELETE SET NULL,
      FOREIGN KEY (bound_avatar_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (bound_observation_id) REFERENCES observations(id) ON DELETE SET NULL
    );

    CREATE INDEX idx_outbox_events_available
      ON outbox_events(processed_at, dead_lettered_at, available_at, locked_until);
    CREATE INDEX idx_account_deletion_jobs_user
      ON account_deletion_jobs(user_id_snapshot, requested_at DESC);
    CREATE INDEX idx_account_deletion_job_items_job
      ON account_deletion_job_items(job_id, status, id);
    CREATE INDEX idx_post_drafts_user_updated
      ON post_drafts(user_id, consumed_at, updated_at DESC, id DESC);
    CREATE INDEX idx_media_assets_owner_status
      ON media_assets(owner_user_id, status, created_at DESC);
    CREATE UNIQUE INDEX idx_media_assets_draft_sort
      ON media_assets(bound_draft_id, sort_order) WHERE bound_draft_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_media_assets_post_sort
      ON media_assets(bound_post_id, sort_order) WHERE bound_post_id IS NOT NULL;
    CREATE UNIQUE INDEX idx_media_assets_avatar_unique
      ON media_assets(bound_avatar_user_id) WHERE bound_avatar_user_id IS NOT NULL;
  `);

  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
