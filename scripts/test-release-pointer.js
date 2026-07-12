"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  ABSENT,
  switchReleasePointer,
} = require("../deploy/scripts/switch-release-pointer");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-release-pointer-"));
const releases = path.join(root, "releases");
const releaseA = path.join(releases, "a");
const releaseB = path.join(releases, "b");
const pointer = path.join(root, "current");

function environment(expected, target) {
  return {
    POINTER_PATH: pointer,
    TARGET_ROOT: releases,
    EXPECTED_OLD_TARGET: expected,
    NEW_TARGET: target,
    POINTER_TEST_ALLOW_NON_LINUX: "true",
  };
}

try {
  fs.mkdirSync(releaseA, { recursive: true });
  fs.mkdirSync(releaseB);
  const options = { unitTestSandboxRoot: root };
  const first = switchReleasePointer(environment(ABSENT, releaseA), options);
  assert.strictEqual(first.previousTarget, null);
  assert.strictEqual(fs.realpathSync(pointer), releaseA);

  if (process.platform === "win32") {
    // Node/Win32 rename cannot atomically replace a symlink. Production is
    // Linux-only; still validate compare-and-swap and path containment here.
    assert.throws(
      () => switchReleasePointer(environment(releaseB, releaseA), options),
      /changed concurrently/u
    );
  } else {
    const second = switchReleasePointer(environment(releaseA, releaseB), options);
    assert.strictEqual(second.previousTarget, releaseA);
    assert.strictEqual(fs.realpathSync(pointer), releaseB);
    assert.throws(
      () => switchReleasePointer(environment(releaseA, releaseB), options),
      /changed concurrently/u
    );
  }

  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  assert.throws(
    () => switchReleasePointer(environment(process.platform === "win32" ? releaseA : releaseB, outside), options),
    /direct child/u
  );
  console.log("Release pointer safety tests passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
