const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function main() {
  if (process.platform !== "linux") {
    throw new Error("database holder verification requires Linux /proc");
  }
  const preflight = JSON.parse(process.env.PREFLIGHT_OUTPUT || "null");
  if (!preflight?.databaseExists || preflight.databaseEmpty) {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "database-missing-or-empty" })}\n`);
    return;
  }

  const databaseStats = fs.statSync(preflight.databasePath, { bigint: true });
  const database = new DatabaseSync(preflight.databasePath);
  const holders = [];
  try {
    database.exec("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;");
    for (const procEntry of fs.readdirSync("/proc", { withFileTypes: true })) {
      if (!procEntry.isDirectory() || !/^\d+$/u.test(procEntry.name)) continue;
      const pid = Number(procEntry.name);
      if (pid === process.pid) continue;
      let descriptorNames;
      try {
        descriptorNames = fs.readdirSync(`/proc/${pid}/fd`);
      } catch (error) {
        if (["EACCES", "EPERM"].includes(error.code)) {
          throw new Error(`cannot inspect /proc/${pid}/fd while proving database exclusivity`);
        }
        continue;
      }
      const holdsDatabase = descriptorNames.some((descriptorName) => {
        try {
          return sameFile(databaseStats, fs.statSync(`/proc/${pid}/fd/${descriptorName}`, { bigint: true }));
        } catch (error) {
          if (["EACCES", "EPERM"].includes(error.code)) throw error;
          return false;
        }
      });
      if (holdsDatabase) {
        let command = "unknown";
        try {
          command = fs.readFileSync(`/proc/${pid}/comm`, "utf8").trim() || command;
        } catch {
          // The process may have exited after descriptor inspection.
        }
        holders.push({ pid, command });
      }
    }
  } finally {
    try {
      database.exec("ROLLBACK;");
    } catch {
      // BEGIN EXCLUSIVE may itself have failed.
    }
    database.close();
  }

  if (holders.length) {
    throw new Error(`database still has open process holder(s): ${JSON.stringify(holders)}`);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: false, databasePath: preflight.databasePath })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "DATABASE_NOT_EXCLUSIVE",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
