const fs = require("fs");
const path = require("path");

const VERSION = "V002";
const NAME = "legacy-retirement";
const USERS_IMPORT_NAME = "legacy-users-json-v1";
const TOKENS_IMPORT_NAME = "legacy-revoked-tokens-json-v1";
const TABLE_RETIREMENT_NAME = "legacy-table-retirement-v1";
const DEFERRED_TABLES = ["user_point_events"];
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$(?:0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

function tableExists(db, tableName) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(tableName));
}

function readJsonArray(filePath, importMode) {
  if (!fs.existsSync(filePath)) {
    if (importMode === "required") {
      throw new Error(`Required legacy JSON file is missing: ${filePath}`);
    }
    return { sourceExists: false, values: [] };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let value;
  try {
    value = raw.trim() ? JSON.parse(raw) : [];
  } catch (error) {
    throw new Error(`Could not parse legacy JSON ${filePath}: ${error.message}`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Legacy JSON ${filePath} must contain an array`);
  }
  return { sourceExists: true, values: value };
}

function runDataMigrationOnce(db, name, now, operation) {
  const existing = db.prepare(`
    SELECT status
    FROM data_migrations
    WHERE name = ?
  `).get(name);
  if (existing) {
    if (existing.status !== "completed") {
      throw new Error(`Data migration ${name} is in unexpected state ${existing.status}`);
    }
    return;
  }

  const detail = operation();
  db.prepare(`
    INSERT INTO data_migrations (name, status, detail_json, completed_at)
    VALUES (?, 'completed', ?, ?)
  `).run(name, JSON.stringify(detail), now().toISOString());
}

function importLegacyUsers(db, dataDirectory, importMode) {
  const filePath = path.join(dataDirectory, "users.json");
  const { sourceExists, values } = readJsonArray(filePath, importMode);
  const insertUser = db.prepare(`
    INSERT INTO users (
      id,
      email,
      nickname,
      password_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  let validRows = 0;
  let insertedRows = 0;
  let alreadyPresentRows = 0;

  for (const [index, user] of values.entries()) {
    if (!user || !user.id || !user.email || !user.passwordHash) {
      if (importMode === "required") {
        throw new Error(`Invalid required legacy user row at index ${index}`);
      }
      continue;
    }
    if (
      importMode === "required"
      && (
        typeof user.id !== "string"
        || typeof user.email !== "string"
        || typeof user.passwordHash !== "string"
        || typeof user.createdAt !== "string"
        || typeof user.updatedAt !== "string"
        || (user.nickname !== undefined && typeof user.nickname !== "string")
      )
    ) {
      throw new Error(`Malformed required legacy user row at index ${index}`);
    }
    const id = String(user.id).trim();
    const email = String(user.email).trim().toLowerCase();
    const passwordHash = String(user.passwordHash);
    const createdAtValue = user.createdAt || new Date(0).toISOString();
    const updatedAtValue = user.updatedAt || createdAtValue;
    const createdAtEpoch = Date.parse(createdAtValue);
    const updatedAtEpoch = Date.parse(updatedAtValue);
    if (
      !id
      || !email
      || (importMode === "required" && !EMAIL_PATTERN.test(email))
      || (importMode === "required" && !BCRYPT_HASH_PATTERN.test(passwordHash))
      || !Number.isFinite(createdAtEpoch)
      || !Number.isFinite(updatedAtEpoch)
    ) {
      if (importMode === "required") {
        throw new Error(`Malformed required legacy user row at index ${index}`);
      }
      continue;
    }
    validRows += 1;
    const createdAt = new Date(createdAtEpoch).toISOString();
    const updatedAt = new Date(updatedAtEpoch).toISOString();
    const nickname = user.nickname || email.split("@")[0];
    const conflicts = db.prepare(`
      SELECT id, email, nickname, password_hash, created_at, updated_at
      FROM users
      WHERE id = ? OR lower(email) = ?
    `).all(id, email);
    if (conflicts.length) {
      const identityExact = conflicts.length === 1
        && conflicts[0].id === id
        && String(conflicts[0].email).toLowerCase() === email
        && conflicts[0].password_hash === passwordHash;
      const metadataExact = identityExact
        && conflicts[0].nickname === nickname
        && Date.parse(conflicts[0].created_at) === createdAtEpoch
        && Date.parse(conflicts[0].updated_at) === updatedAtEpoch;
      const exact = identityExact
        && (importMode !== "required" || metadataExact);
      if (!exact) {
        throw new Error(`Legacy user conflict for id=${id} email=${email}`);
      }
      alreadyPresentRows += 1;
      continue;
    }
    const result = insertUser.run(
      id,
      email,
      nickname,
      passwordHash,
      createdAt,
      updatedAt
    );
    insertedRows += Number(result.changes);
  }

  return {
    importMode,
    source: "users.json",
    sourceExists,
    sourceRows: values.length,
    validRows,
    insertedRows,
    alreadyPresentRows,
    skippedRows: values.length - validRows,
  };
}

function importLegacyRevokedTokens(db, dataDirectory, importMode) {
  const filePath = path.join(dataDirectory, "revoked-tokens.json");
  const { sourceExists, values } = readJsonArray(filePath, importMode);
  const insertToken = db.prepare(`
    INSERT INTO revoked_tokens (jti, expires_at)
    VALUES (?, ?)
  `);
  let validRows = 0;
  let insertedRows = 0;
  let alreadyPresentRows = 0;
  let extendedRows = 0;

  for (const [index, token] of values.entries()) {
    if (!token || !token.jti || !token.expiresAt) {
      if (importMode === "required") {
        throw new Error(`Invalid required legacy revoked-token row at index ${index}`);
      }
      continue;
    }
    if (
      importMode === "required"
      && (typeof token.jti !== "string" || typeof token.expiresAt !== "string")
    ) {
      throw new Error(`Malformed required legacy revoked-token row at index ${index}`);
    }
    const jti = String(token.jti).trim();
    if (!jti) {
      if (importMode === "required") {
        throw new Error(`Malformed required legacy revoked-token row at index ${index}`);
      }
      continue;
    }
    validRows += 1;
    const incomingExpiry = Date.parse(token.expiresAt);
    if (!Number.isFinite(incomingExpiry)) {
      throw new Error(`Legacy revoked token has invalid expiresAt for jti=${jti}`);
    }
    const expiresAt = new Date(incomingExpiry).toISOString();
    const existing = db.prepare(`
      SELECT expires_at
      FROM revoked_tokens
      WHERE jti = ?
    `).get(jti);
    if (existing) {
      const existingExpiry = Date.parse(existing.expires_at);
      if (!Number.isFinite(existingExpiry)) {
        throw new Error(`Existing revoked token has invalid expires_at for jti=${jti}`);
      }
      if (incomingExpiry > existingExpiry) {
        db.prepare("UPDATE revoked_tokens SET expires_at = ? WHERE jti = ?")
          .run(expiresAt, jti);
        extendedRows += 1;
      } else {
        alreadyPresentRows += 1;
      }
      continue;
    }
    const result = insertToken.run(jti, expiresAt);
    insertedRows += Number(result.changes);
  }

  return {
    importMode,
    source: "revoked-tokens.json",
    sourceExists,
    sourceRows: values.length,
    validRows,
    insertedRows,
    alreadyPresentRows,
    extendedRows,
    skippedRows: values.length - validRows,
  };
}

function validateDataMigrationsTable(db) {
  if (!tableExists(db, "data_migrations")) {
    throw new Error("V002 data_migrations table is missing");
  }

  const columns = db.prepare("PRAGMA table_info(data_migrations)").all();
  const expectedNames = ["name", "status", "detail_json", "completed_at"];
  if (
    columns.length !== expectedNames.length
    || columns.some((column, index) => column.name !== expectedNames[index])
  ) {
    throw new Error("V002 data_migrations table has an invalid shape");
  }

  for (const name of [USERS_IMPORT_NAME, TOKENS_IMPORT_NAME]) {
    const row = db.prepare(`
      SELECT status, detail_json, completed_at
      FROM data_migrations
      WHERE name = ?
    `).get(name);
    if (!row || row.status !== "completed" || !row.completed_at) {
      throw new Error(`V002 data migration marker is missing or incomplete: ${name}`);
    }
    try {
      JSON.parse(row.detail_json);
    } catch {
      throw new Error(`V002 data migration detail is invalid JSON: ${name}`);
    }
  }

  const retirement = db.prepare(`
    SELECT status, detail_json, completed_at
    FROM data_migrations
    WHERE name = ?
  `).get(TABLE_RETIREMENT_NAME);
  if (!retirement || retirement.status !== "deferred" || !retirement.completed_at) {
    throw new Error("V002 deferred legacy-table retirement marker is missing");
  }
  let retirementDetail;
  try {
    retirementDetail = JSON.parse(retirement.detail_json);
  } catch {
    throw new Error("V002 deferred legacy-table retirement detail is invalid JSON");
  }
  if (
    retirementDetail.disposition !== "deferred"
    || !Array.isArray(retirementDetail.tables)
    || !DEFERRED_TABLES.every((tableNameValue) => (
      retirementDetail.tables.includes(tableNameValue)
    ))
  ) {
    throw new Error("V002 deferred legacy-table retirement detail is invalid");
  }
}

function up(db, context) {
  if (!context.dataDirectory) {
    throw new Error("V002 requires a legacy data directory");
  }

  const importMode = context.legacyJsonImportMode || "optional";
  const legacySources = ["users.json", "revoked-tokens.json"];
  if (importMode === "required") {
    const missingSources = legacySources.filter(
      (fileName) => !fs.existsSync(path.join(context.dataDirectory, fileName))
    );
    if (missingSources.length) {
      throw new Error(
        `Required legacy JSON file(s) missing: ${missingSources.join(", ")}`
      );
    }
  }

  db.exec(`
    CREATE TABLE data_migrations (
      name TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      completed_at TEXT NOT NULL
    );
  `);

  runDataMigrationOnce(
    db,
    USERS_IMPORT_NAME,
    context.now,
    () => importMode === "disabled"
      ? {
          importMode,
          source: "users.json",
          sourceExists: null,
          sourceRows: 0,
          validRows: 0,
          insertedRows: 0,
          alreadyPresentRows: 0,
          skippedRows: 0,
        }
      : importLegacyUsers(db, context.dataDirectory, importMode)
  );
  runDataMigrationOnce(
    db,
    TOKENS_IMPORT_NAME,
    context.now,
    () => importMode === "disabled"
      ? {
          importMode,
          source: "revoked-tokens.json",
          sourceExists: null,
          sourceRows: 0,
          validRows: 0,
          insertedRows: 0,
          alreadyPresentRows: 0,
          extendedRows: 0,
          skippedRows: 0,
        }
      : importLegacyRevokedTokens(db, context.dataDirectory, importMode)
  );

  const pointsTablePresent = tableExists(db, "user_point_events");
  db.prepare(`
    INSERT INTO data_migrations (name, status, detail_json, completed_at)
    VALUES (?, 'deferred', ?, ?)
  `).run(
    TABLE_RETIREMENT_NAME,
    JSON.stringify({
      disposition: "deferred",
      tables: DEFERRED_TABLES,
      presentAtMigration: {
        user_point_events: pointsTablePresent,
      },
      reason: "zero-data-loss-hot-update",
    }),
    context.now().toISOString()
  );

  // Destructive retirement is deliberately deferred to a separately reviewed
  // release. V002 never drops a legacy table.
  if (pointsTablePresent && !tableExists(db, "user_point_events")) {
    throw new Error("V002 must preserve the existing user_point_events table");
  }
  validateDataMigrationsTable(db);
}

module.exports = {
  version: VERSION,
  name: NAME,
  up,
  validate: validateDataMigrationsTable,
};
