const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const dataDirectory = path.join(__dirname, "..", "data");
const databaseFile = process.env.DATABASE_FILE || path.join(dataDirectory, "birdora.sqlite");

let database = null;

function readJsonIfExists(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) return fallbackValue;

  const raw = fs.readFileSync(filePath, "utf8");
  return raw ? JSON.parse(raw) : fallbackValue;
}

function migrateUsers(db) {
  const usersFile = path.join(dataDirectory, "users.json");
  const users = readJsonIfExists(usersFile, []);
  if (!Array.isArray(users) || !users.length) return;

  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (
      id,
      email,
      nickname,
      password_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  for (const user of users) {
    if (!user || !user.id || !user.email || !user.passwordHash) continue;

    insertUser.run(
      user.id,
      String(user.email).toLowerCase(),
      user.nickname || String(user.email).split("@")[0],
      user.passwordHash,
      user.createdAt || new Date().toISOString(),
      user.updatedAt || user.createdAt || new Date().toISOString()
    );
  }
}

function migrateRevokedTokens(db) {
  const revokedTokensFile = path.join(dataDirectory, "revoked-tokens.json");
  const tokens = readJsonIfExists(revokedTokensFile, []);
  if (!Array.isArray(tokens) || !tokens.length) return;

  const insertToken = db.prepare(`
    INSERT OR IGNORE INTO revoked_tokens (
      jti,
      expires_at
    ) VALUES (?, ?)
  `);

  for (const token of tokens) {
    if (!token || !token.jti || !token.expiresAt) continue;
    insertToken.run(token.jti, token.expiresAt);
  }
}

function migrateLegacyJsonData(db) {
  db.exec("BEGIN");
  try {
    migrateUsers(db);
    migrateRevokedTokens(db);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function getDatabase() {
  if (database) return database;

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  database = new DatabaseSync(databaseFile);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
  `);

  migrateLegacyJsonData(database);
  return database;
}

function mapUserRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  getDatabase,
  mapUserRow,
};
