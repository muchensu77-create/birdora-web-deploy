const path = require("path");
const { spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const testFiles = [
  "scripts/test-database-migrations.js",
  "scripts/test-database-safety.js",
  "scripts/test-database-concurrency.js",
  "scripts/test-legacy-v1-6-probe.js",
  "scripts/test-legacy-adoption-evidence.js",
  "scripts/test-release-artifacts.js",
  "scripts/test-activation-write-gate.js",
  "scripts/test-activation-journal.js",
  "scripts/test-release-pointer.js",
  "scripts/test-production-env.js",
  "scripts/test-database-lifecycle-lock.js",
  "scripts/test-deployment-contracts.js",
  "scripts/test-frontend-contracts.js",
  "scripts/test-security-contracts.js",
  "scripts/test-recognition-work-queue.js",
  "scripts/test-phase0-backend.js",
  "scripts/test-outbox-worker.js",
  "scripts/test-api-integration.js",
];

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, [testFile], {
    cwd: projectRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    break;
  }
}
