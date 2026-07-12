"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ACTIVATION_PHASES,
  updateActivationJournal,
} = require("./update-activation-journal");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-activation-journal-"));
const dataDirectory = path.join(root, "data");
const controlDirectory = path.join(root, "control");
const bundleDirectory = path.join(dataDirectory, "rollback-bundles", "bundle-1");
const pendingPath = path.join(controlDirectory, "activation-pending.json");
const attemptId = "20260712T000000Z-0123456789abcdef";
const revision = "0123456789abcdef0123456789abcdef01234567";
const context = {
  previousRuntimeDirectory: path.join(root, "releases", "a"),
  candidateRuntimeDirectory: path.join(root, "releases", "b"),
  runtimePointer: path.join(root, "current"),
  previousPublicDirectory: path.join(root, "public-releases", "a"),
  candidatePublicDirectory: path.join(root, "public-releases", "b"),
  activePublicPointer: path.join(root, "active-public"),
  candidateArtifactManifestSha256: "a".repeat(64),
};

function environment(status, overrides = {}) {
  return {
    DATA_DIR: dataDirectory,
    ACTIVATION_CONTROL_DIR: controlDirectory,
    ACTIVATION_PENDING_FILE: pendingPath,
    CURRENT_REVISION: revision,
    ROLLBACK_BUNDLE_DIR: bundleDirectory,
    JOURNAL_ATTEMPT_ID: attemptId,
    JOURNAL_STATUS: status,
    JOURNAL_CONTEXT_JSON: JSON.stringify(context),
    JOURNAL_DETAILS_JSON: JSON.stringify({ status }),
    ...overrides,
  };
}

try {
  fs.mkdirSync(bundleDirectory, { recursive: true });
  fs.mkdirSync(controlDirectory, { recursive: true });
  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES[1], { JOURNAL_CREATE: "true" })),
    /must start/u
  );

  const created = updateActivationJournal(environment(ACTIVATION_PHASES[0], { JOURNAL_CREATE: "true" }));
  assert.strictEqual(created.status, ACTIVATION_PHASES[0]);
  let journal = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  assert.strictEqual(journal.formatVersion, 2);
  assert.strictEqual(journal.attemptId, attemptId);
  assert.deepStrictEqual(journal.context, context);
  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES[1], {
      JOURNAL_DETAILS_JSON: JSON.stringify({ oversized: "x".repeat(300 * 1024) }),
    })),
    /256 KiB safety limit/u
  );
  assert.strictEqual(JSON.parse(fs.readFileSync(pendingPath, "utf8")).status, ACTIVATION_PHASES[0]);

  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES[0])),
    /not the next legal phase/u
  );
  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES[2])),
    /not the next legal phase/u
  );
  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES[1], { JOURNAL_ATTEMPT_ID: `${attemptId}-other` })),
    /identity differs/u
  );

  for (const status of ACTIVATION_PHASES.slice(1)) {
    const result = updateActivationJournal(environment(status));
    assert.strictEqual(result.status, status);
  }
  journal = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  assert.strictEqual(journal.status, ACTIVATION_PHASES.at(-1));
  assert.deepStrictEqual(journal.phases.map((phase) => phase.status), ACTIVATION_PHASES);
  assert.strictEqual(
    fs.readdirSync(controlDirectory).some((name) => name.startsWith("activation-pending.json.tmp-")),
    false
  );

  fs.writeFileSync(pendingPath, "not-json\n");
  assert.throws(
    () => updateActivationJournal(environment(ACTIVATION_PHASES.at(-1))),
    /valid JSON/u
  );
  console.log("Activation journal state-machine tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
