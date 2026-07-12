"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EVIDENCE_SCHEMA_VERSION = "birdora.legacy-adoption-evidence.v1";
const POLICY_FORMAT_VERSION = 1;
const REPORT_KIND = "birdora-legacy-inventory";
const MAX_CONTROL_FILE_BYTES = 1024 * 1024;
const MAX_PM2_DUMP_BYTES = 32 * 1024 * 1024;
const MAX_PROC_FILE_BYTES = 1024 * 1024;
const MAX_PROCESS_COUNT = 131072;
const MAX_PROCESS_FD_COUNT = 262144;
const MAX_DIRECTORY_DEPTH = 64;
const MAX_MEDIA_SCAN_MILLISECONDS = 15000;
const MAX_ARGUMENT_COUNT = 4096;
const MAX_ENVIRONMENT_RECORDS = 16384;
const MAX_NGINX_SYNTAX_DEPTH = 64;
const MAX_NGINX_SYNTAX_TOKENS = 131072;
const CONTROL_DIRECTORY = "/var/lib/birdora-control";
const ACTIVATION_PENDING_FILE = `${CONTROL_DIRECTORY}/activation-pending.json`;
const CURRENT_RELEASE_FILE = `${CONTROL_DIRECTORY}/current-release.json`;
const RUNTIME_POINTER = "/var/www/birdora-web/current";
const RELEASE_ROOT = "/var/www/birdora-web/releases";
const PUBLIC_POINTER = "/var/www/birdora-web/.active-public";
const PUBLIC_RELEASE_ROOT = "/var/www/birdora-web/.public-releases";
const MAINTENANCE_FLAG = "/var/lib/birdora-maintenance/maintenance.flag";
const DATABASE_LOCK_FILE = "/var/lock/birdora-db-maintenance.lock";
const DEPLOYMENT_LOCK_FILE = "/var/lock/birdora-web.deploy.lock";
const NGINX_AVAILABLE_FILE = "/etc/nginx/sites-available/birdora.birdai-glasses.com";
const NGINX_ENABLED_FILE = "/etc/nginx/sites-enabled/birdora.birdai-glasses.com";
const FIXED_COLLECTOR_PATH = "/usr/local/libexec/birdora/legacy-inventory.js";
const FIXED_POLICY_PATH = "/etc/birdora/legacy-inventory-policy.json";
const FIXED_REPORT_DIRECTORY = "/var/lib/birdora-protected/legacy-inventory";
const ALLOWED_CHECK_RESULTS = new Set([
  "PASS",
  "FAIL",
  "UNKNOWN",
  "MANUAL_REQUIRED",
  "REDACTED",
  "NA",
]);
const ALLOWED_AUTOMATED_STATES = new Set([
  "BLOCKED",
  "DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE",
  "AWAITING_MANUAL",
]);
const CHECK_REASON_CODES = new Set([
  "confirmed",
  "mismatch",
  "unsafe-path",
  "unavailable",
  "not-applicable-live-phase",
  "not-applicable-quiesced-phase",
  "writer-present",
  "not-inspected",
  "unexpected-process",
  "environment-mismatch",
  "managed-state-present",
  "redacted-by-design",
  "manual-confirmation-required",
]);
const SAFE_ENVIRONMENT_KEYS = Object.freeze([
  "NODE_ENV",
  "HOST",
  "PORT",
  "DATABASE_FILE",
  "DATA_DIRECTORY",
  "COMMUNITY_UPLOAD_DIR",
  "OBSERVATION_UPLOAD_DIR",
  "PM2_HOME",
]);
const DANGEROUS_RUNTIME_ENVIRONMENT_KEYS = new Set([
  "BASH_ENV",
  "ENV",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "NODE_PATH",
]);
const SENSITIVE_ENVIRONMENT_PATTERNS = Object.freeze([
  /SECRET/iu,
  /TOKEN/iu,
  /PASSWORD/iu,
  /COOKIE/iu,
  /AUTHORIZATION/iu,
  /CREDENTIAL/iu,
  /PRIVATE[_-]?KEY/iu,
  /SESSION/iu,
]);
const RUNTIME_IDENTITY_FILES = Object.freeze([
  "server.js",
  "package.json",
  "app/db/database.js",
]);
const KNOWN_MANUAL_CONFIRMATIONS = Object.freeze([
  ["production-host-and-traffic-entry", "Confirm the production host, DNS, load balancer/CDN, domain, and traffic entrypoints."],
  ["all-writers-and-service-managers", "Confirm every PM2 user, systemd unit, cron/timer, container, screen/tmux process, backup agent, and worker that can write the database or uploads."],
  ["external-port-3003-firewall", "Verify from an external host that cloud and host firewalls block direct TCP 3003."],
  ["business-data-baseline", "Reconcile database identity and media totals with the business ledger and the latest known-good backup."],
  ["legacy-source-review", "Match runtime file hashes to the intended legacy revision and review destructive startup DDL before any restart."],
  ["data-path-mapping", "Approve a no-copy/no-overwrite mapping from legacy DB/uploads paths to the managed topology."],
  ["pm2-secret-lifecycle", "Approve PM2 dump secret retention, permissions, backup exclusion, and JWT rotation."],
  ["nginx-and-tls-external-state", "Confirm active Nginx/CDN/TLS state and certificate renewal outside the disk-file projection."],
  ["recovery-rehearsal", "Complete an isolated backup/restore and forward-fix rehearsal using a sanitized copy."],
]);
const KNOWN_CHECK_DEFINITIONS = Object.freeze([
  ["execution.linux-platform", "execution", true],
  ["execution.root-identity", "execution", true],
  ["execution.host-namespaces", "execution", true],
  ["filesystem.application-root", "filesystem", true],
  ["filesystem.data-root", "filesystem", true],
  ["filesystem.pm2-root", "filesystem", true],
  ["listener.single-loopback", "listener", true],
  ["listener.single-owner", "listener", true],
  ["runtime.listener-process", "runtime", true],
  ["runtime.identity-files", "runtime", true],
  ["database.identity", "database", true],
  ["database.listener-opener-binding", "database", true],
  ["database.quiesced-if-required", "database", true],
  ["database.logical-state-not-inspected", "database", false],
  ["uploads.community-safe", "uploads", true],
  ["uploads.observation-safe", "uploads", true],
  ["pm2.dump-safe", "pm2", true],
  ["pm2.persistence-entry", "pm2", true],
  ["pm2.environment-mapping", "pm2", true],
  ["nginx.disk-projection", "nginx", true],
  ["nginx.unexpanded-includes", "nginx", false],
  ["control.legacy-unmanaged", "control", true],
  ["consistency.two-pass", "consistency", true],
  ["redaction.export-contract", "redaction", true],
  ["manual.external-state", "manual", false],
]);
const KNOWN_CHECKS = new Map(KNOWN_CHECK_DEFINITIONS.map(([id, category, blocking]) => [id, { category, blocking }]));
const ALLOWED_EVIDENCE_KEYS = new Set([
  "schemaVersion", "kind", "reportId", "capture", "collector", "exportPolicy", "authorization", "verdict",
  "host", "policy", "sideEffectContract", "controlState", "pm2", "listeners", "database", "uploads", "nginx",
  "runtimeSource", "filesystem", "consistency", "checks", "manualConfirmations", "collectorErrors", "processes",
  "inventoryMetrics", "phase", "mode", "capturePhase", "startedAt", "completedAt", "attempts", "complete", "name", "formatVersion",
  "installedPath", "runtime", "rawSecretMaterialCaptured", "rawProcessEnvironmentCaptured", "rawCommandLineCaptured",
  "rawPm2DumpCaptured", "databaseOpened", "databaseRowsCaptured", "databaseSchemaCaptured", "mediaContentCaptured",
  "mediaFileNamesCaptured", "inventoryOnly", "adoptionAuthorized", "mutationAuthorized", "automatedState",
  "authorizesMutation", "authorizesAdoption", "platform", "architecture", "kernelRelease", "bootId", "rootUid",
  "hostPidNamespace", "hostMountNamespace", "hostNetworkNamespace", "hostUserNamespace", "initProcessClass",
  "containerMarkersPresent", "hostEnvironmentCandidate",
  "applicationRoot", "databaseFile", "dataDirectory", "communityUploadDirectory",
  "observationUploadDirectory", "pm2Home", "siteName", "listenerPort", "expectedWriterAppNames", "expectedAdjacentAppNames",
  "maximumMediaFilesPerRoot", "maximumReportBytes", "approvedRuntimeIdentityFiles", "sqliteConnectionOpened", "pm2CliUsed", "pm2RpcConnected",
  "externalCommandsExecuted", "networkRequestsMade", "signalsSent", "serviceStateChanged", "productionFilesWritten",
  "reportFileWritten", "activationPending", "currentRelease", "runtimePointer", "releaseRoot", "publicPointer",
  "publicReleaseRoot", "maintenanceFlag", "databaseLock", "deploymentLock", "managedStatePresent", "filesParsed", "home", "homeTrusted",
  "primary", "backup", "selected", "selectedProjection", "cliUsed", "rpcConnected", "rawDumpExported", "metadata",
  "usable", "projection", "validJsonArray", "processCount", "approvedProcessCount", "unexpectedProcessCount",
  "writerProcessCount", "adjacentProcessCount", "rawDumpDigestExported", "malformed", "approvedName",
  "approvedNameValue", "writerName", "adjacentName", "pid", "statusClass", "workingDirectoryClass", "executionPathApproved",
  "environment", "recordCount", "malformedRecordCount", "unknownKeyCount", "dangerousRuntimeKeyPresent", "safeKeys",
  "sensitivePresence", "valuesExported",
  "NODE_ENV", "HOST", "PORT", "DATABASE_FILE", "DATA_DIRECTORY", "COMMUNITY_UPLOAD_DIR", "OBSERVATION_UPLOAD_DIR",
  "PM2_HOME", "present", "matchesExpected", "jwtOrSessionSecret", "tokenOrCredential", "password",
  "cookieOrAuthorization", "privateKey", "family", "addressClass", "port", "state", "socketInode", "ownerPids",
  "path", "logicalState", "headerRead", "schemaRead", "rowsRead", "sidecars", "wal", "shm", "journal", "openers",
  "process", "descriptorCount", "accessModes", "writableDescriptorPresent", "community", "observation", "root",
  "fileCount", "directoryCount", "totalBytes", "symlinkCount", "hardlinkCount", "specialCount", "unreadableCount",
  "nestedMountCount", "crossDeviceEntryCount",
  "maximumFileLimitReached", "namesExported", "contentRead", "available", "enabled", "diskProjection", "selectedDiskSource",
  "activeRuntimeState", "configurationTestExecuted", "readable", "configuredServerNamePresent", "loopbackProxyPresent",
  "wildcardApplicationProxyPresent", "tlsListenerPresent", "unexpandedIncludePresent", "configurationBytes", "rawConfigurationExported",
  "configurationDigestExported", "enabledSymlinkTargetsAvailable", "rootTrusted", "identityFiles", "identityFileSetComplete", "gitMetadata",
  "gitCommandExecuted", "claimedRevision", "sha256", "fixedPathsOnly", "application", "data", "physicalDirectory",
  "ancestors", "depthFromRoot", "exists", "type", "canonicalMatchesRequested", "uid", "gid", "mode", "nlink", "device",
  "inode", "bytes", "mtimeNs", "ctimeNs", "groupOrOtherWritable", "errorCode", "processDirectoryDevice",
  "processDirectoryInode", "startTimeTicks", "parentPid", "identity", "effectiveUid", "effectiveGid", "executableClass",
  "command", "argumentCount", "approvedEntrypointIsExecutedScript", "secretLikeArgumentPresent", "rawArgumentsExported",
  "inspectedDescriptorCount", "transientProcessRaceCount", "transientDescriptorRaceCount", "descriptorScanComplete",
  "stable", "snapshotsCompared", "internalTokensExported", "id", "category", "result",
  "blocking", "reason", "status",
]);

class LegacyInventoryError extends Error {
  constructor(message, code = "LEGACY_INVENTORY_FAILED", exitCode = 70) {
    super(message);
    this.name = "LegacyInventoryError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

function fail(message, code, exitCode) {
  throw new LegacyInventoryError(message, code, exitCode);
}

function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("canonical JSON forbids non-finite numbers", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || value === undefined) {
    fail("canonical JSON received a non-JSON value", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  }
  if (seen.has(value)) fail("canonical JSON received a cyclic value", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    if (Object.keys(value).length !== value.length || value.some((item) => item === undefined)) {
      fail("canonical JSON forbids sparse arrays", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
    }
    serialized = `[${value.map((item) => canonicalJson(item, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail("canonical JSON requires plain objects", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
    }
    const keys = Object.keys(value).sort(compareStrings);
    if (keys.some((key) => value[key] === undefined)) {
      fail("canonical JSON forbids undefined object fields", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
    }
    serialized = `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return serialized;
}

function assertStrictJsonSyntax(text, description) {
  let offset = 0;
  let nodes = 0;
  const skipWhitespace = () => {
    while (offset < text.length && /[\u0009\u000a\u000d\u0020]/u.test(text[offset])) offset += 1;
  };
  const parseStringToken = () => {
    if (text[offset] !== "\"") fail(`${description} has invalid JSON syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
    const start = offset;
    offset += 1;
    while (offset < text.length) {
      const character = text[offset];
      if (character === "\"") {
        offset += 1;
        try { return JSON.parse(text.slice(start, offset)); } catch { break; }
      }
      if (character === "\\") {
        offset += 1;
        if (offset >= text.length) break;
        if (text[offset] === "u") {
          if (!/^[0-9a-fA-F]{4}$/u.test(text.slice(offset + 1, offset + 5))) break;
          offset += 5;
        } else {
          if (!"\"\\/bfnrt".includes(text[offset])) break;
          offset += 1;
        }
        continue;
      }
      if (character.charCodeAt(0) < 0x20) break;
      offset += 1;
    }
    fail(`${description} has invalid JSON string syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
  };
  const parseValue = (depth) => {
    nodes += 1;
    if (nodes > 1_000_000 || depth > 128) fail(`${description} exceeds JSON safety limits`, "LEGACY_INVENTORY_INVALID_JSON", 65);
    skipWhitespace();
    if (text[offset] === "{") {
      offset += 1;
      const keys = new Set();
      skipWhitespace();
      if (text[offset] === "}") { offset += 1; return; }
      while (offset < text.length) {
        skipWhitespace();
        const key = parseStringToken();
        if (keys.has(key)) fail(`${description} contains a duplicate JSON key`, "LEGACY_INVENTORY_INVALID_JSON", 65);
        keys.add(key);
        skipWhitespace();
        if (text[offset] !== ":") fail(`${description} has invalid JSON object syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
        offset += 1;
        parseValue(depth + 1);
        skipWhitespace();
        if (text[offset] === "}") { offset += 1; return; }
        if (text[offset] !== ",") fail(`${description} has invalid JSON object syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
        offset += 1;
      }
      fail(`${description} has an unterminated JSON object`, "LEGACY_INVENTORY_INVALID_JSON", 65);
    }
    if (text[offset] === "[") {
      offset += 1;
      skipWhitespace();
      if (text[offset] === "]") { offset += 1; return; }
      while (offset < text.length) {
        parseValue(depth + 1);
        skipWhitespace();
        if (text[offset] === "]") { offset += 1; return; }
        if (text[offset] !== ",") fail(`${description} has invalid JSON array syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
        offset += 1;
      }
      fail(`${description} has an unterminated JSON array`, "LEGACY_INVENTORY_INVALID_JSON", 65);
    }
    if (text[offset] === "\"") { parseStringToken(); return; }
    const primitive = text.slice(offset).match(/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/u);
    if (!primitive) fail(`${description} has invalid JSON value syntax`, "LEGACY_INVENTORY_INVALID_JSON", 65);
    offset += primitive[0].length;
  };
  parseValue(0);
  skipWhitespace();
  if (offset !== text.length) fail(`${description} has trailing JSON content`, "LEGACY_INVENTORY_INVALID_JSON", 65);
}

function parseJsonValue(bytes, description) {
  let text;
  try {
    text = Buffer.isBuffer(bytes)
      ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
      : String(bytes);
  } catch {
    fail(`${description} is not valid UTF-8`, "LEGACY_INVENTORY_INVALID_JSON", 65);
  }
  assertStrictJsonSyntax(text, description);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    fail(`${description} is not valid JSON`, "LEGACY_INVENTORY_INVALID_JSON", 65);
  }
  return value;
}

function parseJsonObject(bytes, description) {
  const value = parseJsonValue(bytes, description);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${description} must be one JSON object`, "LEGACY_INVENTORY_INVALID_JSON", 65);
  }
  return value;
}

function readBoundedRegularFile(filePath, maximumBytes, options = {}) {
  if (options.requireLinuxSecurityBoundary && (process.platform !== "linux" || !fs.constants.O_NOFOLLOW)) {
    fail(`${options.description || "file"} requires the Linux no-follow boundary`, "LEGACY_INVENTORY_UNSAFE_FILE", 78);
  }
  let descriptor;
  try {
    descriptor = fs.openSync(
      filePath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0)
    );
  } catch (error) {
    fail(`${options.description || "file"} cannot be opened safely`, "LEGACY_INVENTORY_FILE_OPEN_FAILED", 74);
  }
  try {
    const stats = fs.fstatSync(descriptor, { bigint: true });
    if (!stats.isFile() || stats.nlink !== 1n || stats.size < 0n || stats.size > BigInt(maximumBytes)) {
      fail(`${options.description || "file"} must be one bounded regular single-link file`, "LEGACY_INVENTORY_UNSAFE_FILE", 74);
    }
    if (options.requireRootOwnership && (stats.uid !== 0n || stats.gid !== 0n)) {
      fail(`${options.description || "file"} must be root-owned`, "LEGACY_INVENTORY_UNSAFE_FILE", 78);
    }
    if (options.maximumMode !== undefined && (stats.mode & 0o7777n) !== BigInt(options.maximumMode)) {
      fail(`${options.description || "file"} has an unexpected mode`, "LEGACY_INVENTORY_UNSAFE_FILE", 78);
    }
    if (options.rejectGroupOrOtherWrite && (stats.mode & 0o022n) !== 0n) {
      fail(`${options.description || "file"} is writable by group or other users`, "LEGACY_INVENTORY_UNSAFE_FILE", 78);
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "uid", "gid", "nlink"].some((key) => after[key] !== stats[key])) {
      fail(`${options.description || "file"} changed during the secure read`, "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
    }
    return { bytes, stats };
  } finally {
    fs.closeSync(descriptor);
  }
}

function readPseudoFileBounded(filePath, maximumBytes = MAX_PROC_FILE_BYTES) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY);
  } catch {
    fail("required proc evidence is unavailable", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 66);
  }
  const chunks = [];
  let total = 0;
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    while (true) {
      const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) {
        fail("proc evidence exceeds its safety limit", "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
      }
      chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
    }
  } finally {
    fs.closeSync(descriptor);
  }
  return Buffer.concat(chunks, total);
}

function assertPlainAbsolutePath(value, name) {
  if (
    typeof value !== "string"
    || !path.posix.isAbsolute(value)
    || value.length > 4096
    || /[\u0000-\u001f\u007f]/u.test(value)
    || path.posix.normalize(value) !== value
  ) {
    fail(`${name} must be one normalized absolute path`, "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  return value;
}

function isWithin(parent, child) {
  const relative = path.posix.relative(parent, child);
  return relative === "" || (!relative.startsWith("../") && relative !== ".." && !path.posix.isAbsolute(relative));
}

function assertStringArray(value, name, maximumItems = 32) {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximumItems) {
    fail(`${name} must be a non-empty bounded array`, "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const normalized = value.map((item) => {
    if (typeof item !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u.test(item)) {
      fail(`${name} contains an invalid name`, "LEGACY_INVENTORY_POLICY_INVALID", 65);
    }
    return item;
  });
  if (new Set(normalized).size !== normalized.length) {
    fail(`${name} contains duplicates`, "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  return normalized;
}

function validatePolicy(policy) {
  const allowedKeys = new Set([
    "formatVersion",
    "capturePhase",
    "applicationRoot",
    "databaseFile",
    "dataDirectory",
    "communityUploadDirectory",
    "observationUploadDirectory",
    "pm2Home",
    "siteName",
    "listenerPort",
    "expectedWriterAppNames",
    "expectedAdjacentAppNames",
    "maximumMediaFilesPerRoot",
    "maximumReportBytes",
    "approvedRuntimeIdentityFiles",
  ]);
  const unknown = Object.keys(policy).filter((key) => !allowedKeys.has(key));
  if (unknown.length) fail("legacy inventory policy contains unknown fields", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  if (policy.formatVersion !== POLICY_FORMAT_VERSION) fail("legacy inventory policy version is unsupported", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  if (!["live-discovery", "quiesced-binding"].includes(policy.capturePhase)) {
    fail("legacy inventory capture phase is unsupported", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const applicationRoot = assertPlainAbsolutePath(policy.applicationRoot, "applicationRoot");
  if (applicationRoot !== "/var/www/birdora-web") {
    fail("applicationRoot must be the fixed Birdora production root", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const databaseFile = assertPlainAbsolutePath(policy.databaseFile, "databaseFile");
  const allowedDatabaseFiles = new Set([
    "/var/lib/birdora/birdora.sqlite",
    "/var/www/birdora-web/app/data/birdora.sqlite",
  ]);
  if (!allowedDatabaseFiles.has(databaseFile)) {
    fail("databaseFile is outside the explicitly reviewed legacy paths", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const dataDirectory = assertPlainAbsolutePath(policy.dataDirectory, "dataDirectory");
  if (path.posix.dirname(databaseFile) !== dataDirectory) {
    fail("dataDirectory must be the direct parent of databaseFile", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const communityUploadDirectory = assertPlainAbsolutePath(policy.communityUploadDirectory, "communityUploadDirectory");
  const observationUploadDirectory = assertPlainAbsolutePath(policy.observationUploadDirectory, "observationUploadDirectory");
  if (
    communityUploadDirectory !== path.posix.join(dataDirectory, "uploads/community")
    || observationUploadDirectory !== path.posix.join(dataDirectory, "uploads/observations")
  ) {
    fail("upload roots must be the fixed direct data-directory children", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const pm2Home = assertPlainAbsolutePath(policy.pm2Home, "pm2Home");
  if (!["/root/.pm2", "/var/lib/birdora/pm2"].includes(pm2Home)) {
    fail("pm2Home is outside the explicitly reviewed legacy namespaces", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  if (policy.siteName !== "birdora.birdai-glasses.com" || policy.listenerPort !== 3003) {
    fail("siteName/listenerPort must match the fixed Birdora production endpoint", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  if (!Number.isSafeInteger(policy.maximumMediaFilesPerRoot) || policy.maximumMediaFilesPerRoot < 1 || policy.maximumMediaFilesPerRoot > 1_000_000) {
    fail("maximumMediaFilesPerRoot is outside the safe range", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  if (!Number.isSafeInteger(policy.maximumReportBytes) || policy.maximumReportBytes < 1024 || policy.maximumReportBytes > 16 * 1024 * 1024) {
    fail("maximumReportBytes is outside the safe range", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  const expectedWriterAppNames = assertStringArray(policy.expectedWriterAppNames, "expectedWriterAppNames");
  const expectedAdjacentAppNames = assertStringArray(policy.expectedAdjacentAppNames, "expectedAdjacentAppNames");
  if (expectedWriterAppNames.some((name) => expectedAdjacentAppNames.includes(name))) {
    fail("writer and adjacent app names must not overlap", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  }
  if (
    !Array.isArray(policy.approvedRuntimeIdentityFiles)
    || policy.approvedRuntimeIdentityFiles.length > RUNTIME_IDENTITY_FILES.length
    || new Set(policy.approvedRuntimeIdentityFiles).size !== policy.approvedRuntimeIdentityFiles.length
    || policy.approvedRuntimeIdentityFiles.some((name) => !RUNTIME_IDENTITY_FILES.includes(name))
  ) fail("approved runtime identity files are invalid", "LEGACY_INVENTORY_POLICY_INVALID", 65);
  return Object.freeze({
    formatVersion: POLICY_FORMAT_VERSION,
    capturePhase: policy.capturePhase,
    applicationRoot,
    databaseFile,
    dataDirectory,
    communityUploadDirectory,
    observationUploadDirectory,
    pm2Home,
    siteName: policy.siteName,
    listenerPort: policy.listenerPort,
    expectedWriterAppNames: Object.freeze(expectedWriterAppNames),
    expectedAdjacentAppNames: Object.freeze(expectedAdjacentAppNames),
    maximumMediaFilesPerRoot: policy.maximumMediaFilesPerRoot,
    maximumReportBytes: policy.maximumReportBytes,
    approvedRuntimeIdentityFiles: Object.freeze([...policy.approvedRuntimeIdentityFiles]),
  });
}

function readPolicy(policyPath) {
  const { bytes } = readBoundedRegularFile(policyPath, MAX_CONTROL_FILE_BYTES, {
    description: "legacy inventory policy",
    requireRootOwnership: true,
    maximumMode: 0o600,
    requireLinuxSecurityBoundary: true,
  });
  return validatePolicy(parseJsonObject(bytes, "legacy inventory policy"));
}

function safePathMetadata(filePath) {
  try {
    const stats = fs.lstatSync(filePath, { bigint: true });
    const type = stats.isSymbolicLink()
      ? "symlink"
      : stats.isDirectory()
        ? "directory"
        : stats.isFile()
          ? "file"
          : "special";
    let canonicalMatchesRequested = false;
    try { canonicalMatchesRequested = fs.realpathSync(filePath) === path.resolve(filePath); } catch { /* reported as false */ }
    return {
      exists: true,
      type,
      canonicalMatchesRequested,
      uid: stats.uid.toString(),
      gid: stats.gid.toString(),
      mode: Number(stats.mode & 0o7777n),
      nlink: stats.nlink.toString(),
      device: stats.dev.toString(),
      inode: stats.ino.toString(),
      bytes: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      ctimeNs: stats.ctimeNs.toString(),
      groupOrOtherWritable: (stats.mode & 0o022n) !== 0n,
    };
  } catch (error) {
    if (error.code === "ENOENT") return { exists: false, type: "missing" };
    return { exists: null, type: "unreadable", errorCode: String(error.code || "IO_ERROR") };
  }
}

function exactObjectKeys(value, allowedKeys, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${description} must be one object`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  const unknown = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (unknown.length > 0) fail(`${description} contains unknown fields`, "LEGACY_EVIDENCE_INVALID", 65);
  if (Object.keys(value).length !== allowedKeys.length || allowedKeys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${description} is missing required fields`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  return value;
}

function decimalString(value, description) {
  const normalized = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(normalized)) {
    fail(`${description} must be an unsigned decimal string`, "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  return normalized;
}

function boundedSafeInteger(value, minimum, maximum, description) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(`${description} is outside its safe range`, "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  return number;
}

function metadataIdentity(metadata) {
  if (!metadata || metadata.exists !== true) return { exists: metadata?.exists ?? null, type: metadata?.type || "unknown" };
  return {
    exists: true,
    type: metadata.type,
    device: metadata.device,
    inode: metadata.inode,
    bytes: metadata.bytes,
    mtimeNs: metadata.mtimeNs,
    ctimeNs: metadata.ctimeNs,
    nlink: metadata.nlink,
  };
}

function isPhysicalDirectory(directory) {
  const metadata = safePathMetadata(directory);
  return metadata.exists === true
    && metadata.type === "directory"
    && metadata.canonicalMatchesRequested === true;
}

function fixedPathAncestors(filePath) {
  const normalized = path.posix.resolve(filePath);
  const values = [];
  let current = path.posix.dirname(normalized);
  while (true) {
    const metadata = safePathMetadata(current);
    values.push({
      depthFromRoot: current === "/" ? 0 : current.split("/").filter(Boolean).length,
      metadata,
    });
    if (current === "/") break;
    current = path.posix.dirname(current);
  }
  return values.reverse();
}

function parseProcStat(contents, expectedPid) {
  const text = Buffer.isBuffer(contents) ? contents.toString("utf8") : String(contents);
  const opening = text.indexOf("(");
  const closing = text.lastIndexOf(") ");
  if (opening < 1 || closing <= opening || /[\u0000\r\n]/u.test(text.trimEnd())) {
    fail("process stat format is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  const pidText = text.slice(0, opening).trim();
  if (decimalString(pidText, "process PID") !== String(expectedPid)) {
    fail("process stat PID changed", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
  }
  const fields = text.slice(closing + 2).trim().split(/\s+/u);
  if (fields.length < 50 || !/^[A-Z]$/u.test(fields[0])) {
    fail("process stat fields are incomplete", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  const parentPid = boundedSafeInteger(fields[1], 0, 4194304, "parent PID");
  const startTimeTicks = decimalString(fields[19], "process start time");
  return { parentPid, startTimeTicks, state: fields[0] };
}

function parseProcStatus(contents) {
  const text = Buffer.isBuffer(contents) ? contents.toString("utf8") : String(contents);
  const values = new Map();
  for (const line of text.split("\n")) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    values.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  const uidFields = String(values.get("Uid") || "").split(/\s+/u);
  const gidFields = String(values.get("Gid") || "").split(/\s+/u);
  if (uidFields.length !== 4 || gidFields.length !== 4) {
    fail("process status identity fields are incomplete", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  return {
    uid: decimalString(uidFields[0], "process UID"),
    effectiveUid: decimalString(uidFields[1], "process effective UID"),
    gid: decimalString(gidFields[0], "process GID"),
    effectiveGid: decimalString(gidFields[1], "process effective GID"),
  };
}

function parseNulRecords(bytes, maximumRecords, description) {
  if (!Buffer.isBuffer(bytes)) fail(`${description} must be bytes`, "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  const records = [];
  let start = 0;
  for (let index = 0; index <= bytes.length; index += 1) {
    if (index !== bytes.length && bytes[index] !== 0) continue;
    if (index > start) records.push(Buffer.from(bytes.subarray(start, index)));
    start = index + 1;
    if (records.length > maximumRecords) fail(`${description} contains too many records`, "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
  }
  return records;
}

function environmentProjection(bytes, policy) {
  const records = parseNulRecords(bytes, MAX_ENVIRONMENT_RECORDS, "process environment");
  const safeExpected = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(policy.listenerPort),
    DATABASE_FILE: policy.databaseFile,
    DATA_DIRECTORY: policy.dataDirectory,
    COMMUNITY_UPLOAD_DIR: policy.communityUploadDirectory,
    OBSERVATION_UPLOAD_DIR: policy.observationUploadDirectory,
    PM2_HOME: policy.pm2Home,
  };
  const found = new Map();
  const seenKeys = new Set();
  const environmentKeys = [];
  let malformedRecordCount = 0;
  for (const record of records) {
    const separator = record.indexOf(0x3d);
    if (separator <= 0) {
      malformedRecordCount += 1;
      continue;
    }
    const keyBytes = record.subarray(0, separator);
    const key = keyBytes.toString("ascii");
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/u.test(key) || !keyBytes.equals(Buffer.from(key, "ascii"))) {
      malformedRecordCount += 1;
      continue;
    }
    environmentKeys.push(key);
    if (seenKeys.has(key)) {
      malformedRecordCount += 1;
      if (Object.hasOwn(safeExpected, key)) found.set(key, { present: true, matchesExpected: false });
      continue;
    }
    seenKeys.add(key);
    if (Object.hasOwn(safeExpected, key)) {
      const value = record.subarray(separator + 1);
      const expected = Buffer.from(safeExpected[key], "utf8");
      found.set(key, {
        present: true,
        matchesExpected: value.length === expected.length && crypto.timingSafeEqual(value, expected),
      });
    }
  }
  const safeKeys = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) safeKeys[key] = found.get(key) || { present: false, matchesExpected: false };
  const knownKeys = new Set(SAFE_ENVIRONMENT_KEYS);
  return {
    recordCount: records.length,
    malformedRecordCount,
    unknownKeyCount: environmentKeys.filter((key) => !knownKeys.has(key)).length,
    dangerousRuntimeKeyPresent: environmentKeys.some((key) => DANGEROUS_RUNTIME_ENVIRONMENT_KEYS.has(key)),
    safeKeys,
    sensitivePresence: secretPresence(environmentKeys),
    valuesExported: false,
  };
}

function commandLineProjection(bytes, policy) {
  const records = parseNulRecords(bytes, MAX_ARGUMENT_COUNT, "process command line");
  let secretLikeArgumentPresent = false;
  const approvedEntrypoints = new Set([
    "server.js",
    path.posix.join(policy.applicationRoot, "server.js"),
    path.posix.join(policy.applicationRoot, "current/server.js"),
  ]);
  for (const record of records) {
    const value = record.toString("utf8");
    if (/(?:secret|token|password|authorization|cookie|credential|private[_-]?key|eyJ[A-Za-z0-9_-]{8,}\.)/iu.test(value)) {
      secretLikeArgumentPresent = true;
    }
  }
  return {
    argumentCount: records.length,
    approvedEntrypointIsExecutedScript: records.length === 2
      && approvedEntrypoints.has(records[1].toString("utf8")),
    secretLikeArgumentPresent,
    rawArgumentsExported: false,
  };
}

function classifyRuntimePath(value, policy, kind) {
  if (typeof value !== "string" || !value.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(value)) return "invalid";
  if (kind === "cwd") {
    if (value === policy.applicationRoot) return "application-root";
    if (value === path.posix.join(policy.applicationRoot, "current")) return "managed-current";
    if (isWithin(policy.applicationRoot, value)) return "inside-application-root";
    return "outside-application-root";
  }
  if (value === "/opt/node-v24/bin/node") return "managed-node-v24";
  if (value === "/usr/bin/node" || value === "/usr/local/bin/node") return "system-node";
  return "other-executable";
}

function readProcLink(pid, name) {
  try {
    return fs.readlinkSync(`/proc/${pid}/${name}`);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") {
      fail("process identity changed during capture", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
    }
    fail("required process identity is unreadable", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 66);
  }
}

function sameProcNamespace(selfNamespace, initNamespace, namespaceKind) {
  if (!["pid", "mnt", "net", "user"].includes(namespaceKind)) return false;
  const pattern = /^(pid|mnt|net|user):\[([1-9][0-9]*)\]$/u;
  const selfMatch = typeof selfNamespace === "string" ? selfNamespace.match(pattern) : null;
  const initMatch = typeof initNamespace === "string" ? initNamespace.match(pattern) : null;
  return selfMatch !== null
    && initMatch !== null
    && selfMatch[1] === namespaceKind
    && initMatch[1] === namespaceKind
    && selfMatch[2] === initMatch[2];
}

function collectProcessProjection(pid, policy) {
  boundedSafeInteger(pid, 1, 4194304, "process PID");
  let procStats;
  try {
    procStats = fs.lstatSync(`/proc/${pid}`, { bigint: true });
  } catch {
    fail("process identity changed during capture", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
  }
  const stat = parseProcStat(readPseudoFileBounded(`/proc/${pid}/stat`), pid);
  const status = parseProcStatus(readPseudoFileBounded(`/proc/${pid}/status`));
  const cwd = readProcLink(pid, "cwd");
  const executableLink = readProcLink(pid, "exe");
  const executableDeleted = executableLink.endsWith(" (deleted)");
  const executable = executableDeleted ? executableLink.slice(0, -" (deleted)".length) : executableLink;
  const command = commandLineProjection(readPseudoFileBounded(`/proc/${pid}/cmdline`), policy);
  const environment = environmentProjection(readPseudoFileBounded(`/proc/${pid}/environ`), policy);
  const after = parseProcStat(readPseudoFileBounded(`/proc/${pid}/stat`), pid);
  if (after.startTimeTicks !== stat.startTimeTicks || after.parentPid !== stat.parentPid) {
    fail("process identity changed during capture", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
  }
  return {
    pid,
    processDirectoryDevice: procStats.dev.toString(),
    processDirectoryInode: procStats.ino.toString(),
    startTimeTicks: stat.startTimeTicks,
    parentPid: stat.parentPid,
    state: stat.state,
    identity: status,
    executableClass: executableDeleted ? "deleted-executable" : classifyRuntimePath(executable, policy, "executable"),
    workingDirectoryClass: classifyRuntimePath(cwd, policy, "cwd"),
    command,
    environment,
  };
}

function classifyTcpAddress(hexAddress, family) {
  const normalized = String(hexAddress).toUpperCase();
  if (family === "ipv4") {
    if (normalized === "0100007F") return "loopback";
    if (normalized === "00000000") return "wildcard";
    return "other";
  }
  if (normalized === "00000000000000000000000001000000") return "loopback";
  if (/^0{32}$/u.test(normalized)) return "wildcard";
  return "other";
}

function parseProcNetTcp(contents, family, listenerPort) {
  if (!new Set(["ipv4", "ipv6"]).has(family)) fail("network family is invalid", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  const expectedPort = boundedSafeInteger(listenerPort, 1, 65535, "listener port");
  const text = Buffer.isBuffer(contents) ? contents.toString("ascii") : String(contents);
  const listeners = [];
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/u);
    if (fields.length === 1 && fields[0] === "") continue;
    if (fields.length < 10) fail("kernel TCP table format is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
    const separator = fields[1].lastIndexOf(":");
    if (separator <= 0 || !/^[0-9A-Fa-f]+$/u.test(fields[1].slice(0, separator))) {
      fail("kernel TCP address format is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
    }
    const port = Number.parseInt(fields[1].slice(separator + 1), 16);
    if (port !== expectedPort || fields[3] !== "0A") continue;
    listeners.push({
      family,
      addressClass: classifyTcpAddress(fields[1].slice(0, separator), family),
      port,
      state: "LISTEN",
      socketInode: decimalString(fields[9], "listener socket inode"),
    });
  }
  return listeners;
}

function numericProcessIds() {
  let entries;
  try {
    entries = fs.readdirSync("/proc", { withFileTypes: true });
  } catch {
    fail("the host proc filesystem is unavailable", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 77);
  }
  const values = entries
    .filter((entry) => entry.isDirectory() && /^[1-9][0-9]*$/u.test(entry.name))
    .map((entry) => boundedSafeInteger(entry.name, 1, 4194304, "process PID"))
    .sort((left, right) => left - right);
  if (values.length === 0 || values.length > MAX_PROCESS_COUNT) {
    fail("the host process table is outside its safety limit", "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
  }
  return values;
}

function listProcessDescriptors(pid) {
  let names;
  try {
    names = fs.readdirSync(`/proc/${pid}/fd`);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ESRCH") return { raced: true, descriptors: [] };
    fail("a process descriptor table is unreadable", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 66);
  }
  const descriptors = names.filter((name) => /^[0-9]+$/u.test(name));
  if (descriptors.length > MAX_PROCESS_FD_COUNT) {
    fail("a process descriptor table exceeds its safety limit", "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
  }
  return { raced: false, descriptors };
}

function parseDescriptorAccessMode(contents) {
  const text = Buffer.isBuffer(contents) ? contents.toString("ascii") : String(contents);
  const match = text.match(/^flags:\s*([0-7]+)\s*$/mu);
  if (!match) return "unknown";
  const flags = Number.parseInt(match[1], 8);
  if (!Number.isSafeInteger(flags)) return "unknown";
  const access = flags & 0o3;
  if (access === 0) return "read-only";
  if (access === 1) return "write-only";
  if (access === 2) return "read-write";
  return "unknown";
}

function regularFileIdentity(filePath) {
  const metadata = safePathMetadata(filePath);
  if (
    metadata.exists !== true
    || metadata.type !== "file"
    || metadata.canonicalMatchesRequested !== true
    || metadata.nlink !== "1"
  ) return { metadata, identity: null };
  return {
    metadata,
    identity: { device: metadata.device, inode: metadata.inode },
  };
}

function addDecimalStrings(left, right) {
  return (BigInt(left) + BigInt(right)).toString();
}

function decodeMountInfoPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 4096) {
    fail("mountinfo contains an invalid path", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  const decoded = value.replace(/\\(040|011|012|134)/gu, (_match, code) => ({
    "040": " ",
    "011": "\t",
    "012": "\n",
    "134": "\\",
  })[code]);
  if (/\\[0-9]{3}/u.test(decoded) || !path.posix.isAbsolute(decoded) || path.posix.normalize(decoded) !== decoded || /[\u0000\r\n]/u.test(decoded)) {
    fail("mountinfo path encoding is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  return decoded;
}

function parseMountInfo(contents) {
  let text;
  try {
    text = Buffer.isBuffer(contents)
      ? new TextDecoder("utf-8", { fatal: true }).decode(contents)
      : String(contents);
  } catch {
    fail("mountinfo is not valid UTF-8", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  const mountPoints = new Set();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const fields = line.split(" ");
    if (fields.length < 10 || fields.indexOf("-") < 6) {
      fail("mountinfo format is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
    }
    mountPoints.add(decodeMountInfoPath(fields[4]));
    if (mountPoints.size > 131072) fail("mountinfo exceeds its safety limit", "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
  }
  if (!mountPoints.has("/")) fail("mountinfo root entry is missing", "LEGACY_INVENTORY_INVALID_PROC", 74);
  return mountPoints;
}

function collectMountPoints() {
  return parseMountInfo(readPseudoFileBounded("/proc/self/mountinfo", 4 * MAX_PROC_FILE_BYTES));
}

function scanMediaRoot(root, maximumFiles, mountPoints) {
  const rootMetadata = safePathMetadata(root);
  const summary = {
    root: rootMetadata,
    fileCount: 0,
    directoryCount: 0,
    totalBytes: "0",
    symlinkCount: 0,
    hardlinkCount: 0,
    specialCount: 0,
    unreadableCount: 0,
    nestedMountCount: 0,
    crossDeviceEntryCount: 0,
    maximumFileLimitReached: false,
    namesExported: false,
    contentRead: false,
  };
  const tokenHash = crypto.createHash("sha256");
  const addTokenRow = (row) => tokenHash.update(canonicalJson(row)).update("\n");
  if (!isPhysicalDirectory(root)) return { summary, token: canonicalJson(metadataIdentity(rootMetadata)) };
  addTokenRow(["root", metadataIdentity(rootMetadata)]);
  const stack = [{ absolute: root, relative: "", depth: 0 }];
  const maximumEntries = Math.min(500000, maximumFiles + 100000);
  const startedAt = process.hrtime.bigint();
  let inspectedEntries = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    if (current.depth > MAX_DIRECTORY_DEPTH) {
      summary.unreadableCount += 1;
      continue;
    }
    let entries = [];
    let directory;
    let directoryBudgetExceeded = false;
    try {
      directory = fs.opendirSync(current.absolute);
      while (true) {
        const entry = directory.readSync();
        if (entry === null) break;
        entries.push(entry);
        if (
          inspectedEntries + entries.length > maximumEntries
          || (entries.length % 1024 === 0 && Number(process.hrtime.bigint() - startedAt) / 1e6 > MAX_MEDIA_SCAN_MILLISECONDS)
        ) {
          directoryBudgetExceeded = true;
          break;
        }
      }
    } catch {
      summary.unreadableCount += 1;
      continue;
    } finally {
      if (directory) {
        try { directory.closeSync(); } catch { /* an exhausted directory may already be closed */ }
      }
    }
    if (directoryBudgetExceeded) {
      summary.maximumFileLimitReached = true;
      return { summary, token: tokenHash.digest("hex") };
    }
    entries.sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      inspectedEntries += 1;
      if (
        inspectedEntries > maximumEntries
        || (inspectedEntries % 1024 === 0 && Number(process.hrtime.bigint() - startedAt) / 1e6 > MAX_MEDIA_SCAN_MILLISECONDS)
      ) {
        summary.maximumFileLimitReached = true;
        return { summary, token: tokenHash.digest("hex") };
      }
      const absolute = path.join(current.absolute, entry.name);
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      let stats;
      try {
        stats = fs.lstatSync(absolute, { bigint: true });
      } catch {
        summary.unreadableCount += 1;
        addTokenRow(["unreadable", current.depth + 1]);
        continue;
      }
      const identity = [current.depth + 1, stats.dev.toString(), stats.ino.toString(), stats.mode.toString(), stats.nlink.toString(), stats.size.toString(), stats.mtimeNs.toString(), stats.ctimeNs.toString()];
      const nestedMount = absolute !== root && mountPoints.has(path.posix.normalize(absolute));
      const crossDevice = stats.dev.toString() !== rootMetadata.device;
      if (nestedMount || crossDevice) {
        if (nestedMount) summary.nestedMountCount += 1;
        if (crossDevice) summary.crossDeviceEntryCount += 1;
        addTokenRow(["mount-boundary", nestedMount, crossDevice, ...identity]);
        continue;
      }
      if (stats.isSymbolicLink()) {
        summary.symlinkCount += 1;
        addTokenRow(["symlink", ...identity]);
      } else if (stats.isDirectory()) {
        summary.directoryCount += 1;
        addTokenRow(["directory", ...identity]);
        stack.push({ absolute, relative, depth: current.depth + 1 });
      } else if (stats.isFile()) {
        if (summary.fileCount >= maximumFiles) {
          summary.maximumFileLimitReached = true;
          return { summary, token: tokenHash.digest("hex") };
        }
        summary.fileCount += 1;
        summary.totalBytes = addDecimalStrings(summary.totalBytes, stats.size.toString());
        if (stats.nlink !== 1n) summary.hardlinkCount += 1;
        addTokenRow(["file", ...identity]);
      } else {
        summary.specialCount += 1;
        addTokenRow(["special", ...identity]);
      }
    }
  }
  return { summary, token: tokenHash.digest("hex") };
}

function projectPm2Environment(value, policy) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      recordCount: 0,
      malformed: true,
      unknownKeyCount: 0,
      dangerousRuntimeKeyPresent: false,
      safeKeys: Object.fromEntries(SAFE_ENVIRONMENT_KEYS.map((key) => [key, { present: false, matchesExpected: false }])),
      sensitivePresence: secretPresence([]),
      valuesExported: false,
    };
  }
  const keys = Object.keys(value);
  const expected = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(policy.listenerPort),
    DATABASE_FILE: policy.databaseFile,
    DATA_DIRECTORY: policy.dataDirectory,
    COMMUNITY_UPLOAD_DIR: policy.communityUploadDirectory,
    OBSERVATION_UPLOAD_DIR: policy.observationUploadDirectory,
    PM2_HOME: policy.pm2Home,
  };
  const safeKeys = {};
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    safeKeys[key] = {
      present: Object.hasOwn(value, key),
      matchesExpected: typeof value[key] === "string" && value[key] === expected[key],
    };
  }
  return {
    recordCount: keys.length,
    malformed: false,
    unknownKeyCount: keys.filter((key) => !SAFE_ENVIRONMENT_KEYS.includes(key)).length,
    dangerousRuntimeKeyPresent: keys.some((key) => DANGEROUS_RUNTIME_ENVIRONMENT_KEYS.has(key)),
    safeKeys,
    sensitivePresence: secretPresence(keys),
    valuesExported: false,
  };
}

function sanitizePm2Process(value, policy) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { malformed: true, approvedName: false, writerName: false, adjacentName: false };
  }
  const pm2Environment = value.pm2_env && typeof value.pm2_env === "object" && !Array.isArray(value.pm2_env)
    ? value.pm2_env
    : value;
  const rawName = typeof pm2Environment.name === "string" ? pm2Environment.name : typeof value.name === "string" ? value.name : "";
  const writerName = policy.expectedWriterAppNames.includes(rawName);
  const adjacentName = policy.expectedAdjacentAppNames.includes(rawName);
  const approvedName = writerName || adjacentName;
  const environment = pm2Environment.env && typeof pm2Environment.env === "object" && !Array.isArray(pm2Environment.env)
    ? pm2Environment.env
    : pm2Environment;
  const cwd = typeof pm2Environment.pm_cwd === "string" ? pm2Environment.pm_cwd : "";
  const executionPath = typeof pm2Environment.pm_exec_path === "string" ? pm2Environment.pm_exec_path : "";
  const rawStatus = typeof pm2Environment.status === "string" ? pm2Environment.status.toLowerCase() : "";
  const statusClass = ["online", "stopped", "errored", "stopping", "launching"].includes(rawStatus)
    ? rawStatus
    : "unknown";
  return {
    malformed: false,
    approvedName,
    approvedNameValue: approvedName ? rawName : null,
    writerName,
    adjacentName,
    statusClass,
    workingDirectoryClass: classifyRuntimePath(cwd, policy, "cwd"),
    executionPathApproved: executionPath === path.posix.join(policy.applicationRoot, "server.js")
      || executionPath === path.posix.join(policy.applicationRoot, "current/server.js"),
    environment: projectPm2Environment(environment, policy),
  };
}

function readPm2DumpFile(filePath, policy, label) {
  const metadata = safePathMetadata(filePath);
  if (metadata.exists !== true) return { metadata, usable: false, projection: null, internalToken: canonicalJson(metadataIdentity(metadata)) };
  if (
    metadata.type !== "file"
    || metadata.canonicalMatchesRequested !== true
    || metadata.nlink !== "1"
    || metadata.uid !== "0"
    || metadata.groupOrOtherWritable
  ) return { metadata, usable: false, projection: null, internalToken: canonicalJson(metadataIdentity(metadata)) };
  let bytes;
  try {
    ({ bytes } = readBoundedRegularFile(filePath, MAX_PM2_DUMP_BYTES, {
      description: `${label} PM2 dump`,
      requireRootOwnership: true,
      rejectGroupOrOtherWrite: true,
    }));
  } catch (error) {
    if (error instanceof LegacyInventoryError) return { metadata, usable: false, projection: null, internalToken: canonicalJson(metadataIdentity(metadata)) };
    throw error;
  }
  let parsed;
  try {
    parsed = parseJsonValue(bytes, `${label} PM2 dump`);
  } catch (error) {
    if (!(error instanceof LegacyInventoryError)) throw error;
    return {
      metadata,
      usable: false,
      projection: { validJsonArray: false },
      internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), state: "invalid-json" })),
    };
  }
  if (!Array.isArray(parsed) || parsed.length > 1024) {
    return {
      metadata,
      usable: false,
      projection: { validJsonArray: false },
      internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), state: "invalid-shape" })),
    };
  }
  const processes = parsed.map((entry) => sanitizePm2Process(entry, policy));
  const projection = {
    validJsonArray: true,
    processCount: processes.length,
    approvedProcessCount: processes.filter((entry) => entry.approvedName).length,
    unexpectedProcessCount: processes.filter((entry) => !entry.approvedName).length,
    writerProcessCount: processes.filter((entry) => entry.writerName).length,
    adjacentProcessCount: processes.filter((entry) => entry.adjacentName).length,
    processes,
    rawDumpExported: false,
    rawDumpDigestExported: false,
  };
  return {
    metadata,
    usable: true,
    projection,
    internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), projection })),
  };
}

function collectPm2Evidence(policy) {
  const home = safePathMetadata(policy.pm2Home);
  const homeTrusted = home.exists === true
    && home.type === "directory"
    && home.canonicalMatchesRequested === true
    && home.uid === "0"
    && home.gid === "0"
    && !home.groupOrOtherWritable;
  const primaryPath = path.posix.join(policy.pm2Home, "dump.pm2");
  const backupPath = path.posix.join(policy.pm2Home, "dump.pm2.bak");
  const primary = homeTrusted
    ? readPm2DumpFile(primaryPath, policy, "primary")
    : { metadata: safePathMetadata(primaryPath), usable: false, projection: null, internalToken: "untrusted-home" };
  const backup = homeTrusted
    ? readPm2DumpFile(backupPath, policy, "backup")
    : { metadata: safePathMetadata(backupPath), usable: false, projection: null, internalToken: "untrusted-home" };
  const selectedName = primary.usable ? "primary" : null;
  const selected = selectedName === "primary" ? primary : null;
  return {
    projection: {
      home,
      homeTrusted,
      primary: { metadata: primary.metadata, usable: primary.usable, projection: primary.projection },
      backup: { metadata: backup.metadata, usable: backup.usable, projection: backup.projection },
      selected: selectedName,
      selectedProjection: selected?.projection || null,
      cliUsed: false,
      rpcConnected: false,
      rawDumpExported: false,
    },
    internalToken: sha256(canonicalJson({
      home: metadataIdentity(home),
      primary: primary.internalToken,
      backup: backup.internalToken,
      selectedName,
    })),
  };
}

function nginxSyntaxFailure() {
  fail("Nginx disk configuration could not be projected safely", "LEGACY_INVENTORY_INVALID_NGINX", 65);
}

function tokenizeNginxConfiguration(text) {
  if (typeof text !== "string") nginxSyntaxFailure();
  const tokens = [];
  let index = 0;
  const push = (type, value = null) => {
    tokens.push({ type, value });
    if (tokens.length > MAX_NGINX_SYNTAX_TOKENS) nginxSyntaxFailure();
  };

  while (index < text.length) {
    const current = text[index];
    if (/\s/u.test(current)) {
      index += 1;
      continue;
    }
    if (current === "#") {
      while (index < text.length && text[index] !== "\n") index += 1;
      continue;
    }
    if (current === "{" || current === "}" || current === ";") {
      push(current);
      index += 1;
      continue;
    }

    let value = "";
    while (index < text.length) {
      const character = text[index];
      if (/\s/u.test(character) || character === "{" || character === "}" || character === ";" || character === "#") break;
      if (character === "\\") {
        index += 1;
        if (index >= text.length || text[index] === "\r" || text[index] === "\n") nginxSyntaxFailure();
        value += text[index];
        index += 1;
        continue;
      }
      if (character === "\"" || character === "'") {
        const quote = character;
        index += 1;
        let closed = false;
        while (index < text.length) {
          const quotedCharacter = text[index];
          if (quotedCharacter === "\\") {
            index += 1;
            if (index >= text.length || text[index] === "\r" || text[index] === "\n") nginxSyntaxFailure();
            value += text[index];
            index += 1;
            continue;
          }
          if (quotedCharacter === quote) {
            index += 1;
            closed = true;
            break;
          }
          if (quotedCharacter === "\u0000" || quotedCharacter === "\r" || quotedCharacter === "\n") nginxSyntaxFailure();
          value += quotedCharacter;
          index += 1;
        }
        if (!closed) nginxSyntaxFailure();
        continue;
      }
      if (character === "\u0000" || character.charCodeAt(0) < 0x20) nginxSyntaxFailure();
      value += character;
      index += 1;
    }
    if (value.length === 0) nginxSyntaxFailure();
    push("word", value);
  }
  return tokens;
}

function parseNginxConfiguration(text) {
  const tokens = tokenizeNginxConfiguration(text);
  let index = 0;
  let directiveCount = 0;

  const parseSequence = (depth, closingBraceRequired) => {
    if (depth > MAX_NGINX_SYNTAX_DEPTH) nginxSyntaxFailure();
    const directives = [];
    while (index < tokens.length) {
      if (tokens[index].type === "}") {
        if (!closingBraceRequired) nginxSyntaxFailure();
        index += 1;
        return directives;
      }
      if (tokens[index].type !== "word") nginxSyntaxFailure();
      const words = [];
      while (index < tokens.length && tokens[index].type === "word") {
        words.push(tokens[index].value);
        index += 1;
      }
      if (words.length === 0 || index >= tokens.length) nginxSyntaxFailure();
      const terminator = tokens[index].type;
      index += 1;
      directiveCount += 1;
      if (directiveCount > MAX_NGINX_SYNTAX_TOKENS) nginxSyntaxFailure();
      if (terminator === ";") {
        directives.push({ name: words[0], arguments: words.slice(1), children: null });
        continue;
      }
      if (terminator !== "{") nginxSyntaxFailure();
      directives.push({
        name: words[0],
        arguments: words.slice(1),
        children: parseSequence(depth + 1, true),
      });
    }
    if (closingBraceRequired) nginxSyntaxFailure();
    return directives;
  };

  return parseSequence(0, false);
}

function walkNginxDirectives(directives, callback) {
  for (const directive of directives) {
    callback(directive);
    if (directive.children !== null) walkNginxDirectives(directive.children, callback);
  }
}

function nginxListenHasTls443(argumentsValue) {
  if (argumentsValue.length < 2 || !argumentsValue.slice(1).includes("ssl")) return false;
  const endpoint = argumentsValue[0];
  return endpoint === "443" || /^(?:\[[0-9a-f:.]+\]|[^:;\s]+):443$/iu.test(endpoint);
}

function nginxProxyTargets(proxyArgument, hostPattern, port) {
  if (typeof proxyArgument !== "string") return false;
  const escapedPort = String(port).replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`^http://${hostPattern}:${escapedPort}(?:/[^\\s]*)?$`, "u").test(proxyArgument);
}

function projectNginxConfiguration(text, policy) {
  const directives = parseNginxConfiguration(text);
  const serverBlocks = directives.filter((directive) => directive.name === "server" && directive.children !== null);
  let configuredServerNamePresent = false;
  let wildcardApplicationProxyPresent = false;
  let sameBlockTlsLoopbackPresent = false;
  let unexpandedIncludePresent = false;
  let ambiguousRelevantSyntax = false;
  walkNginxDirectives(directives, (directive) => {
    if (directive.name === "include") unexpandedIncludePresent = true;
  });

  for (const serverBlock of serverBlocks) {
    if (serverBlock.arguments.length !== 0) ambiguousRelevantSyntax = true;
    const directServerNames = serverBlock.children.filter((directive) => directive.name === "server_name" && directive.children === null);
    if (directServerNames.some((directive) => directive.arguments.length === 0)) ambiguousRelevantSyntax = true;
    const targetsConfiguredHost = directServerNames.some((directive) => directive.arguments.includes(policy.siteName));
    if (targetsConfiguredHost) configuredServerNamePresent = true;

    let tls443 = false;
    let loopbackProxy = false;
    let targetBlockAmbiguous = false;
    for (const directive of serverBlock.children) {
      if (directive.name !== "listen" || directive.children !== null) continue;
      if (directive.arguments.length === 0) ambiguousRelevantSyntax = true;
      if (nginxListenHasTls443(directive.arguments)) tls443 = true;
    }
    walkNginxDirectives(serverBlock.children, (directive) => {
      if (directive.name === "server" && directive.children !== null) targetBlockAmbiguous = true;
      if (directive.name === "proxy_pass" && directive.children === null) {
        if (directive.arguments.length !== 1) {
          ambiguousRelevantSyntax = true;
          return;
        }
        if (nginxProxyTargets(directive.arguments[0], "(?:127\\.0\\.0\\.1|\\[::1\\])", policy.listenerPort)) {
          loopbackProxy = true;
        }
        if (nginxProxyTargets(directive.arguments[0], "(?:0\\.0\\.0\\.0|\\[::\\])", policy.listenerPort)) {
          wildcardApplicationProxyPresent = true;
        }
      }
    });
    if (targetsConfiguredHost && targetBlockAmbiguous) ambiguousRelevantSyntax = true;
    if (targetsConfiguredHost && tls443 && loopbackProxy && !targetBlockAmbiguous) {
      sameBlockTlsLoopbackPresent = true;
    }
  }

  if (ambiguousRelevantSyntax) sameBlockTlsLoopbackPresent = false;
  return {
    configuredServerNamePresent,
    loopbackProxyPresent: sameBlockTlsLoopbackPresent,
    wildcardApplicationProxyPresent,
    tlsListenerPresent: sameBlockTlsLoopbackPresent,
    unexpandedIncludePresent,
  };
}

function readProjectedNginxConfiguration(filePath, policy) {
  const metadata = safePathMetadata(filePath);
  if (
    metadata.exists !== true
    || metadata.type !== "file"
    || metadata.canonicalMatchesRequested !== true
    || metadata.nlink !== "1"
    || metadata.uid !== "0"
    || metadata.groupOrOtherWritable
  ) return { metadata, readable: false, projection: null, internalToken: canonicalJson(metadataIdentity(metadata)) };
  let bytes;
  try {
    ({ bytes } = readBoundedRegularFile(filePath, MAX_CONTROL_FILE_BYTES, {
      description: "Nginx disk configuration",
      requireRootOwnership: true,
      rejectGroupOrOtherWrite: true,
      requireLinuxSecurityBoundary: true,
    }));
  } catch (error) {
    if (error instanceof LegacyInventoryError) return { metadata, readable: false, projection: null, internalToken: canonicalJson(metadataIdentity(metadata)) };
    throw error;
  }
  let text;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch {
    return {
      metadata,
      readable: false,
      projection: null,
      internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), state: "invalid-text" })),
    };
  }
  let projection;
  try {
    projection = {
      ...projectNginxConfiguration(text, policy),
      configurationBytes: bytes.length,
      rawConfigurationExported: false,
      configurationDigestExported: false,
    };
  } catch (error) {
    if (!(error instanceof LegacyInventoryError)) throw error;
    return {
      metadata,
      readable: false,
      projection: null,
      internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), state: "invalid-nginx-syntax" })),
    };
  }
  return {
    metadata,
    readable: true,
    projection,
    internalToken: sha256(canonicalJson({ metadata: metadataIdentity(metadata), projection })),
  };
}

function collectNginxEvidence(policy) {
  const available = readProjectedNginxConfiguration(NGINX_AVAILABLE_FILE, policy);
  const enabledMetadata = safePathMetadata(NGINX_ENABLED_FILE);
  let enabledSymlinkTargetsAvailable = false;
  if (
    enabledMetadata.exists === true
    && enabledMetadata.type === "symlink"
    && enabledMetadata.uid === "0"
    && enabledMetadata.gid === "0"
  ) {
    try { enabledSymlinkTargetsAvailable = fs.realpathSync(NGINX_ENABLED_FILE) === NGINX_AVAILABLE_FILE; } catch { /* remains false */ }
  }
  const enabledPhysical = enabledMetadata.exists === true
    && enabledMetadata.type === "file"
    && enabledMetadata.canonicalMatchesRequested === true
    && enabledMetadata.nlink === "1"
    && enabledMetadata.uid === "0"
    && !enabledMetadata.groupOrOtherWritable;
  const enabled = enabledPhysical
    ? readProjectedNginxConfiguration(NGINX_ENABLED_FILE, policy)
    : { metadata: enabledMetadata, readable: false, projection: null, internalToken: canonicalJson(metadataIdentity(enabledMetadata)) };
  const selected = enabled.readable ? enabled : available.readable ? available : null;
  return {
    projection: {
      available: { metadata: available.metadata, readable: available.readable },
      enabled: { metadata: enabled.metadata, readable: enabled.readable },
      diskProjection: selected?.projection || null,
      selectedDiskSource: enabled.readable ? "enabled-physical-file" : available.readable ? "available-file" : null,
      enabledSymlinkTargetsAvailable,
      activeRuntimeState: "not_inspected",
      configurationTestExecuted: false,
      serviceStateChanged: false,
    },
    internalToken: sha256(canonicalJson({ available: available.internalToken, enabled: enabled.internalToken })),
  };
}

function collectRuntimeSource(policy) {
  const root = safePathMetadata(policy.applicationRoot);
  const rootTrusted = root.exists === true
    && root.type === "directory"
    && root.canonicalMatchesRequested === true
    && !root.groupOrOtherWritable;
  const identityFiles = [];
  const tokenRows = [];
  for (const relativeName of RUNTIME_IDENTITY_FILES) {
    const filePath = path.posix.join(policy.applicationRoot, relativeName);
    const metadata = safePathMetadata(filePath);
    let digest = null;
    if (
      rootTrusted
      && policy.approvedRuntimeIdentityFiles.includes(relativeName)
      && metadata.exists === true
      && metadata.type === "file"
      && metadata.canonicalMatchesRequested === true
      && metadata.nlink === "1"
      && !metadata.groupOrOtherWritable
    ) {
      try {
        const { bytes } = readBoundedRegularFile(filePath, 8 * 1024 * 1024, {
          description: "runtime identity file",
          rejectGroupOrOtherWrite: true,
          requireLinuxSecurityBoundary: true,
        });
        digest = sha256(bytes);
      } catch (error) {
        if (!(error instanceof LegacyInventoryError)) throw error;
      }
    }
    identityFiles.push({ name: relativeName, metadata, sha256: digest });
    tokenRows.push([relativeName, metadataIdentity(metadata), digest]);
  }
  const gitHeadFile = path.posix.join(policy.applicationRoot, ".git/HEAD");
  const gitHeadMetadata = safePathMetadata(gitHeadFile);
  return {
    projection: {
      root,
      rootTrusted,
      identityFiles,
      identityFileSetComplete: policy.approvedRuntimeIdentityFiles.length === RUNTIME_IDENTITY_FILES.length
        && identityFiles.every((item) => typeof item.sha256 === "string"),
      gitMetadata: gitHeadMetadata,
      gitCommandExecuted: false,
      claimedRevision: null,
    },
    internalToken: sha256(canonicalJson(tokenRows)),
  };
}

function collectControlState() {
  const activationPending = safePathMetadata(ACTIVATION_PENDING_FILE);
  const currentRelease = safePathMetadata(CURRENT_RELEASE_FILE);
  const runtimePointer = safePathMetadata(RUNTIME_POINTER);
  const releaseRoot = safePathMetadata(RELEASE_ROOT);
  const publicPointer = safePathMetadata(PUBLIC_POINTER);
  const publicReleaseRoot = safePathMetadata(PUBLIC_RELEASE_ROOT);
  const maintenanceFlag = safePathMetadata(MAINTENANCE_FLAG);
  const databaseLock = safePathMetadata(DATABASE_LOCK_FILE);
  const deploymentLock = safePathMetadata(DEPLOYMENT_LOCK_FILE);
  const managedEntries = [
    activationPending,
    currentRelease,
    runtimePointer,
    releaseRoot,
    publicPointer,
    publicReleaseRoot,
    maintenanceFlag,
    databaseLock,
    deploymentLock,
  ];
  return {
    projection: {
      activationPending,
      currentRelease,
      runtimePointer,
      releaseRoot,
      publicPointer,
      publicReleaseRoot,
      maintenanceFlag,
      databaseLock,
      deploymentLock,
      managedStatePresent: managedEntries.some((metadata) => metadata.exists === true),
      filesParsed: false,
    },
    internalToken: sha256(canonicalJson(managedEntries.map(metadataIdentity))),
  };
}

function safeRootSummary(directory) {
  const metadata = safePathMetadata(directory);
  return {
    metadata,
    physicalDirectory: metadata.exists === true
      && metadata.type === "directory"
      && metadata.canonicalMatchesRequested === true,
    ancestors: fixedPathAncestors(directory),
  };
}

function collectFilesystemEvidence(policy) {
  return {
    fixedPathsOnly: true,
    application: safeRootSummary(policy.applicationRoot),
    data: safeRootSummary(policy.dataDirectory),
    pm2: safeRootSummary(policy.pm2Home),
  };
}

function collectHostEvidence() {
  const bootId = readPseudoFileBounded("/proc/sys/kernel/random/boot_id", 128).toString("ascii").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(bootId)) {
    fail("kernel boot identity format is unsupported", "LEGACY_INVENTORY_INVALID_PROC", 74);
  }
  const selfPidNamespace = readProcLink("self", "ns/pid");
  const initPidNamespace = readProcLink(1, "ns/pid");
  const selfMountNamespace = readProcLink("self", "ns/mnt");
  const initMountNamespace = readProcLink(1, "ns/mnt");
  const selfNetworkNamespace = readProcLink("self", "ns/net");
  const initNetworkNamespace = readProcLink(1, "ns/net");
  const selfUserNamespace = readProcLink("self", "ns/user");
  const initUserNamespace = readProcLink(1, "ns/user");
  const initExecutable = readProcLink(1, "exe").replace(/ \(deleted\)$/u, "");
  const initProcessClass = ["/usr/lib/systemd/systemd", "/lib/systemd/systemd", "/sbin/init"].includes(initExecutable)
    ? "systemd-or-init"
    : "other";
  let cgroup;
  try { cgroup = new TextDecoder("utf-8", { fatal: true }).decode(readPseudoFileBounded("/proc/1/cgroup")); } catch {
    fail("init cgroup evidence is invalid", "LEGACY_INVENTORY_HOST_NAMESPACE_UNPROVEN", 77);
  }
  const containerMarkers = [safePathMetadata("/.dockerenv"), safePathMetadata("/run/.containerenv")];
  if (containerMarkers.some((metadata) => metadata.exists === null)) {
    fail("container marker state is unreadable", "LEGACY_INVENTORY_HOST_NAMESPACE_UNPROVEN", 77);
  }
  const containerMarkersPresent = containerMarkers.some((metadata) => metadata.exists === true)
    || /(?:^|[/:.-])(?:docker|containerd|kubepods|lxc)(?:[/:.-]|$)/imu.test(cgroup);
  const hostPidNamespace = sameProcNamespace(selfPidNamespace, initPidNamespace, "pid");
  const hostMountNamespace = sameProcNamespace(selfMountNamespace, initMountNamespace, "mnt");
  const hostNetworkNamespace = sameProcNamespace(selfNetworkNamespace, initNetworkNamespace, "net");
  const hostUserNamespace = sameProcNamespace(selfUserNamespace, initUserNamespace, "user");
  const hostEnvironmentCandidate = hostPidNamespace
    && hostMountNamespace
    && hostNetworkNamespace
    && hostUserNamespace
    && initProcessClass === "systemd-or-init"
    && !containerMarkersPresent;
  if (!hostEnvironmentCandidate) {
    fail("host namespace cannot be established safely", "LEGACY_INVENTORY_HOST_NAMESPACE_UNPROVEN", 77);
  }
  return {
    platform: process.platform,
    architecture: process.arch,
    kernelRelease: os.release(),
    bootId: bootId.toLowerCase(),
    rootUid: typeof process.getuid === "function" && process.getuid() === 0,
    hostPidNamespace,
    hostMountNamespace,
    hostNetworkNamespace,
    hostUserNamespace,
    initProcessClass,
    containerMarkersPresent,
    hostEnvironmentCandidate,
  };
}

function scanRelevantDescriptors(processIds, socketInodes, databaseIdentity, policy) {
  const expectedSockets = new Set(socketInodes.map(String));
  const socketOwners = new Map([...expectedSockets].map((inode) => [inode, new Set()]));
  const databaseMatches = new Map();
  let transientProcessRaceCount = 0;
  let transientDescriptorRaceCount = 0;
  let relevantDescriptorRace = false;
  let inspectedDescriptorCount = 0;
  for (const pid of processIds) {
    const listed = listProcessDescriptors(pid);
    if (listed.raced) transientProcessRaceCount += 1;
    for (const descriptor of listed.descriptors) {
      inspectedDescriptorCount += 1;
      if (inspectedDescriptorCount > MAX_PROCESS_FD_COUNT) {
        fail("the host descriptor inventory exceeds its safety limit", "LEGACY_INVENTORY_PROC_OVERSIZE", 74);
      }
      const descriptorPath = `/proc/${pid}/fd/${descriptor}`;
      let target;
      try {
        target = fs.readlinkSync(descriptorPath);
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") {
          transientDescriptorRaceCount += 1;
          continue;
        }
        fail("a process descriptor is unreadable", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 66);
      }
      const socketMatch = target.match(/^socket:\[([0-9]+)\]$/u);
      if (socketMatch && expectedSockets.has(socketMatch[1])) {
        socketOwners.get(socketMatch[1]).add(pid);
        continue;
      }
      if (!databaseIdentity) continue;
      let stats;
      try {
        stats = fs.statSync(descriptorPath, { bigint: true });
      } catch (error) {
        if (error.code === "ENOENT" || error.code === "ESRCH") {
          transientDescriptorRaceCount += 1;
          continue;
        }
        fail("a process descriptor cannot be inspected completely", "LEGACY_INVENTORY_PROC_UNAVAILABLE", 66);
      }
      if (stats.dev.toString() !== databaseIdentity.device || stats.ino.toString() !== databaseIdentity.inode) continue;
      let accessMode;
      try {
        accessMode = parseDescriptorAccessMode(readPseudoFileBounded(`/proc/${pid}/fdinfo/${descriptor}`, 64 * 1024));
      } catch (error) {
        if (error instanceof LegacyInventoryError && error.code === "LEGACY_INVENTORY_PROC_UNAVAILABLE") {
          relevantDescriptorRace = true;
          continue;
        }
        throw error;
      }
      if (!databaseMatches.has(pid)) databaseMatches.set(pid, []);
      databaseMatches.get(pid).push(accessMode);
    }
  }
  if (relevantDescriptorRace) fail("a relevant database descriptor changed during capture", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
  const relevantPids = new Set();
  for (const owners of socketOwners.values()) for (const pid of owners) relevantPids.add(pid);
  for (const pid of databaseMatches.keys()) relevantPids.add(pid);
  const processProjections = new Map();
  for (const pid of [...relevantPids].sort((left, right) => left - right)) {
    processProjections.set(pid, collectProcessProjection(pid, policy));
  }
  const openers = [...databaseMatches]
    .sort((left, right) => left[0] - right[0])
    .map(([pid, accessModes]) => ({
      process: processProjections.get(pid),
      descriptorCount: accessModes.length,
      accessModes: [...new Set(accessModes)].sort(compareStrings),
      writableDescriptorPresent: accessModes.some((mode) => mode !== "read-only"),
    }));
  return {
    socketOwners,
    openers,
    processProjections,
    inspectedDescriptorCount,
    transientProcessRaceCount,
    transientDescriptorRaceCount,
    descriptorScanComplete: transientProcessRaceCount === 0 && transientDescriptorRaceCount === 0,
  };
}

function allSafeEnvironmentMappings(environmentProjectionValue) {
  const structurallyValid = Object.hasOwn(environmentProjectionValue || {}, "malformedRecordCount")
    ? environmentProjectionValue.malformedRecordCount === 0
    : environmentProjectionValue?.malformed === false;
  return structurallyValid
    && environmentProjectionValue.dangerousRuntimeKeyPresent === false
    && SAFE_ENVIRONMENT_KEYS.every((key) => (
    environmentProjectionValue?.safeKeys?.[key]?.present === true
    && environmentProjectionValue.safeKeys[key].matchesExpected === true
    ));
}

function allPhysicalSafeAncestors(summary) {
  return summary.physicalDirectory
    && summary.metadata.groupOrOtherWritable === false
    && summary.ancestors.every((item) => (
      item.metadata.exists === true
      && item.metadata.type === "directory"
      && item.metadata.canonicalMatchesRequested === true
      && !item.metadata.groupOrOtherWritable
    ));
}

function mediaSummarySafe(summary) {
  return summary.root.exists === true
    && summary.root.type === "directory"
    && summary.root.canonicalMatchesRequested === true
    && summary.root.groupOrOtherWritable === false
    && summary.symlinkCount === 0
    && summary.hardlinkCount === 0
    && summary.specialCount === 0
    && summary.unreadableCount === 0
    && summary.nestedMountCount === 0
    && summary.crossDeviceEntryCount === 0
    && summary.maximumFileLimitReached === false;
}

function makeKnownCheck(id, result, reason) {
  const definition = KNOWN_CHECKS.get(id);
  if (!definition) fail("collector attempted to create an unknown check", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  return check(id, definition.category, result, definition.blocking, reason);
}

function buildSnapshotChecks(snapshot, policy) {
  const liveDiscovery = policy.capturePhase === "live-discovery";
  const listenerOwners = snapshot.listeners.flatMap((listener) => listener.ownerPids);
  const uniqueListenerOwners = [...new Set(listenerOwners)];
  const listenerProcess = uniqueListenerOwners.length === 1
    ? snapshot.processes.find((item) => item.pid === uniqueListenerOwners[0])
    : null;
  const selectedPm2 = snapshot.pm2.selectedProjection;
  const writerProcesses = selectedPm2?.processes?.filter((item) => item.writerName) || [];
  const pm2WriterIdentityMatches = writerProcesses.length === 1
    && writerProcesses[0].statusClass === (liveDiscovery ? "online" : "stopped");
  const runtimeIdentitySafe = snapshot.runtimeSource.identityFileSetComplete;
  const nginxProjection = snapshot.nginx.diskProjection;
  const pm2EnvironmentSafe = writerProcesses.length === 1 && allSafeEnvironmentMappings(writerProcesses[0].environment);
  const databaseMetadataSafe = snapshot.database.path.exists === true
    && snapshot.database.path.type === "file"
    && snapshot.database.path.canonicalMatchesRequested === true
    && snapshot.database.path.nlink === "1"
    && snapshot.database.path.groupOrOtherWritable === false
    && Object.values(snapshot.database.sidecars).every((metadata) => (
      metadata.exists === false
      || (
        metadata.exists === true
        && metadata.type === "file"
        && metadata.canonicalMatchesRequested === true
        && metadata.nlink === "1"
        && metadata.groupOrOtherWritable === false
      )
    ));
  const databaseOpenerPids = snapshot.database.openers.map((item) => item.process.pid);
  const databaseBindingSafe = snapshot.inventoryMetrics.descriptorScanComplete === true
    && (
      liveDiscovery
        ? uniqueListenerOwners.length === 1
          && databaseOpenerPids.length === 1
          && databaseOpenerPids[0] === uniqueListenerOwners[0]
          && snapshot.database.openers[0].writableDescriptorPresent === true
        : databaseOpenerPids.length === 0
    );
  const listenerRuntimeSafe = !liveDiscovery || (listenerProcess
    && ["managed-node-v24", "system-node"].includes(listenerProcess.executableClass)
    && !["outside-application-root", "invalid"].includes(listenerProcess.workingDirectoryClass)
    && listenerProcess.command.approvedEntrypointIsExecutedScript
    && listenerProcess.command.secretLikeArgumentPresent === false
    && allSafeEnvironmentMappings(listenerProcess.environment));
  const listenerStateSafe = liveDiscovery
    ? snapshot.listeners.length === 1 && snapshot.listeners[0].addressClass === "loopback"
    : snapshot.listeners.length === 0;
  const listenerOwnerSafe = liveDiscovery
    ? uniqueListenerOwners.length === 1 && snapshot.listeners.every((item) => item.ownerPids.length === 1)
    : uniqueListenerOwners.length === 0;
  return [
    makeKnownCheck("execution.linux-platform", snapshot.host.platform === "linux" ? "PASS" : "FAIL", snapshot.host.platform === "linux" ? "confirmed" : "mismatch"),
    makeKnownCheck("execution.root-identity", snapshot.host.rootUid ? "PASS" : "FAIL", snapshot.host.rootUid ? "confirmed" : "mismatch"),
    makeKnownCheck("execution.host-namespaces", snapshot.host.hostEnvironmentCandidate ? "PASS" : "FAIL", snapshot.host.hostEnvironmentCandidate ? "confirmed" : "mismatch"),
    makeKnownCheck("filesystem.application-root", allPhysicalSafeAncestors(snapshot.filesystem.application) ? "PASS" : "FAIL", allPhysicalSafeAncestors(snapshot.filesystem.application) ? "confirmed" : "unsafe-path"),
    makeKnownCheck("filesystem.data-root", allPhysicalSafeAncestors(snapshot.filesystem.data) ? "PASS" : "FAIL", allPhysicalSafeAncestors(snapshot.filesystem.data) ? "confirmed" : "unsafe-path"),
    makeKnownCheck("filesystem.pm2-root", allPhysicalSafeAncestors(snapshot.filesystem.pm2) ? "PASS" : "FAIL", allPhysicalSafeAncestors(snapshot.filesystem.pm2) ? "confirmed" : "unsafe-path"),
    makeKnownCheck("listener.single-loopback", listenerStateSafe ? "PASS" : "FAIL", listenerStateSafe ? liveDiscovery ? "confirmed" : "not-applicable-quiesced-phase" : "mismatch"),
    makeKnownCheck("listener.single-owner", listenerOwnerSafe ? "PASS" : "FAIL", listenerOwnerSafe ? liveDiscovery ? "confirmed" : "not-applicable-quiesced-phase" : "mismatch"),
    makeKnownCheck("runtime.listener-process", listenerRuntimeSafe ? "PASS" : "FAIL", listenerRuntimeSafe ? liveDiscovery ? "confirmed" : "not-applicable-quiesced-phase" : "mismatch"),
    makeKnownCheck("runtime.identity-files", runtimeIdentitySafe ? "PASS" : "FAIL", runtimeIdentitySafe ? "confirmed" : "unavailable"),
    makeKnownCheck("database.identity", databaseMetadataSafe ? "PASS" : "FAIL", databaseMetadataSafe ? "confirmed" : "unsafe-path"),
    makeKnownCheck("database.listener-opener-binding", databaseBindingSafe ? "PASS" : "FAIL", databaseBindingSafe ? "confirmed" : snapshot.inventoryMetrics.descriptorScanComplete ? "mismatch" : "unavailable"),
    makeKnownCheck("database.quiesced-if-required", liveDiscovery || (snapshot.database.openers.length === 0 && snapshot.listeners.length === 0) ? "PASS" : "FAIL", liveDiscovery ? "not-applicable-live-phase" : snapshot.database.openers.length === 0 && snapshot.listeners.length === 0 ? "confirmed" : "writer-present"),
    makeKnownCheck("database.logical-state-not-inspected", "NA", "not-inspected"),
    makeKnownCheck("uploads.community-safe", mediaSummarySafe(snapshot.uploads.community) ? "PASS" : "FAIL", mediaSummarySafe(snapshot.uploads.community) ? "confirmed" : "unsafe-path"),
    makeKnownCheck("uploads.observation-safe", mediaSummarySafe(snapshot.uploads.observation) ? "PASS" : "FAIL", mediaSummarySafe(snapshot.uploads.observation) ? "confirmed" : "unsafe-path"),
    makeKnownCheck("pm2.dump-safe", snapshot.pm2.homeTrusted && selectedPm2?.validJsonArray === true ? "PASS" : "FAIL", snapshot.pm2.homeTrusted && selectedPm2?.validJsonArray === true ? "confirmed" : "unavailable"),
    makeKnownCheck("pm2.persistence-entry", pm2WriterIdentityMatches && selectedPm2.unexpectedProcessCount === 0 ? "PASS" : "FAIL", pm2WriterIdentityMatches && selectedPm2?.unexpectedProcessCount === 0 ? "confirmed" : "unexpected-process"),
    makeKnownCheck("pm2.environment-mapping", pm2EnvironmentSafe ? "PASS" : "FAIL", pm2EnvironmentSafe ? "confirmed" : "environment-mismatch"),
    makeKnownCheck("nginx.disk-projection", snapshot.nginx.enabledSymlinkTargetsAvailable && nginxProjection?.configuredServerNamePresent && nginxProjection.loopbackProxyPresent && !nginxProjection.wildcardApplicationProxyPresent && nginxProjection.tlsListenerPresent ? "PASS" : "FAIL", snapshot.nginx.enabledSymlinkTargetsAvailable && nginxProjection?.configuredServerNamePresent && nginxProjection.loopbackProxyPresent && !nginxProjection.wildcardApplicationProxyPresent && nginxProjection.tlsListenerPresent ? "confirmed" : "mismatch"),
    makeKnownCheck("nginx.unexpanded-includes", nginxProjection?.unexpandedIncludePresent ? "MANUAL_REQUIRED" : "PASS", nginxProjection?.unexpandedIncludePresent ? "manual-confirmation-required" : "confirmed"),
    makeKnownCheck("control.legacy-unmanaged", snapshot.controlState.managedStatePresent === false ? "PASS" : "FAIL", snapshot.controlState.managedStatePresent === false ? "confirmed" : "managed-state-present"),
    makeKnownCheck("consistency.two-pass", "PASS", "confirmed"),
    makeKnownCheck("redaction.export-contract", "PASS", "redacted-by-design"),
    makeKnownCheck("manual.external-state", "MANUAL_REQUIRED", "manual-confirmation-required"),
  ];
}

function collectInventorySnapshot(policy) {
  const host = collectHostEvidence();
  const processIds = numericProcessIds();
  const mountPoints = collectMountPoints();
  const listeners = [
    ...parseProcNetTcp(readPseudoFileBounded("/proc/net/tcp"), "ipv4", policy.listenerPort),
    ...parseProcNetTcp(readPseudoFileBounded("/proc/net/tcp6"), "ipv6", policy.listenerPort),
  ].sort((left, right) => compareStrings(`${left.family}:${left.socketInode}`, `${right.family}:${right.socketInode}`));
  const databaseFile = regularFileIdentity(policy.databaseFile);
  const descriptors = scanRelevantDescriptors(
    processIds,
    listeners.map((item) => item.socketInode),
    databaseFile.identity,
    policy
  );
  const projectedListeners = listeners.map((listener) => ({
    ...listener,
    ownerPids: [...(descriptors.socketOwners.get(listener.socketInode) || [])].sort((left, right) => left - right),
  }));
  const processes = [...descriptors.processProjections.values()].sort((left, right) => left.pid - right.pid);
  const community = scanMediaRoot(policy.communityUploadDirectory, policy.maximumMediaFilesPerRoot, mountPoints);
  const observation = scanMediaRoot(policy.observationUploadDirectory, policy.maximumMediaFilesPerRoot, mountPoints);
  const pm2 = collectPm2Evidence(policy);
  const nginx = collectNginxEvidence(policy);
  const runtimeSource = collectRuntimeSource(policy);
  const controlState = collectControlState();
  const filesystem = collectFilesystemEvidence(policy);
  const database = {
    path: databaseFile.metadata,
    sqliteConnectionOpened: false,
    logicalState: "not_inspected",
    headerRead: false,
    schemaRead: false,
    rowsRead: false,
    sidecars: {
      wal: safePathMetadata(`${policy.databaseFile}-wal`),
      shm: safePathMetadata(`${policy.databaseFile}-shm`),
      journal: safePathMetadata(`${policy.databaseFile}-journal`),
    },
    openers: descriptors.openers,
  };
  const projection = {
    host,
    listeners: projectedListeners,
    processes,
    database,
    uploads: { community: community.summary, observation: observation.summary },
    pm2: pm2.projection,
    nginx: nginx.projection,
    runtimeSource: runtimeSource.projection,
    controlState: controlState.projection,
    filesystem,
    inventoryMetrics: {
      processCount: processIds.length,
      inspectedDescriptorCount: descriptors.inspectedDescriptorCount,
      transientProcessRaceCount: descriptors.transientProcessRaceCount,
      transientDescriptorRaceCount: descriptors.transientDescriptorRaceCount,
      descriptorScanComplete: descriptors.descriptorScanComplete,
    },
  };
  const { inventoryMetrics, ...stableProjectionBody } = projection;
  const stableProjection = {
    ...stableProjectionBody,
    inventoryMetrics: { descriptorScanComplete: inventoryMetrics.descriptorScanComplete },
  };
  const internalToken = sha256(canonicalJson({
    projection: stableProjection,
    communityToken: community.token,
    observationToken: observation.token,
    pm2Token: pm2.internalToken,
    nginxToken: nginx.internalToken,
    runtimeSourceToken: runtimeSource.internalToken,
    controlStateToken: controlState.internalToken,
  }));
  return { projection, internalToken };
}

function isoTimestamp(value, description) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) || new Date(value).toISOString() !== value) {
    fail(`${description} must be one canonical UTC timestamp`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  return value;
}

function policyProjection(policy) {
  return {
    formatVersion: policy.formatVersion,
    capturePhase: policy.capturePhase,
    applicationRoot: policy.applicationRoot,
    databaseFile: policy.databaseFile,
    dataDirectory: policy.dataDirectory,
    communityUploadDirectory: policy.communityUploadDirectory,
    observationUploadDirectory: policy.observationUploadDirectory,
    pm2Home: policy.pm2Home,
    siteName: policy.siteName,
    listenerPort: policy.listenerPort,
    expectedWriterAppNames: [...policy.expectedWriterAppNames],
    expectedAdjacentAppNames: [...policy.expectedAdjacentAppNames],
    maximumMediaFilesPerRoot: policy.maximumMediaFilesPerRoot,
    maximumReportBytes: policy.maximumReportBytes,
    approvedRuntimeIdentityFiles: [...policy.approvedRuntimeIdentityFiles],
  };
}

function deriveEvidenceDecision(evidence) {
  const blockingCheckIds = evidence.checks
    .filter((item) => item.blocking && item.result !== "PASS")
    .map((item) => item.id);
  const pendingManualConfirmationIds = evidence.manualConfirmations
    .filter((item) => item.status === "PENDING")
    .map((item) => item.id);
  const rejectedManualConfirmationIds = evidence.manualConfirmations
    .filter((item) => item.status === "REJECTED")
    .map((item) => item.id);
  let automatedState;
  if (
    evidence.collectorErrors.length > 0
    || blockingCheckIds.length > 0
    || rejectedManualConfirmationIds.length > 0
    || evidence.consistency?.stable !== true
  ) {
    automatedState = "BLOCKED";
  } else if (evidence.capture?.phase === "live-discovery") {
    automatedState = "DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE";
  } else {
    // Every valid v1 collector report deliberately fixes all independent
    // confirmations to PENDING. Confirmation happens outside this immutable
    // evidence artifact, so quiesced evidence can only await manual review.
    automatedState = "AWAITING_MANUAL";
  }
  return {
    automatedState,
    authorizesMutation: false,
    authorizesAdoption: false,
    blockingCheckIds,
    pendingManualConfirmationIds,
    rejectedManualConfirmationIds,
  };
}

function createEvidenceReport(policy, stableSnapshot, captureDetails) {
  const reportId = crypto.randomUUID();
  const report = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: REPORT_KIND,
    reportId,
    capture: {
      phase: policy.capturePhase,
      mode: "live-read-only",
      startedAt: captureDetails.startedAt,
      completedAt: captureDetails.completedAt,
      attempts: captureDetails.attempts,
      complete: true,
    },
    collector: {
      name: "birdora-legacy-inventory",
      formatVersion: 1,
      installedPath: FIXED_COLLECTOR_PATH,
      runtime: "node-v24",
    },
    exportPolicy: {
      rawSecretMaterialCaptured: false,
      rawProcessEnvironmentCaptured: false,
      rawCommandLineCaptured: false,
      rawPm2DumpCaptured: false,
      databaseOpened: false,
      databaseRowsCaptured: false,
      databaseSchemaCaptured: false,
      mediaContentCaptured: false,
      mediaFileNamesCaptured: false,
    },
    authorization: {
      inventoryOnly: true,
      adoptionAuthorized: false,
      mutationAuthorized: false,
    },
    verdict: null,
    ...stableSnapshot.projection,
    policy: policyProjection(policy),
    sideEffectContract: {
      sqliteConnectionOpened: false,
      pm2CliUsed: false,
      pm2RpcConnected: false,
      externalCommandsExecuted: false,
      networkRequestsMade: false,
      signalsSent: false,
      serviceStateChanged: false,
      productionFilesWritten: false,
      reportFileWritten: true,
    },
    consistency: {
      stable: true,
      snapshotsCompared: 2,
      attempts: captureDetails.attempts,
      internalTokensExported: false,
    },
    checks: [],
    manualConfirmations: manualConfirmations(),
    collectorErrors: [],
  };
  report.checks = buildSnapshotChecks(report, policy);
  const decision = deriveEvidenceDecision(report);
  report.verdict = {
    automatedState: decision.automatedState,
    authorizesMutation: false,
    authorizesAdoption: false,
  };
  validateEvidenceShape(report);
  return report;
}

function collectStableInventory(policy, options = {}) {
  const maximumAttempts = options.maximumAttempts ?? 3;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 3) {
    fail("stable inventory attempt limit is invalid", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  }
  const startedAt = new Date().toISOString();
  let lastConcurrencyError = null;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      const first = collectInventorySnapshot(policy);
      const second = collectInventorySnapshot(policy);
      if (first.internalToken !== second.internalToken) {
        lastConcurrencyError = new LegacyInventoryError("inventory changed between snapshots", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
        continue;
      }
      return createEvidenceReport(policy, second, {
        startedAt,
        completedAt: new Date().toISOString(),
        attempts: attempt,
      });
    } catch (error) {
      if (error instanceof LegacyInventoryError && error.exitCode === 75) {
        lastConcurrencyError = error;
        continue;
      }
      throw error;
    }
  }
  throw lastConcurrencyError || new LegacyInventoryError("inventory did not stabilize", "LEGACY_INVENTORY_CONCURRENT_CHANGE", 75);
}

function assertTrustedOutputDirectory(directory, options = {}) {
  if (directory !== FIXED_REPORT_DIRECTORY && !options.unitTestDirectory) {
    fail("legacy inventory output directory is not fixed", "LEGACY_INVENTORY_OUTPUT_UNSAFE", 73);
  }
  let stats;
  try {
    stats = fs.lstatSync(directory, { bigint: true });
  } catch {
    fail("legacy inventory output directory is unavailable", "LEGACY_INVENTORY_OUTPUT_UNSAFE", 73);
  }
  const expectedOwner = options.unitTestDirectory ? BigInt(process.getuid?.() ?? 0) : 0n;
  const expectedGroup = options.unitTestDirectory ? BigInt(process.getgid?.() ?? 0) : 0n;
  const enforceLinuxIdentity = !options.unitTestDirectory || process.platform === "linux";
  if (
    !stats.isDirectory()
    || stats.isSymbolicLink()
    || fs.realpathSync(directory) !== path.resolve(directory)
    || (enforceLinuxIdentity && stats.uid !== expectedOwner)
    || (enforceLinuxIdentity && stats.gid !== expectedGroup)
    || (enforceLinuxIdentity && (stats.mode & 0o7777n) !== 0o700n)
  ) fail("legacy inventory output directory is unsafe", "LEGACY_INVENTORY_OUTPUT_UNSAFE", 73);
  return stats;
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeEvidenceReportAtomic(evidence, policy, options = {}) {
  validateEvidenceShape(evidence);
  const outputDirectory = options.outputDirectory || FIXED_REPORT_DIRECTORY;
  assertTrustedOutputDirectory(outputDirectory, options);
  const serialized = `${canonicalJson(evidence)}\n`;
  const maximumBytes = Math.min(policy.maximumReportBytes, 16 * 1024 * 1024);
  if (Buffer.byteLength(serialized, "utf8") > maximumBytes) {
    fail("legacy inventory report exceeds its safety limit", "LEGACY_INVENTORY_OUTPUT_OVERSIZE", 73);
  }
  const finalName = `legacy-inventory-${evidence.reportId}.json`;
  const finalPath = path.join(outputDirectory, finalName);
  const temporaryPath = path.join(outputDirectory, `.legacy-inventory-${crypto.randomUUID()}.tmp`);
  const priorUmask = process.umask(0o077);
  let descriptor;
  let temporaryExists = false;
  let finalLinked = false;
  let expectedIdentity = null;
  try {
    descriptor = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
      0o600
    );
    temporaryExists = true;
    fs.fchmodSync(descriptor, 0o600);
    if (!options.unitTestDirectory && process.platform === "linux") fs.fchownSync(descriptor, 0, 0);
    fs.writeFileSync(descriptor, serialized, "utf8");
    fs.fsyncSync(descriptor);
    const temporaryStats = fs.fstatSync(descriptor, { bigint: true });
    expectedIdentity = { device: temporaryStats.dev, inode: temporaryStats.ino };
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporaryPath, finalPath);
    finalLinked = true;
    fs.unlinkSync(temporaryPath);
    temporaryExists = false;
    if (!(options.unitTestDirectory && process.platform !== "linux")) fsyncDirectory(outputDirectory);
    const finalStats = fs.lstatSync(finalPath, { bigint: true });
    const expectedOwner = options.unitTestDirectory ? BigInt(process.getuid?.() ?? 0) : 0n;
    const expectedGroup = options.unitTestDirectory ? BigInt(process.getgid?.() ?? 0) : 0n;
    const enforceLinuxIdentity = !options.unitTestDirectory || process.platform === "linux";
    if (
      !finalStats.isFile()
      || finalStats.isSymbolicLink()
      || finalStats.nlink !== 1n
      || (enforceLinuxIdentity && finalStats.uid !== expectedOwner)
      || (enforceLinuxIdentity && finalStats.gid !== expectedGroup)
      || (enforceLinuxIdentity && (finalStats.mode & 0o7777n) !== 0o600n)
    ) fail("legacy inventory final report identity is unsafe", "LEGACY_INVENTORY_OUTPUT_UNSAFE", 73);
    return { reportId: evidence.reportId, fileName: finalName, bytes: Buffer.byteLength(serialized, "utf8") };
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* best effort cleanup */ }
    }
    if (temporaryExists) {
      try { fs.unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    }
    if (finalLinked && expectedIdentity) {
      try {
        const finalStats = fs.lstatSync(finalPath, { bigint: true });
        if (finalStats.dev === expectedIdentity.device && finalStats.ino === expectedIdentity.inode) {
          fs.unlinkSync(finalPath);
          if (!(options.unitTestDirectory && process.platform !== "linux")) fsyncDirectory(outputDirectory);
        }
      } catch { /* preserve the primary fail-closed error */ }
    }
    if (error instanceof LegacyInventoryError) throw error;
    fail("legacy inventory report could not be committed safely", "LEGACY_INVENTORY_OUTPUT_UNSAFE", 73);
  } finally {
    process.umask(priorUmask);
  }
}

function check(id, category, result, blocking, reason) {
  if (!/^[a-z0-9][a-z0-9.-]{2,95}$/u.test(id) || !/^[a-z][a-z0-9-]{1,31}$/u.test(category)) {
    fail("collector attempted to create an invalid check identifier", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  }
  if (!ALLOWED_CHECK_RESULTS.has(result)) fail("collector attempted to create an invalid check result", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  if (!CHECK_REASON_CODES.has(reason)) fail("collector attempted to create an invalid check reason", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  return { id, category, result, blocking: Boolean(blocking), reason };
}

function manualConfirmations() {
  return KNOWN_MANUAL_CONFIRMATIONS.map(([id, reason]) => ({ id, status: "PENDING", reason }));
}

function secretPresence(environmentKeys) {
  const present = {
    jwtOrSessionSecret: false,
    tokenOrCredential: false,
    password: false,
    cookieOrAuthorization: false,
    privateKey: false,
  };
  for (const key of environmentKeys) {
    if (/JWT|SESSION|SECRET/iu.test(key)) present.jwtOrSessionSecret = true;
    if (/TOKEN|CREDENTIAL/iu.test(key)) present.tokenOrCredential = true;
    if (/PASSWORD/iu.test(key)) present.password = true;
    if (/COOKIE|AUTHORIZATION/iu.test(key)) present.cookieOrAuthorization = true;
    if (/PRIVATE[_-]?KEY/iu.test(key)) present.privateKey = true;
  }
  return present;
}

function assertEvidenceRedacted(evidence) {
  let serialized;
  try { serialized = JSON.stringify(evidence); } catch {
    fail("legacy inventory evidence cannot be serialized safely", "LEGACY_INVENTORY_REDACTION_FAILED", 74);
  }
  const forbiddenPatterns = [
    /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u,
    /(?:JWT_SECRET|PASSWORD|AUTHORIZATION|COOKIE|ACCESS_TOKEN|REFRESH_TOKEN)\s*[=:]\s*[^,}\s]+/iu,
  ];
  if (forbiddenPatterns.some((pattern) => pattern.test(serialized))) {
    fail("legacy inventory evidence contains forbidden sensitive material", "LEGACY_INVENTORY_REDACTION_FAILED", 74);
  }
  const stack = [evidence];
  const seen = new WeakSet();
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        SENSITIVE_ENVIRONMENT_PATTERNS.some((pattern) => pattern.test(key))
        && key !== "authorization"
        && typeof child !== "boolean"
      ) {
        fail("legacy inventory evidence contains a sensitive field value", "LEGACY_INVENTORY_REDACTION_FAILED", 74);
      }
      if (typeof child === "string" && (
        /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u.test(child)
        || /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/u.test(child)
        || /(?:secret|password|authorization|cookie|access[_-]?token|refresh[_-]?token)\s*[=:]\s*\S+/iu.test(child)
      )) fail("legacy inventory evidence contains a sensitive string", "LEGACY_INVENTORY_REDACTION_FAILED", 74);
      stack.push(child);
    }
  }
  if (
    evidence.exportPolicy?.rawSecretMaterialCaptured !== false
    || evidence.exportPolicy?.rawProcessEnvironmentCaptured !== false
    || evidence.exportPolicy?.rawCommandLineCaptured !== false
    || evidence.exportPolicy?.rawPm2DumpCaptured !== false
    || evidence.exportPolicy?.databaseOpened !== false
    || evidence.exportPolicy?.databaseRowsCaptured !== false
    || evidence.exportPolicy?.databaseSchemaCaptured !== false
    || evidence.exportPolicy?.mediaContentCaptured !== false
    || evidence.exportPolicy?.mediaFileNamesCaptured !== false
  ) {
    fail("legacy inventory export policy is not safely redacted", "LEGACY_INVENTORY_REDACTION_FAILED", 74);
  }
  return true;
}

function assertAllowedEvidenceTree(evidence) {
  const stack = [{ value: evidence, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > 200000 || depth > 96) fail("legacy evidence tree exceeds its safety limit", "LEGACY_EVIDENCE_INVALID", 65);
    if (value === null || typeof value === "string" || typeof value === "boolean") continue;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail("legacy evidence contains an unsafe number", "LEGACY_EVIDENCE_INVALID", 65);
      continue;
    }
    if (!value || typeof value !== "object") fail("legacy evidence contains a non-JSON value", "LEGACY_EVIDENCE_INVALID", 65);
    if (seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      if (value.length > 200000) fail("legacy evidence array exceeds its safety limit", "LEGACY_EVIDENCE_INVALID", 65);
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) fail("legacy evidence must use plain objects", "LEGACY_EVIDENCE_INVALID", 65);
    for (const [key, child] of Object.entries(value)) {
      if (!ALLOWED_EVIDENCE_KEYS.has(key)) fail("legacy evidence contains an unknown field", "LEGACY_EVIDENCE_INVALID", 65);
      stack.push({ value: child, depth: depth + 1 });
    }
  }
}

function assertBoolean(value, description) {
  if (typeof value !== "boolean") fail(`${description} must be boolean`, "LEGACY_EVIDENCE_INVALID", 65);
}

function assertDecimal(value, description) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value) || value.length > 32) {
    fail(`${description} must be a bounded decimal string`, "LEGACY_EVIDENCE_INVALID", 65);
  }
}

function validateMetadata(metadata, description) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    fail(`${description} metadata is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (metadata.exists === false) {
    exactObjectKeys(metadata, ["exists", "type"], description);
    if (metadata.type !== "missing") fail(`${description} missing metadata is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    return;
  }
  if (metadata.exists === null) {
    exactObjectKeys(metadata, ["exists", "type", "errorCode"], description);
    if (metadata.type !== "unreadable" || !/^[A-Z0-9_]{2,64}$/u.test(metadata.errorCode || "")) {
      fail(`${description} unreadable metadata is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
    return;
  }
  exactObjectKeys(metadata, [
    "exists", "type", "canonicalMatchesRequested", "uid", "gid", "mode", "nlink", "device", "inode", "bytes",
    "mtimeNs", "ctimeNs", "groupOrOtherWritable",
  ], description);
  if (metadata.exists !== true || !["file", "directory", "symlink", "special"].includes(metadata.type)) {
    fail(`${description} existing metadata is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertBoolean(metadata.canonicalMatchesRequested, `${description} canonical flag`);
  for (const key of ["uid", "gid", "nlink", "device", "inode", "bytes", "mtimeNs", "ctimeNs"]) assertDecimal(metadata[key], `${description} ${key}`);
  if (!Number.isSafeInteger(metadata.mode) || metadata.mode < 0 || metadata.mode > 0o7777) {
    fail(`${description} mode is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertBoolean(metadata.groupOrOtherWritable, `${description} writable flag`);
}

function validateSafeEnvironment(environment, description) {
  exactObjectKeys(environment, [
    "recordCount", "malformedRecordCount", "unknownKeyCount", "dangerousRuntimeKeyPresent", "safeKeys", "sensitivePresence", "valuesExported",
  ], description);
  for (const key of ["recordCount", "malformedRecordCount", "unknownKeyCount"]) {
    if (!Number.isSafeInteger(environment[key]) || environment[key] < 0 || environment[key] > MAX_ENVIRONMENT_RECORDS) {
      fail(`${description} count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
  }
  assertBoolean(environment.dangerousRuntimeKeyPresent, `${description} dangerous runtime key`);
  exactObjectKeys(environment.safeKeys, SAFE_ENVIRONMENT_KEYS, `${description} safe keys`);
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    exactObjectKeys(environment.safeKeys[key], ["present", "matchesExpected"], `${description} ${key}`);
    assertBoolean(environment.safeKeys[key].present, `${description} ${key} present`);
    assertBoolean(environment.safeKeys[key].matchesExpected, `${description} ${key} match`);
  }
  exactObjectKeys(environment.sensitivePresence, [
    "jwtOrSessionSecret", "tokenOrCredential", "password", "cookieOrAuthorization", "privateKey",
  ], `${description} sensitive presence`);
  for (const value of Object.values(environment.sensitivePresence)) assertBoolean(value, `${description} sensitive presence`);
  if (environment.valuesExported !== false) fail(`${description} exports values`, "LEGACY_EVIDENCE_INVALID", 65);
}

function validateProcessProjection(processValue, description) {
  exactObjectKeys(processValue, [
    "pid", "processDirectoryDevice", "processDirectoryInode", "startTimeTicks", "parentPid", "state", "identity",
    "executableClass", "workingDirectoryClass", "command", "environment",
  ], description);
  if (!Number.isSafeInteger(processValue.pid) || processValue.pid <= 0 || processValue.pid > 4194304) {
    fail(`${description} PID is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  for (const key of ["processDirectoryDevice", "processDirectoryInode", "startTimeTicks"]) assertDecimal(processValue[key], `${description} ${key}`);
  if (!Number.isSafeInteger(processValue.parentPid) || processValue.parentPid < 0 || processValue.parentPid > 4194304 || !/^[A-Z]$/u.test(processValue.state)) {
    fail(`${description} process state is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  exactObjectKeys(processValue.identity, ["uid", "effectiveUid", "gid", "effectiveGid"], `${description} identity`);
  for (const key of ["uid", "effectiveUid", "gid", "effectiveGid"]) assertDecimal(processValue.identity[key], `${description} ${key}`);
  if (!["managed-node-v24", "system-node", "other-executable", "deleted-executable", "invalid"].includes(processValue.executableClass)) {
    fail(`${description} executable class is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (!["application-root", "managed-current", "inside-application-root", "outside-application-root", "invalid"].includes(processValue.workingDirectoryClass)) {
    fail(`${description} working directory class is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  exactObjectKeys(processValue.command, [
    "argumentCount", "approvedEntrypointIsExecutedScript", "secretLikeArgumentPresent", "rawArgumentsExported",
  ], `${description} command`);
  if (!Number.isSafeInteger(processValue.command.argumentCount) || processValue.command.argumentCount < 0 || processValue.command.argumentCount > MAX_ARGUMENT_COUNT) {
    fail(`${description} argument count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertBoolean(processValue.command.approvedEntrypointIsExecutedScript, `${description} approved entrypoint`);
  assertBoolean(processValue.command.secretLikeArgumentPresent, `${description} secret-like argument`);
  if (processValue.command.rawArgumentsExported !== false) fail(`${description} exports command arguments`, "LEGACY_EVIDENCE_INVALID", 65);
  validateSafeEnvironment(processValue.environment, `${description} environment`);
}

function validateMediaSummary(summary, description) {
  exactObjectKeys(summary, [
    "root", "fileCount", "directoryCount", "totalBytes", "symlinkCount", "hardlinkCount", "specialCount",
    "unreadableCount", "nestedMountCount", "crossDeviceEntryCount", "maximumFileLimitReached", "namesExported", "contentRead",
  ], description);
  validateMetadata(summary.root, `${description} root`);
  for (const key of [
    "fileCount", "directoryCount", "symlinkCount", "hardlinkCount", "specialCount", "unreadableCount",
    "nestedMountCount", "crossDeviceEntryCount",
  ]) {
    if (!Number.isSafeInteger(summary[key]) || summary[key] < 0 || summary[key] > 1_000_000) {
      fail(`${description} count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
  }
  assertDecimal(summary.totalBytes, `${description} total bytes`);
  assertBoolean(summary.maximumFileLimitReached, `${description} file limit`);
  if (summary.namesExported !== false || summary.contentRead !== false) {
    fail(`${description} export boundary is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
}

function validatePm2Environment(environment, description) {
  exactObjectKeys(environment, [
    "recordCount", "malformed", "unknownKeyCount", "dangerousRuntimeKeyPresent", "safeKeys", "sensitivePresence", "valuesExported",
  ], description);
  if (!Number.isSafeInteger(environment.recordCount) || environment.recordCount < 0 || environment.recordCount > MAX_ENVIRONMENT_RECORDS) {
    fail(`${description} record count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertBoolean(environment.malformed, `${description} malformed flag`);
  if (!Number.isSafeInteger(environment.unknownKeyCount) || environment.unknownKeyCount < 0 || environment.unknownKeyCount > MAX_ENVIRONMENT_RECORDS) {
    fail(`${description} unknown key count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertBoolean(environment.dangerousRuntimeKeyPresent, `${description} dangerous runtime key`);
  exactObjectKeys(environment.safeKeys, SAFE_ENVIRONMENT_KEYS, `${description} safe keys`);
  for (const key of SAFE_ENVIRONMENT_KEYS) {
    exactObjectKeys(environment.safeKeys[key], ["present", "matchesExpected"], `${description} ${key}`);
    assertBoolean(environment.safeKeys[key].present, `${description} ${key} present`);
    assertBoolean(environment.safeKeys[key].matchesExpected, `${description} ${key} match`);
  }
  exactObjectKeys(environment.sensitivePresence, [
    "jwtOrSessionSecret", "tokenOrCredential", "password", "cookieOrAuthorization", "privateKey",
  ], `${description} sensitive presence`);
  for (const value of Object.values(environment.sensitivePresence)) assertBoolean(value, `${description} sensitive presence`);
  if (environment.valuesExported !== false) fail(`${description} exports values`, "LEGACY_EVIDENCE_INVALID", 65);
}

function validatePm2Projection(pm2, policy) {
  exactObjectKeys(pm2, [
    "home", "homeTrusted", "primary", "backup", "selected", "selectedProjection", "cliUsed", "rpcConnected", "rawDumpExported",
  ], "legacy evidence PM2");
  validateMetadata(pm2.home, "legacy evidence PM2 home");
  assertBoolean(pm2.homeTrusted, "legacy evidence PM2 home trust");
  const expectedHomeTrusted = pm2.home.exists === true
    && pm2.home.type === "directory"
    && pm2.home.canonicalMatchesRequested === true
    && pm2.home.uid === "0"
    && pm2.home.gid === "0"
    && pm2.home.groupOrOtherWritable === false;
  if (pm2.homeTrusted !== expectedHomeTrusted) fail("legacy evidence PM2 home trust differs", "LEGACY_EVIDENCE_INVALID", 65);
  for (const label of ["primary", "backup"]) {
    const dump = pm2[label];
    exactObjectKeys(dump, ["metadata", "usable", "projection"], `legacy evidence PM2 ${label}`);
    validateMetadata(dump.metadata, `legacy evidence PM2 ${label} metadata`);
    assertBoolean(dump.usable, `legacy evidence PM2 ${label} usable`);
    if (dump.projection === null) continue;
    if (dump.projection.validJsonArray === false) {
      exactObjectKeys(dump.projection, ["validJsonArray"], `legacy evidence PM2 ${label} invalid projection`);
      continue;
    }
    exactObjectKeys(dump.projection, [
      "validJsonArray", "processCount", "approvedProcessCount", "unexpectedProcessCount", "writerProcessCount",
      "adjacentProcessCount", "processes", "rawDumpExported", "rawDumpDigestExported",
    ], `legacy evidence PM2 ${label} projection`);
    if (dump.projection.validJsonArray !== true || !Array.isArray(dump.projection.processes) || dump.projection.processes.length > 1024) {
      fail(`legacy evidence PM2 ${label} process projection is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
    for (const key of ["processCount", "approvedProcessCount", "unexpectedProcessCount", "writerProcessCount", "adjacentProcessCount"]) {
      if (!Number.isSafeInteger(dump.projection[key]) || dump.projection[key] < 0 || dump.projection[key] > 1024) {
        fail(`legacy evidence PM2 ${label} count is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
      }
    }
    if (dump.projection.processCount !== dump.projection.processes.length || dump.projection.rawDumpExported !== false || dump.projection.rawDumpDigestExported !== false) {
      fail(`legacy evidence PM2 ${label} projection boundary is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
    for (const processValue of dump.projection.processes) {
      if (processValue.malformed === true) {
        exactObjectKeys(processValue, ["malformed", "approvedName", "writerName", "adjacentName"], `legacy evidence PM2 ${label} malformed process`);
        continue;
      }
      exactObjectKeys(processValue, [
        "malformed", "approvedName", "approvedNameValue", "writerName", "adjacentName", "workingDirectoryClass",
        "statusClass", "executionPathApproved", "environment",
      ], `legacy evidence PM2 ${label} process`);
      for (const key of ["approvedName", "writerName", "adjacentName", "executionPathApproved"]) assertBoolean(processValue[key], `legacy evidence PM2 ${label} ${key}`);
      if (processValue.approvedNameValue !== null && ![...policy.expectedWriterAppNames, ...policy.expectedAdjacentAppNames].includes(processValue.approvedNameValue)) {
        fail(`legacy evidence PM2 ${label} approved name is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
      }
      if (
        processValue.approvedName !== (processValue.writerName || processValue.adjacentName)
        || (processValue.writerName && processValue.adjacentName)
        || processValue.approvedName !== (processValue.approvedNameValue !== null)
      ) fail(`legacy evidence PM2 ${label} process role is inconsistent`, "LEGACY_EVIDENCE_INVALID", 65);
      if (!["online", "stopped", "errored", "stopping", "launching", "unknown"].includes(processValue.statusClass)) {
        fail(`legacy evidence PM2 ${label} status class is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
      }
      if (!["application-root", "managed-current", "inside-application-root", "outside-application-root", "invalid"].includes(processValue.workingDirectoryClass)) {
        fail(`legacy evidence PM2 ${label} cwd class is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
      }
      validatePm2Environment(processValue.environment, `legacy evidence PM2 ${label} environment`);
    }
    const completeProcesses = dump.projection.processes.filter((item) => item.malformed === false);
    if (
      dump.projection.approvedProcessCount !== completeProcesses.filter((item) => item.approvedName).length
      || dump.projection.unexpectedProcessCount !== dump.projection.processes.filter((item) => item.malformed === true || !item.approvedName).length
      || dump.projection.writerProcessCount !== completeProcesses.filter((item) => item.writerName).length
      || dump.projection.adjacentProcessCount !== completeProcesses.filter((item) => item.adjacentName).length
    ) fail(`legacy evidence PM2 ${label} counts differ from process projection`, "LEGACY_EVIDENCE_INVALID", 65);
    if (dump.usable !== true) fail(`legacy evidence PM2 ${label} usable flag differs`, "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (![null, "primary"].includes(pm2.selected) || pm2.cliUsed !== false || pm2.rpcConnected !== false || pm2.rawDumpExported !== false) {
    fail("legacy evidence PM2 boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
  const selectedProjection = pm2.selected === null ? null : pm2[pm2.selected].projection;
  if (pm2.selected !== null && pm2[pm2.selected].usable !== true) {
    fail("legacy evidence PM2 selected dump is unusable", "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (canonicalJson(pm2.selectedProjection) !== canonicalJson(selectedProjection)) {
    fail("legacy evidence PM2 selected projection differs", "LEGACY_EVIDENCE_INVALID", 65);
  }
}

function validateNginxProjection(nginx) {
  exactObjectKeys(nginx, [
    "available", "enabled", "diskProjection", "selectedDiskSource", "activeRuntimeState", "configurationTestExecuted",
    "serviceStateChanged", "enabledSymlinkTargetsAvailable",
  ], "legacy evidence Nginx");
  for (const label of ["available", "enabled"]) {
    exactObjectKeys(nginx[label], ["metadata", "readable"], `legacy evidence Nginx ${label}`);
    validateMetadata(nginx[label].metadata, `legacy evidence Nginx ${label} metadata`);
    assertBoolean(nginx[label].readable, `legacy evidence Nginx ${label} readable`);
  }
  if (nginx.diskProjection !== null) {
    exactObjectKeys(nginx.diskProjection, [
      "configuredServerNamePresent", "loopbackProxyPresent", "wildcardApplicationProxyPresent", "tlsListenerPresent",
      "unexpandedIncludePresent", "configurationBytes", "rawConfigurationExported", "configurationDigestExported",
    ], "legacy evidence Nginx disk projection");
    for (const key of ["configuredServerNamePresent", "loopbackProxyPresent", "wildcardApplicationProxyPresent", "tlsListenerPresent", "unexpandedIncludePresent"]) {
      assertBoolean(nginx.diskProjection[key], `legacy evidence Nginx ${key}`);
    }
    if (!Number.isSafeInteger(nginx.diskProjection.configurationBytes) || nginx.diskProjection.configurationBytes < 0 || nginx.diskProjection.configurationBytes > MAX_CONTROL_FILE_BYTES) {
      fail("legacy evidence Nginx byte count is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
    if (nginx.diskProjection.rawConfigurationExported !== false || nginx.diskProjection.configurationDigestExported !== false) {
      fail("legacy evidence Nginx export boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
  }
  if (
    ![null, "enabled-physical-file", "available-file"].includes(nginx.selectedDiskSource)
    || typeof nginx.enabledSymlinkTargetsAvailable !== "boolean"
    || nginx.activeRuntimeState !== "not_inspected"
    || nginx.configurationTestExecuted !== false
    || nginx.serviceStateChanged !== false
  ) fail("legacy evidence Nginx boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  if (
    nginx.enabledSymlinkTargetsAvailable
    && (
      nginx.enabled.metadata.exists !== true
      || nginx.enabled.metadata.type !== "symlink"
      || nginx.available.readable !== true
      || nginx.selectedDiskSource !== "available-file"
    )
  ) fail("legacy evidence Nginx symlink projection is inconsistent", "LEGACY_EVIDENCE_INVALID", 65);
}

function validateRuntimeSource(runtimeSource, policy) {
  exactObjectKeys(runtimeSource, [
    "root", "rootTrusted", "identityFiles", "identityFileSetComplete", "gitMetadata", "gitCommandExecuted", "claimedRevision",
  ], "legacy evidence runtime source");
  validateMetadata(runtimeSource.root, "legacy evidence runtime root");
  assertBoolean(runtimeSource.rootTrusted, "legacy evidence runtime root trust");
  const expectedRootTrusted = runtimeSource.root.exists === true
    && runtimeSource.root.type === "directory"
    && runtimeSource.root.canonicalMatchesRequested === true
    && runtimeSource.root.groupOrOtherWritable === false;
  if (runtimeSource.rootTrusted !== expectedRootTrusted) fail("legacy evidence runtime root trust differs", "LEGACY_EVIDENCE_INVALID", 65);
  if (!Array.isArray(runtimeSource.identityFiles) || runtimeSource.identityFiles.length !== RUNTIME_IDENTITY_FILES.length) {
    fail("legacy evidence runtime identity file catalog is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
  for (let index = 0; index < RUNTIME_IDENTITY_FILES.length; index += 1) {
    const identityFile = runtimeSource.identityFiles[index];
    exactObjectKeys(identityFile, ["name", "metadata", "sha256"], "legacy evidence runtime identity file");
    if (identityFile.name !== RUNTIME_IDENTITY_FILES[index]) fail("legacy evidence runtime identity file order is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    validateMetadata(identityFile.metadata, `legacy evidence runtime identity ${identityFile.name}`);
    if (identityFile.sha256 !== null && !/^[0-9a-f]{64}$/u.test(identityFile.sha256)) {
      fail("legacy evidence runtime identity digest is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
  }
  assertBoolean(runtimeSource.identityFileSetComplete, "legacy evidence runtime identity completeness");
  const expectedIdentityComplete = policy.approvedRuntimeIdentityFiles.length === RUNTIME_IDENTITY_FILES.length
    && runtimeSource.identityFiles.every((item) => typeof item.sha256 === "string");
  if (runtimeSource.identityFileSetComplete !== expectedIdentityComplete) {
    fail("legacy evidence runtime identity completeness differs", "LEGACY_EVIDENCE_INVALID", 65);
  }
  validateMetadata(runtimeSource.gitMetadata, "legacy evidence git metadata");
  if (runtimeSource.gitCommandExecuted !== false || runtimeSource.claimedRevision !== null) {
    fail("legacy evidence runtime Git boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
}

function validateFilesystemSummary(filesystem, policy) {
  exactObjectKeys(filesystem, ["fixedPathsOnly", "application", "data", "pm2"], "legacy evidence filesystem");
  if (filesystem.fixedPathsOnly !== true) fail("legacy evidence filesystem is not fixed", "LEGACY_EVIDENCE_INVALID", 65);
  const roots = {
    application: policy.applicationRoot,
    data: policy.dataDirectory,
    pm2: policy.pm2Home,
  };
  for (const label of ["application", "data", "pm2"]) {
    const summary = filesystem[label];
    exactObjectKeys(summary, ["metadata", "physicalDirectory", "ancestors"], `legacy evidence filesystem ${label}`);
    validateMetadata(summary.metadata, `legacy evidence filesystem ${label} metadata`);
    assertBoolean(summary.physicalDirectory, `legacy evidence filesystem ${label} physical flag`);
    const expectedAncestorCount = path.posix.dirname(roots[label]).split("/").filter(Boolean).length + 1;
    if (!Array.isArray(summary.ancestors) || summary.ancestors.length !== expectedAncestorCount || summary.ancestors.length > 32) {
      fail(`legacy evidence filesystem ${label} ancestors are invalid`, "LEGACY_EVIDENCE_INVALID", 65);
    }
    const expectedPhysicalDirectory = summary.metadata.exists === true
      && summary.metadata.type === "directory"
      && summary.metadata.canonicalMatchesRequested === true;
    if (summary.physicalDirectory !== expectedPhysicalDirectory) {
      fail(`legacy evidence filesystem ${label} physical flag differs`, "LEGACY_EVIDENCE_INVALID", 65);
    }
    let previousDepth = -1;
    for (const ancestor of summary.ancestors) {
      exactObjectKeys(ancestor, ["depthFromRoot", "metadata"], `legacy evidence filesystem ${label} ancestor`);
      if (!Number.isSafeInteger(ancestor.depthFromRoot) || ancestor.depthFromRoot !== previousDepth + 1) {
        fail(`legacy evidence filesystem ${label} ancestor depth is invalid`, "LEGACY_EVIDENCE_INVALID", 65);
      }
      previousDepth = ancestor.depthFromRoot;
      validateMetadata(ancestor.metadata, `legacy evidence filesystem ${label} ancestor metadata`);
    }
  }
}

function validateControlState(controlState) {
  const metadataKeys = [
    "activationPending", "currentRelease", "runtimePointer", "releaseRoot", "publicPointer", "publicReleaseRoot",
    "maintenanceFlag", "databaseLock", "deploymentLock",
  ];
  exactObjectKeys(controlState, [...metadataKeys, "managedStatePresent", "filesParsed"], "legacy evidence control state");
  for (const key of metadataKeys) validateMetadata(controlState[key], `legacy evidence control ${key} metadata`);
  assertBoolean(controlState.managedStatePresent, "legacy evidence managed state");
  if (controlState.managedStatePresent !== metadataKeys.some((key) => controlState[key].exists === true) || controlState.filesParsed !== false) {
    fail("legacy evidence control state differs from metadata", "LEGACY_EVIDENCE_INVALID", 65);
  }
}

function validateDatabase(database, processMap) {
  exactObjectKeys(database, [
    "path", "sqliteConnectionOpened", "logicalState", "headerRead", "schemaRead", "rowsRead", "sidecars", "openers",
  ], "legacy evidence database");
  validateMetadata(database.path, "legacy evidence database path");
  exactObjectKeys(database.sidecars, ["wal", "shm", "journal"], "legacy evidence database sidecars");
  for (const label of ["wal", "shm", "journal"]) validateMetadata(database.sidecars[label], `legacy evidence database ${label}`);
  if (!Array.isArray(database.openers) || database.openers.length > 256) fail("legacy evidence database openers are invalid", "LEGACY_EVIDENCE_INVALID", 65);
  const openerIds = new Set();
  for (const opener of database.openers) {
    exactObjectKeys(opener, ["process", "descriptorCount", "accessModes", "writableDescriptorPresent"], "legacy evidence database opener");
    validateProcessProjection(opener.process, "legacy evidence database opener process");
    if (openerIds.has(opener.process.pid)) fail("legacy evidence database opener is duplicated", "LEGACY_EVIDENCE_INVALID", 65);
    openerIds.add(opener.process.pid);
    if (canonicalJson(processMap.get(opener.process.pid)) !== canonicalJson(opener.process)) {
      fail("legacy evidence database opener differs from process inventory", "LEGACY_EVIDENCE_INVALID", 65);
    }
    if (!Number.isSafeInteger(opener.descriptorCount) || opener.descriptorCount < 1 || opener.descriptorCount > MAX_PROCESS_FD_COUNT) {
      fail("legacy evidence database descriptor count is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
    if (!Array.isArray(opener.accessModes) || opener.accessModes.length < 1 || opener.accessModes.some((mode) => !["read-only", "write-only", "read-write", "unknown"].includes(mode))) {
      fail("legacy evidence database access modes are invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
    assertBoolean(opener.writableDescriptorPresent, "legacy evidence database writable descriptor");
    if (opener.writableDescriptorPresent !== opener.accessModes.some((mode) => mode !== "read-only")) {
      fail("legacy evidence database writable descriptor differs", "LEGACY_EVIDENCE_INVALID", 65);
    }
  }
}

function validateCoreProjection(evidence, policy) {
  const processMap = new Map();
  for (const processValue of evidence.processes) {
    validateProcessProjection(processValue, "legacy evidence process");
    if (processMap.has(processValue.pid)) fail("legacy evidence process is duplicated", "LEGACY_EVIDENCE_INVALID", 65);
    processMap.set(processValue.pid, processValue);
  }
  for (const listener of evidence.listeners) {
    exactObjectKeys(listener, ["family", "addressClass", "port", "state", "socketInode", "ownerPids"], "legacy evidence listener");
    if (!/^(?:ipv4|ipv6)$/u.test(listener.family) || !/^(?:loopback|wildcard|other)$/u.test(listener.addressClass) || listener.port !== policy.listenerPort || listener.state !== "LISTEN") {
      fail("legacy evidence listener projection is invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
    assertDecimal(listener.socketInode, "legacy evidence listener socket inode");
    if (!Array.isArray(listener.ownerPids) || listener.ownerPids.length > 16 || new Set(listener.ownerPids).size !== listener.ownerPids.length) {
      fail("legacy evidence listener owners are invalid", "LEGACY_EVIDENCE_INVALID", 65);
    }
    for (const pid of listener.ownerPids) if (!processMap.has(pid)) fail("legacy evidence listener owner is absent from process inventory", "LEGACY_EVIDENCE_INVALID", 65);
  }
  validateDatabase(evidence.database, processMap);
  exactObjectKeys(evidence.uploads, ["community", "observation"], "legacy evidence uploads");
  validateMediaSummary(evidence.uploads.community, "legacy evidence community uploads");
  validateMediaSummary(evidence.uploads.observation, "legacy evidence observation uploads");
  validatePm2Projection(evidence.pm2, policy);
  validateNginxProjection(evidence.nginx);
  validateRuntimeSource(evidence.runtimeSource, policy);
  validateFilesystemSummary(evidence.filesystem, policy);
  validateControlState(evidence.controlState);
  exactObjectKeys(evidence.inventoryMetrics, [
    "processCount", "inspectedDescriptorCount", "transientProcessRaceCount", "transientDescriptorRaceCount", "descriptorScanComplete",
  ], "legacy evidence inventory metrics");
  if (
    !Number.isSafeInteger(evidence.inventoryMetrics.processCount)
    || evidence.inventoryMetrics.processCount < evidence.processes.length
    || evidence.inventoryMetrics.processCount > MAX_PROCESS_COUNT
    || !Number.isSafeInteger(evidence.inventoryMetrics.inspectedDescriptorCount)
    || evidence.inventoryMetrics.inspectedDescriptorCount < 0
    || evidence.inventoryMetrics.inspectedDescriptorCount > MAX_PROCESS_FD_COUNT
    || !Number.isSafeInteger(evidence.inventoryMetrics.transientProcessRaceCount)
    || evidence.inventoryMetrics.transientProcessRaceCount < 0
    || evidence.inventoryMetrics.transientProcessRaceCount > MAX_PROCESS_COUNT
    || !Number.isSafeInteger(evidence.inventoryMetrics.transientDescriptorRaceCount)
    || evidence.inventoryMetrics.transientDescriptorRaceCount < 0
    || evidence.inventoryMetrics.transientDescriptorRaceCount > MAX_PROCESS_FD_COUNT
    || typeof evidence.inventoryMetrics.descriptorScanComplete !== "boolean"
    || evidence.inventoryMetrics.descriptorScanComplete !== (
      evidence.inventoryMetrics.transientProcessRaceCount === 0
      && evidence.inventoryMetrics.transientDescriptorRaceCount === 0
    )
  ) fail("legacy evidence inventory metrics are invalid", "LEGACY_EVIDENCE_INVALID", 65);
}

function validateEvidenceShape(evidence) {
  const topLevelKeys = [
    "schemaVersion", "kind", "reportId", "capture", "collector", "exportPolicy", "authorization", "verdict", "host",
    "policy", "sideEffectContract", "controlState", "pm2", "listeners", "database", "uploads", "nginx", "runtimeSource",
    "filesystem", "consistency", "checks", "manualConfirmations", "collectorErrors", "processes", "inventoryMetrics",
  ];
  exactObjectKeys(evidence, topLevelKeys, "legacy evidence");
  if (Object.keys(evidence).length !== topLevelKeys.length || topLevelKeys.some((key) => !Object.hasOwn(evidence, key))) {
    fail("legacy evidence is missing required sections", "LEGACY_EVIDENCE_INVALID", 65);
  }
  assertAllowedEvidenceTree(evidence);
  canonicalJson(evidence);
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION || evidence.kind !== REPORT_KIND) {
    fail("legacy evidence schema is unsupported", "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(evidence.reportId || "")) {
    fail("legacy evidence reportId is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
  exactObjectKeys(evidence.capture, ["phase", "mode", "startedAt", "completedAt", "attempts", "complete"], "legacy evidence capture");
  if (
    !["live-discovery", "quiesced-binding"].includes(evidence.capture.phase)
    || evidence.capture.mode !== "live-read-only"
    || evidence.capture.complete !== true
    || !Number.isSafeInteger(evidence.capture.attempts)
    || evidence.capture.attempts < 1
    || evidence.capture.attempts > 3
  ) fail("legacy evidence capture boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  const startedAt = isoTimestamp(evidence.capture.startedAt, "capture startedAt");
  const completedAt = isoTimestamp(evidence.capture.completedAt, "capture completedAt");
  if (completedAt < startedAt) fail("legacy evidence capture time is inverted", "LEGACY_EVIDENCE_INVALID", 65);
  exactObjectKeys(evidence.collector, ["name", "formatVersion", "installedPath", "runtime"], "legacy evidence collector");
  if (
    evidence.collector.name !== "birdora-legacy-inventory"
    || evidence.collector.formatVersion !== 1
    || evidence.collector.installedPath !== FIXED_COLLECTOR_PATH
    || evidence.collector.runtime !== "node-v24"
  ) fail("legacy evidence collector identity is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  const expectedExportPolicy = {
    rawSecretMaterialCaptured: false,
    rawProcessEnvironmentCaptured: false,
    rawCommandLineCaptured: false,
    rawPm2DumpCaptured: false,
    databaseOpened: false,
    databaseRowsCaptured: false,
    databaseSchemaCaptured: false,
    mediaContentCaptured: false,
    mediaFileNamesCaptured: false,
  };
  exactObjectKeys(evidence.exportPolicy, Object.keys(expectedExportPolicy), "legacy evidence export policy");
  if (canonicalJson(evidence.exportPolicy) !== canonicalJson(expectedExportPolicy)) {
    fail("legacy evidence export policy is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
  exactObjectKeys(evidence.authorization, ["inventoryOnly", "adoptionAuthorized", "mutationAuthorized"], "legacy evidence authorization");
  if (
    evidence.authorization.inventoryOnly !== true
    || evidence.authorization.adoptionAuthorized !== false
    || evidence.authorization.mutationAuthorized !== false
  ) fail("legacy evidence authorization boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  exactObjectKeys(evidence.sideEffectContract, [
    "sqliteConnectionOpened", "pm2CliUsed", "pm2RpcConnected", "externalCommandsExecuted", "networkRequestsMade",
    "signalsSent", "serviceStateChanged", "productionFilesWritten", "reportFileWritten",
  ], "legacy evidence side-effect contract");
  if (
    Object.entries(evidence.sideEffectContract).some(([key, value]) => key === "reportFileWritten" ? value !== true : value !== false)
  ) fail("legacy evidence side-effect contract is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  exactObjectKeys(evidence.consistency, ["stable", "snapshotsCompared", "attempts", "internalTokensExported"], "legacy evidence consistency");
  if (
    evidence.consistency.stable !== true
    || evidence.consistency.snapshotsCompared !== 2
    || evidence.consistency.attempts !== evidence.capture.attempts
    || evidence.consistency.internalTokensExported !== false
  ) fail("legacy evidence consistency proof is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  const normalizedPolicy = validatePolicy(evidence.policy);
  if (normalizedPolicy.capturePhase !== evidence.capture.phase) fail("legacy evidence policy/capture phase differs", "LEGACY_EVIDENCE_INVALID", 65);
  exactObjectKeys(evidence.host, [
    "platform", "architecture", "kernelRelease", "bootId", "rootUid", "hostPidNamespace", "hostMountNamespace",
    "hostNetworkNamespace", "hostUserNamespace", "initProcessClass", "containerMarkersPresent", "hostEnvironmentCandidate",
  ], "legacy evidence host");
  if (
    evidence.host.platform !== "linux"
    || evidence.host.rootUid !== true
    || evidence.host.hostPidNamespace !== true
    || evidence.host.hostMountNamespace !== true
    || evidence.host.hostNetworkNamespace !== true
    || evidence.host.hostUserNamespace !== true
    || evidence.host.initProcessClass !== "systemd-or-init"
    || evidence.host.containerMarkersPresent !== false
    || evidence.host.hostEnvironmentCandidate !== true
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(evidence.host.bootId || "")
    || !/^[a-z0-9_-]{1,32}$/u.test(evidence.host.architecture || "")
    || !/^[A-Za-z0-9._+~-]{1,128}$/u.test(evidence.host.kernelRelease || "")
  ) fail("legacy evidence host boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  if (
    !Array.isArray(evidence.listeners)
    || evidence.listeners.length > 64
    || !Array.isArray(evidence.processes)
    || evidence.processes.length > 256
    || !Array.isArray(evidence.database?.openers)
    || evidence.database.openers.length > 256
  ) fail("legacy evidence process/listener arrays are invalid", "LEGACY_EVIDENCE_INVALID", 65);
  const processIds = evidence.processes.map((item) => item?.pid);
  if (processIds.some((pid) => !Number.isSafeInteger(pid) || pid <= 0) || new Set(processIds).size !== processIds.length) {
    fail("legacy evidence process identities are invalid", "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (
    evidence.database.sqliteConnectionOpened !== false
    || evidence.database.logicalState !== "not_inspected"
    || evidence.database.headerRead !== false
    || evidence.database.schemaRead !== false
    || evidence.database.rowsRead !== false
  ) fail("legacy evidence database boundary is invalid", "LEGACY_EVIDENCE_INVALID", 65);
  validateCoreProjection(evidence, normalizedPolicy);
  if (!Array.isArray(evidence.checks) || evidence.checks.length !== KNOWN_CHECK_DEFINITIONS.length) {
    fail("legacy evidence check catalog is incomplete", "LEGACY_EVIDENCE_INVALID", 65);
  }
  let expectedChecks;
  try {
    expectedChecks = buildSnapshotChecks(evidence, normalizedPolicy);
  } catch (error) {
    if (error instanceof LegacyInventoryError) throw error;
    fail("legacy evidence cannot reproduce its checks", "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (canonicalJson(evidence.checks) !== canonicalJson(expectedChecks)) {
    fail("legacy evidence checks differ from the fixed projection", "LEGACY_EVIDENCE_INVALID", 65);
  }
  const expectedManualConfirmations = manualConfirmations();
  if (canonicalJson(evidence.manualConfirmations) !== canonicalJson(expectedManualConfirmations)) {
    fail("legacy evidence manual confirmations must remain the fixed pending catalog", "LEGACY_EVIDENCE_INVALID", 65);
  }
  if (!Array.isArray(evidence.collectorErrors) || evidence.collectorErrors.length !== 0) {
    fail("a formal legacy evidence report cannot contain collector errors", "LEGACY_EVIDENCE_INVALID", 65);
  }
  exactObjectKeys(evidence.verdict, ["automatedState", "authorizesMutation", "authorizesAdoption"], "legacy evidence verdict");
  const expectedDecision = deriveEvidenceDecision(evidence);
  if (
    evidence.verdict.automatedState !== expectedDecision.automatedState
    || evidence.verdict.authorizesMutation !== false
    || evidence.verdict.authorizesAdoption !== false
  ) fail("legacy evidence verdict differs from the reproducible decision", "LEGACY_EVIDENCE_INVALID", 65);
  assertEvidenceRedacted(evidence);
  return evidence;
}

function evaluateEvidence(evidence) {
  validateEvidenceShape(evidence);
  const decision = deriveEvidenceDecision(evidence);
  if (!ALLOWED_AUTOMATED_STATES.has(decision.automatedState)) {
    fail("legacy evidence evaluator reached an invalid state", "LEGACY_INVENTORY_INTERNAL_INVARIANT", 70);
  }
  return decision;
}

module.exports = {
  ACTIVATION_PENDING_FILE,
  ALLOWED_AUTOMATED_STATES,
  CONTROL_DIRECTORY,
  CURRENT_RELEASE_FILE,
  EVIDENCE_SCHEMA_VERSION,
  FIXED_COLLECTOR_PATH,
  FIXED_POLICY_PATH,
  FIXED_REPORT_DIRECTORY,
  LegacyInventoryError,
  MAX_CONTROL_FILE_BYTES,
  MAX_PM2_DUMP_BYTES,
  MAX_PROC_FILE_BYTES,
  NGINX_AVAILABLE_FILE,
  NGINX_ENABLED_FILE,
  REPORT_KIND,
  RUNTIME_IDENTITY_FILES,
  SAFE_ENVIRONMENT_KEYS,
  SENSITIVE_ENVIRONMENT_PATTERNS,
  assertEvidenceRedacted,
  canonicalJson,
  check,
  commandLineProjection,
  collectInventorySnapshot,
  collectStableInventory,
  compareStrings,
  createEvidenceReport,
  evaluateEvidence,
  environmentProjection,
  fail,
  isWithin,
  manualConfirmations,
  parseJsonObject,
  parseMountInfo,
  projectNginxConfiguration,
  parseProcNetTcp,
  parseProcStat,
  readBoundedRegularFile,
  readPolicy,
  readPseudoFileBounded,
  safePathMetadata,
  sameProcNamespace,
  sanitizePm2Process,
  secretPresence,
  sha256,
  validateEvidenceShape,
  validatePolicy,
  writeEvidenceReportAtomic,
};
