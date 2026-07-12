"use strict";

const VERSION = "V009";
const NAME = "notifications";

function validate(db) {
  for (const table of ["notifications", "notification_preferences", "user_event_stream"]) {
    if (db.prepare(`PRAGMA table_info(${table})`).all().length === 0) throw new Error(`V009 table ${table} is missing`);
  }
  const missingPreferences = db.prepare(`
    SELECT COUNT(*) AS count FROM users
    LEFT JOIN notification_preferences AS preferences ON preferences.user_id = users.id
    WHERE preferences.user_id IS NULL
  `).get();
  if (Number(missingPreferences.count) !== 0) throw new Error("V009 notification preference backfill is incomplete");
}

function up(db, context) {
  db.exec(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      recipient_user_id TEXT NOT NULL,
      actor_user_id TEXT DEFAULT NULL,
      type TEXT NOT NULL CHECK (type IN ('post_liked', 'post_commented', 'user_followed', 'comment_replied', 'post_moderation_updated', 'system_announcement')),
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      dedupe_key TEXT NOT NULL UNIQUE,
      read_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_notifications_recipient_cursor
      ON notifications(recipient_user_id, created_at DESC, id DESC);
    CREATE INDEX idx_notifications_recipient_unread
      ON notifications(recipient_user_id, read_at, created_at DESC);

    CREATE TABLE notification_preferences (
      user_id TEXT PRIMARY KEY,
      in_app_enabled INTEGER NOT NULL DEFAULT 1 CHECK (in_app_enabled IN (0, 1)),
      likes_enabled INTEGER NOT NULL DEFAULT 1 CHECK (likes_enabled IN (0, 1)),
      comments_enabled INTEGER NOT NULL DEFAULT 1 CHECK (comments_enabled IN (0, 1)),
      follows_enabled INTEGER NOT NULL DEFAULT 1 CHECK (follows_enabled IN (0, 1)),
      moderation_enabled INTEGER NOT NULL DEFAULT 1 CHECK (moderation_enabled IN (0, 1)),
      system_enabled INTEGER NOT NULL DEFAULT 1 CHECK (system_enabled IN (0, 1)),
      email_enabled INTEGER NOT NULL DEFAULT 1 CHECK (email_enabled IN (0, 1)),
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE user_event_stream (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_user_event_stream_user_sequence ON user_event_stream(user_id, sequence);
  `);
  const now = context.now().toISOString();
  db.prepare(`
    INSERT INTO notification_preferences (
      user_id, in_app_enabled, likes_enabled, comments_enabled, follows_enabled,
      moderation_enabled, system_enabled, email_enabled, updated_at
    )
    SELECT id, 1, 1, 1, 1, 1, 1, email_notifications, ? FROM users
  `).run(now);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
