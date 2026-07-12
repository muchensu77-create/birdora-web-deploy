#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  LegacyInventoryError,
  RUNTIME_IDENTITY_FILES,
  SAFE_ENVIRONMENT_KEYS,
  createEvidenceReport,
  parseProcNetTcp,
  readBoundedRegularFile,
  sameProcNamespace,
  validatePolicy,
  writeEvidenceReportAtomic,
} = require("../deploy/scripts/legacy-inventory-lib");

const PRODUCTION_PREFIXES = Object.freeze([
  "/etc/birdora",
  "/etc/nginx",
  "/opt/node-v24",
  "/usr/local/libexec/birdora",
  "/var/lib/birdora",
  "/var/lib/birdora-control",
  "/var/lib/birdora-protected",
  "/var/lock/birdora",
  "/var/www/birdora-web",
]);
const SANDBOX_ENVIRONMENT = "BIRDORA_LEGACY_LINUX_TEST_SANDBOX";
const STRACE_ENVIRONMENT = "BIRDORA_LEGACY_LINUX_TEST_STRACE_BIN";
const MKFIFO_ENVIRONMENT = "BIRDORA_LEGACY_LINUX_TEST_MKFIFO_BIN";
const FIXTURE_PID = 4242;

function pathOverlapsPrefix(candidate, prefix) {
  return candidate === prefix || candidate.startsWith(`${prefix}/`) || prefix.startsWith(`${candidate}/`);
}

function validateSandbox(value) {
  assert.strictEqual(process.platform, "linux", "Linux is required");
  assert(value && path.posix.isAbsolute(value), `${SANDBOX_ENVIRONMENT} must be absolute`);
  const temporaryRoot = fs.realpathSync("/tmp");
  const resolved = fs.realpathSync(value);
  const stats = fs.lstatSync(resolved, { bigint: true });
  assert(stats.isDirectory() && !stats.isSymbolicLink(), "sandbox must be a real directory");
  assert.strictEqual(path.dirname(resolved), temporaryRoot, "sandbox must be a direct child of /tmp");
  assert(/^birdora-legacy-inventory\.[A-Za-z0-9]+$/u.test(path.basename(resolved)), "sandbox name is invalid");
  assert.strictEqual(Number(stats.mode & 0o7777n), 0o700, "sandbox must use mode 0700");
  for (const prefix of PRODUCTION_PREFIXES) {
    assert(!pathOverlapsPrefix(resolved, prefix), `sandbox overlaps production prefix ${prefix}`);
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
    assert(!pathOverlapsPrefix(candidate, prefix), `test path overlaps production prefix ${prefix}`);
  }
  return candidate;
}

function guardedPath(value, description) {
  assert.strictEqual(typeof value, "string", `${description} must use a string path`);
  assert(!/[\u0000-\u001f\u007f]/u.test(value), `${description} contains control characters`);
  return path.resolve(value);
}

function installFilesystemBoundary(sandbox) {
  const originals = new Map();
  const descriptorPaths = new Map();
  const remember = (name) => {
    const original = fs[name];
    assert.strictEqual(typeof original, "function", `fs.${name} must exist`);
    originals.set(name, original);
    return original;
  };
  const rejectProductionRead = (value, description) => {
    if (typeof value === "number") return;
    const candidate = guardedPath(value, description);
    for (const prefix of PRODUCTION_PREFIXES) {
      assert(!pathOverlapsPrefix(candidate, prefix), `${description} attempted to read production prefix ${prefix}`);
    }
  };
  const requireSandboxMutation = (value, description) => {
    const candidate = guardedPath(value, description);
    assert(
      candidate === sandbox || candidate.startsWith(`${sandbox}${path.sep}`),
      `${description} attempted state outside the sandbox: ${candidate}`
    );
    for (const prefix of PRODUCTION_PREFIXES) {
      assert(!pathOverlapsPrefix(candidate, prefix), `${description} overlaps production prefix ${prefix}`);
    }
  };
  const assertSandboxDescriptor = (descriptor, description) => {
    const openedPath = descriptorPaths.get(descriptor);
    assert(openedPath, `${description} received an untracked descriptor`);
    requireSandboxMutation(openedPath, description);
  };

  for (const name of [
    "accessSync", "existsSync", "lstatSync", "readFileSync", "readlinkSync", "realpathSync", "readdirSync", "statSync",
  ]) {
    const original = remember(name);
    fs[name] = function guardedRead(value, ...args) {
      rejectProductionRead(value, `fs.${name}`);
      return original.call(fs, value, ...args);
    };
  }

  const originalOpen = remember("openSync");
  fs.openSync = function guardedOpen(value, flags, ...args) {
    const numericFlags = typeof flags === "number" ? flags : null;
    const writeMask = fs.constants.O_WRONLY
      | fs.constants.O_RDWR
      | fs.constants.O_CREAT
      | fs.constants.O_TRUNC
      | fs.constants.O_APPEND;
    const writeCapable = numericFlags === null
      ? /[+wax]/u.test(String(flags))
      : (numericFlags & writeMask) !== 0;
    if (writeCapable) requireSandboxMutation(value, "fs.openSync(write)");
    else rejectProductionRead(value, "fs.openSync(read)");
    const descriptor = originalOpen.call(fs, value, flags, ...args);
    descriptorPaths.set(descriptor, guardedPath(value, "fs.openSync"));
    return descriptor;
  };

  const originalClose = remember("closeSync");
  fs.closeSync = function guardedClose(descriptor, ...args) {
    try {
      return originalClose.call(fs, descriptor, ...args);
    } finally {
      descriptorPaths.delete(descriptor);
    }
  };

  for (const name of [
    "appendFileSync", "chmodSync", "chownSync", "mkdirSync", "rmSync", "rmdirSync", "truncateSync", "unlinkSync",
  ]) {
    const original = remember(name);
    fs[name] = function guardedMutation(value, ...args) {
      requireSandboxMutation(value, `fs.${name}`);
      return original.call(fs, value, ...args);
    };
  }

  for (const name of ["copyFileSync", "linkSync", "renameSync"]) {
    const original = remember(name);
    fs[name] = function guardedTwoPathMutation(source, destination, ...args) {
      requireSandboxMutation(source, `fs.${name}(source)`);
      requireSandboxMutation(destination, `fs.${name}(destination)`);
      return original.call(fs, source, destination, ...args);
    };
  }

  const originalSymlink = remember("symlinkSync");
  fs.symlinkSync = function guardedSymlink(target, linkPath, ...args) {
    const resolvedTarget = path.resolve(path.dirname(guardedPath(linkPath, "fs.symlinkSync(link)")), target);
    requireSandboxMutation(resolvedTarget, "fs.symlinkSync(target)");
    requireSandboxMutation(linkPath, "fs.symlinkSync(link)");
    return originalSymlink.call(fs, target, linkPath, ...args);
  };

  const originalWriteFile = remember("writeFileSync");
  fs.writeFileSync = function guardedWriteFile(destination, ...args) {
    if (typeof destination === "number") assertSandboxDescriptor(destination, "fs.writeFileSync(fd)");
    else requireSandboxMutation(destination, "fs.writeFileSync(path)");
    return originalWriteFile.call(fs, destination, ...args);
  };

  for (const name of ["fchmodSync", "fchownSync", "fdatasyncSync", "fsyncSync", "ftruncateSync"]) {
    const original = remember(name);
    fs[name] = function guardedDescriptorMutation(descriptor, ...args) {
      assertSandboxDescriptor(descriptor, `fs.${name}`);
      return original.call(fs, descriptor, ...args);
    };
  }

  return () => {
    for (const [name, original] of originals) fs[name] = original;
  };
}

function assertSanitizedEnvironment() {
  const allowed = new Set([
    "HOME",
    "LANG",
    "LC_ALL",
    "PATH",
    "TMPDIR",
    "TZ",
    SANDBOX_ENVIRONMENT,
    STRACE_ENVIRONMENT,
    MKFIFO_ENVIRONMENT,
  ]);
  const unexpected = Object.keys(process.env).filter((name) => !allowed.has(name));
  assert.deepStrictEqual(unexpected, [], `test environment was not sanitized: ${unexpected.join(",")}`);
  assert.strictEqual(process.env.HOME, path.join(process.env[SANDBOX_ENVIRONMENT], "home"));
  assert.strictEqual(process.env.LANG, "C");
  assert.strictEqual(process.env.LC_ALL, "C");
  assert.strictEqual(process.env.PATH, "/usr/sbin:/usr/bin:/sbin:/bin");
  assert.strictEqual(process.env.TMPDIR, "/tmp");
  assert.strictEqual(process.env.TZ, "UTC");
}

function assertLegacyError(callback, expectedCode) {
  assert.throws(callback, (error) => (
    error instanceof LegacyInventoryError && error.code === expectedCode
  ));
}

function rawPolicy() {
  return {
    formatVersion: 1,
    capturePhase: "live-discovery",
    applicationRoot: "/var/www/birdora-web",
    databaseFile: "/var/lib/birdora/birdora.sqlite",
    dataDirectory: "/var/lib/birdora",
    communityUploadDirectory: "/var/lib/birdora/uploads/community",
    observationUploadDirectory: "/var/lib/birdora/uploads/observations",
    pm2Home: "/root/.pm2",
    siteName: "birdora.birdai-glasses.com",
    listenerPort: 3003,
    expectedWriterAppNames: ["birdora-web-auth"],
    expectedAdjacentAppNames: ["birdora-api", "zhubao-api"],
    maximumMediaFilesPerRoot: 200000,
    maximumReportBytes: 8388608,
    approvedRuntimeIdentityFiles: [...RUNTIME_IDENTITY_FILES],
  };
}

function metadata(type, overrides = {}) {
  return {
    exists: true,
    type,
    canonicalMatchesRequested: true,
    uid: "0",
    gid: "0",
    mode: type === "directory" ? 0o700 : 0o600,
    nlink: "1",
    device: "2049",
    inode: "10001",
    bytes: "0",
    mtimeNs: "1700000000000000000",
    ctimeNs: "1700000000000000000",
    groupOrOtherWritable: false,
    ...overrides,
  };
}

function missingMetadata() {
  return { exists: false, type: "missing" };
}

function sensitivePresence() {
  return {
    jwtOrSessionSecret: false,
    tokenOrCredential: false,
    password: false,
    cookieOrAuthorization: false,
    privateKey: false,
  };
}

function safeKeys() {
  return Object.fromEntries(SAFE_ENVIRONMENT_KEYS.map((key) => [key, {
    present: true,
    matchesExpected: true,
  }]));
}

function processEnvironment() {
  return {
    recordCount: SAFE_ENVIRONMENT_KEYS.length,
    malformedRecordCount: 0,
    unknownKeyCount: 0,
    dangerousRuntimeKeyPresent: false,
    safeKeys: safeKeys(),
    sensitivePresence: sensitivePresence(),
    valuesExported: false,
  };
}

function pm2Environment() {
  return {
    recordCount: SAFE_ENVIRONMENT_KEYS.length,
    malformed: false,
    unknownKeyCount: 0,
    dangerousRuntimeKeyPresent: false,
    safeKeys: safeKeys(),
    sensitivePresence: sensitivePresence(),
    valuesExported: false,
  };
}

function processProjection() {
  return {
    pid: FIXTURE_PID,
    processDirectoryDevice: "2049",
    processDirectoryInode: "20001",
    startTimeTicks: "987654",
    parentPid: 1,
    state: "S",
    identity: { uid: "1001", effectiveUid: "1001", gid: "1001", effectiveGid: "1001" },
    executableClass: "managed-node-v24",
    workingDirectoryClass: "application-root",
    command: {
      argumentCount: 2,
      approvedEntrypointIsExecutedScript: true,
      secretLikeArgumentPresent: false,
      rawArgumentsExported: false,
    },
    environment: processEnvironment(),
  };
}

function mediaSummary(inode) {
  return {
    root: metadata("directory", { inode }),
    fileCount: 2,
    directoryCount: 1,
    totalBytes: "4096",
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
}

function physicalRoot(inode, depths) {
  return {
    metadata: metadata("directory", { inode }),
    physicalDirectory: true,
    ancestors: depths.map((depthFromRoot, index) => ({
      depthFromRoot,
      metadata: metadata("directory", { inode: `${inode}${index}` }),
    })),
  };
}

function pm2DumpProjection() {
  return {
    validJsonArray: true,
    processCount: 1,
    approvedProcessCount: 1,
    unexpectedProcessCount: 0,
    writerProcessCount: 1,
    adjacentProcessCount: 0,
    processes: [{
      malformed: false,
      approvedName: true,
      approvedNameValue: "birdora-web-auth",
      writerName: true,
      adjacentName: false,
      statusClass: "online",
      workingDirectoryClass: "application-root",
      executionPathApproved: true,
      environment: pm2Environment(),
    }],
    rawDumpExported: false,
    rawDumpDigestExported: false,
  };
}

function validEvidence() {
  const selectedProjection = pm2DumpProjection();
  const runtimeProcess = processProjection();
  const projection = {
    host: {
      platform: "linux",
      architecture: "x64",
      kernelRelease: "6.8.0-fixture",
      bootId: "123e4567-e89b-12d3-a456-426614174000",
      rootUid: true,
      hostPidNamespace: true,
      hostMountNamespace: true,
      hostNetworkNamespace: true,
      hostUserNamespace: true,
      initProcessClass: "systemd-or-init",
      containerMarkersPresent: false,
      hostEnvironmentCandidate: true,
    },
    listeners: [{
      family: "ipv4",
      addressClass: "loopback",
      port: 3003,
      state: "LISTEN",
      socketInode: "34567",
      ownerPids: [FIXTURE_PID],
    }],
    processes: [runtimeProcess],
    database: {
      path: metadata("file", { inode: "30001", bytes: "8192" }),
      sqliteConnectionOpened: false,
      logicalState: "not_inspected",
      headerRead: false,
      schemaRead: false,
      rowsRead: false,
      sidecars: { wal: missingMetadata(), shm: missingMetadata(), journal: missingMetadata() },
      openers: [{
        process: runtimeProcess,
        descriptorCount: 1,
        accessModes: ["read-write"],
        writableDescriptorPresent: true,
      }],
    },
    uploads: { community: mediaSummary("40001"), observation: mediaSummary("40002") },
    pm2: {
      home: metadata("directory", { inode: "50001" }),
      homeTrusted: true,
      primary: {
        metadata: metadata("file", { inode: "50002", bytes: "2048" }),
        usable: true,
        projection: selectedProjection,
      },
      backup: { metadata: missingMetadata(), usable: false, projection: null },
      selected: "primary",
      selectedProjection: JSON.parse(JSON.stringify(selectedProjection)),
      cliUsed: false,
      rpcConnected: false,
      rawDumpExported: false,
    },
    nginx: {
      available: { metadata: metadata("file", { inode: "60001", mode: 0o644 }), readable: true },
      enabled: { metadata: metadata("symlink", { inode: "60002", mode: 0o777 }), readable: false },
      enabledSymlinkTargetsAvailable: true,
      diskProjection: {
        configuredServerNamePresent: true,
        loopbackProxyPresent: true,
        wildcardApplicationProxyPresent: false,
        tlsListenerPresent: true,
        configurationBytes: 1024,
        rawConfigurationExported: false,
        configurationDigestExported: false,
      },
      selectedDiskSource: "available-file",
      activeRuntimeState: "not_inspected",
      configurationTestExecuted: false,
      serviceStateChanged: false,
    },
    runtimeSource: {
      root: metadata("directory", { inode: "70001", mode: 0o755 }),
      rootTrusted: true,
      identityFiles: RUNTIME_IDENTITY_FILES.map((name, index) => ({
        name,
        metadata: metadata("file", { inode: String(70010 + index), mode: 0o644, bytes: "1024" }),
        sha256: String(index + 1).repeat(64),
      })),
      identityFileSetComplete: true,
      gitMetadata: missingMetadata(),
      gitCommandExecuted: false,
      claimedRevision: null,
    },
    controlState: {
      activationPending: missingMetadata(),
      currentRelease: missingMetadata(),
      runtimePointer: missingMetadata(),
      releaseRoot: missingMetadata(),
      publicPointer: missingMetadata(),
      publicReleaseRoot: missingMetadata(),
      maintenanceFlag: missingMetadata(),
      databaseLock: missingMetadata(),
      deploymentLock: missingMetadata(),
      managedStatePresent: false,
      filesParsed: false,
    },
    filesystem: {
      fixedPathsOnly: true,
      application: physicalRoot("80001", [0, 1, 2]),
      data: physicalRoot("80002", [0, 1, 2]),
      pm2: physicalRoot("80003", [0, 1]),
    },
    inventoryMetrics: {
      processCount: 64,
      inspectedDescriptorCount: 512,
      transientProcessRaceCount: 0,
      transientDescriptorRaceCount: 0,
      descriptorScanComplete: true,
    },
  };
  return createEvidenceReport(validatePolicy(rawPolicy()), { projection }, {
    startedAt: "2026-07-12T01:00:00.000Z",
    completedAt: "2026-07-12T01:00:01.000Z",
    attempts: 1,
  });
}

function testSecureReaderSemantics(sandbox) {
  const source = withinSandbox(sandbox, "reader-source.txt");
  const symlink = withinSandbox(sandbox, "reader-symlink.txt");
  const hardlink = withinSandbox(sandbox, "reader-hardlink.txt");
  const fifo = withinSandbox(sandbox, "reader-fifo");
  fs.writeFileSync(source, "metadata-only-fixture\n", { flag: "wx", mode: 0o600 });
  fs.chmodSync(source, 0o600);

  fs.symlinkSync(source, symlink);
  assertLegacyError(
    () => readBoundedRegularFile(symlink, 1024, {
      description: "Linux symlink fixture",
      requireLinuxSecurityBoundary: true,
    }),
    "LEGACY_INVENTORY_FILE_OPEN_FAILED"
  );

  fs.linkSync(source, hardlink);
  assertLegacyError(
    () => readBoundedRegularFile(source, 1024, {
      description: "Linux hardlink fixture",
      requireLinuxSecurityBoundary: true,
    }),
    "LEGACY_INVENTORY_UNSAFE_FILE"
  );
  fs.unlinkSync(hardlink);

  const mkfifo = process.env[MKFIFO_ENVIRONMENT];
  assert(mkfifo && path.isAbsolute(mkfifo), "mkfifo must be an absolute executable path");
  const fifoCreated = spawnSync(mkfifo, [fifo], {
    env: cleanChildEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 2000,
  });
  assert.strictEqual(fifoCreated.status, 0, "mkfifo fixture creation must succeed");
  const fifoRead = spawnSync(process.execPath, [__filename, "--fifo-read-fixture", fifo], {
    env: cleanChildEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 2000,
  });
  assert.strictEqual(fifoRead.error, undefined, "FIFO read guard must not block until timeout");
  assert.strictEqual(fifoRead.status, 0, "FIFO read guard must reject the special file safely");
  fs.unlinkSync(fifo);

  fs.chmodSync(source, 0o640);
  assertLegacyError(
    () => readBoundedRegularFile(source, 1024, {
      description: "Linux mode fixture",
      maximumMode: 0o600,
      requireLinuxSecurityBoundary: true,
    }),
    "LEGACY_INVENTORY_UNSAFE_FILE"
  );
  fs.chmodSync(source, 0o600);

  const rootOwnedOptions = {
    description: "Linux root ownership fixture",
    requireRootOwnership: true,
    maximumMode: 0o600,
    rejectGroupOrOtherWrite: true,
    requireLinuxSecurityBoundary: true,
  };
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    assert.strictEqual(readBoundedRegularFile(source, 1024, rootOwnedOptions).bytes.toString("utf8"), "metadata-only-fixture\n");
    return "root-owned-reader-pass";
  }
  assertLegacyError(
    () => readBoundedRegularFile(source, 1024, rootOwnedOptions),
    "LEGACY_INVENTORY_UNSAFE_FILE"
  );
  assert.strictEqual(
    readBoundedRegularFile(source, 1024, {
      description: "Linux mode fixture",
      maximumMode: 0o600,
      rejectGroupOrOtherWrite: true,
      requireLinuxSecurityBoundary: true,
    }).bytes.toString("utf8"),
    "metadata-only-fixture\n"
  );
  return "non-root-rejection-pass";
}

function testAtomicReportSemantics(sandbox) {
  const outputDirectory = withinSandbox(sandbox, "reports");
  fs.mkdirSync(outputDirectory, { mode: 0o700 });
  fs.chmodSync(outputDirectory, 0o700);
  const evidence = validEvidence();
  const policy = validatePolicy(rawPolicy());
  const originalFsync = fs.fsyncSync;
  let directoryFsyncs = 0;
  fs.fsyncSync = (descriptor) => {
    if (fs.fstatSync(descriptor).isDirectory()) directoryFsyncs += 1;
    return originalFsync(descriptor);
  };
  let result;
  try {
    result = writeEvidenceReportAtomic(evidence, policy, {
      outputDirectory,
      unitTestDirectory: true,
    });
  } finally {
    fs.fsyncSync = originalFsync;
  }

  assert(directoryFsyncs >= 1, "atomic report commit must fsync its directory");
  const reportPath = withinSandbox(outputDirectory, result.fileName);
  const firstBytes = fs.readFileSync(reportPath);
  const stats = fs.lstatSync(reportPath, { bigint: true });
  assert(stats.isFile() && !stats.isSymbolicLink(), "report must be a regular non-symlink file");
  assert.strictEqual(stats.nlink, 1n, "report must have one link");
  assert.strictEqual(Number(stats.mode & 0o7777n), 0o600, "report must use mode 0600");
  assert.strictEqual(stats.uid, BigInt(process.getuid()), "report owner must match the isolated test identity");
  assert.strictEqual(stats.gid, BigInt(process.getgid()), "report group must match the isolated test identity");

  assertLegacyError(
    () => writeEvidenceReportAtomic(evidence, policy, { outputDirectory, unitTestDirectory: true }),
    "LEGACY_INVENTORY_OUTPUT_UNSAFE"
  );
  assert.deepStrictEqual(fs.readFileSync(reportPath), firstBytes, "no-overwrite failure must preserve the committed report");
  assert.deepStrictEqual(
    fs.readdirSync(outputDirectory).filter((name) => name.endsWith(".tmp")),
    [],
    "no-overwrite failure must not leave temporary files"
  );
}

function testRealProcParserCompatibility() {
  const ipv4 = parseProcNetTcp(fs.readFileSync("/proc/net/tcp"), "ipv4", 3003);
  const ipv6 = parseProcNetTcp(fs.readFileSync("/proc/net/tcp6"), "ipv6", 3003);
  for (const listener of [...ipv4, ...ipv6]) {
    assert.strictEqual(listener.port, 3003);
    assert.strictEqual(listener.state, "LISTEN");
    assert(/^[0-9]+$/u.test(listener.socketInode));
    assert(["loopback", "wildcard", "other"].includes(listener.addressClass));
  }

  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  const fixture = `${header}\n0: 0100007F:0BBB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 34567 1\n`;
  assert.deepStrictEqual(parseProcNetTcp(fixture, "ipv4", 3003), [{
    family: "ipv4",
    addressClass: "loopback",
    port: 3003,
    state: "LISTEN",
    socketInode: "34567",
  }]);
  return { ipv4Matches: ipv4.length, ipv6Matches: ipv6.length };
}

function testNamespaceIdentitySemantics() {
  const sameAsPid1 = {};
  for (const kind of ["pid", "mnt", "net", "user"]) {
    const selfNamespace = fs.readlinkSync(`/proc/self/ns/${kind}`);
    const initNamespace = fs.readlinkSync(`/proc/1/ns/${kind}`);
    assert.strictEqual(sameProcNamespace(selfNamespace, selfNamespace, kind), true, `${kind} namespace format is unsupported`);
    sameAsPid1[kind] = sameProcNamespace(selfNamespace, initNamespace, kind);
  }

  assert.strictEqual(sameProcNamespace("net:[4026531000]", "net:[4026531001]", "net"), false);
  assert.strictEqual(sameProcNamespace("user:[4026531000]", "user:[4026531001]", "user"), false);
  assert.strictEqual(sameProcNamespace("mnt:[4026531000]", "net:[4026531000]", "mnt"), false);
  assert.strictEqual(sameProcNamespace("net:[0]", "net:[0]", "net"), false);
  assert.strictEqual(sameProcNamespace("malformed", "malformed", "user"), false);

  return {
    sameAsPid1,
    mismatchedNetworkRejected: true,
    mismatchedUserRejected: true,
    wrongKindRejected: true,
    malformedIdentityRejected: true,
  };
}

function cleanChildEnvironment() {
  const environment = {
    HOME: process.env.HOME,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/sbin:/usr/bin:/sbin:/bin",
    TMPDIR: "/tmp",
    TZ: "UTC",
    [SANDBOX_ENVIRONMENT]: process.env[SANDBOX_ENVIRONMENT],
    [MKFIFO_ENVIRONMENT]: process.env[MKFIFO_ENVIRONMENT],
  };
  if (process.env[STRACE_ENVIRONMENT]) environment[STRACE_ENVIRONMENT] = process.env[STRACE_ENVIRONMENT];
  return environment;
}

function runStraceReadAudit(sandbox) {
  const strace = process.env[STRACE_ENVIRONMENT];
  if (!strace) return { used: false, reason: "strace-not-installed" };
  assert(path.isAbsolute(strace), "strace must be an absolute executable path");
  fs.accessSync(strace, fs.constants.X_OK);
  const fixture = withinSandbox(sandbox, "strace-read-fixture.txt");
  const trace = withinSandbox(sandbox, "strace-read-fixture.log");
  fs.writeFileSync(fixture, "strace-metadata-read\n", { flag: "wx", mode: 0o600 });
  fs.chmodSync(fixture, 0o600);
  const result = spawnSync(strace, [
    "-f",
    "-qq",
    "-s",
    "4096",
    "-o",
    trace,
    "-e",
    "trace=%file,%network",
    "--",
    process.execPath,
    __filename,
    "--strace-read-fixture",
    fixture,
  ], {
    env: cleanChildEnvironment(),
    encoding: "utf8",
    stdio: ["ignore", "ignore", "pipe"],
    timeout: 10000,
  });
  if (result.error || result.status !== 0 || !fs.existsSync(trace)) {
    return { used: false, reason: "strace-present-but-unavailable" };
  }
  const traceText = readBoundedRegularFile(trace, 8 * 1024 * 1024, {
    description: "isolated strace output",
    maximumMode: 0o600,
    rejectGroupOrOtherWrite: true,
    requireLinuxSecurityBoundary: true,
  }).bytes.toString("utf8");
  assert(traceText.length > 0, "strace output must be non-empty");
  assert(traceText.includes(fixture), "strace must observe the isolated fixture read");
  assert(!/\b(?:socket|socketpair|connect|bind|listen|accept|accept4|sendto|recvfrom|sendmsg|recvmsg)\(/u.test(traceText), "read fixture must not use network syscalls");
  assert(!/\b(?:unlink|unlinkat|rename|renameat|renameat2|mkdir|mkdirat|rmdir|chmod|fchmod|fchmodat|chown|fchown|fchownat|truncate|ftruncate|link|linkat|symlink|symlinkat|mknod|mknodat|mount|umount2)\(/u.test(traceText), "read fixture must not use filesystem mutation syscalls");
  for (const line of traceText.split("\n")) {
    if (!/\bopen(?:at|at2)?\(/u.test(line)) continue;
    assert(!/\bO_(?:WRONLY|RDWR|CREAT|TRUNC|APPEND|TMPFILE)\b/u.test(line), `read fixture used a write-capable open: ${line}`);
  }
  for (const prefix of PRODUCTION_PREFIXES) {
    assert(!traceText.includes(`\"${prefix}`), `strace observed access to production prefix ${prefix}`);
  }
  return { used: true, reason: "syscall-audit-passed" };
}

function runReadFixtureHelper(sandbox, fixture) {
  assertSanitizedEnvironment();
  const resolvedSandbox = validateSandbox(sandbox);
  const resolvedFixture = withinSandbox(resolvedSandbox, path.relative(resolvedSandbox, path.resolve(fixture)));
  assert.strictEqual(resolvedFixture, path.resolve(fixture), "strace fixture must remain in the sandbox");
  const result = readBoundedRegularFile(resolvedFixture, 1024, {
    description: "strace metadata/read fixture",
    maximumMode: 0o600,
    rejectGroupOrOtherWrite: true,
    requireLinuxSecurityBoundary: true,
  });
  assert.strictEqual(result.bytes.toString("utf8"), "strace-metadata-read\n");
}

function runFifoFixtureHelper(sandbox, fixture) {
  assertSanitizedEnvironment();
  const resolvedSandbox = validateSandbox(sandbox);
  const resolvedFixture = withinSandbox(resolvedSandbox, path.relative(resolvedSandbox, path.resolve(fixture)));
  assert.strictEqual(resolvedFixture, path.resolve(fixture), "FIFO fixture must remain in the sandbox");
  assertLegacyError(() => readBoundedRegularFile(resolvedFixture, 1024, {
    description: "FIFO nonblocking fixture",
    requireLinuxSecurityBoundary: true,
  }), "LEGACY_INVENTORY_UNSAFE_FILE");
}

function main() {
  assertSanitizedEnvironment();
  const sandbox = validateSandbox(process.env[SANDBOX_ENVIRONMENT]);
  const restoreFilesystemBoundary = installFilesystemBoundary(sandbox);
  try {
    if (process.argv[2] === "--strace-read-fixture") {
      assert.strictEqual(process.argv.length, 4, "strace helper accepts exactly one fixture path");
      runReadFixtureHelper(sandbox, process.argv[3]);
      return;
    }
    if (process.argv[2] === "--fifo-read-fixture") {
      assert.strictEqual(process.argv.length, 4, "FIFO helper accepts exactly one fixture path");
      runFifoFixtureHelper(sandbox, process.argv[3]);
      return;
    }
    assert.strictEqual(process.argv.length, 2, "Linux legacy inventory semantics test accepts no arguments");

    const readerOwnership = testSecureReaderSemantics(sandbox);
    testAtomicReportSemantics(sandbox);
    const proc = testRealProcParserCompatibility();
    const namespaces = testNamespaceIdentitySemantics();
    const strace = runStraceReadAudit(sandbox);
    const unverified = [
      "complete-fixed-path-collector",
      "pm2-and-nginx-live-state",
      "real-production-database-zero-side-effect",
      "host-namespace-boundary",
    ];
    if (!strace.used) unverified.push("strace-syscall-audit");
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      status: "PASS",
      platform: "Linux",
      sandboxPolicy: "fresh-direct-child-of-/tmp-only",
      tests: [
        "filesystem-production-prefix-and-sandbox-write-guard",
        "O_NOFOLLOW-symlink-rejection",
        "single-link-reader-rejection",
        "nonblocking-special-file-rejection",
        "root-and-mode-reader-semantics",
        "atomic-report-0600-nlink1-no-overwrite-directory-fsync",
        "real-proc-net-tcp-format",
        "pid1-network-and-user-namespace-negative-fixtures",
      ],
      readerOwnership,
      proc,
      namespaces,
      strace,
      unverified,
    })}\n`);
  } finally {
    restoreFilesystemBoundary();
  }
}

main();
