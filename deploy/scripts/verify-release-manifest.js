#!/usr/bin/env node
"use strict";

const { verifyRelease } = require("./release-manifest-lib");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

try {
  const result = verifyRelease({
    releaseDirectory: required("RELEASE_DIR"),
    publicKeyPath: required("RELEASE_PUBLIC_KEY"),
    requireRootOwnership: process.env.RELEASE_REQUIRE_ROOT_OWNERSHIP !== "false",
    requireNoGroupOrOtherWrite: process.env.RELEASE_REQUIRE_IMMUTABLE_PERMISSIONS !== "false",
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || "RELEASE_MANIFEST_VERIFY_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
