"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const {
  ALLOWED_AUTOMATED_STATES,
  LegacyInventoryError,
  RUNTIME_IDENTITY_FILES,
  SAFE_ENVIRONMENT_KEYS,
  assertEvidenceRedacted,
  commandLineProjection,
  createEvidenceReport,
  environmentProjection,
  evaluateEvidence,
  parseJsonObject,
  parseMountInfo,
  projectNginxConfiguration,
  parseProcNetTcp,
  sameProcNamespace,
  sanitizePm2Process,
  validateEvidenceShape,
  validatePolicy,
  writeEvidenceReportAtomic,
} = require("../deploy/scripts/legacy-inventory-lib");
const {
  MAX_EVIDENCE_BYTES,
  evaluateEvidenceFile,
  readEvidenceFile,
  resolveLocalEvidencePath,
  run,
} = require("./evaluate-legacy-adoption-evidence");

const projectRoot = path.resolve(__dirname, "..");
const FIXTURE_PID = 4242;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertLegacyError(callback, expectedCode = "LEGACY_EVIDENCE_INVALID") {
  assert.throws(callback, (error) => (
    error instanceof LegacyInventoryError && error.code === expectedCode
  ));
}

function rawPolicy(capturePhase = "live-discovery") {
  return {
    formatVersion: 1,
    capturePhase,
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

function safeKeyProjection() {
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
    safeKeys: safeKeyProjection(),
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
    safeKeys: safeKeyProjection(),
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
    identity: {
      uid: "1001",
      effectiveUid: "1001",
      gid: "1001",
      effectiveGid: "1001",
    },
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
    fileCount: 12,
    directoryCount: 2,
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

function physicalRoot(inode, ancestorDepths) {
  return {
    metadata: metadata("directory", { inode }),
    physicalDirectory: true,
    ancestors: ancestorDepths.map((depthFromRoot, index) => ({
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

function completeProjection() {
  const primaryProjection = pm2DumpProjection();
  const runtimeProcess = processProjection();
  return {
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
      sidecars: {
        wal: missingMetadata(),
        shm: missingMetadata(),
        journal: missingMetadata(),
      },
      openers: [{
        process: runtimeProcess,
        descriptorCount: 1,
        accessModes: ["read-write"],
        writableDescriptorPresent: true,
      }],
    },
    uploads: {
      community: mediaSummary("40001"),
      observation: mediaSummary("40002"),
    },
    pm2: {
      home: metadata("directory", { inode: "50001" }),
      homeTrusted: true,
      primary: {
        metadata: metadata("file", { inode: "50002", bytes: "2048" }),
        usable: true,
        projection: primaryProjection,
      },
      backup: {
        metadata: missingMetadata(),
        usable: false,
        projection: null,
      },
      selected: "primary",
      selectedProjection: clone(primaryProjection),
      cliUsed: false,
      rpcConnected: false,
      rawDumpExported: false,
    },
    nginx: {
      available: {
        metadata: metadata("file", { inode: "60001", mode: 0o644 }),
        readable: true,
      },
      enabled: {
        metadata: metadata("symlink", { inode: "60002", mode: 0o777 }),
        readable: false,
      },
      enabledSymlinkTargetsAvailable: true,
      diskProjection: {
        configuredServerNamePresent: true,
        loopbackProxyPresent: true,
        wildcardApplicationProxyPresent: false,
        tlsListenerPresent: true,
        unexpandedIncludePresent: false,
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
}

function validEvidence(capturePhase = "live-discovery", mutateProjection = null) {
  const policy = validatePolicy(rawPolicy(capturePhase));
  const projection = completeProjection();
  if (capturePhase === "quiesced-binding") {
    projection.listeners = [];
    projection.processes = [];
    projection.database.openers = [];
    projection.pm2.primary.projection.processes[0].statusClass = "stopped";
    projection.pm2.selectedProjection.processes[0].statusClass = "stopped";
  }
  if (mutateProjection) mutateProjection(projection);
  return createEvidenceReport(policy, { projection }, {
    startedAt: "2026-07-12T01:00:00.000Z",
    completedAt: "2026-07-12T01:00:01.000Z",
    attempts: 1,
  });
}

function testPolicyFailsClosed() {
  const normalized = validatePolicy(rawPolicy());
  assert.strictEqual(normalized.applicationRoot, "/var/www/birdora-web");
  assert.strictEqual(normalized.listenerPort, 3003);
  assert(Object.isFrozen(normalized.expectedWriterAppNames));
  assert(Object.isFrozen(normalized.approvedRuntimeIdentityFiles));

  const unknownField = rawPolicy();
  unknownField.outputPath = "/tmp/evidence.json";
  assertLegacyError(() => validatePolicy(unknownField), "LEGACY_INVENTORY_POLICY_INVALID");

  const pathTraversal = rawPolicy();
  pathTraversal.applicationRoot = "/var/www/birdora-web/../other";
  assertLegacyError(() => validatePolicy(pathTraversal), "LEGACY_INVENTORY_POLICY_INVALID");

  const databaseOutsideAllowlist = rawPolicy();
  databaseOutsideAllowlist.databaseFile = "/tmp/birdora.sqlite";
  databaseOutsideAllowlist.dataDirectory = "/tmp";
  databaseOutsideAllowlist.communityUploadDirectory = "/tmp/uploads/community";
  databaseOutsideAllowlist.observationUploadDirectory = "/tmp/uploads/observations";
  assertLegacyError(() => validatePolicy(databaseOutsideAllowlist), "LEGACY_INVENTORY_POLICY_INVALID");

  const overlappingNames = rawPolicy();
  overlappingNames.expectedAdjacentAppNames.push("birdora-web-auth");
  assertLegacyError(() => validatePolicy(overlappingNames), "LEGACY_INVENTORY_POLICY_INVALID");

  const unapprovedIdentityFile = rawPolicy();
  unapprovedIdentityFile.approvedRuntimeIdentityFiles.push("app/config/auth.config.js");
  assertLegacyError(() => validatePolicy(unapprovedIdentityFile), "LEGACY_INVENTORY_POLICY_INVALID");
}

function testStrictEvidenceValidation() {
  const report = validEvidence();
  assert.strictEqual(validateEvidenceShape(report), report);
  assert.match(report.reportId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
  assert.strictEqual(report.checks.length, 25);
  assert.strictEqual(report.manualConfirmations.length, 9);
  assert(report.manualConfirmations.every((item) => item.status === "PENDING"));

  const hyphensOnlyUuid = clone(report);
  hyphensOnlyUuid.reportId = "-".repeat(36);
  assertLegacyError(() => validateEvidenceShape(hyphensOnlyUuid));

  const unknownPhase = clone(report);
  unknownPhase.capture.phase = "post-adoption";
  assertLegacyError(() => validateEvidenceShape(unknownPhase));

  const missingSection = clone(report);
  delete missingSection.pm2;
  assertLegacyError(() => validateEvidenceShape(missingSection));

  const leakedField = clone(report);
  leakedField.leakedPassword = "not-an-exportable-field";
  assertLegacyError(() => validateEvidenceShape(leakedField));

  const forgedCheck = clone(report);
  forgedCheck.checks[0] = {
    id: "execution.fake-pass",
    category: "execution",
    result: "PASS",
    blocking: true,
    reason: "confirmed",
  };
  assertLegacyError(() => validateEvidenceShape(forgedCheck));

  const confirmedManual = clone(report);
  confirmedManual.manualConfirmations[0].status = "CONFIRMED";
  assertLegacyError(() => validateEvidenceShape(confirmedManual));

  const rejectedManual = clone(report);
  rejectedManual.manualConfirmations[0].status = "REJECTED";
  assertLegacyError(() => validateEvidenceShape(rejectedManual));

  const missingManual = clone(report);
  missingManual.manualConfirmations.pop();
  assertLegacyError(() => validateEvidenceShape(missingManual));

  const duplicatedManual = clone(report);
  duplicatedManual.manualConfirmations[8] = clone(duplicatedManual.manualConfirmations[0]);
  assertLegacyError(() => validateEvidenceShape(duplicatedManual));

  const forgedVerdict = clone(report);
  forgedVerdict.verdict.automatedState = "REVIEWABLE_FOR_OFFLINE_REHEARSAL";
  assertLegacyError(() => validateEvidenceShape(forgedVerdict));

  const forgedAuthorization = clone(report);
  forgedAuthorization.verdict.authorizesAdoption = true;
  assertLegacyError(() => validateEvidenceShape(forgedAuthorization));
}

function testRedactionFailsClosed() {
  assert.strictEqual(assertEvidenceRedacted(validEvidence()), true);

  const jwtLeak = validEvidence();
  jwtLeak.runtimeSource.claimedRevision = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.invalidsignaturevalue";
  assertLegacyError(() => assertEvidenceRedacted(jwtLeak), "LEGACY_INVENTORY_REDACTION_FAILED");

  const unsafeExportClaim = validEvidence();
  unsafeExportClaim.exportPolicy.rawPm2DumpCaptured = true;
  assertLegacyError(() => assertEvidenceRedacted(unsafeExportClaim), "LEGACY_INVENTORY_REDACTION_FAILED");
}

function assertNeverAuthorizes(decision) {
  assert.strictEqual(decision.authorizesMutation, false);
  assert.strictEqual(decision.authorizesAdoption, false);
}

function testEvaluationStates() {
  const live = evaluateEvidence(validEvidence());
  assert.strictEqual(live.automatedState, "DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE");
  assert.deepStrictEqual(live.rejectedManualConfirmationIds, []);
  assertNeverAuthorizes(live);

  const noSourceHashPolicy = validatePolicy({ ...rawPolicy(), approvedRuntimeIdentityFiles: [] });
  const noSourceHashProjection = completeProjection();
  for (const identityFile of noSourceHashProjection.runtimeSource.identityFiles) identityFile.sha256 = null;
  noSourceHashProjection.runtimeSource.identityFileSetComplete = false;
  const noSourceHashReport = createEvidenceReport(noSourceHashPolicy, { projection: noSourceHashProjection }, {
    startedAt: "2026-07-12T01:00:00.000Z",
    completedAt: "2026-07-12T01:00:01.000Z",
    attempts: 1,
  });
  const noSourceHashDecision = evaluateEvidence(noSourceHashReport);
  assert.strictEqual(noSourceHashDecision.automatedState, "BLOCKED");
  assert(noSourceHashDecision.blockingCheckIds.includes("runtime.identity-files"));

  const quiesced = evaluateEvidence(validEvidence("quiesced-binding"));
  assert.strictEqual(quiesced.automatedState, "AWAITING_MANUAL");
  assert.strictEqual(quiesced.pendingManualConfirmationIds.length, 9);
  assertNeverAuthorizes(quiesced);

  const writerStillLive = evaluateEvidence(validEvidence("quiesced-binding", (projection) => {
    const liveProjection = completeProjection();
    projection.listeners = liveProjection.listeners;
    projection.processes = liveProjection.processes;
    projection.pm2.primary.projection.processes[0].statusClass = "online";
    projection.pm2.selectedProjection.processes[0].statusClass = "online";
  }));
  assert.strictEqual(writerStillLive.automatedState, "BLOCKED");
  assert(writerStillLive.blockingCheckIds.includes("database.quiesced-if-required"));
  assert(writerStillLive.blockingCheckIds.includes("pm2.persistence-entry"));

  const blockedReport = validEvidence("live-discovery", (projection) => {
    projection.listeners[0].addressClass = "wildcard";
  });
  const blocked = evaluateEvidence(blockedReport);
  assert.strictEqual(blocked.automatedState, "BLOCKED");
  assert.deepStrictEqual(blocked.blockingCheckIds, ["listener.single-loopback"]);
  assertNeverAuthorizes(blocked);

  const racedDescriptorScan = evaluateEvidence(validEvidence("live-discovery", (projection) => {
    projection.inventoryMetrics.transientDescriptorRaceCount = 1;
    projection.inventoryMetrics.descriptorScanComplete = false;
  }));
  assert.strictEqual(racedDescriptorScan.automatedState, "BLOCKED");
  assert(racedDescriptorScan.blockingCheckIds.includes("database.listener-opener-binding"));
}

function testProcNetTcpParser() {
  const header = "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  const ipv4 = [
    header,
    "0: 0100007F:0BBB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 34567 1",
    "1: 00000000:0BBB 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 34568 1",
    "2: 0100007F:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 34569 1",
    "",
  ].join("\n");
  assert.deepStrictEqual(parseProcNetTcp(ipv4, "ipv4", 3003), [{
    family: "ipv4",
    addressClass: "loopback",
    port: 3003,
    state: "LISTEN",
    socketInode: "34567",
  }, {
    family: "ipv4",
    addressClass: "wildcard",
    port: 3003,
    state: "LISTEN",
    socketInode: "34568",
  }]);

  const ipv6 = [
    header,
    "0: 00000000000000000000000001000000:0BBB 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000 1001 0 44567 1",
    "",
  ].join("\n");
  assert.strictEqual(parseProcNetTcp(ipv6, "ipv6", 3003)[0].addressClass, "loopback");
  assertLegacyError(
    () => parseProcNetTcp(`${header}\nmalformed\n`, "ipv4", 3003),
    "LEGACY_INVENTORY_INVALID_PROC"
  );
}

function testPm2DumpSanitizerShapes() {
  const policy = validatePolicy(rawPolicy());
  const expectedEnvironment = {
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: "3003",
    DATABASE_FILE: policy.databaseFile,
    DATA_DIRECTORY: policy.dataDirectory,
    COMMUNITY_UPLOAD_DIR: policy.communityUploadDirectory,
    OBSERVATION_UPLOAD_DIR: policy.observationUploadDirectory,
    PM2_HOME: policy.pm2Home,
    JWT_SECRET: "must-never-appear-in-the-projection",
  };
  const direct = sanitizePm2Process({
    name: "birdora-web-auth",
    status: "online",
    pm_cwd: policy.applicationRoot,
    pm_exec_path: `${policy.applicationRoot}/server.js`,
    env: expectedEnvironment,
  }, policy);
  assert.strictEqual(direct.writerName, true);
  assert.strictEqual(direct.statusClass, "online");
  assert.strictEqual(direct.workingDirectoryClass, "application-root");
  assert.strictEqual(direct.executionPathApproved, true);
  assert.strictEqual(direct.environment.sensitivePresence.jwtOrSessionSecret, true);
  assert.strictEqual(JSON.stringify(direct).includes(expectedEnvironment.JWT_SECRET), false);
  assert(SAFE_ENVIRONMENT_KEYS.every((key) => direct.environment.safeKeys[key].matchesExpected));

  const nested = sanitizePm2Process({ pm2_env: {
    name: "birdora-web-auth",
    status: "stopped",
    pm_cwd: policy.applicationRoot,
    pm_exec_path: `${policy.applicationRoot}/server.js`,
    env: expectedEnvironment,
  } }, policy);
  assert.strictEqual(nested.statusClass, "stopped");
  assert.strictEqual(nested.environment.valuesExported, false);

  for (const dangerousKey of ["LD_AUDIT", "LD_LIBRARY_PATH", "LD_PRELOAD", "NODE_OPTIONS"]) {
    const dangerous = sanitizePm2Process({
      name: "birdora-web-auth",
      status: "online",
      pm_cwd: policy.applicationRoot,
      pm_exec_path: `${policy.applicationRoot}/server.js`,
      env: { ...expectedEnvironment, [dangerousKey]: "/tmp/unapproved-runtime-loader" },
    }, policy);
    assert.strictEqual(dangerous.environment.dangerousRuntimeKeyPresent, true, dangerousKey);
  }
}

function testMountInfoParser() {
  const mountInfo = [
    "36 25 0:32 / / rw,relatime - ext4 /dev/root rw",
    "37 36 0:33 / /var/lib/birdora/uploads/community/nested rw,nosuid - tmpfs tmpfs rw",
    "38 36 0:34 / /mnt/with\\040space rw - tmpfs tmpfs rw",
    "",
  ].join("\n");
  const mountPoints = parseMountInfo(mountInfo);
  assert(mountPoints.has("/"));
  assert(mountPoints.has("/var/lib/birdora/uploads/community/nested"));
  assert(mountPoints.has("/mnt/with space"));
  assertLegacyError(() => parseMountInfo("malformed mountinfo\n"), "LEGACY_INVENTORY_INVALID_PROC");
}

function testNginxBlockProjection() {
  const policy = validatePolicy(rawPolicy());
  const splitAcrossUnrelatedBlocks = projectNginxConfiguration(`
    server {
      listen 80;
      server_name ${policy.siteName};
      return 301 https://$host$request_uri;
    }
    server {
      listen 443 ssl;
      server_name unrelated.example;
    }
    server {
      listen 8080;
      server_name another.example;
      location / { proxy_pass http://127.0.0.1:${policy.listenerPort}; }
    }
  `, policy);
  assert.strictEqual(splitAcrossUnrelatedBlocks.configuredServerNamePresent, true);
  assert.strictEqual(splitAcrossUnrelatedBlocks.loopbackProxyPresent, false);
  assert.strictEqual(splitAcrossUnrelatedBlocks.tlsListenerPresent, false);

  const splitAcrossTargetBlocks = projectNginxConfiguration(`
    server {
      listen 443 ssl;
      server_name ${policy.siteName};
    }
    server {
      listen 80;
      server_name ${policy.siteName};
      location / { proxy_pass http://127.0.0.1:${policy.listenerPort}; }
    }
  `, policy);
  assert.strictEqual(splitAcrossTargetBlocks.loopbackProxyPresent, false);
  assert.strictEqual(splitAcrossTargetBlocks.tlsListenerPresent, false);

  const productionShape = projectNginxConfiguration(`
    # HTTP is intentionally a separate redirect-only virtual host.
    server {
      listen 80;
      server_name ${policy.siteName};
      return 301 https://$host$request_uri;
    }
    server {
      listen [::]:443 ssl http2;
      server_name ${policy.siteName};
      ssl_certificate /etc/letsencrypt/live/example/fullchain.pem;
      location /api/ {
        proxy_pass http://127.0.0.1:${policy.listenerPort};
      }
    }
  `, policy);
  assert.deepStrictEqual(productionShape, {
    configuredServerNamePresent: true,
    loopbackProxyPresent: true,
    wildcardApplicationProxyPresent: false,
    tlsListenerPresent: true,
    unexpandedIncludePresent: false,
  });

  const certbotIncludeShape = projectNginxConfiguration(`
    server {
      listen 443 ssl;
      server_name ${policy.siteName};
      include /etc/letsencrypt/options-ssl-nginx.conf;
      location /api/ { proxy_pass http://127.0.0.1:${policy.listenerPort}; }
    }
  `, policy);
  assert.strictEqual(certbotIncludeShape.configuredServerNamePresent, true);
  assert.strictEqual(certbotIncludeShape.loopbackProxyPresent, true);
  assert.strictEqual(certbotIncludeShape.tlsListenerPresent, true);
  assert.strictEqual(certbotIncludeShape.unexpandedIncludePresent, true);

  const certbotEvidence = validEvidence("live-discovery", (projection) => {
    projection.nginx.diskProjection.unexpandedIncludePresent = true;
  });
  const diskCheck = certbotEvidence.checks.find((item) => item.id === "nginx.disk-projection");
  const includeCheck = certbotEvidence.checks.find((item) => item.id === "nginx.unexpanded-includes");
  assert.strictEqual(diskCheck.result, "PASS");
  assert.strictEqual(includeCheck.result, "MANUAL_REQUIRED");
  assert.strictEqual(includeCheck.blocking, false);
  assert(certbotEvidence.manualConfirmations.some((item) => item.id === "nginx-and-tls-external-state" && item.status === "PENDING"));

  assertLegacyError(
    () => projectNginxConfiguration(`server { server_name ${policy.siteName};`, policy),
    "LEGACY_INVENTORY_INVALID_NGINX"
  );
  assertLegacyError(
    () => projectNginxConfiguration(`server { server_name "${policy.siteName}; }`, policy),
    "LEGACY_INVENTORY_INVALID_NGINX"
  );
  assertLegacyError(
    () => projectNginxConfiguration(`server { server_name ${policy.siteName} }`, policy),
    "LEGACY_INVENTORY_INVALID_NGINX"
  );
}

function testHostNamespaceBoundary() {
  for (const kind of ["pid", "mnt", "net", "user"]) {
    assert.strictEqual(sameProcNamespace(`${kind}:[4026531000]`, `${kind}:[4026531000]`, kind), true);
    assert.strictEqual(sameProcNamespace(`${kind}:[4026531000]`, `${kind}:[4026531001]`, kind), false);
    const otherKind = kind === "net" ? "pid" : "net";
    assert.strictEqual(sameProcNamespace(`${kind}:[4026531000]`, `${otherKind}:[4026531000]`, kind), false);
    assert.strictEqual(sameProcNamespace(`${kind}:[0]`, `${kind}:[0]`, kind), false);
    assert.strictEqual(sameProcNamespace("malformed", "malformed", kind), false);
  }
  assert.strictEqual(sameProcNamespace("net:[4026531000]", "net:[4026531000]", "unsupported"), false);

  for (const field of ["hostNetworkNamespace", "hostUserNamespace"]) {
    const mismatch = validEvidence();
    mismatch.host[field] = false;
    assertLegacyError(() => validateEvidenceShape(mismatch));

    const missing = validEvidence();
    delete missing.host[field];
    assertLegacyError(() => validateEvidenceShape(missing));
  }
}

function testCommandLineEntrypointBinding() {
  const policy = validatePolicy(rawPolicy());
  const encode = (...values) => Buffer.from(`${values.join("\0")}\0`, "utf8");
  const approved = commandLineProjection(encode("/opt/node-v24/bin/node", `${policy.applicationRoot}/server.js`), policy);
  assert.strictEqual(approved.approvedEntrypointIsExecutedScript, true);
  const decoy = commandLineProjection(encode(
    "/opt/node-v24/bin/node",
    "/tmp/unapproved.js",
    `${policy.applicationRoot}/server.js`
  ), policy);
  assert.strictEqual(decoy.approvedEntrypointIsExecutedScript, false);
  const flagged = commandLineProjection(encode(
    "/opt/node-v24/bin/node",
    "--require",
    `${policy.applicationRoot}/server.js`
  ), policy);
  assert.strictEqual(flagged.approvedEntrypointIsExecutedScript, false);
}

function testDuplicateEnvironmentFailsMapping() {
  const policy = validatePolicy(rawPolicy());
  const records = [
    "NODE_ENV=production",
    "HOST=127.0.0.1",
    "PORT=3003",
    "DATABASE_FILE=/tmp/decoy.sqlite",
    `DATABASE_FILE=${policy.databaseFile}`,
    `DATA_DIRECTORY=${policy.dataDirectory}`,
    `COMMUNITY_UPLOAD_DIR=${policy.communityUploadDirectory}`,
    `OBSERVATION_UPLOAD_DIR=${policy.observationUploadDirectory}`,
    `PM2_HOME=${policy.pm2Home}`,
  ];
  const projection = environmentProjection(Buffer.from(`${records.join("\0")}\0`), policy);
  assert.strictEqual(projection.malformedRecordCount, 1);
  assert.strictEqual(projection.safeKeys.DATABASE_FILE.present, true);
  assert.strictEqual(projection.safeKeys.DATABASE_FILE.matchesExpected, false);
  for (const dangerousRecord of [
    "LD_AUDIT=/tmp/unapproved-audit.so",
    "LD_LIBRARY_PATH=/tmp/unapproved-libraries",
    "LD_PRELOAD=/tmp/unapproved-preload.so",
    "NODE_OPTIONS=--require=/tmp/unapproved.js",
  ]) {
    const dangerous = environmentProjection(Buffer.from(`${[
      ...records.filter((record) => !record.startsWith("DATABASE_FILE=")),
      `DATABASE_FILE=${policy.databaseFile}`,
      dangerousRecord,
    ].join("\0")}\0`), policy);
    assert.strictEqual(dangerous.dangerousRuntimeKeyPresent, true, dangerousRecord);
  }
}

function testStrictJsonParsing() {
  assert.deepStrictEqual(parseJsonObject(Buffer.from('{"outer":{"value":1}}'), "fixture"), { outer: { value: 1 } });
  assertLegacyError(
    () => parseJsonObject(Buffer.from('{"outer":{"value":1,"value":2}}'), "fixture"),
    "LEGACY_INVENTORY_INVALID_JSON"
  );
  assertLegacyError(
    () => parseJsonObject(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]), "fixture"),
    "LEGACY_INVENTORY_INVALID_JSON"
  );
}

function testSchemaContractAlignment() {
  const schemaPath = path.join(projectRoot, "deploy/schemas/legacy-adoption-evidence-v1.schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const report = validEvidence();
  assert.strictEqual(schema.additionalProperties, false);
  assert.deepStrictEqual([...schema.required].sort(), Object.keys(report).sort());
  assert.deepStrictEqual(Object.keys(schema.properties).sort(), Object.keys(report).sort());
  assert.strictEqual(schema.properties.kind.const, report.kind);
  assert.strictEqual(schema.properties.checks.minItems, report.checks.length);
  assert.strictEqual(schema.properties.manualConfirmations.minItems, report.manualConfirmations.length);
  assert.deepStrictEqual([...schema.$defs.host.required].sort(), Object.keys(report.host).sort());
  assert.strictEqual(schema.$defs.host.properties.hostNetworkNamespace.const, true);
  assert.strictEqual(schema.$defs.host.properties.hostUserNamespace.const, true);
  assert.deepStrictEqual(
    schema.$defs.verdict.properties.automatedState.enum,
    ["BLOCKED", "DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE", "AWAITING_MANUAL"]
  );
  assert.deepStrictEqual([...ALLOWED_AUTOMATED_STATES], schema.$defs.verdict.properties.automatedState.enum);
  const schemaChecks = schema.properties.checks.prefixItems.map((item) => item.allOf[1].properties);
  assert.deepStrictEqual(schemaChecks.map((item) => item.id.const), report.checks.map((item) => item.id));
  assert.deepStrictEqual(schemaChecks.map((item) => item.category.const), report.checks.map((item) => item.category));
  assert.deepStrictEqual(schemaChecks.map((item) => item.blocking.const), report.checks.map((item) => item.blocking));
  const schemaManualIds = schema.properties.manualConfirmations.prefixItems
    .map((item) => item.allOf[1].properties.id.const);
  assert.deepStrictEqual(schemaManualIds, report.manualConfirmations.map((item) => item.id));
  const stack = [schema];
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;
    if (typeof value.$ref === "string" && value.$ref.startsWith("#/$defs/")) {
      assert(Object.hasOwn(schema.$defs, value.$ref.slice("#/$defs/".length)), `unresolved schema reference ${value.$ref}`);
    }
    for (const child of Object.values(value)) stack.push(child);
  }
}

function testOfflineFileBoundary() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-legacy-evaluator-"));
  try {
    const livePath = path.join(temporaryRoot, "live.json");
    fs.writeFileSync(livePath, `${JSON.stringify(validEvidence())}\n`, { flag: "wx", mode: 0o600 });

    const envelope = evaluateEvidenceFile(livePath);
    assert.strictEqual(envelope.automatedState, "DISCOVERY_COMPLETE_REQUIRES_QUIESCED_RECAPTURE");
    assert.strictEqual(envelope.authorization.adoptionAuthorized, false);
    assert.strictEqual(envelope.authorization.mutationAuthorized, false);
    assert.deepStrictEqual(envelope.rejectedManualConfirmationIds, []);

    let standardOutput = "";
    let standardError = "";
    const io = {
      stdout: { write: (chunk) => { standardOutput += chunk; } },
      stderr: { write: (chunk) => { standardError += chunk; } },
    };
    assert.strictEqual(run([livePath], io), 0);
    const emitted = JSON.parse(standardOutput);
    assert.strictEqual(emitted.authorization.adoptionAuthorized, false);
    assert.strictEqual(emitted.authorization.mutationAuthorized, false);
    assert.strictEqual(standardError, "");

    const blocked = validEvidence("live-discovery", (projection) => {
      projection.listeners[0].addressClass = "wildcard";
    });
    const blockedPath = path.join(temporaryRoot, "blocked.json");
    fs.writeFileSync(blockedPath, JSON.stringify(blocked), { flag: "wx", mode: 0o600 });
    const sink = { stdout: { write: () => {} }, stderr: { write: () => {} } };
    assert.strictEqual(run([blockedPath], sink), 2);

    assertLegacyError(() => run([], io), "LEGACY_EVIDENCE_USAGE");
    assertLegacyError(() => run([livePath, blockedPath], io), "LEGACY_EVIDENCE_USAGE");
    assertLegacyError(() => resolveLocalEvidencePath("relative-evidence.json"), "LEGACY_EVIDENCE_PATH_INVALID");
    assertLegacyError(() => resolveLocalEvidencePath("https://example.invalid/evidence.json"), "LEGACY_EVIDENCE_PATH_INVALID");
    assertLegacyError(() => resolveLocalEvidencePath("\\\\server\\share\\evidence.json"), "LEGACY_EVIDENCE_PATH_INVALID");

    const malformedPath = path.join(temporaryRoot, "malformed.json");
    fs.writeFileSync(malformedPath, "{not-json", { flag: "wx", mode: 0o600 });
    assertLegacyError(() => readEvidenceFile(malformedPath), "LEGACY_INVENTORY_INVALID_JSON");

    const oversizedPath = path.join(temporaryRoot, "oversized.json");
    fs.writeFileSync(oversizedPath, Buffer.alloc(MAX_EVIDENCE_BYTES + 1, 0x20), { flag: "wx", mode: 0o600 });
    assertLegacyError(() => readEvidenceFile(oversizedPath), "LEGACY_INVENTORY_UNSAFE_FILE");
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function testAtomicReportNoOverwrite() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-legacy-atomic-"));
  const outputDirectory = path.join(temporaryRoot, "reports");
  try {
    fs.mkdirSync(outputDirectory, { mode: 0o700 });
    fs.chmodSync(outputDirectory, 0o700);
    const policy = validatePolicy(rawPolicy());
    const report = validEvidence();
    const result = writeEvidenceReportAtomic(report, policy, {
      outputDirectory,
      unitTestDirectory: true,
    });
    const reportPath = path.join(outputDirectory, result.fileName);
    const firstBytes = fs.readFileSync(reportPath);
    assert(firstBytes.length > 0);
    assertLegacyError(
      () => writeEvidenceReportAtomic(report, policy, { outputDirectory, unitTestDirectory: true }),
      "LEGACY_INVENTORY_OUTPUT_UNSAFE"
    );
    assert.deepStrictEqual(fs.readFileSync(reportPath), firstBytes);
    assert.deepStrictEqual(
      fs.readdirSync(outputDirectory).filter((name) => name.endsWith(".tmp")),
      []
    );
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

function loadBootstrapGuards(nodeVersion, environment) {
  const collectorPath = path.join(projectRoot, "deploy/scripts/legacy-inventory.js");
  const source = fs.readFileSync(collectorPath, "utf8").replace(/^#![^\r\n]*\r?\n/u, "");
  const boundary = source.indexOf("function assertCoreDumpsDisabled()");
  assert(boundary > 0, "collector bootstrap guard boundary is missing");
  const context = {
    process: { env: environment, versions: { node: nodeVersion } },
    require,
  };
  vm.runInNewContext(`${source.slice(0, boundary)}\n` +
    "globalThis.__bootstrapGuards = { assertSanitizedEnvironment, assertSupportedNodeVersion };\n", context, {
    filename: collectorPath,
  });
  return context.__bootstrapGuards;
}

function assertBootstrapFailure(callback, expectedCode) {
  assert.throws(callback, (error) => Boolean(error) && error.code === expectedCode);
}

function testBootstrapRuntimeBoundary() {
  const exactEnvironment = {
    HOME: "/root",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  };
  for (const version of ["24.14.0", "24.14.1", "24.99.0"]) {
    const guards = loadBootstrapGuards(version, { ...exactEnvironment });
    assert.doesNotThrow(() => guards.assertSupportedNodeVersion(), version);
    assert.doesNotThrow(() => guards.assertSanitizedEnvironment(), version);
  }
  for (const version of ["23.99.99", "24.13.99", "25.0.0", "24.14.0-rc.1", "malformed", undefined]) {
    const guards = loadBootstrapGuards(version, { ...exactEnvironment });
    assertBootstrapFailure(
      () => guards.assertSupportedNodeVersion(),
      "LEGACY_INVENTORY_NODE_VERSION_UNSUPPORTED"
    );
  }
  const missingKeyEnvironment = { ...exactEnvironment };
  delete missingKeyEnvironment.LANG;
  for (const unsafeEnvironment of [
    missingKeyEnvironment,
    { ...exactEnvironment, NODE_ENV: "production" },
    { ...exactEnvironment, PATH: "/tmp" },
  ]) {
    const guards = loadBootstrapGuards("24.14.0", unsafeEnvironment);
    assertBootstrapFailure(
      () => guards.assertSanitizedEnvironment(),
      "LEGACY_INVENTORY_ENVIRONMENT_UNSAFE"
    );
  }
}

function assertRuntimeCapabilityAllowlist(source, contract) {
  const moduleSpecifiers = new Set();
  const dynamicRequireArguments = new Set();
  const requirePattern = /\brequire\s*\(\s*([^)]*?)\s*\)/gu;
  for (const match of source.matchAll(requirePattern)) {
    const argument = match[1].trim();
    const literal = argument.match(/^(["'])([^"']+)\1$/u);
    if (literal) moduleSpecifiers.add(literal[2]);
    else dynamicRequireArguments.add(argument);
  }
  const importPattern = /(?:^|\n)\s*import\s+(?:[^"'()\r\n]+?\s+from\s+)?(["'])([^"'\r\n]+)\1\s*;?/gu;
  for (const match of source.matchAll(importPattern)) moduleSpecifiers.add(match[2]);
  assert.deepStrictEqual(
    [...moduleSpecifiers].sort(),
    [...contract.allowedModuleSpecifiers].sort(),
    `${contract.name} require/import module capability set changed`
  );
  assert.deepStrictEqual(
    [...dynamicRequireArguments].sort(),
    [...contract.allowedDynamicRequireArguments].sort(),
    `${contract.name} dynamic require capability set changed`
  );

  const directCapabilities = [
    ["child process", /\bchild_process\b/u],
    ["command execution", /\b(?:exec|execFile|spawn|fork)(?:Sync)?\s*\(/u],
    ["dynamic import", /\bimport\s*\(/u],
    ["global fetch", /\b(?:(?:globalThis|global)\s*\.\s*)?fetch\s*\(/u],
    ["global socket client", /\b(?:(?:globalThis|global)\s*\.\s*)?(?:WebSocket|EventSource)\s*\(/u],
    ["process signalling or native loading", /\bprocess\s*\.\s*(?:kill|abort|dlopen|binding|_linkedBinding)\s*\(/u],
    ["runtime code generation", /\b(?:eval|Function)\s*\(/u],
  ];
  for (const [capability, pattern] of directCapabilities) {
    assert.strictEqual(pattern.test(source), false, `${contract.name} contains forbidden ${capability} capability`);
  }
}

function testForbiddenRuntimeDependencies() {
  const contracts = [
    {
      name: "legacy-inventory-lib.js",
      sourcePath: path.join(projectRoot, "deploy/scripts/legacy-inventory-lib.js"),
      allowedModuleSpecifiers: new Set(["crypto", "fs", "os", "path"]),
      allowedDynamicRequireArguments: new Set(),
    },
    {
      name: "legacy-inventory.js",
      sourcePath: path.join(projectRoot, "deploy/scripts/legacy-inventory.js"),
      allowedModuleSpecifiers: new Set(["fs", "path"]),
      allowedDynamicRequireArguments: new Set(["EXPECTED_LIBRARY"]),
    },
    {
      name: "evaluate-legacy-adoption-evidence.js",
      sourcePath: path.join(projectRoot, "scripts/evaluate-legacy-adoption-evidence.js"),
      allowedModuleSpecifiers: new Set(["../deploy/scripts/legacy-inventory-lib", "fs", "path"]),
      allowedDynamicRequireArguments: new Set(),
    },
  ];
  for (const contract of contracts) {
    assertRuntimeCapabilityAllowlist(fs.readFileSync(contract.sourcePath, "utf8"), contract);
  }

  const emptyContract = {
    name: "synthetic forbidden fixture",
    allowedModuleSpecifiers: new Set(),
    allowedDynamicRequireArguments: new Set(),
  };
  for (const source of [
    'require("child_process")',
    'require("dns")',
    'require("node:dns/promises")',
    'require("undici")',
    'require(\n"net"\n)',
    'import { request } from "undici";',
    'fetch("https://example.invalid")',
    'globalThis.fetch("https://example.invalid")',
    'new WebSocket("wss://example.invalid")',
    'process.kill(1, "SIGTERM")',
    'process.dlopen(module, "/tmp/unapproved.node")',
    'import("node:http")',
    'require(runtimeSelectedModule)',
  ]) {
    assert.throws(
      () => assertRuntimeCapabilityAllowlist(source, emptyContract),
      assert.AssertionError,
      source
    );
  }

  assert.doesNotThrow(() => assertRuntimeCapabilityAllowlist(
    'const fs = require("fs");\nimport path from "path";\n',
    {
      name: "synthetic allowed fixture",
      allowedModuleSpecifiers: new Set(["fs", "path"]),
      allowedDynamicRequireArguments: new Set(),
    }
  ));
}

function testStableControllerBundleContract() {
  const runner = fs.readFileSync(path.join(projectRoot, "deploy/scripts/run-with-production-env.js"), "utf8");
  assert.strictEqual(runner.includes('"legacy-inventory-lib.js"'), false);
  assert.strictEqual(runner.includes('"legacy-inventory.js"'), false);
  const collector = fs.readFileSync(path.join(projectRoot, "deploy/scripts/legacy-inventory.js"), "utf8");
  assert(collector.includes('const EXPECTED_COLLECTOR = `${CONTROLLER_DIRECTORY}/legacy-inventory.js`;'));
  assert(collector.includes('const POLICY_FILE = "/etc/birdora/legacy-inventory-policy.json";'));
  assert(collector.includes('const REPORT_DIRECTORY = "/var/lib/birdora-protected/legacy-inventory";'));
  assert(collector.indexOf("assertTrustedFile(EXPECTED_LIBRARY") < collector.indexOf("require(EXPECTED_LIBRARY)"));
  const examplePolicy = JSON.parse(fs.readFileSync(
    path.join(projectRoot, "deploy/policy/legacy-inventory-policy.example.json"),
    "utf8"
  ));
  assert.doesNotThrow(() => validatePolicy(examplePolicy));
}

testPolicyFailsClosed();
testStrictEvidenceValidation();
testRedactionFailsClosed();
testEvaluationStates();
testProcNetTcpParser();
testPm2DumpSanitizerShapes();
testMountInfoParser();
testNginxBlockProjection();
testHostNamespaceBoundary();
testCommandLineEntrypointBinding();
testDuplicateEnvironmentFailsMapping();
testStrictJsonParsing();
testSchemaContractAlignment();
testOfflineFileBoundary();
testAtomicReportNoOverwrite();
testBootstrapRuntimeBoundary();
testForbiddenRuntimeDependencies();
testStableControllerBundleContract();

console.log("Legacy adoption evidence evaluator tests passed.");
