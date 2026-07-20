const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const STATE_PATH =
  process.env.BIRDORA_BROWSER_STATE_PATH ||
  path.join(os.tmpdir(), "birdora-browser50-current.json");
const EXPECTED_COUNT = Number(process.env.BIRDORA_BROWSER_EXPECTED_COUNT || "50");
const MAX_CONCURRENCY = Number(process.env.BIRDORA_BROWSER_MAX_CONCURRENCY || String(EXPECTED_COUNT));
const START_DELAY_MS = Number(process.env.BIRDORA_BROWSER_START_DELAY_MS || "20000");
const PER_WORKER_TIMEOUT_MS = Number(process.env.BIRDORA_BROWSER_WORKER_TIMEOUT_MS || "240000");

function readState() {
  if (!fs.existsSync(STATE_PATH)) {
    throw new Error(`Harness state not found: ${STATE_PATH}. Run scripts/browser-50-agent-harness.ps1 start first.`);
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf8").replace(/^\uFEFF/, ""));
}

function getPnpmExecutable() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function getNodeExecutable() {
  return process.execPath;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function spawnWorker({ state, userIndex, startAtMs, logsDir }) {
  const label = `agent-${String(userIndex).padStart(2, "0")}`;
  const logPath = path.join(logsDir, `${label}.log`);
  const log = fs.createWriteStream(logPath, { flags: "w" });
  const startedAtMs = Date.now();
  const child = spawn(getNodeExecutable(), ["scripts/test-browser-user-flow-worker.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      WEB_BASE_URL: state.webBaseUrl,
      E2E_API_BASE_URL: state.apiBaseUrl,
      BIRDORA_BROWSER_RUN_ID: state.runId,
      BIRDORA_BROWSER_RESULT_DIR: state.resultDir,
      BIRDORA_BROWSER_USER_INDEX: String(userIndex),
      BIRDORA_BROWSER_START_AT_MS: String(startAtMs),
      BIRDORA_BROWSER_FLOW_TIMEOUT_MS: process.env.BIRDORA_BROWSER_FLOW_TIMEOUT_MS || "120000",
      BIRDORA_BROWSER_RECOGNITION_TIMEOUT_MS:
        process.env.BIRDORA_BROWSER_RECOGNITION_TIMEOUT_MS || "180000",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  child.stdout.on("data", (chunk) => log.write(chunk));
  child.stderr.on("data", (chunk) => log.write(chunk));

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill();
      log.write(`\n${label} killed after ${PER_WORKER_TIMEOUT_MS}ms timeout\n`);
    }, PER_WORKER_TIMEOUT_MS);

    child.on("exit", (code, signal) => {
      clearTimeout(timeout);
      log.end();
      resolve({
        label,
        userIndex,
        pid: child.pid,
        startedAtMs,
        completedAtMs: Date.now(),
        durationMs: Date.now() - startedAtMs,
        exitCode: code,
        signal,
        logPath,
        resultPath: path.join(state.resultDir, `${label}.json`),
      });
    });
  });
}

function summarizeExit(results) {
  return {
    total: results.length,
    exitZero: results.filter((result) => result.exitCode === 0).length,
    exitNonZero: results.filter((result) => result.exitCode !== 0).length,
    minStartedAtMs: Math.min(...results.map((result) => result.startedAtMs)),
    maxStartedAtMs: Math.max(...results.map((result) => result.startedAtMs)),
    minCompletedAtMs: Math.min(...results.map((result) => result.completedAtMs)),
    maxCompletedAtMs: Math.max(...results.map((result) => result.completedAtMs)),
  };
}

async function runSummary(state) {
  const reportJson = path.join(PROJECT_ROOT, "docs", "browser-50-agent-flow-report.json");
  const reportMd = path.join(PROJECT_ROOT, "docs", "browser-50-agent-flow-report.md");
  const child = spawn(getNodeExecutable(), ["scripts/summarize-browser-agent-results.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      BIRDORA_BROWSER_RESULT_DIR: state.resultDir,
      BIRDORA_BROWSER_RUN_ID: state.runId,
      BIRDORA_BROWSER_EXPECTED_COUNT: String(EXPECTED_COUNT),
      BIRDORA_BROWSER_REPORT_JSON: reportJson,
      BIRDORA_BROWSER_REPORT_MD: reportMd,
    },
    stdio: "inherit",
    windowsHide: true,
  });

  const code = await new Promise((resolve) => child.on("exit", resolve));
  return {
    code,
    reportJson,
    reportMd,
  };
}

async function main() {
  if (!Number.isInteger(EXPECTED_COUNT) || EXPECTED_COUNT < 1 || EXPECTED_COUNT > 100) {
    throw new Error("BIRDORA_BROWSER_EXPECTED_COUNT must be between 1 and 100.");
  }
  if (!Number.isInteger(MAX_CONCURRENCY) || MAX_CONCURRENCY < 1 || MAX_CONCURRENCY > EXPECTED_COUNT) {
    throw new Error("BIRDORA_BROWSER_MAX_CONCURRENCY must be between 1 and BIRDORA_BROWSER_EXPECTED_COUNT.");
  }

  const state = readState();
  const logsDir = path.join(state.resultDir, "logs");
  fs.mkdirSync(logsDir, { recursive: true });

  const launchStartedAtMs = Date.now();
  const startAtMs = launchStartedAtMs + START_DELAY_MS;
  const runnerPath = path.join(state.resultDir, "runner-50-pages.json");
  let nextUserIndex = 1;
  const runWorkerQueue = async () => {
    const queueResults = [];
    while (nextUserIndex <= EXPECTED_COUNT) {
      const userIndex = nextUserIndex;
      nextUserIndex += 1;
      queueResults.push(await spawnWorker({ state, userIndex, startAtMs, logsDir }));
    }
    return queueResults;
  };
  const workers = Array.from({ length: MAX_CONCURRENCY }, () => runWorkerQueue());

  const launchCompletedAtMs = Date.now();
  console.log(
    `Scheduled ${EXPECTED_COUNT} browser workers at max concurrency ${MAX_CONCURRENCY} in ` +
      `${launchCompletedAtMs - launchStartedAtMs}ms. Shared first-wave start gate: ` +
      `${new Date(startAtMs).toISOString()}`
  );

  const results = (await Promise.all(workers)).flat().sort((left, right) => left.userIndex - right.userIndex);
  const exitSummary = summarizeExit(results);
  const summaryResult = await runSummary(state);
  const runner = {
    runId: state.runId,
    webBaseUrl: state.webBaseUrl,
    apiBaseUrl: state.apiBaseUrl,
    resultDir: state.resultDir,
    expectedCount: EXPECTED_COUNT,
    maxConcurrency: MAX_CONCURRENCY,
    strictSimultaneous: MAX_CONCURRENCY === EXPECTED_COUNT,
    launchStartedAt: new Date(launchStartedAtMs).toISOString(),
    launchCompletedAt: new Date(launchCompletedAtMs).toISOString(),
    launchWindowMs: launchCompletedAtMs - launchStartedAtMs,
    startGateAt: new Date(startAtMs).toISOString(),
    startDelayMs: START_DELAY_MS,
    exitSummary: {
      ...exitSummary,
      workerStartWindowMs: exitSummary.maxStartedAtMs - exitSummary.minStartedAtMs,
      workerCompletionWindowMs: exitSummary.maxCompletedAtMs - exitSummary.minCompletedAtMs,
    },
    summaryResult,
    workers: results,
  };
  writeJson(runnerPath, runner);
  console.log(JSON.stringify(runner, null, 2));

  if (exitSummary.exitNonZero || summaryResult.code !== 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
