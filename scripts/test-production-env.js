"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  buildSanitizedEnvironment,
  parseProductionEnv,
} = require("../deploy/scripts/production-env-lib");

const projectRoot = path.resolve(__dirname, "..");
const template = fs.readFileSync(path.join(projectRoot, "deploy/env/birdora-web-auth.env.example"), "utf8")
  .replace("replace-with-at-least-32-random-characters", "test-secret-0123456789abcdef-0123456789abcdef");

const values = parseProductionEnv(template);
assert.strictEqual(values.HOST, "127.0.0.1");
assert.strictEqual(values.DATABASE_AUTO_MIGRATE, "false");
assert.strictEqual(values.JWT_SECRET.length >= 32, true);

assert.throws(() => parseProductionEnv(`${template}\nNODE_OPTIONS=--require=/tmp/evil.js\n`), /unknown/u);
assert.throws(() => parseProductionEnv(`${template}\nPORT=3003\n`), /duplicate/u);
assert.throws(() => parseProductionEnv(template.replace("COMMUNITY_PUBLISH_ENABLED=false", "COMMUNITY_PUBLISH_ENABLED=true")), /must be false/u);
assert.throws(() => parseProductionEnv(template.replace(values.JWT_SECRET, "short")), /too short/u);
assert.throws(() => parseProductionEnv(template.replace("NODE_ENV=production", "export NODE_ENV=production")), /export syntax/u);

const sanitized = buildSanitizedEnvironment(values, { BIRDORA_ENV_SANITIZED: "true" });
assert.strictEqual(sanitized.NODE_OPTIONS, undefined);
assert.strictEqual(sanitized.LD_PRELOAD, undefined);
assert.strictEqual(sanitized.PM2_HOME, "/var/lib/birdora/pm2");
assert.strictEqual(sanitized.BIRDORA_ENV_SANITIZED, "true");
console.log("Strict production environment tests passed.");
