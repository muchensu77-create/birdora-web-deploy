#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ABSENT = "__ABSENT__";
const DEPLOY_LOCK_FILE = "/var/lock/birdora-web.deploy.lock";

function required(environment, name) {
  const value = environment[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function assertRealDirectory(directory, name, options = {}) {
  const resolved = path.resolve(directory);
  const stats = fs.lstatSync(resolved);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${name} must be a real directory: ${resolved}`);
  }
  if (fs.realpathSync(resolved) !== resolved) {
    throw new Error(`${name} contains a symbolic-link path component: ${resolved}`);
  }
  if (
    process.platform === "linux"
    && !options.unitTestSandboxRoot
    && (stats.uid !== 0 || (stats.mode & 0o022) !== 0)
  ) {
    throw new Error(`${name} must be root-owned and not group/other writable: ${resolved}`);
  }
  return { resolved, stats };
}

function linuxDeviceIdentity(device) {
  const value = BigInt(device);
  return {
    major: ((value & 0x00000000000fff00n) >> 8n)
      | ((value & 0xfffff00000000000n) >> 32n),
    minor: (value & 0x00000000000000ffn)
      | ((value & 0x00000ffffff00000n) >> 12n),
  };
}

function assertDeploymentLock(environment) {
  if (process.platform !== "linux") return;
  if (environment.DEPLOY_LOCK_FILE !== DEPLOY_LOCK_FILE) {
    throw new Error(`release pointer switch requires the fixed deployment lock ${DEPLOY_LOCK_FILE}`);
  }
  const ownerPid = Number(environment.DEPLOY_LOCK_OWNER_PID);
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) throw new Error("deployment lock owner PID is invalid");
  const lockStats = fs.lstatSync(DEPLOY_LOCK_FILE, { bigint: true });
  if (
    !lockStats.isFile()
    || lockStats.isSymbolicLink()
    || lockStats.nlink !== 1n
    || lockStats.uid !== 0n
    || (lockStats.mode & 0o022n) !== 0n
  ) {
    throw new Error("deployment lock file identity is unsafe");
  }
  const ownerHoldsDescriptor = fs.readdirSync(`/proc/${ownerPid}/fd`).some((descriptor) => {
    try {
      const stats = fs.statSync(`/proc/${ownerPid}/fd/${descriptor}`, { bigint: true });
      return stats.dev === lockStats.dev && stats.ino === lockStats.ino;
    } catch {
      return false;
    }
  });
  if (!ownerHoldsDescriptor) throw new Error("declared deployment lock owner has no matching descriptor");
  const device = linuxDeviceIdentity(lockStats.dev);
  const held = fs.readFileSync("/proc/locks", "utf8").split("\n").some((line) => {
    if (line.includes("->")) return false;
    const fields = line.trim().split(/\s+/u);
    const index = fields.indexOf("FLOCK");
    if (index < 0 || fields[index + 2] !== "WRITE" || Number(fields[index + 3]) !== ownerPid) return false;
    const parts = String(fields[index + 4] || "").split(":");
    return parts.length >= 3
      && BigInt(`0x${parts.at(-3)}`) === device.major
      && BigInt(`0x${parts.at(-2)}`) === device.minor
      && BigInt(parts.at(-1)) === lockStats.ino;
  });
  if (!held) throw new Error("declared deployment process does not hold the exclusive deployment FLOCK");
}

function resolveDirectChild(root, target, name, options = {}) {
  const normalized = path.resolve(target);
  if (path.dirname(normalized) !== root) {
    throw new Error(`${name} must be a direct child of ${root}`);
  }
  const validated = assertRealDirectory(normalized, name, options);
  return validated.resolved;
}

function currentPointerTarget(pointerPath) {
  let stats;
  try {
    stats = fs.lstatSync(pointerPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stats.isSymbolicLink()) throw new Error(`release pointer is not a symbolic link: ${pointerPath}`);
  try {
    return fs.realpathSync(pointerPath);
  } catch {
    throw new Error(`release pointer is dangling: ${pointerPath}`);
  }
}

function fsyncDirectory(directory) {
  if (process.platform === "win32") return;
  const descriptor = fs.openSync(directory, "r");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateUnitTestSandbox(options, paths) {
  if (!options.unitTestSandboxRoot) return false;
  const sandbox = fs.realpathSync(path.resolve(options.unitTestSandboxRoot));
  const temporaryRoot = fs.realpathSync(os.tmpdir());
  if (sandbox !== temporaryRoot && !sandbox.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error("unit test pointer sandbox must stay inside the operating-system temporary directory");
  }
  for (const candidate of paths) {
    const normalized = path.resolve(candidate);
    if (normalized !== sandbox && !normalized.startsWith(`${sandbox}${path.sep}`)) {
      throw new Error("unit test pointer path escapes its sandbox");
    }
  }
  return true;
}

function switchReleasePointer(environment = process.env, options = {}) {
  if (process.platform !== "linux" && environment.POINTER_TEST_ALLOW_NON_LINUX !== "true") {
    throw new Error("atomic release-pointer activation is supported only on Linux");
  }
  const pointerPath = path.resolve(required(environment, "POINTER_PATH"));
  const targetRootValue = required(environment, "TARGET_ROOT");
  const newTargetValue = required(environment, "NEW_TARGET");
  const isUnitSandbox = validateUnitTestSandbox(options, [pointerPath, targetRootValue, newTargetValue]);
  if (!isUnitSandbox) assertDeploymentLock(environment);
  const pointerParent = assertRealDirectory(path.dirname(pointerPath), "pointer parent", options);
  const targetRoot = assertRealDirectory(targetRootValue, "target root", options);
  if (pointerParent.stats.dev !== targetRoot.stats.dev) {
    throw new Error("pointer parent and target root must be on the same filesystem");
  }
  const expectedValue = required(environment, "EXPECTED_OLD_TARGET");
  const expectedTarget = expectedValue === ABSENT
    ? null
    : resolveDirectChild(targetRoot.resolved, expectedValue, "expected old target", options);
  const newTarget = resolveDirectChild(targetRoot.resolved, newTargetValue, "new target", options);
  if (fs.statSync(newTarget).dev !== targetRoot.stats.dev) {
    throw new Error("new release target must not cross into a nested mount point");
  }
  const observedTarget = currentPointerTarget(pointerPath);
  if (observedTarget !== expectedTarget) {
    throw new Error(
      `release pointer changed concurrently: expected=${expectedTarget || ABSENT} observed=${observedTarget || ABSENT}`
    );
  }
  if (newTarget === observedTarget) throw new Error("new release target is already active");

  const temporaryPath = `${pointerPath}.next-${process.pid}-${Date.now()}`;
  try {
    const linkTarget = process.platform === "win32"
      ? newTarget
      : path.relative(pointerParent.resolved, newTarget);
    fs.symlinkSync(linkTarget, temporaryPath, process.platform === "win32" ? "junction" : "dir");
    const temporaryStats = fs.lstatSync(temporaryPath);
    if (!temporaryStats.isSymbolicLink() || fs.realpathSync(temporaryPath) !== newTarget) {
      throw new Error("temporary release pointer does not resolve to the requested target");
    }
    fs.renameSync(temporaryPath, pointerPath);
    fsyncDirectory(pointerParent.resolved);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
  const activatedTarget = currentPointerTarget(pointerPath);
  if (activatedTarget !== newTarget) throw new Error("activated release pointer failed post-rename verification");
  return {
    ok: true,
    pointerPath,
    previousTarget: observedTarget,
    activeTarget: activatedTarget,
  };
}

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(switchReleasePointer())}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: "RELEASE_POINTER_SWITCH_FAILED",
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ABSENT,
  assertDeploymentLock,
  currentPointerTarget,
  switchReleasePointer,
};
