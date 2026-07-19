const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const testOrigin = "http://127.0.0.1:4174";
const testFiles = [
  "scripts/test-auth.js",
  "scripts/test-community.js",
  "scripts/test-observations.js",
  "scripts/test-social.js",
  "scripts/test-drafts-notifications.js",
  "scripts/test-moderation.js",
];

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForReady(baseUrl, child, getOutput) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`API exited before readiness.\n${getOutput()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health/ready`);
      if (response.ok) return;
    } catch {
      // Listener is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API readiness timed out.\n${getOutput()}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once("close", resolve));
  child.kill();
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 12_000))]);
}

async function main() {
  const port = await getFreePort();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-api-test-suite-"));
  const databaseFile = path.join(tempDirectory, "birdora.sqlite");
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    AUTH_BASE_URL: `http://127.0.0.1:${port}`,
    TEST_ORIGIN: testOrigin,
    ALLOWED_ORIGINS: testOrigin,
    JWT_SECRET: "api-suite-secret-at-least-32-characters-long",
    DATABASE_FILE: databaseFile,
    COMMUNITY_UPLOAD_DIR: path.join(tempDirectory, "community"),
    OBSERVATION_UPLOAD_DIR: path.join(tempDirectory, "observations"),
    PASSWORD_WORKER_POOL_SIZE: "0",
    AUTH_RATE_LIMIT: "1000",
    COMMUNITY_WRITE_RATE_LIMIT: "1000",
    OBSERVATION_WRITE_RATE_LIMIT: "1000",
    COMMUNITY_PUBLISH_ENABLED: "true",
    COMMUNITY_POST_EDIT_ENABLED: "true",
    COMMUNITY_LEGACY_LIKE_ENABLED: "true",
    ACCOUNT_DELETION_ENABLED: "true",
    CONTENT_REPORT_RATE_LIMIT: "1000",
    MODERATION_DECISION_RATE_LIMIT: "1000",
    OUTBOX_WORKER_ENABLED: "true",
    OUTBOX_POLL_INTERVAL_MS: "100",
  };
  let output = "";
  const server = spawn(process.execPath, ["server.js"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });

  try {
    await waitForReady(env.AUTH_BASE_URL, server, () => output);
    for (const testFile of testFiles) {
      const result = spawnSync(process.execPath, [testFile], {
        cwd: projectRoot,
        env,
        stdio: "inherit",
      });
      if (result.error) throw result.error;
      if (result.status !== 0) {
        throw new Error(`${testFile} failed with exit code ${result.status}`);
      }
    }
  } finally {
    await stopServer(server);
    fs.rmSync(tempDirectory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
}

main().catch((error) => {
  console.error(`API integration suite failed: ${error.message}`);
  process.exitCode = 1;
});
