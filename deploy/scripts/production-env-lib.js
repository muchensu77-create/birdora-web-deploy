"use strict";

const fs = require("fs");
const path = require("path");

const ALLOWED_KEYS = new Set([
  "ACCOUNT_DELETION_ENABLED",
  "ALLOWED_ORIGINS",
  "ALLOW_EMPTY_DATABASE_INITIALIZATION",
  "AUTH_RATE_LIMIT",
  "COMMUNITY_DEMO_ENABLED",
  "COMMUNITY_LEGACY_LIKE_ENABLED",
  "COMMUNITY_POST_EDIT_ENABLED",
  "COMMUNITY_PUBLISH_ENABLED",
  "COMMUNITY_UPLOAD_DIR",
  "COMMUNITY_WRITE_RATE_LIMIT",
  "CONTENT_REPORT_RATE_LIMIT",
  "COOKIE_SECURE",
  "CORS_ORIGIN",
  "DATABASE_AUTO_MIGRATE",
  "DATABASE_BACKUP_DIR",
  "DATABASE_BACKUP_ENABLED",
  "DATABASE_BACKUP_RETENTION",
  "DATABASE_FILE",
  "DATA_DIRECTORY",
  "DIRECT_PORT_3003_FIREWALL_CONFIRMED",
  "HOST",
  "JWT_COOKIE_NAME",
  "JWT_EXPIRES_IN",
  "JWT_SECRET",
  "LEGACY_JSON_IMPORT_MODE",
  "NODE_ENV",
  "NODE_INTERPRETER",
  "OBSERVATION_UPLOAD_DIR",
  "OBSERVATION_WRITE_RATE_LIMIT",
  "MODERATION_DECISION_RATE_LIMIT",
  "OUTBOX_MAX_ATTEMPTS",
  "OUTBOX_MAX_BACKLOG_EVENTS",
  "OUTBOX_MAX_BACKLOG_PAYLOAD_BYTES",
  "OUTBOX_MAX_OLDEST_AGE_SECONDS",
  "OUTBOX_POLL_INTERVAL_MS",
  "OUTBOX_WORKER_ENABLED",
  "PORT",
  "RECOGNITION_MAX_CONCURRENCY",
  "RECOGNITION_MAX_QUEUE",
  "RECOGNITION_QUEUE_TIMEOUT_MS",
  "RECOGNITION_RATE_LIMIT",
  "TRUST_PROXY",
]);

const REQUIRED_KEYS = Object.freeze([
  "ALLOWED_ORIGINS",
  "COMMUNITY_UPLOAD_DIR",
  "CORS_ORIGIN",
  "DATABASE_BACKUP_DIR",
  "DATABASE_FILE",
  "DATA_DIRECTORY",
  "HOST",
  "JWT_SECRET",
  "NODE_ENV",
  "NODE_INTERPRETER",
  "OBSERVATION_UPLOAD_DIR",
  "PORT",
]);

const DISABLED_FLAGS = Object.freeze([
  "ACCOUNT_DELETION_ENABLED",
  "COMMUNITY_DEMO_ENABLED",
  "COMMUNITY_LEGACY_LIKE_ENABLED",
  "COMMUNITY_POST_EDIT_ENABLED",
  "COMMUNITY_PUBLISH_ENABLED",
]);

function decodeValue(rawValue, lineNumber) {
  const value = rawValue.trim();
  if (!value.startsWith("\"") && !value.startsWith("'")) return value;
  const quote = value[0];
  if (value.length < 2 || value.at(-1) !== quote) {
    throw new Error(`unterminated quoted value on line ${lineNumber}`);
  }
  const inner = value.slice(1, -1);
  if (quote === "'") return inner;
  return inner.replace(/\\([\\"nrt])/gu, (_match, escaped) => ({
    "\\": "\\",
    "\"": "\"",
    n: "\n",
    r: "\r",
    t: "\t",
  })[escaped]);
}

function parseProductionEnv(contents) {
  if (typeof contents !== "string") throw new Error("production environment input must be text");
  const values = {};
  const lines = contents.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (/^export\s/u.test(trimmed)) {
      throw new Error(`shell export syntax is forbidden on line ${lineNumber}`);
    }
    const separator = trimmed.indexOf("=");
    if (separator <= 0) throw new Error(`invalid KEY=VALUE record on line ${lineNumber}`);
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z][A-Z0-9_]*$/u.test(key)) throw new Error(`invalid environment key on line ${lineNumber}`);
    if (!ALLOWED_KEYS.has(key)) throw new Error(`unknown production environment key: ${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`duplicate production environment key: ${key}`);
    const value = decodeValue(trimmed.slice(separator + 1), lineNumber);
    if (value.includes("\0") || /[\r\n]/u.test(value)) {
      throw new Error(`multiline/NUL environment values are forbidden: ${key}`);
    }
    values[key] = value;
  }
  validateProductionEnv(values);
  return values;
}

function requireExact(values, key, expected) {
  if (values[key] !== expected) throw new Error(`${key} must be ${expected}`);
}

function requireAbsolute(values, key, expectedRoot) {
  const value = values[key];
  if (!value || !path.posix.isAbsolute(value) || path.posix.normalize(value) !== value) {
    throw new Error(`${key} must be a normalized absolute POSIX path`);
  }
  if (expectedRoot && value !== expectedRoot && !value.startsWith(`${expectedRoot}/`)) {
    throw new Error(`${key} must stay inside ${expectedRoot}`);
  }
}

function requirePositiveInteger(values, key) {
  if (!(key in values)) return;
  if (!/^[1-9][0-9]*$/u.test(values[key])) throw new Error(`${key} must be a positive integer`);
  const numericValue = Number(values[key]);
  const maximum = key === "DATABASE_BACKUP_RETENTION"
    ? 1000
    : key === "OUTBOX_MAX_BACKLOG_PAYLOAD_BYTES"
      ? 1024 * 1024 * 1024
      : 1_000_000;
  if (!Number.isSafeInteger(numericValue) || numericValue > maximum) throw new Error(`${key} exceeds the safe maximum ${maximum}`);
}

function canonicalHttpsOrigin(value, key) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid URL origin`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || value !== parsed.origin) {
    throw new Error(`${key} must be one canonical HTTPS origin without credentials/path/query/fragment`);
  }
  return parsed.origin;
}

function validateProductionEnv(values) {
  for (const key of REQUIRED_KEYS) {
    if (!values[key]) throw new Error(`missing required production environment key: ${key}`);
  }
  requireExact(values, "NODE_ENV", "production");
  requireExact(values, "HOST", "127.0.0.1");
  requireExact(values, "PORT", "3003");
  requireExact(values, "DATABASE_AUTO_MIGRATE", "false");
  requireExact(values, "DATABASE_BACKUP_ENABLED", "true");
  requireExact(values, "LEGACY_JSON_IMPORT_MODE", "disabled");
  requireExact(values, "COOKIE_SECURE", "true");
  requireExact(values, "TRUST_PROXY", "1");
  for (const flag of DISABLED_FLAGS) requireExact(values, flag, "false");
  for (const controlFlag of ["ALLOW_EMPTY_DATABASE_INITIALIZATION", "DIRECT_PORT_3003_FIREWALL_CONFIRMED"]) {
    if (!new Set(["true", "false"]).has(values[controlFlag] || "false")) {
      throw new Error(`${controlFlag} must be true or false`);
    }
  }
  if (!new Set(["true", "false"]).has(values.OUTBOX_WORKER_ENABLED || "false")) {
    throw new Error("OUTBOX_WORKER_ENABLED must be true or false");
  }
  if (Buffer.byteLength(values.JWT_SECRET, "utf8") < 32 || values.JWT_SECRET.startsWith("replace-with-")) {
    throw new Error("JWT_SECRET is missing, too short, or still a placeholder");
  }
  canonicalHttpsOrigin(values.CORS_ORIGIN, "CORS_ORIGIN");
  const origins = values.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
  if (!origins.length) throw new Error("ALLOWED_ORIGINS must contain explicit HTTPS origins only");
  for (const origin of origins) canonicalHttpsOrigin(origin, "ALLOWED_ORIGINS");
  if (!origins.includes(values.CORS_ORIGIN)) throw new Error("ALLOWED_ORIGINS must include CORS_ORIGIN");
  requireAbsolute(values, "NODE_INTERPRETER");
  requireExact(values, "NODE_INTERPRETER", "/opt/node-v24/bin/node");
  requireExact(values, "DATA_DIRECTORY", "/var/lib/birdora");
  requireExact(values, "DATABASE_FILE", "/var/lib/birdora/birdora.sqlite");
  requireExact(values, "DATABASE_BACKUP_DIR", "/var/lib/birdora-protected/backups");
  requireExact(values, "COMMUNITY_UPLOAD_DIR", "/var/lib/birdora/uploads/community");
  requireExact(values, "OBSERVATION_UPLOAD_DIR", "/var/lib/birdora/uploads/observations");
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(values.JWT_COOKIE_NAME || "")) {
    throw new Error("JWT_COOKIE_NAME has an invalid format");
  }
  if (!/^[1-9][0-9]{0,2}(?:m|h|d)$/u.test(values.JWT_EXPIRES_IN || "")) {
    throw new Error("JWT_EXPIRES_IN must be a bounded minute/hour/day duration");
  }
  for (const key of [
    "AUTH_RATE_LIMIT",
    "COMMUNITY_WRITE_RATE_LIMIT",
    "CONTENT_REPORT_RATE_LIMIT",
    "MODERATION_DECISION_RATE_LIMIT",
    "OBSERVATION_WRITE_RATE_LIMIT",
    "OUTBOX_MAX_ATTEMPTS",
    "OUTBOX_MAX_BACKLOG_EVENTS",
    "OUTBOX_MAX_BACKLOG_PAYLOAD_BYTES",
    "OUTBOX_MAX_OLDEST_AGE_SECONDS",
    "OUTBOX_POLL_INTERVAL_MS",
    "RECOGNITION_MAX_CONCURRENCY",
    "RECOGNITION_MAX_QUEUE",
    "RECOGNITION_QUEUE_TIMEOUT_MS",
    "RECOGNITION_RATE_LIMIT",
    "DATABASE_BACKUP_RETENTION",
  ]) requirePositiveInteger(values, key);
  return values;
}

function readProductionEnv(filePath) {
  const parent = path.dirname(path.resolve(filePath));
  const parentStats = fs.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) throw new Error("production environment parent must be a real directory");
  if (process.platform === "linux" && (parentStats.uid !== 0 || (parentStats.mode & 0o022) !== 0)) {
    throw new Error("production environment parent must be root-owned and not group/other writable");
  }
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 64 * 1024) {
      throw new Error("production environment must be one bounded regular single-link file");
    }
    if (process.platform === "linux") {
      if (stats.uid !== 0) throw new Error("production environment must be owned by root");
      if ((stats.mode & 0o777) !== 0o600) throw new Error("production environment permissions must be exactly 0600");
    }
    return parseProductionEnv(fs.readFileSync(descriptor, "utf8"));
  } finally {
    fs.closeSync(descriptor);
  }
}

function buildSanitizedEnvironment(values, additions = {}) {
  return {
    HOME: "/root",
    LANG: "C.UTF-8",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    PM2_HOME: "/var/lib/birdora/pm2",
    ...values,
    ...additions,
  };
}

module.exports = {
  ALLOWED_KEYS,
  DISABLED_FLAGS,
  REQUIRED_KEYS,
  buildSanitizedEnvironment,
  parseProductionEnv,
  readProductionEnv,
  validateProductionEnv,
};
