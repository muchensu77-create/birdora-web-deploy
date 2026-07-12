const VERSION = "V001";
const NAME = "baseline";

const BUSINESS_TABLES = [
  "users",
  "revoked_tokens",
  "observations",
  "community_posts",
  "community_post_reactions",
  "community_post_comments",
  "community_post_questions",
  "community_post_images",
  "community_post_videos",
];

const LEGACY_OPTIONAL_TABLES = new Set(["user_point_events"]);

function column(name, type, options = {}) {
  return {
    name,
    type,
    notnull: options.notnull ?? 0,
    pk: options.pk ?? 0,
    defaultValue: options.defaultValue ?? null,
  };
}

const TABLE_COLUMNS = {
  users: [
    column("id", "TEXT", { pk: 1 }),
    column("email", "TEXT", { notnull: 1 }),
    column("nickname", "TEXT", { notnull: 1 }),
    column("bio", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("gender", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("age", "INTEGER", { defaultValue: "NULL" }),
    column("avatar_url", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("email_notifications", "INTEGER", { notnull: 1, defaultValue: "1" }),
    column("public_profile", "INTEGER", { notnull: 1, defaultValue: "1" }),
    column("password_hash", "TEXT", { notnull: 1 }),
    column("created_at", "TEXT", { notnull: 1 }),
    column("updated_at", "TEXT", { notnull: 1 }),
  ],
  revoked_tokens: [
    column("jti", "TEXT", { pk: 1 }),
    column("expires_at", "TEXT", { notnull: 1 }),
  ],
  observations: [
    column("id", "TEXT", { pk: 1 }),
    column("user_id", "TEXT", { notnull: 1 }),
    column("image_url", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("image_original_name", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("image_mime_type", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("image_size_bytes", "INTEGER", { notnull: 1, defaultValue: "0" }),
    column("selected_species_name", "TEXT", { notnull: 1 }),
    column("selected_species_scientific_name", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("confidence", "REAL", { notnull: 1 }),
    column("top_candidates_json", "TEXT", { notnull: 1, defaultValue: "'[]'" }),
    column("location_text", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("notes", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("source", "TEXT", { notnull: 1, defaultValue: "'osea-browser'" }),
    column("observed_at", "TEXT", { notnull: 1 }),
    column("created_at", "TEXT", { notnull: 1 }),
    column("updated_at", "TEXT", { notnull: 1 }),
  ],
  community_posts: [
    column("id", "TEXT", { pk: 1 }),
    column("user_id", "TEXT", { notnull: 1 }),
    column("observation_id", "TEXT", { defaultValue: "NULL" }),
    column("title", "TEXT", { notnull: 1 }),
    column("body", "TEXT", { notnull: 1 }),
    column("bird", "TEXT", { notnull: 1, defaultValue: "'观鸟笔记'" }),
    column("analysis_summary", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("analysis_score", "INTEGER", { notnull: 1, defaultValue: "0" }),
    column("analysis_tags", "TEXT", { notnull: 1, defaultValue: "'[]'" }),
    column("analysis_suggestions", "TEXT", { notnull: 1, defaultValue: "'[]'" }),
    column("analysis_updated_at", "TEXT", { notnull: 1, defaultValue: "''" }),
    column("created_at", "TEXT", { notnull: 1 }),
    column("updated_at", "TEXT", { notnull: 1 }),
  ],
  community_post_reactions: [
    column("post_id", "TEXT", { notnull: 1, pk: 1 }),
    column("user_id", "TEXT", { notnull: 1, pk: 2 }),
    column("reaction_type", "TEXT", { notnull: 1, pk: 3 }),
    column("created_at", "TEXT", { notnull: 1 }),
  ],
  community_post_comments: [
    column("id", "TEXT", { pk: 1 }),
    column("post_id", "TEXT", { notnull: 1 }),
    column("user_id", "TEXT", { notnull: 1 }),
    column("body", "TEXT", { notnull: 1 }),
    column("created_at", "TEXT", { notnull: 1 }),
    column("updated_at", "TEXT", { notnull: 1 }),
  ],
  community_post_questions: [
    column("id", "TEXT", { pk: 1 }),
    column("post_id", "TEXT", { notnull: 1 }),
    column("user_id", "TEXT", { notnull: 1 }),
    column("body", "TEXT", { notnull: 1 }),
    column("status", "TEXT", { notnull: 1, defaultValue: "'open'" }),
    column("created_at", "TEXT", { notnull: 1 }),
    column("updated_at", "TEXT", { notnull: 1 }),
  ],
  community_post_images: [
    column("id", "TEXT", { pk: 1 }),
    column("post_id", "TEXT", { notnull: 1 }),
    column("storage_path", "TEXT", { notnull: 1 }),
    column("original_name", "TEXT", { notnull: 1 }),
    column("mime_type", "TEXT", { notnull: 1 }),
    column("size_bytes", "INTEGER", { notnull: 1 }),
    column("created_at", "TEXT", { notnull: 1 }),
  ],
  community_post_videos: [
    column("id", "TEXT", { pk: 1 }),
    column("post_id", "TEXT", { notnull: 1 }),
    column("storage_path", "TEXT", { notnull: 1 }),
    column("original_name", "TEXT", { notnull: 1 }),
    column("mime_type", "TEXT", { notnull: 1 }),
    column("size_bytes", "INTEGER", { notnull: 1 }),
    column("created_at", "TEXT", { notnull: 1 }),
  ],
};

const EXPECTED_FOREIGN_KEYS = {
  users: [],
  revoked_tokens: [],
  observations: ["user_id->users.id:CASCADE"],
  community_posts: [
    "observation_id->observations.id:RESTRICT",
    "user_id->users.id:CASCADE",
  ],
  community_post_reactions: [
    "post_id->community_posts.id:CASCADE",
    "user_id->users.id:CASCADE",
  ],
  community_post_comments: [
    "post_id->community_posts.id:CASCADE",
    "user_id->users.id:CASCADE",
  ],
  community_post_questions: [
    "post_id->community_posts.id:CASCADE",
    "user_id->users.id:CASCADE",
  ],
  community_post_images: ["post_id->community_posts.id:CASCADE"],
  community_post_videos: ["post_id->community_posts.id:CASCADE"],
};

const REQUIRED_INDEXES = [
  "idx_users_email",
  "idx_revoked_tokens_expires_at",
  "idx_community_posts_created_at",
  "idx_community_posts_user_id_created_at",
  "idx_community_posts_observation_id",
  "idx_community_post_reactions_post_id",
  "idx_community_post_comments_post_id_created_at",
  "idx_community_post_questions_post_id_created_at",
  "idx_community_post_images_post_id",
  "idx_community_post_videos_post_id",
  "idx_observations_user_id_created_at",
  "idx_observations_created_at",
];

const REQUIRED_TRIGGERS = [
  "trg_community_posts_observation_insert",
  "trg_community_posts_observation_update",
  "trg_observations_linked_delete",
];

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function appTableNames(db) {
  return db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map((row) => row.name);
}

function normalizeDefault(value) {
  if (value === null || value === undefined) return null;
  return String(value).replaceAll(/\s+/gu, " ").trim();
}

function assertTableColumns(db, tableName, options = {}) {
  const actualColumns = db.prepare(
    `PRAGMA table_info(${quoteIdentifier(tableName)})`
  ).all();
  const actualByName = new Map(actualColumns.map((item) => [item.name, item]));
  const expectedColumns = TABLE_COLUMNS[tableName];

  if (
    (!options.allowAdditionalColumns && actualColumns.length !== expectedColumns.length)
    || actualColumns.length < expectedColumns.length
    || expectedColumns.some((item) => !actualByName.has(item.name))
  ) {
    throw new Error(`Unknown legacy database schema: ${tableName} columns do not match the locked commit`);
  }

  for (const expected of expectedColumns) {
    const actual = actualByName.get(expected.name);
    const matches = String(actual.type || "").toUpperCase() === expected.type
      && Number(actual.notnull) === expected.notnull
      && Number(actual.pk) === expected.pk
      && normalizeDefault(actual.dflt_value) === expected.defaultValue;
    if (!matches) {
      throw new Error(
        `Unknown legacy database schema: ${tableName}.${expected.name} does not match the locked commit`
      );
    }
  }
}

function createMigrationLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

function tableName(prefix, name) {
  return quoteIdentifier(`${prefix}${name}`);
}

function createBusinessTables(db, prefix = "") {
  const users = tableName(prefix, "users");
  const revokedTokens = tableName(prefix, "revoked_tokens");
  const observations = tableName(prefix, "observations");
  const posts = tableName(prefix, "community_posts");
  const reactions = tableName(prefix, "community_post_reactions");
  const comments = tableName(prefix, "community_post_comments");
  const questions = tableName(prefix, "community_post_questions");
  const images = tableName(prefix, "community_post_images");
  const videos = tableName(prefix, "community_post_videos");

  db.exec(`
    CREATE TABLE ${users} (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nickname TEXT NOT NULL,
      bio TEXT NOT NULL DEFAULT '',
      gender TEXT NOT NULL DEFAULT '',
      age INTEGER DEFAULT NULL,
      avatar_url TEXT NOT NULL DEFAULT '',
      email_notifications INTEGER NOT NULL DEFAULT 1,
      public_profile INTEGER NOT NULL DEFAULT 1,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE ${revokedTokens} (
      jti TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE ${observations} (
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

    CREATE TABLE ${posts} (
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

    CREATE TABLE ${reactions} (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      reaction_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id, reaction_type),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE ${comments} (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE ${questions} (
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

    CREATE TABLE ${images} (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
    );

    CREATE TABLE ${videos} (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      storage_path TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
    );
  `);
}

function createIndexesAndTriggers(db) {
  db.exec(`
    CREATE INDEX idx_users_email ON users(email);
    CREATE INDEX idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
    CREATE INDEX idx_community_posts_created_at ON community_posts(created_at DESC);
    CREATE INDEX idx_community_posts_user_id_created_at
      ON community_posts(user_id, created_at DESC);
    CREATE INDEX idx_community_posts_observation_id ON community_posts(observation_id);
    CREATE INDEX idx_community_post_reactions_post_id
      ON community_post_reactions(post_id);
    CREATE INDEX idx_community_post_comments_post_id_created_at
      ON community_post_comments(post_id, created_at ASC);
    CREATE INDEX idx_community_post_questions_post_id_created_at
      ON community_post_questions(post_id, created_at ASC);
    CREATE INDEX idx_community_post_images_post_id ON community_post_images(post_id);
    CREATE INDEX idx_community_post_videos_post_id ON community_post_videos(post_id);
    CREATE INDEX idx_observations_user_id_created_at
      ON observations(user_id, created_at DESC);
    CREATE INDEX idx_observations_created_at ON observations(created_at DESC);

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

    CREATE TRIGGER trg_observations_linked_delete
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

function assertKnownLegacyFingerprint(db, tableNames) {
  const existing = new Set(tableNames);
  const allowed = new Set([...BUSINESS_TABLES, ...LEGACY_OPTIONAL_TABLES]);
  const missing = BUSINESS_TABLES.filter((table) => !existing.has(table));
  const unknown = tableNames.filter((table) => !allowed.has(table));
  if (missing.length || unknown.length) {
    throw new Error(
      `Unknown legacy database schema: missing=[${missing.join(", ")}], unknown=[${unknown.join(", ")}]`
    );
  }

  for (const tableNameValue of BUSINESS_TABLES) {
    assertTableColumns(db, tableNameValue);
  }
}

function normalizedForeignKeys(db, tableNameValue) {
  return db.prepare(
    `PRAGMA foreign_key_list(${quoteIdentifier(tableNameValue)})`
  ).all().map((row) => (
    `${row.from}->${row.table}.${row.to}:${String(row.on_delete).toUpperCase()}`
  )).sort();
}

function hasUniqueIndex(db, tableNameValue, expectedColumns) {
  return db.prepare(
    `PRAGMA index_list(${quoteIdentifier(tableNameValue)})`
  ).all().filter((index) => Number(index.unique) === 1).some((index) => {
    const columns = db.prepare(
      `PRAGMA index_info(${quoteIdentifier(index.name)})`
    ).all().sort((left, right) => left.seqno - right.seqno).map((item) => item.name);
    return columns.length === expectedColumns.length
      && columns.every((item, indexValue) => item === expectedColumns[indexValue]);
  });
}

function validateCanonicalSchema(db, context = {}) {
  const tables = new Set(appTableNames(db));
  const missing = BUSINESS_TABLES.filter((table) => !tables.has(table));
  if (missing.length) {
    throw new Error(`Canonical V001 schema is missing tables: ${missing.join(", ")}`);
  }

  const allowAdditionalColumns = Boolean(context.targetVersion && context.targetVersion !== VERSION);
  for (const tableNameValue of BUSINESS_TABLES) {
    assertTableColumns(db, tableNameValue, { allowAdditionalColumns });
    const actualForeignKeys = normalizedForeignKeys(db, tableNameValue);
    const expectedForeignKeys = [...EXPECTED_FOREIGN_KEYS[tableNameValue]].sort();
    if (
      actualForeignKeys.length !== expectedForeignKeys.length
      || actualForeignKeys.some((item, index) => item !== expectedForeignKeys[index])
    ) {
      throw new Error(`Canonical V001 foreign keys do not match for ${tableNameValue}`);
    }
  }

  if (!hasUniqueIndex(db, "users", ["email"])) {
    throw new Error("Canonical V001 schema is missing users.email UNIQUE constraint");
  }
  for (const mediaTable of ["community_post_images", "community_post_videos"]) {
    if (!hasUniqueIndex(db, mediaTable, ["post_id"])) {
      throw new Error(`Canonical V001 schema is missing ${mediaTable}.post_id UNIQUE constraint`);
    }
  }

  const indexNames = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'index'
  `).all().map((row) => row.name));
  const missingIndexes = REQUIRED_INDEXES.filter((indexName) => !indexNames.has(indexName));
  if (missingIndexes.length) {
    throw new Error(`Canonical V001 schema is missing indexes: ${missingIndexes.join(", ")}`);
  }

  const triggerNames = new Set(db.prepare(`
    SELECT name FROM sqlite_master WHERE type = 'trigger'
  `).all().map((row) => row.name));
  const missingTriggers = REQUIRED_TRIGGERS.filter((trigger) => !triggerNames.has(trigger));
  if (missingTriggers.length) {
    throw new Error(`Canonical V001 schema is missing triggers: ${missingTriggers.join(", ")}`);
  }
}

function validateIntegrityInsideMigration(db) {
  const integrityResults = db.prepare("PRAGMA integrity_check").all();
  if (integrityResults.some((row) => row.integrity_check !== "ok")) {
    throw new Error("V001 integrity_check failed");
  }
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check").all();
  if (foreignKeyErrors.length) {
    throw new Error(`V001 foreign_key_check found ${foreignKeyErrors.length} violation(s)`);
  }
}

function preflightLegacySchema(db) {
  const legacyTables = appTableNames(db).filter(
    (tableNameValue) => tableNameValue !== "schema_migrations"
  );
  if (!legacyTables.length) return;

  // Existing production tables are adopted only when they already match the
  // exact canonical schema. V001 never rebuilds, drops, or renames them.
  assertKnownLegacyFingerprint(db, legacyTables);
  validateCanonicalSchema(db);
}

function up(db) {
  const preMigrationTables = appTableNames(db).filter(
    (tableNameValue) => tableNameValue !== "schema_migrations"
  );
  createMigrationLedger(db);

  if (preMigrationTables.length === 0) {
    createBusinessTables(db);
    createIndexesAndTriggers(db);
  } else {
    preflightLegacySchema(db);
  }

  validateCanonicalSchema(db);
  validateIntegrityInsideMigration(db);
}

module.exports = {
  version: VERSION,
  name: NAME,
  preflight: preflightLegacySchema,
  up,
  validate: validateCanonicalSchema,
};
