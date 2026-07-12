"use strict";

const VERSION = "V005";
const NAME = "post-policy";

const REQUIRED_COLUMNS = Object.freeze([
  "location_text", "visibility", "status", "moderation_status", "moderation_source",
  "published_at", "deleted_at", "version",
]);

function validate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(community_posts)").all().map((row) => row.name));
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length) throw new Error(`V005 community_posts columns are missing: ${missing.join(", ")}`);

  const invalid = db.prepare(`
    SELECT COUNT(*) AS count FROM community_posts
    WHERE visibility NOT IN ('public', 'followers', 'private')
       OR status NOT IN ('submitted', 'published', 'deleted')
       OR moderation_status NOT IN ('pending', 'approved', 'rejected', 'under_review', 'hidden')
       OR version < 1
       OR (status = 'published' AND published_at = '')
  `).get();
  if (Number(invalid.count) !== 0) throw new Error("V005 community_posts contain an invalid policy state");

  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  for (const index of ["idx_community_posts_feed", "idx_community_posts_author_policy"]) {
    if (!indexes.has(index)) throw new Error(`V005 index ${index} is missing`);
  }
}

function up(db) {
  db.exec(`
    ALTER TABLE community_posts ADD COLUMN location_text TEXT NOT NULL DEFAULT '';
    ALTER TABLE community_posts
      ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'
      CHECK (visibility IN ('public', 'followers', 'private'));
    ALTER TABLE community_posts
      ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
      CHECK (status IN ('submitted', 'published', 'deleted'));
    ALTER TABLE community_posts
      ADD COLUMN moderation_status TEXT NOT NULL DEFAULT 'approved'
      CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'under_review', 'hidden'));
    ALTER TABLE community_posts ADD COLUMN moderation_source TEXT NOT NULL DEFAULT 'legacy_backfill';
    ALTER TABLE community_posts ADD COLUMN published_at TEXT NOT NULL DEFAULT '';
    ALTER TABLE community_posts ADD COLUMN deleted_at TEXT DEFAULT NULL;
    ALTER TABLE community_posts ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

    UPDATE community_posts SET published_at = created_at WHERE published_at = '';

    CREATE INDEX idx_community_posts_feed
      ON community_posts(status, moderation_status, visibility, published_at DESC, id DESC);
    CREATE INDEX idx_community_posts_author_policy
      ON community_posts(user_id, status, moderation_status, published_at DESC, id DESC);
  `);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
