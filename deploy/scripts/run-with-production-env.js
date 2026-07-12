#!/opt/node-v24/bin/node
"use strict";

// This launcher intentionally validates its installation before loading any
// sibling JavaScript. Invoke it with env -i and the absolute Node path.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const CONTROLLER_DIRECTORY = "/usr/local/libexec/birdora";
const EXPECTED_LAUNCHER = path.join(CONTROLLER_DIRECTORY, "run-with-production-env.js");
const EXPECTED_CONTROLLER = path.join(CONTROLLER_DIRECTORY, "install-http.sh");
const EXPECTED_NODE = "/opt/node-v24/bin/node";
const ENV_FILE = "/etc/birdora/birdora-web-auth.env";
const DEPLOYMENT_LOCK = "/var/lock/birdora-web.deploy.lock";
const CONTROLLER_PROTOCOL_VERSION = "1";

function assertTrustedDirectory(directory) {
  const normalized = path.resolve(directory);
  const stats = fs.lstatSync(normalized);
  if (!stats.isDirectory() || stats.isSymbolicLink() || fs.realpathSync(normalized) !== normalized) {
    throw new Error(`deployment controller directory is not one physical directory: ${normalized}`);
  }
  if (stats.uid !== 0 || (stats.mode & 0o022) !== 0) {
    throw new Error(`deployment controller directory must be root-owned and not group/other writable: ${normalized}`);
  }
  return normalized;
}

function assertTrustedFile(filePath) {
  const normalized = path.resolve(filePath);
  const stats = fs.lstatSync(normalized);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || fs.realpathSync(normalized) !== normalized) {
    throw new Error(`deployment controller file is not one physical regular file: ${normalized}`);
  }
  if (stats.uid !== 0 || (stats.mode & 0o022) !== 0) {
    throw new Error(`deployment controller file must be root-owned and not group/other writable: ${normalized}`);
  }
  return normalized;
}

function assertTrustedExecutable(filePath) {
  const resolved = assertTrustedFile(filePath);
  if ((fs.statSync(resolved).mode & 0o111) === 0) throw new Error(`trusted executable is not executable: ${resolved}`);
  let parent = path.dirname(resolved);
  while (true) {
    assertTrustedDirectory(parent);
    if (parent === "/") break;
    parent = path.dirname(parent);
  }
  return resolved;
}

function assertDeploymentLockFile(filePath) {
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
    throw new Error(`deployment lock must be one pre-created regular file: ${filePath}`);
  }
  if (stats.uid !== 0 || (stats.mode & 0o777) !== 0o600) {
    throw new Error(`deployment lock must be root-owned with mode 0600: ${filePath}`);
  }
}

function main() {
  if (process.platform !== "linux") throw new Error("production environment runner is Linux-only");
  if (process.argv.length !== 3) throw new Error("usage: run-with-production-env.js <candidate-release>");
  if (path.resolve(__filename) !== EXPECTED_LAUNCHER || fs.realpathSync(__filename) !== EXPECTED_LAUNCHER) {
    throw new Error(`production launcher must be installed at ${EXPECTED_LAUNCHER}`);
  }
  if (fs.realpathSync(process.execPath) !== EXPECTED_NODE) {
    throw new Error(`production launcher must run with ${EXPECTED_NODE}`);
  }
  for (const dangerousName of ["BASH_ENV", "ENV", "LD_PRELOAD", "NODE_OPTIONS", "NODE_PATH"]) {
    if (process.env[dangerousName]) throw new Error(`invoke the launcher with env -i; forbidden inherited key: ${dangerousName}`);
  }
  if (process.execArgv.length !== 0) throw new Error("production launcher forbids inherited Node execution arguments");

  assertTrustedDirectory(CONTROLLER_DIRECTORY);
  const controller = assertTrustedFile(EXPECTED_CONTROLLER);
  for (const sibling of [
    "create-rollback-bundle.sh",
    "production-env-lib.js",
    "release-manifest-lib.js",
    "switch-release-pointer.js",
    "verify-release-manifest.js",
  ]) assertTrustedFile(path.join(CONTROLLER_DIRECTORY, sibling));

  // Load only after every executable module path and its parent are trusted.
  const {
    buildSanitizedEnvironment,
    readProductionEnv,
  } = require(path.join(CONTROLLER_DIRECTORY, "production-env-lib.js"));
  const values = readProductionEnv(ENV_FILE);
  assertTrustedExecutable(values.NODE_INTERPRETER);
  assertTrustedExecutable("/usr/bin/bash");
  assertTrustedExecutable("/usr/bin/flock");
  assertTrustedExecutable("/usr/sbin/runuser");
  assertDeploymentLockFile(DEPLOYMENT_LOCK);
  const environment = buildSanitizedEnvironment(values, {
    BIRDORA_ENV_SANITIZED: "true",
    BIRDORA_ENV_SANITIZED_BY_PID: String(process.pid),
    BIRDORA_DEPLOY_LOCK_HELD: "true",
    BIRDORA_CONTROLLER_PROTOCOL_VERSION: CONTROLLER_PROTOCOL_VERSION,
  });
  const result = spawnSync("/usr/bin/flock", [
    "--nonblock",
    "--close",
    "--conflict-exit-code",
    "75",
    DEPLOYMENT_LOCK,
    "/usr/bin/bash",
    controller,
    process.argv[2],
  ], {
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status === 75) {
    process.stderr.write(`ERROR: another Birdora deployment holds ${DEPLOYMENT_LOCK}.\n`);
  }
  process.exitCode = result.status ?? 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exitCode = 1;
}
