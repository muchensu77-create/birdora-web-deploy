require("dotenv").config({ quiet: true });

const { createDatabaseSnapshot, resolveDatabaseOptions } = require("../app/db/database");
const { assertExclusiveDatabaseLifecycleLock } = require("../app/runtime/database-lifecycle-lock");

try {
  if (resolveDatabaseOptions().productionLike) assertExclusiveDatabaseLifecycleLock();
  const backup = createDatabaseSnapshot();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    snapshotRequired: backup.snapshotRequired,
    reason: backup.reason || null,
    schemaVersion: backup.preMigrationSchemaVersion ?? null,
    targetSchemaVersion: backup.targetSchemaVersion ?? null,
    pendingVersions: backup.pendingVersions || [],
    backupPath: backup.backupPath || null,
    manifestPath: backup.manifestPath || null,
    backupSha256: backup.sha256 || null,
  })}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "DATABASE_BACKUP_FAILED",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
