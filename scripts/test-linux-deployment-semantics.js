#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const {
  linuxDeviceIdentity,
  parseProcLocks,
} = require("../app/runtime/database-lifecycle-lock");
const {
  ABSENT,
  switchReleasePointer,
} = require("../deploy/scripts/switch-release-pointer");

const PRODUCTION_PREFIXES = [
  "/etc/birdora",
  "/opt/node-v24",
  "/usr/local/libexec/birdora",
  "/var/lib/birdora",
  "/var/lib/birdora-control",
  "/var/lib/birdora-protected",
  "/var/lock/birdora",
  "/var/www/birdora-web",
];

function cleanChildEnvironment() {
  return {
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    TMPDIR: "/tmp",
    TZ: "UTC",
  };
}

function realTemporaryRoot() {
  return fs.realpathSync("/tmp");
}

function validateSandbox(value) {
  assert.strictEqual(process.platform, "linux", "Linux is required");
  assert(value && path.isAbsolute(value), "BIRDORA_LINUX_TEST_SANDBOX must be absolute");
  const temporaryRoot = realTemporaryRoot();
  const resolved = fs.realpathSync(value);
  const stats = fs.lstatSync(resolved);
  assert(stats.isDirectory() && !stats.isSymbolicLink(), "sandbox must be a real directory");
  assert.strictEqual(path.dirname(resolved), temporaryRoot, "sandbox must be a direct child of /tmp");
  assert(/^birdora-linux-deployment\.[A-Za-z0-9]+$/u.test(path.basename(resolved)), "sandbox name is invalid");
  for (const prefix of PRODUCTION_PREFIXES) {
    assert(!resolved.startsWith(prefix), `sandbox unexpectedly overlaps production prefix ${prefix}`);
  }
  return resolved;
}

function withinSandbox(sandbox, ...segments) {
  const candidate = path.resolve(sandbox, ...segments);
  assert(
    candidate === sandbox || candidate.startsWith(`${sandbox}${path.sep}`),
    `test path escaped sandbox: ${candidate}`
  );
  for (const prefix of PRODUCTION_PREFIXES) {
    assert(!candidate.startsWith(prefix), `test path overlaps production prefix ${prefix}`);
  }
  return candidate;
}

function executableFromEnvironment(name) {
  const value = process.env[name];
  assert(value && path.isAbsolute(value), `${name} must be an absolute path`);
  fs.accessSync(value, fs.constants.X_OK);
  return value;
}

function assertSanitizedEnvironment() {
  const allowed = new Set([
    "BIRDORA_LINUX_TEST_FLOCK_BIN",
    "BIRDORA_LINUX_TEST_SANDBOX",
    "BIRDORA_LINUX_TEST_SLEEP_BIN",
    "BIRDORA_LINUX_TEST_TRUE_BIN",
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "TMPDIR",
    "TZ",
  ]);
  const unexpected = Object.keys(process.env).filter((name) => !allowed.has(name));
  assert.deepStrictEqual(unexpected, [], `test environment was not sanitized: ${unexpected.join(",")}`);
  assert.strictEqual(process.env.TMPDIR, "/tmp");
  assert.strictEqual(process.env.PATH, "/usr/sbin:/usr/bin:/sbin:/bin");
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function lockMatchesFile(lock, stats) {
  const device = linuxDeviceIdentity(stats.dev);
  return lock.inode === stats.ino
    && lock.deviceMajor === device.major
    && lock.deviceMinor === device.minor;
}

function matchingGlobalLocks(lockStats) {
  return parseProcLocks(fs.readFileSync("/proc/locks", "utf8"))
    .filter((lock) => lockMatchesFile(lock, lockStats));
}

function descriptorEvidence(pid, lockStats, expectedMode) {
  const descriptorDirectory = `/proc/${pid}/fd`;
  for (const descriptorName of fs.readdirSync(descriptorDirectory)) {
    try {
      const descriptorPath = path.join(descriptorDirectory, descriptorName);
      if (!sameIdentity(fs.statSync(descriptorPath, { bigint: true }), lockStats)) continue;
      const fdinfo = fs.readFileSync(`/proc/${pid}/fdinfo/${descriptorName}`, "utf8");
      const parsed = parseProcLocks(fdinfo
        .split("\n")
        .filter((line) => line.startsWith("lock:"))
        .map((line) => line.slice("lock:".length).trim())
        .join("\n"));
      const active = parsed.find((lock) => (
        lock.mode === expectedMode
        && lock.pid === pid
        && lockMatchesFile(lock, lockStats)
      ));
      if (active) {
        return {
          descriptor: Number(descriptorName),
          mode: active.mode,
          pid: active.pid,
          procFdinfoMatched: true,
        };
      }
    } catch (error) {
      if (!["ENOENT", "ESRCH", "EBADF"].includes(error.code)) throw error;
    }
  }
  return null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(description, predicate, children = [], timeoutMilliseconds = 5000) {
  const deadline = Date.now() + timeoutMilliseconds;
  let lastError = null;
  while (Date.now() < deadline) {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`${description}: lock holder ${child.pid} exited unexpectedly`);
      }
    }
    try {
      const value = predicate();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(15);
  }
  const suffix = lastError ? `: ${lastError.message}` : "";
  throw new Error(`timed out waiting for ${description}${suffix}`);
}

function waitForSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
}

function waitForExit(child, timeoutMilliseconds = 3000) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`child ${child.pid} did not exit`)), timeoutMilliseconds);
    child.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  try {
    await waitForExit(child);
  } catch {
    child.kill("SIGKILL");
    await waitForExit(child);
  }
}

function startLockHolder(flockBinary, sleepBinary, lockPath, mode) {
  const flag = mode === "READ" ? "--shared" : "--exclusive";
  return spawn(flockBinary, [flag, "--no-fork", lockPath, sleepBinary, "30"], {
    env: cleanChildEnvironment(),
    stdio: ["ignore", "ignore", "pipe"],
  });
}

function runNonblockingLock(flockBinary, trueBinary, lockPath, mode) {
  const flag = mode === "READ" ? "--shared" : "--exclusive";
  return spawnSync(flockBinary, [flag, "--nonblock", lockPath, trueBinary], {
    env: cleanChildEnvironment(),
    encoding: "utf8",
    timeout: 3000,
  });
}

async function testFlockSemantics(sandbox) {
  const flockBinary = executableFromEnvironment("BIRDORA_LINUX_TEST_FLOCK_BIN");
  const sleepBinary = executableFromEnvironment("BIRDORA_LINUX_TEST_SLEEP_BIN");
  const trueBinary = executableFromEnvironment("BIRDORA_LINUX_TEST_TRUE_BIN");
  const lockPath = withinSandbox(sandbox, "database-lifecycle.lock");
  fs.writeFileSync(lockPath, "", { flag: "wx", mode: 0o600 });
  const lockStats = fs.lstatSync(lockPath, { bigint: true });
  const holders = [];

  try {
    const sharedOne = startLockHolder(flockBinary, sleepBinary, lockPath, "READ");
    holders.push(sharedOne);
    await waitForSpawn(sharedOne);
    const sharedTwo = startLockHolder(flockBinary, sleepBinary, lockPath, "READ");
    holders.push(sharedTwo);
    await waitForSpawn(sharedTwo);

    const sharedDescriptors = await waitFor("two shared FLOCK descriptors", () => {
      const first = descriptorEvidence(sharedOne.pid, lockStats, "READ");
      const second = descriptorEvidence(sharedTwo.pid, lockStats, "READ");
      return first && second ? [first, second] : null;
    }, [sharedOne, sharedTwo]);
    const sharedGlobal = matchingGlobalLocks(lockStats);
    assert(sharedGlobal.some((lock) => lock.mode === "READ" && lock.pid === sharedOne.pid));
    assert(sharedGlobal.some((lock) => lock.mode === "READ" && lock.pid === sharedTwo.pid));

    const exclusiveWhileShared = runNonblockingLock(flockBinary, trueBinary, lockPath, "WRITE");
    assert.strictEqual(exclusiveWhileShared.error, undefined);
    assert.notStrictEqual(exclusiveWhileShared.status, 0, "exclusive lock must be denied while shared holders exist");

    await stopChild(sharedOne);
    await stopChild(sharedTwo);
    const noSharedLocks = await waitFor("shared locks to be released", () => (
      matchingGlobalLocks(lockStats).every((lock) => lock.mode !== "READ")
    ));
    assert.strictEqual(noSharedLocks, true);

    const exclusive = startLockHolder(flockBinary, sleepBinary, lockPath, "WRITE");
    holders.push(exclusive);
    await waitForSpawn(exclusive);
    const exclusiveDescriptor = await waitFor("exclusive FLOCK descriptor", () => (
      descriptorEvidence(exclusive.pid, lockStats, "WRITE")
    ), [exclusive]);
    const exclusiveGlobal = matchingGlobalLocks(lockStats);
    assert(exclusiveGlobal.some((lock) => lock.mode === "WRITE" && lock.pid === exclusive.pid));

    const sharedWhileExclusive = runNonblockingLock(flockBinary, trueBinary, lockPath, "READ");
    assert.strictEqual(sharedWhileExclusive.error, undefined);
    assert.notStrictEqual(sharedWhileExclusive.status, 0, "shared lock must be denied while an exclusive holder exists");

    await stopChild(exclusive);
    const exclusiveAfterRelease = runNonblockingLock(flockBinary, trueBinary, lockPath, "WRITE");
    assert.strictEqual(exclusiveAfterRelease.error, undefined);
    assert.strictEqual(exclusiveAfterRelease.status, 0, "exclusive lock should succeed after holders exit");

    return {
      status: "PASS",
      lockPathClass: "temporary-sandbox-only",
      shared: {
        coexistenceVerified: true,
        holderCount: 2,
        procLocksMatched: true,
        procFdinfoMatched: sharedDescriptors.every((item) => item.procFdinfoMatched),
      },
      exclusion: {
        exclusiveDeniedWhileShared: true,
        sharedDeniedWhileExclusive: true,
        exclusiveSucceededAfterRelease: true,
      },
      exclusive: {
        procLocksMatched: true,
        procFdinfoMatched: exclusiveDescriptor.procFdinfoMatched,
      },
    };
  } finally {
    for (const holder of holders) await stopChild(holder);
  }
}

function runPointerObserver(args) {
  const [sandboxValue, pointer, releaseA, releaseB, readyFile, stopFile] = args;
  const sandbox = validateSandbox(sandboxValue);
  for (const candidate of [pointer, releaseA, releaseB, readyFile, stopFile]) {
    withinSandbox(sandbox, path.relative(sandbox, path.resolve(candidate)));
  }
  fs.writeFileSync(readyFile, "ready\n", { flag: "wx", mode: 0o600 });
  let observations = 0;
  let releaseAObservations = 0;
  let releaseBObservations = 0;
  const invalid = [];
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(stopFile) && Date.now() < deadline) {
    observations += 1;
    try {
      const observed = fs.realpathSync(pointer);
      if (observed === releaseA) releaseAObservations += 1;
      else if (observed === releaseB) releaseBObservations += 1;
      else if (invalid.length < 8) invalid.push(`unexpected-target:${observed}`);
    } catch (error) {
      if (invalid.length < 8) invalid.push(`${error.code || "ERROR"}:${error.message}`);
    }
  }
  const stopObserved = fs.existsSync(stopFile);
  process.stdout.write(`${JSON.stringify({
    status: invalid.length === 0 && observations > 0 && stopObserved ? "PASS" : "FAIL",
    observations,
    releaseAObservations,
    releaseBObservations,
    invalid,
    stopObserved,
  })}\n`);
  process.exitCode = invalid.length === 0 && observations > 0 && stopObserved ? 0 : 1;
}

function collectJsonChild(child, timeoutMilliseconds = 20000) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("pointer observer timed out"));
    }, timeoutMilliseconds);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`pointer observer failed code=${code} signal=${signal || "none"}: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch (error) {
        reject(new Error(`pointer observer returned invalid JSON: ${error.message}`));
      }
    });
  });
}

async function testPointerSemantics(sandbox) {
  const releases = withinSandbox(sandbox, "releases");
  const releaseA = withinSandbox(releases, "release-a");
  const releaseB = withinSandbox(releases, "release-b");
  const pointer = withinSandbox(sandbox, "current");
  const readyFile = withinSandbox(sandbox, "observer.ready");
  const stopFile = withinSandbox(sandbox, "observer.stop");
  fs.mkdirSync(releaseA, { recursive: true, mode: 0o700 });
  fs.mkdirSync(releaseB, { mode: 0o700 });

  const options = { unitTestSandboxRoot: sandbox };
  const pointerEnvironment = (expected, target) => ({
    POINTER_PATH: pointer,
    TARGET_ROOT: releases,
    EXPECTED_OLD_TARGET: expected,
    NEW_TARGET: target,
  });
  const initial = switchReleasePointer(pointerEnvironment(ABSENT, releaseA), options);
  assert.strictEqual(initial.previousTarget, null);
  assert.strictEqual(fs.realpathSync(pointer), releaseA);

  const observer = spawn(process.execPath, [
    __filename,
    "--pointer-observer",
    sandbox,
    pointer,
    releaseA,
    releaseB,
    readyFile,
    stopFile,
  ], {
    env: cleanChildEnvironment(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const observerOutcomePromise = collectJsonChild(observer)
    .then((value) => ({ value }), (error) => ({ error }));
  try {
    await waitFor("pointer observer readiness", () => fs.existsSync(readyFile), [observer]);
    await delay(25);

    let expected = releaseA;
    const switchCount = 160;
    for (let index = 0; index < switchCount; index += 1) {
      const target = expected === releaseA ? releaseB : releaseA;
      const result = switchReleasePointer(pointerEnvironment(expected, target), options);
      assert.strictEqual(result.previousTarget, expected);
      assert.strictEqual(result.activeTarget, target);
      expected = target;
      if (index === 0) await delay(25);
    }

    const observedBeforeStaleAttempt = fs.realpathSync(pointer);
    const staleExpected = observedBeforeStaleAttempt === releaseA ? releaseB : releaseA;
    assert.throws(
      () => switchReleasePointer(pointerEnvironment(staleExpected, staleExpected), options),
      /release pointer changed concurrently/u
    );
    assert.strictEqual(fs.realpathSync(pointer), observedBeforeStaleAttempt, "stale CAS must preserve the active target");
    fs.writeFileSync(stopFile, "stop\n", { flag: "wx", mode: 0o600 });
    const observerOutcome = await observerOutcomePromise;
    if (observerOutcome.error) throw observerOutcome.error;
    const observerResult = observerOutcome.value;
    assert.strictEqual(observerResult.status, "PASS");
    assert.strictEqual(observerResult.stopObserved, true);
    assert.strictEqual(observerResult.invalid.length, 0);
    assert(observerResult.observations > 0);
    assert(observerResult.releaseAObservations > 0, "observer must see release A");
    assert(observerResult.releaseBObservations > 0, "observer must see release B");

    return {
      status: "PASS",
      pointerPathClass: "temporary-sandbox-only",
      initialActivationVerified: true,
      switchCount,
      atomicObservation: {
        observations: observerResult.observations,
        validTargetsOnly: true,
        danglingOrMissingObservations: 0,
        releaseAObserved: observerResult.releaseAObservations > 0,
        releaseBObserved: observerResult.releaseBObservations > 0,
      },
      staleExpectedRejected: true,
      staleAttemptPreservedActiveTarget: true,
    };
  } finally {
    if (!fs.existsSync(stopFile)) {
      try {
        fs.writeFileSync(stopFile, "stop\n", { flag: "wx", mode: 0o600 });
      } catch {
        // The observer also has a finite deadline; preserve the primary error.
      }
    }
    await stopChild(observer);
  }
}

async function main() {
  assertSanitizedEnvironment();
  const sandbox = validateSandbox(process.env.BIRDORA_LINUX_TEST_SANDBOX);
  const flock = await testFlockSemantics(sandbox);
  const releasePointer = await testPointerSemantics(sandbox);
  return {
    schemaVersion: 1,
    status: "PASS",
    testSuite: "birdora-linux-deployment-semantics",
    generatedAt: new Date().toISOString(),
    platform: {
      os: process.platform,
      architecture: process.arch,
      kernel: os.release(),
      node: process.version,
    },
    isolation: {
      environmentStartedWithEnvI: true,
      temporarySandboxDirectChildOfTmp: true,
      privilegedCommandsUsed: false,
      serviceManagersUsed: false,
      networkUsed: false,
      productionPathOperations: 0,
    },
    validations: {
      flock,
      releasePointer,
    },
    unverified: [
      "full production server startup and write-gate behavior with a stale activation journal",
      "PM2, Nginx, systemd, ownership, and fixed production-path integration",
    ],
  };
}

if (process.argv[2] === "--pointer-observer") {
  try {
    runPointerObserver(process.argv.slice(3));
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
} else {
  main()
    .then((evidence) => {
      process.stdout.write(`${JSON.stringify(evidence)}\n`);
    })
    .catch((error) => {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: 1,
        status: "FAIL",
        testSuite: "birdora-linux-deployment-semantics",
        generatedAt: new Date().toISOString(),
        platform: process.platform,
        error: {
          name: error.name,
          message: error.message,
        },
        unverified: [
          "full production server startup and write-gate behavior with a stale activation journal",
        ],
      })}\n`);
      process.exitCode = 1;
    });
}
