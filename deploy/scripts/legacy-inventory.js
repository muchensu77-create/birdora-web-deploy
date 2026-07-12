#!/opt/node-v24/bin/node
"use strict";

// This collector is installed in a stable root-owned control plane. It never
// loads the legacy application, opens SQLite, or invokes another executable.
const fs = require("fs");
const path = require("path");

const CONTROLLER_DIRECTORY = "/usr/local/libexec/birdora";
const EXPECTED_COLLECTOR = `${CONTROLLER_DIRECTORY}/legacy-inventory.js`;
const EXPECTED_LIBRARY = `${CONTROLLER_DIRECTORY}/legacy-inventory-lib.js`;
const EXPECTED_NODE = "/opt/node-v24/bin/node";
const POLICY_FILE = "/etc/birdora/legacy-inventory-policy.json";
const REPORT_DIRECTORY = "/var/lib/birdora-protected/legacy-inventory";
const MINIMUM_NODE_VERSION = Object.freeze([24, 14, 0]);
const ALLOWED_ENVIRONMENT = Object.freeze({
  HOME: "/root",
  LANG: "C.UTF-8",
  LC_ALL: "C.UTF-8",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
});

function bootstrapFailure(code, exitCode) {
  const error = new Error("legacy inventory failed closed");
  error.code = code;
  error.exitCode = exitCode;
  throw error;
}

function assertTrustedDirectory(directory, exactMode = null) {
  let stats;
  try {
    stats = fs.lstatSync(directory);
  } catch {
    bootstrapFailure("LEGACY_INVENTORY_CONTROLLER_UNTRUSTED", 78);
  }
  if (
    !stats.isDirectory()
    || stats.isSymbolicLink()
    || fs.realpathSync(directory) !== path.resolve(directory)
    || stats.uid !== 0
    || stats.gid !== 0
    || (stats.mode & 0o6022) !== 0
    || (exactMode !== null && (stats.mode & 0o7777) !== exactMode)
  ) bootstrapFailure("LEGACY_INVENTORY_CONTROLLER_UNTRUSTED", 78);
}

function assertTrustedDirectoryChain(directory) {
  let current = path.resolve(directory);
  while (true) {
    assertTrustedDirectory(current);
    if (current === "/") break;
    current = path.dirname(current);
  }
}

function assertTrustedFile(filePath, executable = false) {
  let stats;
  try {
    stats = fs.lstatSync(filePath);
  } catch {
    bootstrapFailure("LEGACY_INVENTORY_CONTROLLER_UNTRUSTED", 78);
  }
  if (
    !stats.isFile()
    || stats.isSymbolicLink()
    || stats.nlink !== 1
    || fs.realpathSync(filePath) !== path.resolve(filePath)
    || stats.uid !== 0
    || stats.gid !== 0
    || (stats.mode & 0o6022) !== 0
    || (executable && (stats.mode & 0o111) === 0)
  ) bootstrapFailure("LEGACY_INVENTORY_CONTROLLER_UNTRUSTED", 78);
  assertTrustedDirectoryChain(path.dirname(filePath));
}

function assertSanitizedEnvironment() {
  const allowedEntries = Object.entries(ALLOWED_ENVIRONMENT);
  if (Object.keys(process.env).length !== allowedEntries.length) {
    bootstrapFailure("LEGACY_INVENTORY_ENVIRONMENT_UNSAFE", 78);
  }
  for (const [key, value] of allowedEntries) {
    if (!Object.hasOwn(process.env, key) || process.env[key] !== value) {
      bootstrapFailure("LEGACY_INVENTORY_ENVIRONMENT_UNSAFE", 78);
    }
  }
}

function assertSupportedNodeVersion() {
  const match = typeof process.versions?.node === "string"
    ? process.versions.node.match(/^([0-9]+)\.([0-9]+)\.([0-9]+)$/u)
    : null;
  const version = match ? match.slice(1).map(Number) : [];
  const safeVersion = version.length === 3 && version.every(Number.isSafeInteger);
  const supported = safeVersion
    && version[0] === MINIMUM_NODE_VERSION[0]
    && (
      version[1] > MINIMUM_NODE_VERSION[1]
      || (version[1] === MINIMUM_NODE_VERSION[1] && version[2] >= MINIMUM_NODE_VERSION[2])
    );
  if (!supported) bootstrapFailure("LEGACY_INVENTORY_NODE_VERSION_UNSUPPORTED", 78);
}

function assertCoreDumpsDisabled() {
  let contents;
  try {
    contents = fs.readFileSync("/proc/self/limits", "utf8");
  } catch {
    bootstrapFailure("LEGACY_INVENTORY_PROC_UNAVAILABLE", 77);
  }
  if (Buffer.byteLength(contents, "utf8") > 64 * 1024) bootstrapFailure("LEGACY_INVENTORY_PROC_UNAVAILABLE", 77);
  const coreLine = contents.split("\n").find((line) => line.startsWith("Max core file size"));
  if (!coreLine || !/^Max core file size\s+0\s+0\s+/u.test(coreLine)) {
    bootstrapFailure("LEGACY_INVENTORY_CORE_DUMPS_ENABLED", 78);
  }
}

function bootstrap() {
  if (process.platform !== "linux") bootstrapFailure("LEGACY_INVENTORY_LINUX_REQUIRED", 77);
  if (typeof process.getuid !== "function" || process.getuid() !== 0 || process.geteuid() !== 0) {
    bootstrapFailure("LEGACY_INVENTORY_ROOT_REQUIRED", 78);
  }
  if (process.argv.length !== 2) bootstrapFailure("LEGACY_INVENTORY_ARGUMENTS_FORBIDDEN", 64);
  if (process.execArgv.length !== 0) bootstrapFailure("LEGACY_INVENTORY_NODE_ARGUMENTS_FORBIDDEN", 78);
  assertSupportedNodeVersion();
  if (path.resolve(__filename) !== EXPECTED_COLLECTOR || fs.realpathSync(__filename) !== EXPECTED_COLLECTOR) {
    bootstrapFailure("LEGACY_INVENTORY_INSTALL_PATH_INVALID", 78);
  }
  if (fs.realpathSync(process.execPath) !== EXPECTED_NODE) bootstrapFailure("LEGACY_INVENTORY_NODE_INVALID", 78);
  assertSanitizedEnvironment();
  assertCoreDumpsDisabled();
  assertTrustedFile(EXPECTED_COLLECTOR, true);
  assertTrustedFile(EXPECTED_LIBRARY, false);
  assertTrustedFile(EXPECTED_NODE, true);
  assertTrustedDirectoryChain(path.dirname(POLICY_FILE));
  assertTrustedDirectoryChain(REPORT_DIRECTORY);
  assertTrustedDirectory(REPORT_DIRECTORY, 0o700);

  // Load the library only after the external controller, runtime, and every
  // ancestor have passed the immutable control-plane checks above.
  const library = require(EXPECTED_LIBRARY);
  if (
    library.FIXED_COLLECTOR_PATH !== EXPECTED_COLLECTOR
    || library.FIXED_POLICY_PATH !== POLICY_FILE
    || library.FIXED_REPORT_DIRECTORY !== REPORT_DIRECTORY
  ) bootstrapFailure("LEGACY_INVENTORY_LIBRARY_CONTRACT_INVALID", 78);
  const policy = library.readPolicy(POLICY_FILE);
  const evidence = library.collectStableInventory(policy, { maximumAttempts: 3 });
  const committed = library.writeEvidenceReportAtomic(evidence, policy);
  const decision = library.evaluateEvidence(evidence);
  process.stdout.write(`${library.canonicalJson({
    kind: "birdora-legacy-inventory-result",
    reportId: committed.reportId,
    fileName: committed.fileName,
    automatedState: decision.automatedState,
    authorization: {
      inventoryOnly: true,
      adoptionAuthorized: false,
      mutationAuthorized: false,
    },
  })}\n`);
  return decision.automatedState === "BLOCKED" ? 2 : 0;
}

try {
  process.umask(0o077);
  process.exitCode = bootstrap();
} catch (error) {
  const code = typeof error?.code === "string" && /^[A-Z0-9_]{3,96}$/u.test(error.code)
    ? error.code
    : "LEGACY_INVENTORY_FAILED";
  const exitCode = Number.isSafeInteger(error?.exitCode) && error.exitCode >= 1 && error.exitCode <= 255
    ? error.exitCode
    : 70;
  process.stderr.write(`${JSON.stringify({
    kind: "birdora-legacy-inventory-failure",
    error: { code },
    authorization: {
      inventoryOnly: true,
      adoptionAuthorized: false,
      mutationAuthorized: false,
    },
  })}\n`);
  process.exitCode = exitCode;
}
