"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  MANIFEST_NAME,
  SIGNATURE_NAME,
  createManifest,
  verifyRelease,
} = require("../deploy/scripts/release-manifest-lib");

const projectRoot = path.resolve(__dirname, "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-release-artifact-"));
const releaseDirectory = path.join(temporaryRoot, "release");
const publicKeyPath = path.join(temporaryRoot, "release-public.pem");
const revision = "0123456789abcdef0123456789abcdef01234567";

function write(relativePath, contents, mode = 0o644) {
  const absolutePath = path.join(releaseDirectory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, { mode });
}

function signManifest(privateKey) {
  const manifestPath = path.join(releaseDirectory, MANIFEST_NAME);
  const signature = crypto.sign("sha256", fs.readFileSync(manifestPath), privateKey);
  fs.writeFileSync(path.join(releaseDirectory, SIGNATURE_NAME), signature, { mode: 0o644 });
}

function verify() {
  return verifyRelease({
    releaseDirectory,
    publicKeyPath,
    requireRootOwnership: false,
    requireNoGroupOrOtherWrite: false,
  });
}

try {
  fs.mkdirSync(releaseDirectory, { recursive: true });
  write("package.json", `${JSON.stringify({
    name: "birdora-web",
    version: "1.7.0",
    packageManager: "pnpm@10.32.1",
    birdoraDeployment: { controllerProtocolVersion: 1 },
    engines: { node: ">=24.14.0" },
  })}\n`);
  write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
  const fixtureLockSha256 = crypto.createHash("sha256").update("lockfileVersion: '9.0'\n").digest("hex");
  write(".birdora-build-evidence.json", `${JSON.stringify({
    formatVersion: 1,
    revision,
    passed: true,
    pnpmVersion: "10.32.1",
    lockfileSha256: fixtureLockSha256,
    commands: [
      { name: "pnpm test", exitCode: 0 },
      { name: "pnpm test:atlas", exitCode: 0 },
      { name: "pnpm audit --prod", exitCode: 0 },
    ],
  })}\n`);
  write("server.js", "process.stdout.write('fixture');\n");
  write("ecosystem.config.cjs", "module.exports = { apps: [] };\n");
  write("node_modules/.modules.yaml", "packageManager: pnpm\n");
  write("app/db/migrations/001-baseline.js", "module.exports = {};\n");
  write("app/db/migrations/002-legacy-retirement.js", "module.exports = {};\n");
  write("deploy/nginx/birdora-https.conf", "server {}\n");
  write("deploy/nginx/birdora-pre-cert.conf", "server {}\n");
  write("scripts/backup-database.js", "// fixture\n");
  write("scripts/assert-runtime-data-access.js", "// fixture\n");
  write("scripts/database-preflight.js", "// fixture\n");
  write("scripts/migrate-database.js", "// fixture\n");
  write("node_modules/example/index.js", "module.exports = 1;\n");

  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  fs.writeFileSync(publicKeyPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644 });
  const { manifest } = createManifest({
    releaseDirectory,
    revision,
    createdAt: "2026-07-12T00:00:00.000Z",
  });
  fs.writeFileSync(path.join(releaseDirectory, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`);
  signManifest(privateKey);

  const verified = verify();
  assert.strictEqual(verified.ok, true);
  assert.strictEqual(verified.revision, revision);
  assert.strictEqual(verified.fileCount, manifest.fileCount);

  const cliResult = spawnSync(process.execPath, [path.join(projectRoot, "deploy/scripts/verify-release-manifest.js")], {
    cwd: projectRoot,
    env: {
      ...process.env,
      RELEASE_DIR: releaseDirectory,
      RELEASE_PUBLIC_KEY: publicKeyPath,
      RELEASE_REQUIRE_ROOT_OWNERSHIP: "false",
      RELEASE_REQUIRE_IMMUTABLE_PERMISSIONS: "false",
    },
    encoding: "utf8",
  });
  assert.strictEqual(cliResult.status, 0, cliResult.stderr || cliResult.stdout);
  assert.strictEqual(JSON.parse(cliResult.stdout).revision, revision);

  const serverPath = path.join(releaseDirectory, "server.js");
  const originalServer = fs.readFileSync(serverPath);
  fs.appendFileSync(serverPath, "// tampered\n");
  assert.throws(verify, /differs from signed manifest/u);
  fs.writeFileSync(serverPath, originalServer);
  assert.strictEqual(verify().ok, true);

  write("unexpected.js", "// not signed\n");
  assert.throws(verify, /file set differs/u);
  fs.unlinkSync(path.join(releaseDirectory, "unexpected.js"));

  const signaturePath = path.join(releaseDirectory, SIGNATURE_NAME);
  const originalSignature = fs.readFileSync(signaturePath);
  const invalidSignature = Buffer.from(originalSignature);
  invalidSignature[0] ^= 0xff;
  fs.writeFileSync(signaturePath, invalidSignature);
  assert.throws(verify, /signature is invalid/u);
  fs.writeFileSync(signaturePath, originalSignature);

  const manifestPath = path.join(releaseDirectory, MANIFEST_NAME);
  const originalManifest = fs.readFileSync(manifestPath);
  const unsafeManifest = JSON.parse(originalManifest.toString("utf8"));
  unsafeManifest.files[0].path = "../escape";
  fs.writeFileSync(manifestPath, `${JSON.stringify(unsafeManifest, null, 2)}\n`);
  signManifest(privateKey);
  assert.throws(verify, /unsafe path/u);
  fs.writeFileSync(manifestPath, originalManifest);
  fs.writeFileSync(signaturePath, originalSignature);

  const hardLinkPath = path.join(releaseDirectory, "hard-linked-server.js");
  fs.linkSync(serverPath, hardLinkPath);
  assert.throws(verify, /hard-linked file/u);
  fs.unlinkSync(hardLinkPath);

  write(".env", "JWT_SECRET=must-not-enter-release\n");
  assert.throws(verify, /forbidden secret-bearing path/u);
  fs.unlinkSync(path.join(releaseDirectory, ".env"));
  assert.strictEqual(verify().ok, true);

  write("leaked-private.pem", "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----\n");
  assert.throws(verify, /embedded private key material/u);
  fs.unlinkSync(path.join(releaseDirectory, "leaked-private.pem"));

  const evidencePath = path.join(releaseDirectory, ".birdora-build-evidence.json");
  const originalEvidence = fs.readFileSync(evidencePath);
  const failedEvidence = JSON.parse(originalEvidence.toString("utf8"));
  failedEvidence.passed = false;
  fs.writeFileSync(evidencePath, `${JSON.stringify(failedEvidence)}\n`);
  assert.throws(
    () => createManifest({ releaseDirectory, revision }),
    /build evidence is missing, failed/u
  );
  fs.writeFileSync(evidencePath, originalEvidence);

  const wrongPnpmEvidence = JSON.parse(originalEvidence.toString("utf8"));
  wrongPnpmEvidence.pnpmVersion = "10.31.0";
  fs.writeFileSync(evidencePath, `${JSON.stringify(wrongPnpmEvidence)}\n`);
  assert.throws(
    () => createManifest({ releaseDirectory, revision }),
    /build evidence is missing, failed/u
  );
  fs.writeFileSync(evidencePath, originalEvidence);

  console.log("Release artifact trust tests passed.");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
