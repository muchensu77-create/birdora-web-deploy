require("dotenv").config({ quiet: true });

const { preflightDatabase } = require("../app/db/database");

try {
  const status = preflightDatabase();
  process.stdout.write(`${JSON.stringify({
    ok: status.safeToApply,
    mode: "read-only",
    ...status,
  }, null, 2)}\n`);
  if (!status.safeToApply) process.exitCode = 2;
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    mode: "read-only",
    code: "DATABASE_PREFLIGHT_FAILED",
    message: error.message,
  }, null, 2)}\n`);
  process.exitCode = 1;
}
