const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../app/db/database");
const { assertApiWriteTargetSafety, isSafeTestPath } = require("./test-safety");

const DEFAULT_PORT = process.env.PORT || "4000";
const API_BASE_URL = stripTrailingSlash(
  process.env.API_BASE_URL || process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`
);
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const USER_COUNT = parsePositiveInt(process.env.LARGE_IMAGE_USERS, 50);
const TIMEOUT_MS = parsePositiveInt(process.env.LARGE_IMAGE_TIMEOUT_MS, 20000);
const MIN_IMAGE_BYTES = parsePositiveInt(process.env.LARGE_IMAGE_MIN_BYTES, 512 * 1024);
const MAX_IMAGE_BYTES = Math.min(parsePositiveInt(process.env.LARGE_IMAGE_MAX_BYTES, 1000 * 1024), 1024 * 1024);
const RUN_ID = normalizeRunId(process.env.RUN_ID || process.env.LOAD_TEST_RUN_ID || String(Date.now()));
const REPORT_DIR = path.join(__dirname, "..", "docs");
const REPORT_MD_PATH = path.join(REPORT_DIR, "large-image-upload-report.md");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "large-image-upload-report.json");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function normalizeRunId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "-");
  return normalized.startsWith("large-image-") ? normalized : `large-image-${normalized || Date.now()}`;
}

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function average(values) {
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function hasSourceHeader(headers) {
  return Object.keys(headers).some((name) => ["origin", "referer"].includes(name.toLowerCase()));
}

function compactBody(body) {
  if (body === null || body === undefined) return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[redacted-image-data]")
    .slice(0, 240);
}

function createCookieJar() {
  const cookies = new Map();

  return {
    storeFromHeaders(headers) {
      const rawCookies = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")]
          : [];

      rawCookies.forEach((rawCookie) => {
        const [cookiePair] = rawCookie.split(";");
        const separatorIndex = cookiePair.indexOf("=");
        if (separatorIndex <= 0) return;
        cookies.set(
          cookiePair.slice(0, separatorIndex).trim(),
          cookiePair.slice(separatorIndex + 1).trim()
        );
      });
    },
    toHeader() {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    count() {
      return cookies.size;
    },
  };
}

async function request(options) {
  const {
    scenario,
    endpoint,
    method = "GET",
    pathname,
    json,
    cookieJar,
    headers = {},
    expectedStatuses = [200],
  } = options;
  const methodName = String(method).toUpperCase();
  const start = Date.now();
  const finalHeaders = {
    Accept: "application/json",
    ...headers,
  };

  if (json) {
    finalHeaders["Content-Type"] = "application/json";
  }

  if (cookieJar && cookieJar.count() > 0) {
    finalHeaders.Cookie = cookieJar.toHeader();
  }

  if (!SAFE_METHODS.has(methodName) && !hasSourceHeader(finalHeaders)) {
    finalHeaders.Origin = TEST_ORIGIN;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}${pathname}`, {
      method: methodName,
      headers: finalHeaders,
      body: json ? JSON.stringify(json) : undefined,
      signal: controller.signal,
    });

    if (cookieJar) {
      cookieJar.storeFromHeaders(response.headers);
    }

    const rawBody = await response.text();
    let body = rawBody;
    try {
      body = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      body = rawBody;
    }

    const status = response.status;
    const result = {
      scenario,
      endpoint,
      method: methodName,
      status,
      expected: expectedStatuses.includes(status),
      success: expectedStatuses.includes(status) && status < 500,
      timeout: false,
      ms: Date.now() - start,
      requestId: response.headers.get("x-request-id") || "",
      body,
      bodySample: compactBody(body),
    };
    return result;
  } catch (error) {
    const isTimeout = error.name === "AbortError";
    return {
      scenario,
      endpoint,
      method: methodName,
      status: 0,
      expected: false,
      success: false,
      timeout: isTimeout,
      ms: Date.now() - start,
      requestId: "",
      error: isTimeout ? `timeout after ${TIMEOUT_MS}ms` : error.message,
      bodySample: "",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeResults(results) {
  const durations = results.filter((result) => !result.timeout).map((result) => result.ms);
  const sqliteBusy = results.filter((result) =>
    /SQLITE_BUSY|database is locked/i.test(result.error || result.bodySample || "")
  ).length;
  const timeouts = results.filter((result) => result.timeout).length;
  const fiveXx = results.filter((result) => result.status >= 500).length;
  const success = results.filter((result) => result.success).length;

  return {
    total: results.length,
    success,
    failures: results.length - success,
    fiveXx,
    sqliteBusy,
    timeouts,
    average: average(durations),
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.length ? Math.max(...durations) : 0,
    errorSamples: results
      .filter((result) => !result.success || result.timeout || result.status >= 500)
      .slice(0, 12)
      .map((result) => ({
        scenario: result.scenario,
        endpoint: result.endpoint,
        status: result.status,
        timeout: result.timeout,
        requestId: result.requestId,
        error: result.error || result.bodySample || "",
      })),
  };
}

function summarizeMetrics(metrics) {
  const durations = metrics.filter((metric) => metric.ok !== false).map((metric) => Number(metric.durationMs) || 0);
  return {
    total: metrics.length,
    failures: metrics.filter((metric) => metric.ok === false).length,
    average: average(durations),
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.length ? Math.max(...durations) : 0,
  };
}

function makePngDataUrl(byteLength) {
  const size = Math.max(16, Math.min(byteLength, 1024 * 1024));
  const buffer = Buffer.alloc(size, 0x61);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

function imageSizeForIndex(index) {
  if (USER_COUNT <= 1) return MAX_IMAGE_BYTES;
  const spread = Math.max(0, MAX_IMAGE_BYTES - MIN_IMAGE_BYTES);
  return MIN_IMAGE_BYTES + Math.round((spread * index) / (USER_COUNT - 1));
}

function makeObservationPayload(index) {
  const imageBytes = imageSizeForIndex(index);
  return {
    selectedSpeciesName: "Kingfisher",
    selectedSpeciesScientificName: "Alcedo atthis",
    confidence: 0.91,
    topCandidates: [
      {
        rank: 1,
        speciesName: "Kingfisher",
        scientificName: "Alcedo atthis",
        englishName: "Common Kingfisher",
        probability: 0.91,
        oseaIndex: 3334,
        isMapped: true,
      },
    ],
    locationText: `${RUN_ID} large image observation point ${index}`,
    notes: `[${RUN_ID}] ${imageBytes} byte observation image upload`,
    source: RUN_ID,
    observedAt: new Date().toISOString(),
    imageDataUrl: makePngDataUrl(imageBytes),
    imageName: `${RUN_ID}-observation-${index}-${imageBytes}.png`,
  };
}

function makePostPayload(index) {
  const imageBytes = imageSizeForIndex(index);
  return {
    title: `[${RUN_ID}] large image community post ${index}`,
    body:
      `[${RUN_ID}] Large image community upload ${index}. The note includes wetland, weather, ` +
      "location, behavior, and observation context for copy analysis.",
    bird: "Kingfisher",
    imageDataUrl: makePngDataUrl(imageBytes),
    imageName: `${RUN_ID}-community-${index}-${imageBytes}.png`,
  };
}

async function registerAndLogin(index) {
  const account = {
    email: `${RUN_ID}-user-${index}@example.test`,
    nickname: `LargeImageUser${index}`,
    password: "12345678",
  };
  const registerJar = createCookieJar();
  const loginJar = createCookieJar();

  const register = await request({
    scenario: "setup auth",
    endpoint: "POST /api/auth/register",
    method: "POST",
    pathname: "/api/auth/register",
    cookieJar: registerJar,
    json: account,
    expectedStatuses: [201],
  });
  if (!register.success) {
    throw new Error(`register failed for ${account.email}: HTTP ${register.status} ${register.bodySample}`);
  }

  const login = await request({
    scenario: "setup auth",
    endpoint: "POST /api/auth/login",
    method: "POST",
    pathname: "/api/auth/login",
    cookieJar: loginJar,
    json: {
      email: account.email,
      password: account.password,
    },
    expectedStatuses: [200],
  });
  if (!login.success || loginJar.count() === 0) {
    throw new Error(`login failed for ${account.email}: HTTP ${login.status} ${login.bodySample}`);
  }

  return {
    index,
    account,
    cookieJar: loginJar,
  };
}

async function runUploadPhase(users, kind) {
  const scenario = kind === "community" ? "community large image upload" : "observation large image upload";
  return Promise.all(
    users.map((user) =>
      request({
        scenario,
        endpoint: kind === "community" ? "POST /api/community/posts" : "POST /api/observations",
        method: "POST",
        pathname: kind === "community" ? "/api/community/posts" : "/api/observations",
        cookieJar: user.cookieJar,
        json: kind === "community" ? makePostPayload(user.index) : makeObservationPayload(user.index),
        expectedStatuses: [201],
      })
    )
  );
}

function readImageWriteMetrics() {
  const metricsFile = process.env.IMAGE_WRITE_METRICS_FILE || "";
  if (!metricsFile || !fs.existsSync(metricsFile)) return [];

  return fs.readFileSync(metricsFile, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((metric) => !metric.runId || metric.runId === RUN_ID);
}

function resetImageWriteMetrics() {
  const metricsFile = process.env.IMAGE_WRITE_METRICS_FILE || "";
  if (!metricsFile) return;
  fs.mkdirSync(path.dirname(metricsFile), { recursive: true });
  fs.writeFileSync(metricsFile, "");
}

function removeStoredFiles(rows, uploadDir, fieldName) {
  const resolvedUploadDir = path.resolve(uploadDir);
  for (const row of rows) {
    const resolvedPath = path.resolve(resolvedUploadDir, row[fieldName] || "");
    if (!resolvedPath.startsWith(`${resolvedUploadDir}${path.sep}`)) continue;
    fs.rmSync(resolvedPath, { force: true });
  }
}

function cleanupTestData(users) {
  try {
    const emails = users.map((user) => user.account.email);
    if (!emails.length) return;

    const placeholders = emails.map(() => "?").join(", ");
    const db = getDatabase();
    const communityImages = db.prepare(`
      SELECT images.storage_path
      FROM community_post_images AS images
      JOIN community_posts AS posts ON posts.id = images.post_id
      JOIN users ON users.id = posts.user_id
      WHERE users.email IN (${placeholders})
    `).all(...emails);
    const observationImages = db.prepare(`
      SELECT observations.image_url
      FROM observations
      JOIN users ON users.id = observations.user_id
      WHERE users.email IN (${placeholders})
    `).all(...emails);

    db.prepare(`
      DELETE FROM community_posts
      WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))
    `).run(...emails);
    db.prepare(`
      DELETE FROM observations
      WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))
    `).run(...emails);
    db.prepare(`DELETE FROM users WHERE email IN (${placeholders})`).run(...emails);

    removeStoredFiles(communityImages, process.env.COMMUNITY_UPLOAD_DIR || "", "storage_path");
    removeStoredFiles(observationImages, process.env.OBSERVATION_UPLOAD_DIR || "", "image_url");
    console.log("Cleaned generated large image test data.");
  } catch (error) {
    console.warn(`Could not clean generated large image data: ${error.message}`);
  }
}

function summaryTable(entries) {
  const lines = [
    "| Name | Total | Success | Failures | 5xx | SQLITE_BUSY | Timeout | Avg | p50 | p90 | p95 | p99 | Max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, summary] of entries) {
    lines.push(
      `| ${name} | ${summary.total} | ${summary.success} | ${summary.failures} | ${summary.fiveXx} | ` +
        `${summary.sqliteBusy} | ${summary.timeouts} | ${summary.average}ms | ${summary.p50}ms | ` +
        `${summary.p90}ms | ${summary.p95}ms | ${summary.p99}ms | ${summary.max}ms |`
    );
  }
  return lines.join("\n");
}

function metricTable(entries) {
  const lines = [
    "| Name | Total | Failures | Avg | p50 | p90 | p95 | p99 | Max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, summary] of entries) {
    lines.push(
      `| ${name} | ${summary.total} | ${summary.failures} | ${summary.average}ms | ${summary.p50}ms | ` +
        `${summary.p90}ms | ${summary.p95}ms | ${summary.p99}ms | ${summary.max}ms |`
    );
  }
  return lines.join("\n");
}

function codeBlock(value) {
  return ["```", value, "```"].join("\n");
}

function buildReport({ startedAt, finishedAt, users, results, metrics, runError }) {
  const communityResults = results.filter((result) => result.scenario === "community large image upload");
  const observationResults = results.filter((result) => result.scenario === "observation large image upload");
  const communityMetrics = metrics.filter((metric) => metric.kind === "community");
  const observationMetrics = metrics.filter((metric) => metric.kind === "observation");

  return {
    runId: RUN_ID,
    startedAt,
    finishedAt,
    status: runError ? "failed" : results.every((result) => result.success) ? "passed" : "completed_with_findings",
    error: runError ? runError.message : "",
    environment: {
      apiBaseUrl: API_BASE_URL,
      testOrigin: TEST_ORIGIN,
      users: USER_COUNT,
      timeoutMs: TIMEOUT_MS,
      minImageBytes: MIN_IMAGE_BYTES,
      maxImageBytes: MAX_IMAGE_BYTES,
      databaseFile: process.env.DATABASE_FILE || "",
      databaseFileIsIsolated: isSafeTestPath(process.env.DATABASE_FILE || ""),
      communityUploadDir: process.env.COMMUNITY_UPLOAD_DIR || "",
      communityUploadDirIsIsolated: isSafeTestPath(process.env.COMMUNITY_UPLOAD_DIR || ""),
      observationUploadDir: process.env.OBSERVATION_UPLOAD_DIR || "",
      observationUploadDirIsIsolated: isSafeTestPath(process.env.OBSERVATION_UPLOAD_DIR || ""),
      imageWriteMetricsFile: process.env.IMAGE_WRITE_METRICS_FILE || "",
      imageWriteMetricsCaptured: metrics.length > 0,
    },
    summaries: {
      overall: summarizeResults(results),
      community: summarizeResults(communityResults),
      observation: summarizeResults(observationResults),
    },
    diskWrite: {
      overall: summarizeMetrics(metrics),
      community: summarizeMetrics(communityMetrics),
      observation: summarizeMetrics(observationMetrics),
    },
    generatedData: {
      users: users.map((user) => user.account.email),
    },
    errorSamples: summarizeResults(results).errorSamples,
    rawResults: results.map(({ body, ...result }) => result),
  };
}

function reportToMarkdown(report) {
  const lines = [];
  lines.push("# Birdora Large Image Upload Report");
  lines.push("");
  lines.push(`- Test time: ${report.startedAt} - ${report.finishedAt}`);
  lines.push(`- runId: \`${report.runId}\``);
  lines.push(`- status: \`${report.status}\``);
  lines.push(`- API_BASE_URL: \`${report.environment.apiBaseUrl}\``);
  lines.push(`- users: \`${report.environment.users}\``);
  lines.push(`- image bytes: \`${report.environment.minImageBytes}-${report.environment.maxImageBytes}\``);
  lines.push(`- DATABASE_FILE isolated: \`${report.environment.databaseFileIsIsolated}\` (${report.environment.databaseFile})`);
  lines.push(`- COMMUNITY_UPLOAD_DIR isolated: \`${report.environment.communityUploadDirIsIsolated}\` (${report.environment.communityUploadDir})`);
  lines.push(`- OBSERVATION_UPLOAD_DIR isolated: \`${report.environment.observationUploadDirIsIsolated}\` (${report.environment.observationUploadDir})`);
  lines.push(`- image write metrics captured: \`${report.environment.imageWriteMetricsCaptured}\` (${report.environment.imageWriteMetricsFile})`);
  lines.push("");
  lines.push("## Request Latency");
  lines.push("");
  lines.push(summaryTable([
    ["overall uploads", report.summaries.overall],
    ["community posts", report.summaries.community],
    ["observations", report.summaries.observation],
  ]));
  lines.push("");
  lines.push("## Disk Write Latency");
  lines.push("");
  lines.push(metricTable([
    ["overall image writes", report.diskWrite.overall],
    ["community image writes", report.diskWrite.community],
    ["observation image writes", report.diskWrite.observation],
  ]));
  lines.push("");
  lines.push("## Error Samples");
  lines.push("");
  lines.push(report.errorSamples.length ? codeBlock(JSON.stringify(report.errorSamples, null, 2)) : "No unexpected errors captured.");
  lines.push("");
  return lines.join("\n");
}

function writeReport(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(REPORT_MD_PATH, reportToMarkdown(report));
}

async function main() {
  const startedAt = new Date().toISOString();
  const users = [];
  let runError = null;
  let results = [];

  console.log(`Large image upload runId: ${RUN_ID}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`LARGE_IMAGE_USERS: ${USER_COUNT}`);
  console.log(`image bytes: ${MIN_IMAGE_BYTES}-${MAX_IMAGE_BYTES}`);

  try {
    assertApiWriteTargetSafety({
      scriptName: "test-large-image-upload",
      baseUrl: API_BASE_URL,
      requireDatabaseFile: true,
      requireUploadDirs: true,
    });
    resetImageWriteMetrics();

    for (const index of range(USER_COUNT)) {
      users.push(await registerAndLogin(index));
    }

    const observationResults = await runUploadPhase(users, "observation");
    const communityResults = await runUploadPhase(users, "community");
    results = [...observationResults, ...communityResults];
  } catch (error) {
    runError = error;
    console.error(`Large image upload test failed: ${error.message}`);
  } finally {
    const metrics = readImageWriteMetrics();
    const finishedAt = new Date().toISOString();
    const report = buildReport({ startedAt, finishedAt, users, results, metrics, runError });
    writeReport(report);
    cleanupTestData(users);
    console.log(`Large image Markdown report: ${REPORT_MD_PATH}`);
    console.log(`Large image JSON report: ${REPORT_JSON_PATH}`);
    console.log(`overall upload p95=${report.summaries.overall.p95}ms p99=${report.summaries.overall.p99}ms`);
    console.log(`disk write p95=${report.diskWrite.overall.p95}ms p99=${report.diskWrite.overall.p99}ms`);
  }

  if (runError || results.some((result) => !result.success)) {
    process.exitCode = 1;
  }
}

main();
