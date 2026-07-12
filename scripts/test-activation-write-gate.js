"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-activation-gate-"));
const pendingPath = path.join(temporaryDirectory, "activation-pending.json");
const markerPath = path.join(temporaryDirectory, "current-release.json");
const releaseDirectory = path.join(temporaryDirectory, "release-b");
const revision = "0123456789abcdef0123456789abcdef01234567";
const digest = "a".repeat(64);
const attemptId = "20260712T000000Z-0123456789abcdef";

process.env.ACTIVATION_PENDING_FILE = pendingPath;
process.env.CURRENT_RELEASE_FILE = markerPath;

const {
  activationWriteGate,
  assertActivationStartupAllowed,
  getActivationRuntimeState,
} = require("../app/middleware/activation-write-gate");

function writeJournal(overrides = {}) {
  fs.writeFileSync(pendingPath, `${JSON.stringify({
    formatVersion: 2,
    attemptId,
    revision,
    status: "candidate-start-about-to-begin",
    context: {
      candidateRuntimeDirectory: releaseDirectory,
      candidateArtifactManifestSha256: digest,
    },
    ...overrides,
  })}\n`);
}

function invoke(method) {
  let nextCalled = false;
  const response = {
    headers: {},
    statusCode: null,
    body: null,
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  activationWriteGate({ method }, response, () => {
    nextCalled = true;
  });
  return { nextCalled, response };
}

try {
  fs.mkdirSync(releaseDirectory);
  assert.deepStrictEqual(assertActivationStartupAllowed(), {
    pending: false,
    pendingPath,
    markerVerified: false,
  });
  assert.strictEqual(getActivationRuntimeState().writesEnabled, true);

  process.env.BIRDORA_RELEASE_DIR = releaseDirectory;
  process.env.BIRDORA_RELEASE_REVISION = revision;
  process.env.BIRDORA_RELEASE_MANIFEST_SHA256 = digest;
  writeJournal();
  delete process.env.BIRDORA_ACTIVATION_ATTEMPT_ID;
  assert.throws(assertActivationStartupAllowed, /attempt identity mismatch/u);

  process.env.BIRDORA_ACTIVATION_ATTEMPT_ID = attemptId;
  const startup = assertActivationStartupAllowed();
  assert.strictEqual(startup.pending, true);
  assert.strictEqual(startup.writesEnabled, false);
  assert.strictEqual(getActivationRuntimeState().activationPending, true);

  assert.strictEqual(invoke("GET").nextCalled, true);
  const blockedWrite = invoke("POST");
  assert.strictEqual(blockedWrite.nextCalled, false);
  assert.strictEqual(blockedWrite.response.statusCode, 503);
  assert.strictEqual(blockedWrite.response.body.code, "ACTIVATION_PENDING_READ_ONLY");

  writeJournal({ attemptId: "different-attempt" });
  assert.throws(assertActivationStartupAllowed, /attempt identity mismatch/u);
  writeJournal({ status: "migration-about-to-start" });
  assert.throws(assertActivationStartupAllowed, /does not allow candidate startup/u);
  writeJournal({ revision: "f".repeat(40) });
  assert.throws(assertActivationStartupAllowed, /release revision differs/u);
  writeJournal({ formatVersion: 1 });
  assert.throws(assertActivationStartupAllowed, /format is unsupported/u);

  fs.unlinkSync(pendingPath);
  assert.strictEqual(invoke("PATCH").response.statusCode, 503,
    "a candidate cannot write after journal loss but before a verified marker exists");
  assert.throws(assertActivationStartupAllowed, /marker is missing/u);
  fs.writeFileSync(markerPath, `${JSON.stringify({
    formatVersion: 2,
    activationVerified: true,
    activationAttemptId: attemptId,
    revision,
    artifactManifestSha256: digest,
    runtimeReleaseDirectory: releaseDirectory,
  })}\n`);
  assert.strictEqual(invoke("PATCH").nextCalled, true);
  assert.strictEqual(assertActivationStartupAllowed().markerVerified, true);
  try {
    fs.symlinkSync(path.join(temporaryDirectory, "missing-journal-target"), pendingPath, "file");
    assert.strictEqual(invoke("POST").response.statusCode, 503,
      "a dangling journal symlink must keep writes fail-closed");
    assert.throws(assertActivationStartupAllowed, /regular single-link|cannot be opened/u);
    fs.unlinkSync(pendingPath);
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
  console.log("Activation startup and write-gate tests passed.");
} finally {
  delete process.env.ACTIVATION_PENDING_FILE;
  delete process.env.CURRENT_RELEASE_FILE;
  delete process.env.BIRDORA_ACTIVATION_ATTEMPT_ID;
  delete process.env.BIRDORA_RELEASE_DIR;
  delete process.env.BIRDORA_RELEASE_REVISION;
  delete process.env.BIRDORA_RELEASE_MANIFEST_SHA256;
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
