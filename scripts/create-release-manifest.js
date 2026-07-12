"use strict";

const fs = require("fs");
const path = require("path");
const {
  MANIFEST_NAME,
  SIGNATURE_NAME,
  createManifest,
} = require("../deploy/scripts/release-manifest-lib");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
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

function main() {
  const releaseDirectory = path.resolve(required("RELEASE_DIR"));
  const revision = required("RELEASE_REVISION").toLowerCase();
  const manifestPath = path.join(releaseDirectory, MANIFEST_NAME);
  const signaturePath = path.join(releaseDirectory, SIGNATURE_NAME);
  if (fs.existsSync(manifestPath) || fs.existsSync(signaturePath)) {
    throw new Error("release manifest/signature already exists; build into a new immutable directory");
  }
  const { manifest } = createManifest({ releaseDirectory, revision });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    flag: "wx",
    mode: 0o644,
  });
  const descriptor = fs.openSync(manifestPath, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fsyncDirectory(releaseDirectory);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    releaseDirectory,
    revision,
    manifestPath,
    signaturePath,
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
    signingCommand: `openssl dgst -sha256 -sign <offline-private-key> -out ${SIGNATURE_NAME} ${MANIFEST_NAME}`,
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || "RELEASE_MANIFEST_CREATE_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
