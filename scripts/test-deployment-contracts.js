"use strict";

// Static deployment lint. Linux behavior is covered separately by
// test:linux:deployment; this file must never be treated as Ubuntu evidence.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function includes(source, fragment, message) {
  assert.ok(source.includes(fragment), message || `Missing deployment contract: ${fragment}`);
}

function excludes(source, fragment, message) {
  assert.ok(!source.includes(fragment), message || `Forbidden deployment contract found: ${fragment}`);
}

function before(source, first, second, message) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notStrictEqual(firstIndex, -1, `Missing deployment contract: ${first}`);
  assert.notStrictEqual(secondIndex, -1, `Missing deployment contract: ${second}`);
  assert.ok(firstIndex < secondIndex, message || `Expected ${first} before ${second}`);
}

function count(source, fragment) {
  return source.split(fragment).length - 1;
}

const installer = read("deploy/scripts/install-http.sh");
const productionEnvironmentRunner = read("deploy/scripts/run-with-production-env.js");
includes(installer, "set -Eeuo pipefail");
includes(installer, "shopt -s inherit_errexit");
includes(installer, "shopt -u varredir_close", "the exclusive database FD must survive exec into maintenance commands");
includes(installer, "umask 0027", "control files need deterministic group-readable permissions");
includes(installer, 'EXPECTED_CONTROLLER_DIR="/usr/local/libexec/birdora"', "controller must live outside every release");
includes(installer, 'CONTROLLER_PROTOCOL_VERSION="1"');
includes(installer, "signed candidate deployment-controller protocol is incompatible");
includes(installer, 'RELEASE_ROOT="$APP_ROOT/releases"');
includes(installer, "immutable release root must be a physical root-owned directory without group/other write access");
includes(installer, 'RUNTIME_LINK="$APP_ROOT/current"');
includes(installer, 'PUBLIC_RELEASE_ROOT="$APP_ROOT/.public-releases"');
includes(installer, 'ENV_FILE="/etc/birdora/birdora-web-auth.env"');
includes(installer, 'RELEASE_PUBLIC_KEY="/etc/birdora/release-signing-public.pem"');
includes(installer, 'PM2_HOME="/var/lib/birdora/pm2"');
includes(installer, 'PROTECTED_DATA_DIR="/var/lib/birdora-protected"');
includes(installer, 'ACTIVATION_CONTROL_DIR="/var/lib/birdora-control"');
includes(installer, "candidate must be a direct physical child", "candidate path containment must fail closed");
includes(installer, "verify-release-manifest.js", "candidate code and dependencies need an external signed trust anchor");
includes(installer, "ARTIFACT_MANIFEST_SHA256", "artifact identity must remain pinned across the activation");
includes(installer, "getcap -r", "Linux file capabilities must be rejected");
includes(installer, "getfacl --absolute-names --skip-base", "extended ACLs must be rejected");
includes(installer, "Linux capability scan failed; release trust cannot be proven");
includes(installer, "extended ACL scan failed; release trust cannot be proven");
excludes(installer, "source .env", "root shell must never execute release/environment text");
excludes(installer, "source \"$ENV_FILE\"", "strict environment parser cannot be bypassed with shell source");
excludes(installer, "pnpm test; then", "production controller must not run mutable build tests as root");
excludes(installer, 'chown -R root:www-data "$APP_DIR"', "signed runtime release must never be modified in production");
excludes(installer, 'git -C "$APP_DIR"', "production release trust must not depend on a mutable Git checkout");
before(installer, "verify_candidate_tree\nEXPECTED_RELEASE_DIRECTORY", "unresolved activation journal exists",
  "signed candidate verification must precede any stale-journal maintenance mutation");

includes(productionEnvironmentRunner, 'spawnSync("/usr/bin/flock"', "trusted launcher must acquire the global deployment lock");
includes(productionEnvironmentRunner, '"--nonblock"');
includes(productionEnvironmentRunner, '"--close"');
includes(productionEnvironmentRunner, 'BIRDORA_DEPLOY_LOCK_HELD: "true"');
includes(productionEnvironmentRunner, "BIRDORA_CONTROLLER_PROTOCOL_VERSION");
includes(productionEnvironmentRunner, "mode 0600", "deployment lock permissions must satisfy the pointer helper trust policy");
includes(installer, "LOCK_PARENT_HOLDS_FILE", "lock re-entry must prove the parent descriptor");
includes(installer, "LOCK_LAUNCHER_PID", "controller must bind the lock holder to the strict environment launcher");
includes(installer, 'exec {DATABASE_LOCK_FD}<>"$DATABASE_LIFECYCLE_LOCK"', "maintenance must retain one exclusive FD");
includes(installer, 'flock --exclusive --wait 10 "$DATABASE_LOCK_FD"');
includes(installer, 'export BIRDORA_DATABASE_LOCK_FD="$DATABASE_LOCK_FD"');
includes(installer, 'flock --unlock "$DATABASE_LOCK_FD"');
before(installer, 'pm2 stop "$PM2_APP"', "== Acquire one continuous exclusive database/media writer fence ==",
  "old writer must stop before exclusive lock acquisition");
before(installer, "== Acquire one continuous exclusive database/media writer fence ==", "scripts/backup-database.js");
before(installer, "scripts/backup-database.js", "scripts/migrate-database.js");
before(installer, "scripts/migrate-database.js", "runtime-switch-about-to-start");
before(installer, "candidate-start-about-to-begin", 'flock --unlock "$DATABASE_LOCK_FD"');
before(installer, 'flock --unlock "$DATABASE_LOCK_FD"', 'pm2 start "$APP_DIR/ecosystem.config.cjs"');

includes(installer, 'pm2 delete "$PM2_APP"', "A/B switch must discard old PM2 metadata");
includes(installer, "persist_empty_pm2_inventory", "empty PM2 state must be durably verified");
includes(installer, "pm2 save --force", "PM2 otherwise skips replacing a dump when its process list is empty");
includes(installer, "PM2 persisted inventory is not empty after forced save");
includes(installer, "prove_birdora_runtime_data_access false", "runtime access must be proven before maintenance");
includes(installer, "prove_birdora_runtime_data_access true", "runtime access and journal readability must be proven after migration");
includes(installer, "/usr/sbin/runuser --user birdora -- env -i");
includes(installer, 'pm2 start "$APP_DIR/ecosystem.config.cjs" --only "$PM2_APP"',
  "PM2 must start from the candidate physical path");
excludes(installer, "pm2 restart ecosystem.config.cjs", "restart can merge stale PM2 cwd/environment metadata");
excludes(installer, "--update-env", "sanitized explicit PM2 env must not merge caller state");
includes(installer, 'readlink -f "/proc/$NEW_APP_PID/cwd"');
includes(installer, 'readlink -f "/proc/$NEW_APP_PID/exe"');
includes(installer, '"/proc/$NEW_APP_PID/cmdline"');
includes(installer, "NEW_APP_STARTTIME", "PID restarts during identity verification must fail");
includes(installer, 'app.pm2_env?.pm_cwd !== process.env.APP_DIR');
includes(installer, 'app.pm2_env?.pm_exec_path !== "/usr/bin/flock"');
includes(installer, 'health.activation?.writesEnabled !== false');
assert.ok(count(installer, "switch-release-pointer.js") >= 3,
  "runtime activation, public activation, and failure restoration must use the stable pointer helper");

const journalPhases = [
  "migration-about-to-start",
  "migration-command-complete-awaiting-postflight",
  "database-migrated-candidate-not-yet-verified",
  "runtime-switch-about-to-start",
  "runtime-pointer-switched",
  "candidate-start-about-to-begin",
  "candidate-ready",
  "public-switch-about-to-start",
  "public-pointer-switched",
  "nginx-loopback-verified",
  "maintenance-release-about-to-start",
  "public-readonly-verified",
  "marker-commit-about-to-start",
  "marker-committed",
];
for (let index = 0; index < journalPhases.length - 1; index += 1) {
  before(installer, `JOURNAL_STATUS="${journalPhases[index]}"`, `JOURNAL_STATUS="${journalPhases[index + 1]}"`,
    `journal phase order is invalid: ${journalPhases[index]}`);
}
includes(installer, "JOURNAL_ATTEMPT_ID");
includes(installer, "JOURNAL_CONTEXT_JSON");
includes(installer, 'PUBLIC_WRITE_STATUS', "external reads may open only while writes remain journal-gated");
before(installer, "public-readonly-verified", "marker-commit-about-to-start");
before(installer, "marker-committed", "Clear activation journal only after the verified release marker is durable");
includes(installer, "formatVersion: 2");
includes(installer, "artifactManifestSha256: process.env.ARTIFACT_MANIFEST_SHA256");
includes(installer, "runtimeReleaseDirectory: process.env.APP_DIR");
includes(installer, "activationAttemptId: process.env.JOURNAL_ATTEMPT_ID");
includes(installer, "current release marker changed during the controlled activation");
includes(installer, "marker.formatVersion !== 2", "the previous marker schema must be explicit");
includes(installer, "marker.publicReleaseDirectory", "the previous marker must bind the active public pointer");
includes(installer, "activation journal is not the committed attempt being finalized");
assert.ok(count(installer, "verify_candidate_process_identity_now") >= 3,
  "candidate PID/starttime/readiness must be rechecked before marker commit and journal cleanup");
before(installer, 'JOURNAL_STATUS="marker-commit-about-to-start"',
  'verify_candidate_process_identity_now "immediately before marker commit"');
before(installer, 'JOURNAL_STATUS="marker-committed"',
  'verify_candidate_process_identity_now "immediately before activation journal cleanup"');
includes(installer, "fs.fchmodSync(descriptor, 0o640)", "marker writer must defeat a restrictive inherited umask");
excludes(installer, 'path.join(process.env.DATA_DIR, "current-release.json")',
  "runtime-writable data root must not contain the trusted release marker");

includes(installer, "trap report_stopped_service_on_exit EXIT");
includes(installer, "pm2 delete", "failure path must remove the candidate definition");
includes(installer, "runtime pointer remains on the stopped forward-fix candidate",
  "migration failure must never auto-start or imply executable rollback to old code");
includes(installer, "atomically restoring the pre-update public asset pointer");

const rollbackBundle = read("deploy/scripts/create-rollback-bundle.sh");
includes(rollbackBundle, 'PROTECTED_DATA_DIR="/var/lib/birdora-protected"');
includes(rollbackBundle, 'ACTIVE_PUBLIC_LINK="$APP_ROOT/.active-public"');
includes(rollbackBundle, "previous-runtime-manifest.json");
includes(rollbackBundle, "candidate-runtime-manifest.json");
includes(rollbackBundle, "executableRollbackAllowed: false");
includes(rollbackBundle, "forward-fix-only");
includes(rollbackBundle, "user_point_events");
includes(rollbackBundle, "secretMaterialCaptured: false");
includes(rollbackBundle, "COMMUNITY_UPLOAD_DIR");
includes(rollbackBundle, "OBSERVATION_UPLOAD_DIR");
includes(rollbackBundle, "uploads-files.sha256");
includes(rollbackBundle, "pm2-before-update.json");
excludes(rollbackBundle, "for candidate in .env", "JWT secret must never enter rollback config archive");
excludes(rollbackBundle, 'pm2 jlist > "$BUNDLE_DIR/pm2-before-update.json"',
  "raw PM2 environments must never be persisted");
excludes(rollbackBundle, "git archive", "rollback evidence must use signed immutable runtime identity");
excludes(rollbackBundle, "rev-parse HEAD^", "previous release must never be guessed");

const releaseManifest = read("deploy/scripts/release-manifest-lib.js");
includes(releaseManifest, "crypto.verify", "artifact manifest requires an asymmetric signature");
includes(releaseManifest, "O_NOFOLLOW", "artifact files must be opened without following symlinks");
includes(releaseManifest, "validateBuildEvidence", "build/test evidence must be checked at creation and activation");
includes(releaseManifest, "002-legacy-retirement.js", "all published migrations must be required");
includes(releaseManifest, "scripts/assert-runtime-data-access.js");
includes(releaseManifest, "embedded private key material");
includes(releaseManifest, "setuid, setgid, or sticky");
includes(releaseManifest, "controllerProtocolVersion");
const releaseBuilder = read("scripts/build-release-artifact.sh");
includes(releaseBuilder, "release artifacts must be built from a completely clean committed worktree");
includes(releaseBuilder, "--frozen-lockfile");
includes(releaseBuilder, "--config.node-linker=hoisted");
includes(releaseBuilder, "--config.package-import-method=copy");
includes(releaseBuilder, "release build requires the exact package.json pnpm version");
includes(releaseBuilder, "-type l -print -quit");
includes(releaseBuilder, "-type f -links +1");
includes(releaseBuilder, "UNSIGNED_ARTIFACT_READY");
includes(releaseBuilder, "Linux capability scan failed; refusing an unverifiable release");

const productionEnv = read("deploy/scripts/production-env-lib.js");
includes(productionEnv, "ALLOWED_KEYS");
includes(productionEnv, "unknown production environment key");
includes(productionEnv, "O_NOFOLLOW");
includes(productionEnv, "canonicalHttpsOrigin");
includes(productionEnv, 'requireExact(values, "DATABASE_FILE", "/var/lib/birdora/birdora.sqlite")');
const envRunner = read("deploy/scripts/run-with-production-env.js");
before(envRunner, "assertTrustedDirectory(CONTROLLER_DIRECTORY)", "require(path.join(CONTROLLER_DIRECTORY",
  "launcher must validate installation before loading a sibling module");
includes(envRunner, "invoke the launcher with env -i");
includes(envRunner, "fs.realpathSync(__filename) !== EXPECTED_LAUNCHER");

const activationGate = read("app/middleware/activation-write-gate.js");
includes(activationGate, "O_NOFOLLOW");
includes(activationGate, "ACTIVATION_PENDING_READ_ONLY");
includes(activationGate, "assertCurrentReleaseMarker");
includes(activationGate, "managed release identity must be either fully absent or fully valid");
includes(activationGate, "marker.formatVersion !== 2");

const lifecycleLock = read("app/runtime/database-lifecycle-lock.js");
includes(lifecycleLock, "/proc/self/fdinfo/");
includes(lifecycleLock, 'if (line.includes("->")) continue');
includes(lifecycleLock, 'lock.mode === "READ"');
includes(lifecycleLock, 'lock.mode === "WRITE"');
includes(lifecycleLock, "candidateArtifactManifestSha256");
includes(read("scripts/migrate-database.js"), "assertMigrationActivationAuthorization");
includes(read("scripts/backup-database.js"), "assertExclusiveDatabaseLifecycleLock");

const activationJournal = read("scripts/update-activation-journal.js");
includes(activationJournal, "ACTIVATION_PHASES");
includes(activationJournal, "validateJournalHistory");
includes(activationJournal, "assertDeploymentLock");
includes(activationJournal, "fs.linkSync(temporaryPath, pendingPath)",
  "journal creation must not replace an existing/dangling entry");
includes(activationJournal, "activation journal changed concurrently before commit");
includes(activationJournal, "activation journal exceeds the runtime 256 KiB safety limit");
includes(activationJournal, "fs.fchmodSync(descriptor, 0o640)", "journal writer must set exact runtime-readable mode");
includes(activationJournal, "fs.fchownSync(descriptor, 0, controlStats.gid)", "journal group must follow the protected control directory");

const pointer = read("deploy/scripts/switch-release-pointer.js");
includes(pointer, "assertDeploymentLock(environment)");
includes(pointer, "fs.renameSync(temporaryPath, pointerPath)");
includes(pointer, "fsyncDirectory(pointerParent.resolved)");
includes(pointer, "new release target must not cross into a nested mount point");

const ecosystem = read("ecosystem.config.cjs");
includes(ecosystem, 'script: isProduction ? "/usr/bin/flock"');
includes(ecosystem, '"--shared"');
includes(ecosystem, "BIRDORA_RELEASE_DIR must be a direct child");
includes(ecosystem, "kill_timeout: 12000");
includes(ecosystem, "wait_ready: true");
includes(ecosystem, 'uid: isProduction ? "birdora"');

for (const retiredPath of ["deploy/scripts/preflight.sh", "deploy/scripts/enable-https.sh"]) {
  const retired = read(retiredPath);
  includes(retired, "intentionally performs no action");
  includes(retired, "exit 78", `${retiredPath} must fail closed for legacy automation`);
}
const deploymentGuide = read("docs/deployment.md");
includes(deploymentGuide, "NO-GO");
excludes(deploymentGuide, "bash deploy/scripts/preflight.sh");
excludes(deploymentGuide, "bash deploy/scripts/enable-https.sh");

for (const configPath of ["deploy/nginx/birdora-pre-cert.conf", "deploy/nginx/birdora-https.conf"]) {
  const nginx = read(configPath);
  assert.ok(count(nginx, "/var/lib/birdora-maintenance/maintenance.flag") >= 8,
    `${configPath} must gate API and static locations`);
  includes(nginx, "root /var/www/birdora-web/.active-public");
  includes(nginx, '~*^/api/ "no-store"');
  includes(nginx, "client_max_body_size 16m");
  includes(nginx, 'add_header Cache-Control "no-store" always');
  excludes(nginx, "immutable", "fixed-name assets must not receive permanent immutable caching");
}

const compose = read("compose.yaml");
assert.ok(count(compose, 'DATABASE_AUTO_MIGRATE: "false"') >= 2);
includes(compose, 'profiles: ["maintenance"]');
before(compose, "docker compose stop birdora-web", "docker compose run --rm birdora-migrate");

const syncPublic = read("scripts/sync-public.js");
includes(syncPublic, "PUBLIC_OUTPUT_DIR");
includes(syncPublic, "Refusing to overwrite an existing public release");
includes(syncPublic, "isSymbolicLink");

const releaseRoot = path.join(projectRoot, ".public-releases");
const protectedRelease = path.join(releaseRoot, `deployment-contract-${process.pid}-${Date.now()}`);
const sentinelPath = path.join(protectedRelease, "sentinel.txt");
const releaseRootExisted = fs.existsSync(releaseRoot);
try {
  fs.mkdirSync(protectedRelease, { recursive: true });
  fs.writeFileSync(sentinelPath, "must-not-change\n", "utf8");
  const result = spawnSync(process.execPath, [path.join(projectRoot, "scripts/sync-public.js")], {
    cwd: projectRoot,
    env: { ...process.env, PUBLIC_OUTPUT_DIR: protectedRelease },
    encoding: "utf8",
  });
  assert.notStrictEqual(result.status, 0, "public build must reject an existing immutable directory");
  assert.strictEqual(fs.readFileSync(sentinelPath, "utf8"), "must-not-change\n");
} finally {
  fs.rmSync(protectedRelease, { recursive: true, force: true });
  if (!releaseRootExisted && fs.existsSync(releaseRoot) && fs.readdirSync(releaseRoot).length === 0) {
    fs.rmdirSync(releaseRoot);
  }
}

console.log("Deployment architecture lint contracts passed (not Ubuntu runtime evidence).");
