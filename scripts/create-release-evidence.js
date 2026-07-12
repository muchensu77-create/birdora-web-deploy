"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function run(releaseDirectory, name, args, environment) {
  const result = spawnSync("pnpm", args, {
    cwd: releaseDirectory,
    env: environment,
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  return { name, executable: "pnpm", arguments: args, exitCode: result.status ?? 1 };
}

function main() {
  const releaseDirectory = path.resolve(required("RELEASE_DIR"));
  const revision = required("RELEASE_REVISION").toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(revision)) throw new Error("RELEASE_REVISION must be an exact Git commit");
  const evidencePath = path.join(releaseDirectory, ".birdora-build-evidence.json");
  if (fs.existsSync(evidencePath)) throw new Error("build evidence already exists; use a fresh release directory");
  const isolatedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-release-evidence-"));
  try {
    const environment = {
      HOME: process.env.HOME || os.homedir(),
      PATH: process.env.PATH,
      NODE_ENV: "test",
      DATABASE_FILE: path.join(isolatedDirectory, "birdora.sqlite"),
      DATA_DIRECTORY: isolatedDirectory,
      COMMUNITY_UPLOAD_DIR: path.join(isolatedDirectory, "uploads", "community"),
      OBSERVATION_UPLOAD_DIR: path.join(isolatedDirectory, "uploads", "observations"),
      JWT_SECRET: "isolated-release-evidence-secret-at-least-32-characters",
      ALLOWED_ORIGINS: "http://127.0.0.1:4174",
    };
    const commands = [
      run(releaseDirectory, "pnpm test", ["test"], environment),
      run(releaseDirectory, "pnpm test:atlas", ["test:atlas"], environment),
      run(releaseDirectory, "pnpm audit --prod", ["audit", "--prod"], environment),
    ];
    const pnpmVersion = spawnSync("pnpm", ["--version"], {
      cwd: releaseDirectory,
      env: environment,
      encoding: "utf8",
      shell: false,
    });
    if (pnpmVersion.status !== 0) throw new Error("could not record pnpm version");
    const evidence = {
      formatVersion: 1,
      revision,
      completedAt: new Date().toISOString(),
      passed: commands.every((command) => command.exitCode === 0),
      nodeVersion: process.version,
      pnpmVersion: pnpmVersion.stdout.trim(),
      lockfileSha256: hashFile(path.join(releaseDirectory, "pnpm-lock.yaml")),
      commands,
    };
    if (!evidence.passed) throw new Error("release evidence command failed; no signed release may be created");
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: "wx", mode: 0o644 });
    const descriptor = fs.openSync(evidencePath, "r+");
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, evidencePath, revision, commands })}\n`);
  } finally {
    fs.rmSync(isolatedDirectory, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "RELEASE_EVIDENCE_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
