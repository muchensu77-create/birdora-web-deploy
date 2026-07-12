"use strict";

const VERSION = "V007";
const NAME = "drafts-publish";

function validate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(idempotency_records)").all().map((row) => row.name));
  for (const column of [
    "user_id", "scope", "key", "request_hash", "state", "status_code", "response_json",
    "resource_id", "expires_at", "created_at", "updated_at",
  ]) {
    if (!columns.has(column)) throw new Error(`V007 idempotency_records.${column} is missing`);
  }
  const indexes = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all().map((row) => row.name));
  if (!indexes.has("idx_idempotency_records_expiry")) throw new Error("V007 idempotency expiry index is missing");
}

function up(db) {
  db.exec(`
    CREATE TABLE idempotency_records (
      user_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('processing', 'completed')),
      status_code INTEGER DEFAULT NULL,
      response_json TEXT DEFAULT NULL,
      resource_id TEXT DEFAULT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, scope, key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_idempotency_records_expiry ON idempotency_records(expires_at);
    CREATE INDEX idx_post_drafts_publishable
      ON post_drafts(user_id, consumed_at, version, updated_at DESC, id DESC);
  `);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
