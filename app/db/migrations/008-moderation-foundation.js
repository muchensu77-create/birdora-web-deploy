"use strict";

const VERSION = "V008";
const NAME = "moderation-foundation";

const TABLES = Object.freeze([
  "post_revisions", "content_reports", "moderation_cases", "content_safety_results",
  "moderation_actions", "user_roles", "user_role_audit",
]);

function validate(db) {
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name));
  const missing = TABLES.filter((table) => !tables.has(table));
  if (missing.length) throw new Error(`V008 tables are missing: ${missing.join(", ")}`);
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  for (const index of ["idx_post_revisions_pending_unique", "idx_content_reports_post", "idx_moderation_cases_status"]) {
    if (!indexes.has(index)) throw new Error(`V008 index ${index} is missing`);
  }
}

function up(db) {
  db.exec(`
    CREATE TABLE post_revisions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      base_version INTEGER NOT NULL CHECK (base_version >= 1),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      location_text TEXT NOT NULL DEFAULT '',
      visibility TEXT NOT NULL CHECK (visibility IN ('public', 'followers', 'private')),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled_by_safety_change')),
      created_at TEXT NOT NULL,
      decided_at TEXT DEFAULT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX idx_post_revisions_pending_unique
      ON post_revisions(post_id) WHERE status = 'pending';

    CREATE TABLE content_reports (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      reporter_user_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
      created_at TEXT NOT NULL,
      handled_at TEXT DEFAULT NULL,
      UNIQUE (post_id, reporter_user_id, reason),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_content_reports_post ON content_reports(post_id, status, created_at DESC);

    CREATE TABLE moderation_cases (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      revision_id TEXT DEFAULT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('open', 'reviewing', 'approved', 'rejected', 'closed')),
      assigned_user_id TEXT DEFAULT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT DEFAULT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (revision_id) REFERENCES post_revisions(id) ON DELETE SET NULL,
      FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_moderation_cases_status ON moderation_cases(status, opened_at, id);

    CREATE TABLE content_safety_results (
      id TEXT PRIMARY KEY,
      draft_id TEXT DEFAULT NULL,
      revision_id TEXT DEFAULT NULL,
      media_id TEXT DEFAULT NULL,
      rule_set_version TEXT NOT NULL,
      decision TEXT NOT NULL CHECK (decision IN ('allow', 'review', 'reject')),
      reasons_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      CHECK ((draft_id IS NOT NULL) + (revision_id IS NOT NULL) + (media_id IS NOT NULL) = 1),
      FOREIGN KEY (draft_id) REFERENCES post_drafts(id) ON DELETE CASCADE,
      FOREIGN KEY (revision_id) REFERENCES post_revisions(id) ON DELETE CASCADE,
      FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE
    );

    CREATE TABLE user_roles (
      user_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('moderator', 'admin')),
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, role),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE moderation_actions (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      revision_id TEXT DEFAULT NULL,
      moderator_user_id TEXT NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      FOREIGN KEY (case_id) REFERENCES moderation_cases(id) ON DELETE CASCADE,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (revision_id) REFERENCES post_revisions(id) ON DELETE SET NULL,
      FOREIGN KEY (moderator_user_id) REFERENCES users(id) ON DELETE RESTRICT
    );

    CREATE TABLE user_role_audit (
      id TEXT PRIMARY KEY,
      target_user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
      actor_user_id TEXT DEFAULT NULL,
      actor_label TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
  `);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
