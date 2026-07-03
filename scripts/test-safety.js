const path = require("path");

const SAFE_PATH_PATTERN = /(?:load[-_]?test|staging|(?:^|[\\\/_.-])test(?:[\\\/_.-]|$))/i;
const PRODUCTION_PATH_PATTERN = /(?:^|[\\\/])var[\\\/]lib[\\\/]birdora(?:[\\\/]|$)/i;

function isLocalUrl(value) {
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isSafeTestPath(value) {
  if (!value) return false;
  const resolved = path.resolve(value);
  if (PRODUCTION_PATH_PATTERN.test(resolved) && !SAFE_PATH_PATTERN.test(resolved)) {
    return false;
  }
  return SAFE_PATH_PATTERN.test(resolved);
}

function assertApiWriteTargetSafety({
  scriptName,
  baseUrl,
  requireDatabaseFile = true,
  requireUploadDirs = false,
} = {}) {
  if (!isLocalUrl(baseUrl) && process.env.ALLOW_REMOTE_API_TESTS !== "1") {
    throw new Error(
      `${scriptName || "API test"} refuses remote write target ${baseUrl}. ` +
        "Set ALLOW_REMOTE_API_TESTS=1 only for isolated staging."
    );
  }

  const databaseFile = process.env.DATABASE_FILE || "";
  if (requireDatabaseFile && !databaseFile && process.env.ALLOW_SHARED_TEST_DATABASE !== "1") {
    throw new Error(
      `${scriptName || "API test"} writes test data. Set DATABASE_FILE to an isolated test SQLite file, ` +
        "or set ALLOW_SHARED_TEST_DATABASE=1 to intentionally use the local shared database."
    );
  }

  if (databaseFile && !isSafeTestPath(databaseFile) && process.env.ALLOW_SHARED_TEST_DATABASE !== "1") {
    throw new Error(
      `DATABASE_FILE must include load-test, staging, or test unless ALLOW_SHARED_TEST_DATABASE=1 is set: ${databaseFile}`
    );
  }

  if (!requireUploadDirs) return;

  const uploadChecks = [
    ["COMMUNITY_UPLOAD_DIR", process.env.COMMUNITY_UPLOAD_DIR || ""],
    ["OBSERVATION_UPLOAD_DIR", process.env.OBSERVATION_UPLOAD_DIR || ""],
  ];

  for (const [name, value] of uploadChecks) {
    if (!value) {
      throw new Error(`${name} is required for image write tests.`);
    }
    if (!isSafeTestPath(value)) {
      throw new Error(`${name} must include load-test, staging, or test and must not point to production: ${value}`);
    }
  }
}

module.exports = {
  assertApiWriteTargetSafety,
  isSafeTestPath,
};
