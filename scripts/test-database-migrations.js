const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const {
  DEFAULT_MIGRATIONS_DIRECTORY,
  runMigrations,
  verifyDatabaseIntegrity,
} = require("../app/db/migration-runner");
const {
  closeDatabase,
  getDatabase,
  getDatabaseHealth,
  initializeDatabase,
} = require("../app/db/database");

const tests = [];
const PUBLISHED_SCHEMA_FIXTURE = path.join(
  __dirname,
  "fixtures",
  "published-v1.7-schema.sql"
);
const VALID_BCRYPT_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
const ALL_MIGRATIONS = ["V001", "V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009"];

function test(name, operation) {
  tests.push({ name, operation });
}

function withTempDirectory(prefix, operation) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return operation(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function openDatabase(databaseFile, foreignKeys = true) {
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA foreign_keys = ${foreignKeys ? "ON" : "OFF"};
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
  `);
  return db;
}

function exists(db, type, name) {
  return Boolean(db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?
  `).get(type, name));
}

function migrationOptions(dataDirectory, extra = {}) {
  return {
    dataDirectory,
    migrationsDirectory: DEFAULT_MIGRATIONS_DIRECTORY,
    ...extra,
  };
}

function seedLockedCommitRows(db) {
  const timestamp = "2026-07-10T12:00:00.000Z";
  db.prepare(`
    INSERT INTO users (
      id, email, nickname, bio, gender, age, avatar_url,
      email_notifications, public_profile, password_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-user",
    "legacy@example.com",
    "Legacy",
    "bio",
    "other",
    30,
    "",
    0,
    0,
    "legacy-password-hash",
    timestamp,
    timestamp
  );
  db.prepare("INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?)")
    .run("legacy-jti", "2027-01-01T00:00:00.000Z");
  db.prepare(`
    INSERT INTO observations (
      id, user_id, image_url, image_original_name, image_mime_type,
      image_size_bytes, selected_species_name, selected_species_scientific_name,
      confidence, top_candidates_json, location_text, notes, source,
      observed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-observation",
    "legacy-user",
    "/observation.jpg",
    "observation.jpg",
    "image/jpeg",
    512,
    "白鹭",
    "Egretta garzetta",
    0.9,
    "[]",
    "杭州",
    "legacy observation",
    "osea-browser",
    timestamp,
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO community_posts (
      id, user_id, observation_id, title, body, bird,
      analysis_summary, analysis_score, analysis_tags, analysis_suggestions,
      analysis_updated_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-post",
    "legacy-user",
    "legacy-observation",
    "Legacy post",
    "Body",
    "白鹭",
    "summary",
    80,
    "[]",
    "[]",
    timestamp,
    timestamp,
    timestamp
  );
  db.prepare(`
    INSERT INTO community_post_reactions
      (post_id, user_id, reaction_type, created_at)
    VALUES (?, ?, ?, ?)
  `).run("legacy-post", "legacy-user", "helpful", timestamp);
  db.prepare(`
    INSERT INTO community_post_comments
      (id, post_id, user_id, body, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run("legacy-comment", "legacy-post", "legacy-user", "comment", timestamp, timestamp);
  db.prepare(`
    INSERT INTO community_post_questions
      (id, post_id, user_id, body, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run("legacy-question", "legacy-post", "legacy-user", "question", "open", timestamp, timestamp);
  db.prepare(`
    INSERT INTO community_post_images
      (id, post_id, storage_path, original_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-image",
    "legacy-post",
    "/tmp/post.jpg",
    "post.jpg",
    "image/jpeg",
    256,
    timestamp
  );
  db.prepare(`
    INSERT INTO community_post_videos
      (id, post_id, storage_path, original_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "legacy-video",
    "legacy-post",
    "/tmp/post.mp4",
    "post.mp4",
    "video/mp4",
    1024,
    timestamp
  );
}

function createLockedCommitDatabase(databaseFile, dataDirectory) {
  const db = openDatabase(databaseFile);
  db.exec(fs.readFileSync(PUBLISHED_SCHEMA_FIXTURE, "utf8"));
  seedLockedCommitRows(db);
  db.exec(`
    INSERT INTO user_point_events (id, user_id, points, created_at)
    VALUES ('legacy-points', 'legacy-user', 50, '2026-07-10T12:00:00.000Z');
  `);
  return db;
}

test("fresh database reaches the authoritative V009 schema and re-runs cleanly", () => {
  withTempDirectory("birdora-migration-fresh-", (directory) => {
    const databaseFile = path.join(directory, "fresh.sqlite");
    const db = openDatabase(databaseFile);
    try {
      const first = runMigrations(db, migrationOptions(directory));
      assert.deepEqual(first.appliedNow, ALL_MIGRATIONS);
      assert.equal(first.currentVersion, "V009");
      assert.deepEqual(first.checks, {
        integrityCheck: "ok",
        foreignKeyViolations: 0,
      });

      const ledgerColumns = db.prepare("PRAGMA table_info(schema_migrations)")
        .all().map((column) => column.name);
      assert.deepEqual(ledgerColumns, ["version", "name", "checksum", "applied_at"]);
      const ledgerBefore = db.prepare(`
        SELECT version, name, checksum, applied_at
        FROM schema_migrations ORDER BY version
      `).all().map((row) => ({ ...row }));
      assert.deepEqual(ledgerBefore.map((row) => row.version), ALL_MIGRATIONS);
      assert.ok(ledgerBefore.every((row) => /^[a-f0-9]{64}$/u.test(row.checksum)));

      const second = runMigrations(db, migrationOptions(directory));
      assert.deepEqual(second.appliedNow, []);
      const ledgerAfter = db.prepare(`
        SELECT version, name, checksum, applied_at
        FROM schema_migrations ORDER BY version
      `).all().map((row) => ({ ...row }));
      assert.deepEqual(ledgerAfter, ledgerBefore);
      assert.deepEqual(verifyDatabaseIntegrity(db), {
        integrityCheck: "ok",
        foreignKeyViolations: 0,
      });
    } finally {
      db.close();
    }
  });
});

test("frozen published schema is adopted without table replacement or data loss", () => {
  withTempDirectory("birdora-migration-legacy-", (directory) => {
    const databaseFile = path.join(directory, "legacy.sqlite");
    const db = createLockedCommitDatabase(databaseFile, directory);
    try {
      const tableDefinitionsBefore = db.prepare(`
        SELECT name, rootpage, sql
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map((row) => ({ ...row }));
      const expectedCounts = new Map();
      for (const tableName of [
        "users",
        "revoked_tokens",
        "observations",
        "community_posts",
        "community_post_reactions",
        "community_post_comments",
        "community_post_questions",
        "community_post_images",
        "community_post_videos",
      ]) {
        expectedCounts.set(
          tableName,
          Number(db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get().count)
        );
      }

      const baseline = runMigrations(
        db,
        migrationOptions(directory, { targetVersion: "V001" })
      );
      assert.deepEqual(baseline.appliedNow, ["V001"]);
      assert.equal(exists(db, "table", "user_point_events"), true);
      const tableDefinitionsAfter = db.prepare(`
        SELECT name, rootpage, sql
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
          AND name <> 'schema_migrations'
        ORDER BY name
      `).all().map((row) => ({ ...row }));
      assert.deepEqual(tableDefinitionsAfter, tableDefinitionsBefore);
      for (const [tableName, count] of expectedCounts) {
        assert.equal(
          Number(db.prepare(`SELECT COUNT(*) AS count FROM "${tableName}"`).get().count),
          count,
          `${tableName} row count changed during adoption`
        );
      }
      assert.equal(
        db.prepare("SELECT observation_id FROM community_posts WHERE id = 'legacy-post'")
          .get().observation_id,
        "legacy-observation"
      );
      const postForeignKeys = db.prepare("PRAGMA foreign_key_list(community_posts)").all();
      assert.ok(postForeignKeys.some((row) => row.from === "observation_id"));
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);

      const retired = runMigrations(db, migrationOptions(directory));
      assert.deepEqual(retired.appliedNow, ALL_MIGRATIONS.slice(1));
      assert.equal(exists(db, "table", "user_point_events"), true);
      assert.equal(
        db.prepare("SELECT points FROM user_point_events WHERE id = 'legacy-points'")
          .get().points,
        50
      );
      const retirementMarker = db.prepare(`
        SELECT status, detail_json
        FROM data_migrations
        WHERE name = 'legacy-table-retirement-v1'
      `).get();
      assert.equal(retirementMarker.status, "deferred");
      assert.equal(JSON.parse(retirementMarker.detail_json).disposition, "deferred");
      assert.equal(
        Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count),
        expectedCounts.get("users")
      );
      const migratedPost = db.prepare(`
        SELECT status, moderation_status, visibility, published_at
        FROM community_posts WHERE id = 'legacy-post'
      `).get();
      assert.deepEqual({ ...migratedPost }, {
        status: "published",
        moderation_status: "approved",
        visibility: "public",
        published_at: "2026-07-10T12:00:00.000Z",
      });
      assert.equal(
        Number(db.prepare(`
          SELECT COUNT(*) AS count FROM community_post_likes
          WHERE post_id = 'legacy-post' AND user_id = 'legacy-user'
        `).get().count),
        1
      );
      assert.equal(
        Number(db.prepare(`
          SELECT COUNT(*) AS count FROM notification_preferences
          WHERE user_id = 'legacy-user'
        `).get().count),
        1
      );
    } finally {
      db.close();
    }
  });
});

test("unknown or incomplete legacy schema aborts V001 atomically", () => {
  withTempDirectory("birdora-migration-unknown-", (directory) => {
    const databaseFile = path.join(directory, "unknown.sqlite");
    const db = openDatabase(databaseFile);
    try {
      db.exec("CREATE TABLE users (id TEXT PRIMARY KEY);");
      assert.throws(
        () => runMigrations(
          db,
          migrationOptions(directory, { targetVersion: "V001" })
        ),
        /Unknown legacy database schema/u
      );
      assert.equal(exists(db, "table", "schema_migrations"), false);
      assert.equal(exists(db, "table", "users"), true);
      assert.deepEqual(
        db.prepare("PRAGMA table_info(users)").all().map((column) => column.name),
        ["id"]
      );
    } finally {
      db.close();
    }
  });
});

test("published schema missing a canonical index is rejected without table replacement", () => {
  withTempDirectory("birdora-migration-noncanonical-", (directory) => {
    const db = createLockedCommitDatabase(
      path.join(directory, "noncanonical.sqlite"),
      directory
    );
    try {
      db.exec("DROP INDEX idx_observations_created_at;");
      const rootpagesBefore = db.prepare(`
        SELECT name, rootpage
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
        ORDER BY name
      `).all().map((row) => ({ ...row }));
      assert.throws(
        () => runMigrations(db, migrationOptions(directory, {
          targetVersion: "V001",
        })),
        /missing indexes: idx_observations_created_at/u
      );
      assert.equal(exists(db, "table", "schema_migrations"), false);
      assert.deepEqual(
        db.prepare(`
          SELECT name, rootpage
          FROM sqlite_master
          WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
          ORDER BY name
        `).all().map((row) => ({ ...row })),
        rootpagesBefore
      );
      assert.equal(
        db.prepare("SELECT nickname FROM users WHERE id = 'legacy-user'").get().nickname,
        "Legacy"
      );
    } finally {
      db.close();
    }
  });
});

test("changed contents of an applied migration fail checksum verification", () => {
  withTempDirectory("birdora-migration-checksum-", (directory) => {
    const copiedMigrations = path.join(directory, "migrations");
    fs.mkdirSync(copiedMigrations);
    for (const fileName of fs.readdirSync(DEFAULT_MIGRATIONS_DIRECTORY)) {
      fs.copyFileSync(
        path.join(DEFAULT_MIGRATIONS_DIRECTORY, fileName),
        path.join(copiedMigrations, fileName)
      );
    }
    const databaseFile = path.join(directory, "checksum.sqlite");
    const db = openDatabase(databaseFile);
    try {
      runMigrations(db, {
        dataDirectory: directory,
        migrationsDirectory: copiedMigrations,
      });
      fs.appendFileSync(
        path.join(copiedMigrations, "001-baseline.js"),
        "\n// forbidden post-application mutation\n"
      );
      assert.throws(
        () => runMigrations(db, {
          dataDirectory: directory,
          migrationsDirectory: copiedMigrations,
        }),
        /V001 checksum mismatch/u
      );
    } finally {
      db.close();
    }
  });
});

test("legacy users and revoked tokens JSON are imported exactly once", () => {
  withTempDirectory("birdora-migration-json-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([{
      id: "json-user",
      email: "JSON@Example.com",
      nickname: "JSON user",
      passwordHash: "json-password-hash",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    }]));
    fs.writeFileSync(path.join(directory, "revoked-tokens.json"), JSON.stringify([{
      jti: "json-jti",
      expiresAt: "2027-01-01T00:00:00.000Z",
    }]));

    const databaseFile = path.join(directory, "json.sqlite");
    const db = openDatabase(databaseFile);
    try {
      runMigrations(db, migrationOptions(directory));
      assert.equal(
        db.prepare("SELECT email FROM users WHERE id = 'json-user'").get().email,
        "json@example.com"
      );
      assert.ok(db.prepare("SELECT 1 FROM revoked_tokens WHERE jti = 'json-jti'").get());
      assert.equal(
        Number(db.prepare(`
          SELECT COUNT(*) AS count
          FROM data_migrations
          WHERE status = 'completed'
        `).get().count),
        2
      );

      db.prepare("DELETE FROM users WHERE id = 'json-user'").run();
      db.prepare("DELETE FROM revoked_tokens WHERE jti = 'json-jti'").run();
      fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([{
        id: "resurrected-user",
        email: "resurrected@example.com",
        passwordHash: "hash",
      }]));
      fs.writeFileSync(path.join(directory, "revoked-tokens.json"), JSON.stringify([{
        jti: "resurrected-jti",
        expiresAt: "2028-01-01T00:00:00.000Z",
      }]));

      const repeated = runMigrations(db, migrationOptions(directory));
      assert.deepEqual(repeated.appliedNow, []);
      assert.equal(db.prepare("SELECT 1 FROM users WHERE id = 'json-user'").get(), undefined);
      assert.equal(db.prepare("SELECT 1 FROM users WHERE id = 'resurrected-user'").get(), undefined);
      assert.equal(
        db.prepare("SELECT 1 FROM revoked_tokens WHERE jti = 'resurrected-jti'").get(),
        undefined
      );
    } finally {
      db.close();
    }
  });
});

test("disabled legacy JSON mode records completion without reading legacy files", () => {
  withTempDirectory("birdora-migration-json-disabled-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), "{not valid json");
    fs.writeFileSync(path.join(directory, "revoked-tokens.json"), "also invalid");
    const db = openDatabase(path.join(directory, "disabled.sqlite"));
    try {
      const result = runMigrations(db, migrationOptions(directory, {
        legacyJsonImportMode: "disabled",
      }));
      assert.deepEqual(result.appliedNow, ALL_MIGRATIONS);
      const details = db.prepare(`
        SELECT name, detail_json
        FROM data_migrations
        WHERE name IN ('legacy-users-json-v1', 'legacy-revoked-tokens-json-v1')
        ORDER BY name
      `).all();
      assert.equal(details.length, 2);
      for (const row of details) {
        const detail = JSON.parse(row.detail_json);
        assert.equal(detail.importMode, "disabled");
        assert.equal(detail.sourceExists, null);
        assert.equal(detail.sourceRows, 0);
      }
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users").get().count, 0);
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM revoked_tokens").get().count,
        0
      );
    } finally {
      db.close();
    }
  });
});

test("required legacy JSON mode rolls V002 back atomically when either file is missing", () => {
  withTempDirectory("birdora-migration-json-required-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), "[]");
    const db = openDatabase(path.join(directory, "required.sqlite"));
    try {
      runMigrations(db, migrationOptions(directory, { targetVersion: "V001" }));
      db.exec(`
        CREATE TABLE user_point_events (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          points INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      assert.throws(
        () => runMigrations(db, migrationOptions(directory, {
          legacyJsonImportMode: "required",
        })),
        /Required legacy JSON file\(s\) missing: revoked-tokens\.json/u
      );
      assert.deepEqual(
        db.prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all().map((row) => row.version),
        ["V001"]
      );
      assert.equal(exists(db, "table", "data_migrations"), false);
      assert.equal(exists(db, "table", "user_point_events"), true);
    } finally {
      db.close();
    }
  });
});

test("legacy user conflicts abort V002 instead of silently discarding data", () => {
  withTempDirectory("birdora-migration-json-conflict-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([
      {
        id: "would-be-inserted",
        email: "inserted@example.com",
        nickname: "Must roll back",
        passwordHash: VALID_BCRYPT_HASH,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "existing-user",
        email: "different@example.com",
        nickname: "Conflicting user",
        passwordHash: VALID_BCRYPT_HASH,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]));
    fs.writeFileSync(path.join(directory, "revoked-tokens.json"), "[]");
    const db = openDatabase(path.join(directory, "conflict.sqlite"));
    try {
      runMigrations(db, migrationOptions(directory, { targetVersion: "V001" }));
      db.prepare(`
        INSERT INTO users (
          id, email, nickname, password_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "existing-user",
        "existing@example.com",
        "Existing user",
        "existing-hash",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z"
      );

      assert.throws(
        () => runMigrations(db, migrationOptions(directory, {
          legacyJsonImportMode: "required",
        })),
        /Legacy user conflict/u
      );
      assert.deepEqual(
        db.prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all().map((row) => row.version),
        ["V001"]
      );
      assert.equal(exists(db, "table", "data_migrations"), false);
      assert.equal(
        db.prepare("SELECT 1 FROM users WHERE id = 'would-be-inserted'").get(),
        undefined
      );
      assert.deepEqual(
        {
          ...db.prepare("SELECT email, password_hash FROM users WHERE id = ?")
            .get("existing-user"),
        },
        { email: "existing@example.com", password_hash: "existing-hash" }
      );
    } finally {
      db.close();
    }
  });
});

test("required legacy import rejects malformed rows and rolls prior rows back", () => {
  withTempDirectory("birdora-migration-json-malformed-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), JSON.stringify([
      {
        id: "valid-before-malformed",
        email: "valid@example.com",
        nickname: "Must roll back",
        passwordHash: VALID_BCRYPT_HASH,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
      {
        id: "   ",
        email: "not-an-email",
        passwordHash: "not-bcrypt",
      },
    ]));
    fs.writeFileSync(path.join(directory, "revoked-tokens.json"), "[]");
    const db = openDatabase(path.join(directory, "malformed.sqlite"));
    try {
      runMigrations(db, migrationOptions(directory, { targetVersion: "V001" }));
      assert.throws(
        () => runMigrations(db, migrationOptions(directory, {
          legacyJsonImportMode: "required",
        })),
        /Malformed required legacy user row at index 1/u
      );
      assert.equal(
        db.prepare("SELECT 1 FROM users WHERE id = 'valid-before-malformed'").get(),
        undefined
      );
      assert.equal(exists(db, "table", "data_migrations"), false);
      assert.deepEqual(
        db.prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all().map((row) => row.version),
        ["V001"]
      );
    } finally {
      db.close();
    }
  });
});

test("legacy token import extends an existing revocation to the later expiry", () => {
  withTempDirectory("birdora-migration-json-token-", (directory) => {
    fs.writeFileSync(path.join(directory, "users.json"), "[]");
    fs.writeFileSync(path.join(directory, "revoked-tokens.json"), JSON.stringify([{
      jti: "existing-token",
      expiresAt: "2028-01-01T08:00:00+08:00",
    }]));
    const db = openDatabase(path.join(directory, "token.sqlite"));
    try {
      runMigrations(db, migrationOptions(directory, { targetVersion: "V001" }));
      db.prepare("INSERT INTO revoked_tokens (jti, expires_at) VALUES (?, ?)")
        .run("existing-token", "2027-01-01T00:00:00.000Z");
      runMigrations(db, migrationOptions(directory, {
        legacyJsonImportMode: "required",
      }));
      assert.equal(
        db.prepare("SELECT expires_at FROM revoked_tokens WHERE jti = ?")
          .get("existing-token").expires_at,
        "2028-01-01T00:00:00.000Z"
      );
      const detail = JSON.parse(db.prepare(`
        SELECT detail_json
        FROM data_migrations
        WHERE name = 'legacy-revoked-tokens-json-v1'
      `).get().detail_json);
      assert.equal(detail.importMode, "required");
      assert.equal(detail.extendedRows, 1);
      assert.equal(detail.insertedRows, 0);
    } finally {
      db.close();
    }
  });
});

test("foreign_key_check rejects an applied schema containing orphan rows", () => {
  withTempDirectory("birdora-migration-fk-", (directory) => {
    const databaseFile = path.join(directory, "foreign-key.sqlite");
    let db = openDatabase(databaseFile);
    runMigrations(db, migrationOptions(directory));
    assert.deepEqual(verifyDatabaseIntegrity(db), {
      integrityCheck: "ok",
      foreignKeyViolations: 0,
    });
    db.close();

    db = openDatabase(databaseFile, false);
    db.prepare(`
      INSERT INTO community_post_comments
        (id, post_id, user_id, body, created_at, updated_at)
      VALUES ('orphan-comment', 'missing-post', 'missing-user', 'body', 'now', 'now')
    `).run();
    db.close();

    db = openDatabase(databaseFile);
    try {
      assert.throws(
        () => runMigrations(db, migrationOptions(directory)),
        /foreign_key_check failed/u
      );
    } finally {
      db.close();
    }
  });
});

test("initializeDatabase publishes no connection after a migration failure", () => {
  withTempDirectory("birdora-migration-init-", (directory) => {
    closeDatabase();
    const badDatabaseFile = path.join(directory, "bad.sqlite");
    const bad = openDatabase(badDatabaseFile);
    bad.exec("CREATE TABLE unexpected_table (id TEXT PRIMARY KEY);");
    bad.close();

    assert.throws(
      () => getDatabase({ databaseFile: badDatabaseFile, dataDirectory: directory }),
      /Unknown legacy database schema/u
    );

    const goodDatabaseFile = path.join(directory, "good.sqlite");
    try {
      const initialized = initializeDatabase({
        databaseFile: goodDatabaseFile,
        dataDirectory: directory,
      });
      assert.equal(getDatabase(), initialized);
      assert.deepEqual(
        initialized.prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all().map((row) => row.version),
        ALL_MIGRATIONS
      );
      const otherDatabaseFile = path.join(directory, "other.sqlite");
      assert.throws(
        () => getDatabase({
          databaseFile: otherDatabaseFile,
          dataDirectory: directory,
        }),
        /Database is already initialized/u
      );
      assert.equal(fs.existsSync(otherDatabaseFile), false);

      closeDatabase();
      const switched = getDatabase({
        databaseFile: otherDatabaseFile,
        dataDirectory: directory,
        legacyJsonImportMode: "disabled",
      });
      assert.notEqual(switched, initialized);
      assert.equal(getDatabase(), switched);
      assert.equal(getDatabaseHealth().ready, true);
    } finally {
      closeDatabase();
    }
  });
});

test("database readiness detects migration-ledger drift from the active target", () => {
  withTempDirectory("birdora-migration-health-", (directory) => {
    closeDatabase();
    const db = initializeDatabase({
      databaseFile: path.join(directory, "health.sqlite"),
      dataDirectory: directory,
      legacyJsonImportMode: "disabled",
    });
    try {
      assert.deepEqual(getDatabaseHealth(), {
        ready: true,
        schemaVersion: "V009",
        targetSchemaVersion: "V009",
        ledgerVerified: true,
      });
      const targetLedgerRow = db.prepare(`
        SELECT version, name, checksum, applied_at
        FROM schema_migrations
        WHERE version = 'V009'
      `).get();
      db.prepare("DELETE FROM schema_migrations WHERE version = 'V009'").run();
      assert.deepEqual(getDatabaseHealth(), {
        ready: false,
        schemaVersion: "V008",
        targetSchemaVersion: "V009",
        ledgerVerified: false,
      });
      db.prepare(`
        INSERT INTO schema_migrations (version, name, checksum, applied_at)
        VALUES (?, ?, ?, ?)
      `).run(
        targetLedgerRow.version,
        targetLedgerRow.name,
        targetLedgerRow.checksum,
        targetLedgerRow.applied_at
      );
      assert.equal(getDatabaseHealth().ready, true);
      const baselineAppliedAt = db.prepare(`
        SELECT applied_at
        FROM schema_migrations
        WHERE version = 'V001'
      `).get().applied_at;
      db.prepare(`
        UPDATE schema_migrations
        SET applied_at = '2099-01-01T00:00:00.000Z'
        WHERE version = 'V001'
      `).run();
      assert.deepEqual(getDatabaseHealth(), {
        ready: false,
        schemaVersion: "V009",
        targetSchemaVersion: "V009",
        ledgerVerified: false,
      });
      db.prepare(`
        UPDATE schema_migrations
        SET applied_at = ?
        WHERE version = 'V001'
      `).run(baselineAppliedAt);
      assert.equal(getDatabaseHealth().ready, true);
    } finally {
      closeDatabase();
    }
  });
});

let failures = 0;
for (const { name, operation } of tests) {
  try {
    operation();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`not ok - ${name}`);
    console.error(error.stack || error);
  }
}

if (failures) {
  console.error(`${failures} database migration test(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${tests.length} database migration tests passed`);
}
