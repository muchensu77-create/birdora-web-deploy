const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const { DatabaseSync } = require("node:sqlite");

const projectRoot = path.resolve(__dirname, "..");
const temporaryDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "birdora-migration-concurrency-")
);
const databaseFile = path.join(temporaryDirectory, "shared.sqlite");
const ALL_MIGRATIONS = ["V001", "V002", "V003", "V004", "V005", "V006", "V007", "V008", "V009"];

function runMigrationProcess(label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/migrate-database.js"], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_FILE: databaseFile,
        LEGACY_JSON_IMPORT_MODE: "disabled",
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`${label} timed out while migrating the shared database`));
    }, 20_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      resolve({ label, status, signal, stdout, stderr });
    });
  });
}

async function main() {
  try {
    const results = await Promise.all([
      runMigrationProcess("migration process A"),
      runMigrationProcess("migration process B"),
    ]);
    for (const result of results) {
      assert.equal(
        result.status,
        0,
        `${result.label} failed (signal=${result.signal || "none"})\n${result.stderr}`
      );
      const outputLines = result.stdout.trim().split(/\r?\n/u).filter(Boolean);
      const payload = JSON.parse(outputLines.at(-1));
      assert.equal(payload.ok, true);
      assert.equal(payload.schemaVersion, "V009");
      if (payload.backupPath) {
        // A process may observe the other process between migration versions. That
        // is a legitimate non-empty pending snapshot and therefore requires a
        // validated backup before it proceeds.
        assert.equal(fs.existsSync(payload.backupPath), true);
        assert.equal(fs.existsSync(payload.manifestPath), true);
        assert.match(payload.backupSha256, /^[a-f0-9]{64}$/u);
      } else {
        assert.equal(payload.manifestPath, null);
      }
    }

    const db = new DatabaseSync(databaseFile);
    try {
      db.exec("PRAGMA foreign_keys = ON;");
      assert.deepEqual(
        db.prepare(`
          SELECT version
          FROM schema_migrations
          ORDER BY version
        `).all().map((row) => row.version),
        ALL_MIGRATIONS
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count,
        ALL_MIGRATIONS.length
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS count FROM data_migrations").get().count,
        3
      );
      assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []);
      assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    } finally {
      db.close();
    }

    console.log("ok - two concurrent migration processes share one idempotent ledger");
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error("not ok - concurrent database migrations");
  console.error(error.stack || error);
  process.exitCode = 1;
});
