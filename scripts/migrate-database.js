require("dotenv").config({ quiet: true });

const {
  closeDatabase,
  getDatabaseHealth,
  getLastMigrationReport,
  initializeDatabase,
} = require("../app/db/database");
const { resolveDatabaseOptions } = require("../app/db/database");
const { assertMigrationActivationAuthorization } = require("../app/runtime/database-lifecycle-lock");

function main() {
  try {
    if (resolveDatabaseOptions().productionLike) assertMigrationActivationAuthorization();
    // This script is the explicit deployment apply step. Normal production
    // server startup leaves DATABASE_AUTO_MIGRATE=false and only validates.
    initializeDatabase({ autoMigrate: true, migrationCommand: true });
    const health = getDatabaseHealth();
    const report = getLastMigrationReport();
    if (!health.ready) {
      throw new Error("Database migration completed without a ready schema");
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      schemaVersion: health.schemaVersion,
      appliedNow: report?.appliedNow || [],
      backupPath: report?.backup?.backupPath || null,
      manifestPath: report?.backup?.manifestPath || null,
      backupSha256: report?.backup?.sha256 || null,
    })}\n`);
  } finally {
    closeDatabase();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "DATABASE_MIGRATION_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
