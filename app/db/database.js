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

function ensureColumns(db, tableName, columns) {
  const existingColumns = new Set(
    db.prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((column) => column.name)
  );

  for (const column of columns) {
    if (existingColumns.has(column.name)) continue;
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${column.definition}`);
  }
}

function migrateCommunityPostColumns(db) {
  ensureColumns(db, "community_posts", [
    {
      name: "observation_id",
      definition: "observation_id TEXT DEFAULT NULL",
    },
    {
      name: "analysis_summary",
      definition: "analysis_summary TEXT NOT NULL DEFAULT ''",
    },
    {
      name: "analysis_score",
      definition: "analysis_score INTEGER NOT NULL DEFAULT 0",
    },
    {
      name: "analysis_tags",
      definition: "analysis_tags TEXT NOT NULL DEFAULT '[]'",
    },
    {
      name: "analysis_suggestions",
      definition: "analysis_suggestions TEXT NOT NULL DEFAULT '[]'",
    },
    {
      name: "analysis_updated_at",
      definition: "analysis_updated_at TEXT NOT NULL DEFAULT ''",
    },
  ]);
}

function ensureCommunityObservationConstraints(db) {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS trg_community_posts_observation_insert
    BEFORE INSERT ON community_posts
    FOR EACH ROW
    WHEN NEW.observation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM observations WHERE id = NEW.observation_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_community_posts_observation_update
    BEFORE UPDATE OF observation_id ON community_posts
    FOR EACH ROW
    WHEN NEW.observation_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM observations WHERE id = NEW.observation_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_observations_linked_delete
    BEFORE DELETE ON observations
    FOR EACH ROW
    WHEN EXISTS (
      SELECT 1 FROM community_posts WHERE observation_id = OLD.id
    )
    BEGIN
      SELECT RAISE(ABORT, 'observation is linked to a community post');
    END;
  `);
}

function getDatabase() {
  if (database) return database;

  fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
  database = new DatabaseSync(databaseFile);

  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;

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

    CREATE TABLE IF NOT EXISTS community_posts (
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

    CREATE TABLE IF NOT EXISTS community_post_reactions (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id, reaction_type),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_post_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_post_questions (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS community_post_images (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      image_original_name TEXT NOT NULL DEFAULT '',
      image_mime_type TEXT NOT NULL DEFAULT '',
      image_size_bytes INTEGER NOT NULL DEFAULT 0,
      selected_species_name TEXT NOT NULL,
      selected_species_scientific_name TEXT NOT NULL DEFAULT '',
      confidence REAL NOT NULL,
      top_candidates_json TEXT NOT NULL DEFAULT '[]',
      location_text TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'osea-browser',
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
    CREATE INDEX IF NOT EXISTS idx_community_posts_created_at
      ON community_posts(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_community_posts_user_id_created_at
      ON community_posts(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_community_post_reactions_post_id
      ON community_post_reactions(post_id);
    CREATE INDEX IF NOT EXISTS idx_community_post_comments_post_id_created_at
      ON community_post_comments(post_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_community_post_questions_post_id_created_at
      ON community_post_questions(post_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_community_post_images_post_id
      ON community_post_images(post_id);
    CREATE INDEX IF NOT EXISTS idx_observations_user_id_created_at
      ON observations(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_observations_created_at
      ON observations(created_at DESC);
  `);

  migrateCommunityPostColumns(database);
  ensureCommunityObservationConstraints(database);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_community_posts_observation_id
      ON community_posts(observation_id);
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
