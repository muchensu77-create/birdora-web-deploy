"use strict";

const VERSION = "V004";
const NAME = "social-graph";

function validate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(user_follows)").all().map((row) => row.name));
  for (const column of ["follower_user_id", "followed_user_id", "created_at"]) {
    if (!columns.has(column)) throw new Error(`V004 user_follows.${column} is missing`);
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  for (const index of ["idx_user_follows_follower_cursor", "idx_user_follows_followed_cursor"]) {
    if (!indexes.has(index)) throw new Error(`V004 index ${index} is missing`);
  }
  const selfFollows = db.prepare("SELECT COUNT(*) AS count FROM user_follows WHERE follower_user_id = followed_user_id").get();
  if (Number(selfFollows.count) !== 0) throw new Error("V004 contains a self-follow relationship");
}

function up(db) {
  db.exec(`
    CREATE TABLE user_follows (
      follower_user_id TEXT NOT NULL,
      followed_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (follower_user_id, followed_user_id),
      CHECK (follower_user_id <> followed_user_id),
      FOREIGN KEY (follower_user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (followed_user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_user_follows_follower_cursor
      ON user_follows(follower_user_id, created_at DESC, followed_user_id DESC);
    CREATE INDEX idx_user_follows_followed_cursor
      ON user_follows(followed_user_id, created_at DESC, follower_user_id DESC);
  `);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
