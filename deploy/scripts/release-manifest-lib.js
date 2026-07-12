"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const APPLICATION = "birdora-web";
const FORMAT_VERSION = 1;
const MANIFEST_NAME = ".birdora-release-manifest.json";
const SIGNATURE_NAME = ".birdora-release-manifest.sig";
const REQUIRED_FILES = Object.freeze([
  ".birdora-build-evidence.json",
  "app/db/migrations/001-baseline.js",
  "app/db/migrations/002-legacy-retirement.js",
  "deploy/nginx/birdora-https.conf",
  "deploy/nginx/birdora-pre-cert.conf",
  "ecosystem.config.cjs",
  "node_modules/.modules.yaml",
  "package.json",
  "pnpm-lock.yaml",
  "scripts/backup-database.js",
  "scripts/assert-runtime-data-access.js",
  "scripts/database-preflight.js",
  "scripts/migrate-database.js",
  "server.js",
]);

function fail(message, code = "INVALID_RELEASE_ARTIFACT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function validateRelativePath(relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath.length === 0
    || relativePath.length > 4096
    || relativePath.includes("\\")
    || relativePath.includes("\0")
    || /[\u0000-\u001f\u007f]/u.test(relativePath)
    || path.posix.isAbsolute(relativePath)
  ) {
    fail(`release manifest contains an unsafe path: ${JSON.stringify(relativePath)}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`release manifest contains an unsafe path segment: ${JSON.stringify(relativePath)}`);
  }
  return relativePath;
}

function isExcluded(relativePath) {
  return relativePath === MANIFEST_NAME || relativePath === SIGNATURE_NAME;
}

function assertNoReleaseSecret(relativePath) {
  const basename = path.posix.basename(relativePath).toLowerCase();
  if (
    basename === ".env"
    || (basename.startsWith(".env.") && basename !== ".env.example")
    || basename === "id_rsa"
    || basename === "id_ed25519"
    || basename === ".npmrc"
    || basename === ".netrc"
    || basename === ".pypirc"
    || basename === "credentials"
    || basename === "credentials.json"
    || basename === "service-account.json"
    || basename.endsWith(".p12")
    || basename.endsWith(".pfx")
    || basename.endsWith(".key")
  ) {
    fail(`release artifact contains a forbidden secret-bearing path: ${relativePath}`);
  }
  if (relativePath === ".git" || relativePath.startsWith(".git/")) {
    fail("release artifact must not contain Git metadata");
  }
}

function assertNoEmbeddedPrivateKey(filePath, relativePath, stats) {
  if (!stats.isFile() || stats.size === 0 || stats.size > 1024 * 1024) return;
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(descriptor);
    if (opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size) {
      fail(`release file changed during private-key scan: ${relativePath}`);
    }
    const contents = fs.readFileSync(descriptor, "utf8");
    if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u.test(contents)) {
      fail(`release artifact contains embedded private key material: ${relativePath}`);
    }
  } finally {
    fs.closeSync(descriptor);
  }
}

function sha256File(filePath, expectedStats = null) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1) fail(`release hash target is not a regular single-link file: ${filePath}`);
    if (expectedStats && (
      stats.dev !== expectedStats.dev
      || stats.ino !== expectedStats.ino
      || stats.size !== expectedStats.size
      || (stats.mode & 0o7777) !== (expectedStats.mode & 0o7777)
    )) {
      fail(`release file changed between directory scan and secure open: ${filePath}`);
    }
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function sha256Buffer(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readBoundedRegularFile(filePath, maximumBytes, options = {}) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stats = fs.fstatSync(descriptor);
    if (!stats.isFile() || stats.nlink !== 1) fail(`control file is not regular/single-link: ${filePath}`);
    if (stats.size <= 0 || stats.size > maximumBytes) fail(`control file size is invalid: ${filePath}`);
    if (options.requireRootOwnership && typeof stats.uid === "number" && stats.uid !== 0) {
      fail(`control file is not owned by root: ${filePath}`);
    }
    if (options.requireNoGroupOrOtherWrite && (stats.mode & 0o022) !== 0) {
      fail(`control file is writable by group or other users: ${filePath}`);
    }
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function assertEntrySecurity(absolutePath, relativePath, stats, options) {
  if (stats.isSymbolicLink()) {
    fail(`release artifact contains a symbolic link: ${relativePath || "."}`);
  }
  if (!stats.isDirectory() && !stats.isFile()) {
    fail(`release artifact contains a special filesystem entry: ${relativePath || "."}`);
  }
  if ((stats.mode & 0o7000) !== 0) {
    fail(`release entry contains setuid, setgid, or sticky permission bits: ${relativePath || "."}`);
  }
  if (stats.isFile() && options.requireSingleLink !== false && stats.nlink !== 1) {
    fail(`release artifact contains a hard-linked file: ${relativePath}`);
  }
  if (options.requireRootOwnership && typeof stats.uid === "number" && stats.uid !== 0) {
    fail(`release entry is not owned by root: ${relativePath || "."}`);
  }
  if (options.requireNoGroupOrOtherWrite && (stats.mode & 0o022) !== 0) {
    fail(`release entry is writable by group or other users: ${relativePath || "."}`);
  }
  if (options.requireRuntimeReadable && process.platform === "linux") {
    if (stats.isDirectory() && (stats.mode & 0o005) !== 0o005) {
      fail(`runtime user cannot traverse release directory: ${relativePath || "."}`);
    }
    if (stats.isFile() && (stats.mode & 0o004) === 0) {
      fail(`runtime user cannot read release file: ${relativePath}`);
    }
  }
}

function scanRelease(releaseDirectory, options = {}) {
  const root = path.resolve(releaseDirectory);
  const rootStats = fs.lstatSync(root);
  assertEntrySecurity(root, "", rootStats, options);
  if (!rootStats.isDirectory()) fail(`release root is not a directory: ${root}`);

  const files = [];
  function walk(directory) {
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = validateRelativePath(toPortablePath(path.relative(root, absolutePath)));
      const stats = fs.lstatSync(absolutePath);
      assertEntrySecurity(absolutePath, relativePath, stats, options);
      assertNoReleaseSecret(relativePath);
      if (stats.isDirectory()) {
        walk(absolutePath);
      } else if (!isExcluded(relativePath)) {
        assertNoEmbeddedPrivateKey(absolutePath, relativePath, stats);
        files.push({
          path: relativePath,
          bytes: stats.size,
          mode: stats.mode & 0o777,
          sha256: sha256File(absolutePath, stats),
        });
      }
    }
  }
  walk(root);
  files.sort((left, right) => compareStrings(left.path, right.path));
  return { root, files };
}

function validateRevision(revision) {
  if (typeof revision !== "string" || !/^[0-9a-f]{40}$/u.test(revision)) {
    fail("release revision must be an exact lowercase 40-character Git commit", "INVALID_RELEASE_REVISION");
  }
  return revision;
}

function validateRequiredFiles(files) {
  const paths = new Set(files.map((file) => file.path));
  for (const requiredPath of REQUIRED_FILES) {
    if (!paths.has(requiredPath)) fail(`release artifact is missing required file: ${requiredPath}`);
  }
}

function validateBuildEvidence({
  root,
  revision,
  lockfileSha256,
  expectedSha256 = null,
  expectedPnpmVersion,
}) {
  const evidencePath = path.join(root, ".birdora-build-evidence.json");
  const evidenceBytes = readBoundedRegularFile(evidencePath, 1024 * 1024);
  const evidenceSha256 = sha256Buffer(evidenceBytes);
  if (expectedSha256 && evidenceSha256 !== expectedSha256) {
    fail("release build evidence checksum differs from signed manifest");
  }
  let buildEvidence;
  try {
    buildEvidence = JSON.parse(evidenceBytes.toString("utf8"));
  } catch {
    fail("release build evidence is not valid JSON");
  }
  const requiredEvidenceCommands = new Set(["pnpm test", "pnpm test:atlas", "pnpm audit --prod"]);
  if (
    buildEvidence.formatVersion !== 1
    || buildEvidence.revision !== revision
    || buildEvidence.passed !== true
    || buildEvidence.pnpmVersion !== expectedPnpmVersion
    || buildEvidence.lockfileSha256 !== lockfileSha256
    || !Array.isArray(buildEvidence.commands)
    || buildEvidence.commands.some((command) => command.exitCode !== 0)
    || ![...requiredEvidenceCommands].every((name) => buildEvidence.commands.some((command) => command.name === name))
  ) {
    fail("release build evidence is missing, failed, or belongs to another revision/lockfile");
  }
  return { buildEvidence, evidenceSha256 };
}

function createManifest({ releaseDirectory, revision, createdAt = new Date().toISOString() }) {
  const normalizedRevision = validateRevision(revision);
  const { root, files } = scanRelease(releaseDirectory, { requireSingleLink: true });
  validateRequiredFiles(files);
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const packageManager = String(packageJson.packageManager || "");
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(packageManager)) {
    fail("release package.json must pin an exact pnpm version");
  }
  const expectedPnpmVersion = packageManager.slice("pnpm@".length);
  const controllerProtocolVersion = packageJson.birdoraDeployment?.controllerProtocolVersion;
  if (controllerProtocolVersion !== 1) {
    fail("release package.json declares an unsupported deployment controller protocol");
  }
  const lockfileSha256 = sha256File(path.join(root, "pnpm-lock.yaml"));
  const { evidenceSha256 } = validateBuildEvidence({
    root,
    revision: normalizedRevision,
    lockfileSha256,
    expectedPnpmVersion,
  });
  const manifest = {
    formatVersion: FORMAT_VERSION,
    application: APPLICATION,
    revision: normalizedRevision,
    createdAt,
    packageVersion: packageJson.version,
    nodeEngine: packageJson.engines?.node || null,
    packageManager,
    controllerProtocolVersion,
    lockfileSha256,
    buildEvidenceSha256: evidenceSha256,
    fileCount: files.length,
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
    files,
  };
  return { root, manifest };
}

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    fail("release manifest must be one JSON object");
  }
  if (manifest.formatVersion !== FORMAT_VERSION || manifest.application !== APPLICATION) {
    fail("release manifest format or application identity is unsupported");
  }
  validateRevision(manifest.revision);
  if (!/^[0-9a-f]{64}$/u.test(manifest.lockfileSha256 || "")) fail("release manifest lockfile checksum is invalid");
  if (!/^[0-9a-f]{64}$/u.test(manifest.buildEvidenceSha256 || "")) fail("release manifest evidence checksum is invalid");
  if (!/^pnpm@\d+\.\d+\.\d+$/u.test(manifest.packageManager || "")) fail("release manifest package manager is invalid");
  if (manifest.controllerProtocolVersion !== 1) fail("release deployment controller protocol is unsupported");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail("release manifest has no files");
  }
  let previousPath = "";
  let totalBytes = 0;
  const seen = new Set();
  for (const file of manifest.files) {
    if (!file || typeof file !== "object" || Array.isArray(file)) fail("release manifest file entry is invalid");
    validateRelativePath(file.path);
    assertNoReleaseSecret(file.path);
    if (isExcluded(file.path)) fail(`release manifest must not hash its control file: ${file.path}`);
    if (seen.has(file.path) || (previousPath && compareStrings(previousPath, file.path) >= 0)) {
      fail(`release manifest paths are duplicated or unsorted: ${file.path}`);
    }
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0) fail(`invalid release file size: ${file.path}`);
    if (!Number.isSafeInteger(file.mode) || file.mode < 0 || file.mode > 0o777) {
      fail(`invalid release file mode: ${file.path}`);
    }
    if (typeof file.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(file.sha256)) {
      fail(`invalid release file checksum: ${file.path}`);
    }
    seen.add(file.path);
    previousPath = file.path;
    totalBytes += file.bytes;
  }
  if (manifest.fileCount !== manifest.files.length || manifest.totalBytes !== totalBytes) {
    fail("release manifest file count or byte total is inconsistent");
  }
  validateRequiredFiles(manifest.files);
  const filesByPath = new Map(manifest.files.map((file) => [file.path, file]));
  if (filesByPath.get("pnpm-lock.yaml")?.sha256 !== manifest.lockfileSha256) {
    fail("release manifest lockfile field differs from its signed file entry");
  }
  if (filesByPath.get(".birdora-build-evidence.json")?.sha256 !== manifest.buildEvidenceSha256) {
    fail("release manifest evidence field differs from its signed file entry");
  }
}

function verifyRelease({
  releaseDirectory,
  publicKeyPath,
  requireRootOwnership = true,
  requireNoGroupOrOtherWrite = true,
}) {
  const root = path.resolve(releaseDirectory);
  const manifestPath = path.join(root, MANIFEST_NAME);
  const signaturePath = path.join(root, SIGNATURE_NAME);
  const controlOptions = { requireRootOwnership, requireNoGroupOrOtherWrite };
  const manifestBytes = readBoundedRegularFile(manifestPath, 64 * 1024 * 1024, controlOptions);
  const signature = readBoundedRegularFile(signaturePath, 16 * 1024, controlOptions);
  const publicKey = readBoundedRegularFile(publicKeyPath, 1024 * 1024, controlOptions);
  if (!crypto.verify("sha256", manifestBytes, publicKey, signature)) {
    fail("release manifest signature is invalid", "INVALID_RELEASE_SIGNATURE");
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    fail("release manifest is not valid JSON");
  }
  validateManifest(manifest);
  const scanned = scanRelease(root, {
    requireSingleLink: true,
    requireRootOwnership,
    requireNoGroupOrOtherWrite,
    requireRuntimeReadable: true,
  });
  if (scanned.files.length !== manifest.files.length) {
    fail(`release file set differs from signed manifest: expected=${manifest.files.length} actual=${scanned.files.length}`);
  }
  for (let index = 0; index < manifest.files.length; index += 1) {
    const expected = manifest.files[index];
    const actual = scanned.files[index];
    if (
      actual.path !== expected.path
      || actual.bytes !== expected.bytes
      || actual.mode !== expected.mode
      || actual.sha256 !== expected.sha256
    ) {
      fail(`release file differs from signed manifest: ${expected.path}`);
    }
  }
  const actualLockfileSha256 = sha256File(path.join(root, "pnpm-lock.yaml"));
  if (manifest.lockfileSha256 !== actualLockfileSha256) {
    fail("release lockfile checksum differs from manifest");
  }
  const actualPackageJson = JSON.parse(readBoundedRegularFile(
    path.join(root, "package.json"),
    1024 * 1024,
    controlOptions
  ).toString("utf8"));
  if (
    actualPackageJson.packageManager !== manifest.packageManager
    || actualPackageJson.version !== manifest.packageVersion
    || (actualPackageJson.engines?.node || null) !== manifest.nodeEngine
    || actualPackageJson.birdoraDeployment?.controllerProtocolVersion !== manifest.controllerProtocolVersion
  ) {
    fail("release package metadata differs from signed manifest fields");
  }
  validateBuildEvidence({
    root,
    revision: manifest.revision,
    lockfileSha256: actualLockfileSha256,
    expectedSha256: manifest.buildEvidenceSha256,
    expectedPnpmVersion: manifest.packageManager.slice("pnpm@".length),
  });
  return {
    ok: true,
    releaseDirectory: root,
    revision: manifest.revision,
    packageVersion: manifest.packageVersion,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    manifestSha256: sha256Buffer(manifestBytes),
    signatureSha256: sha256Buffer(signature),
    controllerProtocolVersion: manifest.controllerProtocolVersion,
  };
}

module.exports = {
  APPLICATION,
  FORMAT_VERSION,
  MANIFEST_NAME,
  REQUIRED_FILES,
  SIGNATURE_NAME,
  createManifest,
  readBoundedRegularFile,
  sha256Buffer,
  sha256File,
  validateManifest,
  validateBuildEvidence,
  verifyRelease,
};
