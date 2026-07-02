const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../app/db/database");

const DEFAULT_PORT = process.env.PORT || "4000";
const API_BASE_URL = stripTrailingSlash(
  process.env.API_BASE_URL || process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`
);
const WEB_BASE_URL = stripTrailingSlash(process.env.WEB_BASE_URL || "http://127.0.0.1:4174");
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const BAD_TEST_ORIGIN = process.env.BAD_TEST_ORIGIN || "https://evil.example";
const USER_COUNT = parsePositiveInt(process.env.PEAK_USERS, 50);
const TIMEOUT_MS = parsePositiveInt(process.env.LOAD_TEST_TIMEOUT_MS, 15000);
const DURATION_SECONDS = parseNonNegativeInt(process.env.LOAD_TEST_DURATION_SECONDS, 0);
const RUN_ID = normalizeRunId(process.env.RUN_ID || String(Date.now()));
const REPORT_DIR = path.join(__dirname, "..", "docs");
const REPORT_MD_PATH = path.join(REPORT_DIR, "performance-report.md");
const REPORT_JSON_PATH = path.join(REPORT_DIR, "performance-report.json");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAFE_PATH_PATTERN = /(?:load[-_]?test|staging|(?:^|[\\\/_.-])test(?:[\\\/_.-]|$))/i;
const PRODUCTION_PATH_PATTERN = /(?:^|[\\\/])var[\\\/]lib[\\\/]birdora(?:[\\\/]|$)/i;
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=";
const fakePngDataUrl = "data:image/png;base64,aGVsbG8=";
const invalidMimeDataUrl = "data:text/plain;base64,aGVsbG8=";

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

function parsePositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : fallback;
}

function normalizeRunId(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "-");
  return normalized.startsWith("loadtest-d-") ? normalized : `loadtest-d-${normalized || Date.now()}`;
}

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

function hasSourceHeader(headers) {
  return Object.keys(headers).some((name) => ["origin", "referer"].includes(name.toLowerCase()));
}

function isLocalUrl(value) {
  const url = new URL(value);
  return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
}

function isSafeTestPath(value) {
  if (!value) return false;
  const resolved = path.resolve(value);
  if (PRODUCTION_PATH_PATTERN.test(resolved) && !SAFE_PATH_PATTERN.test(resolved)) {
    return false;
  }
  return SAFE_PATH_PATTERN.test(resolved);
}

function assertWriteSafety() {
  const databaseFile = process.env.DATABASE_FILE || "";
  const communityUploadDir = process.env.COMMUNITY_UPLOAD_DIR || "";
  const observationUploadDir = process.env.OBSERVATION_UPLOAD_DIR || "";

  if (!databaseFile) {
    throw new Error("DATABASE_FILE is required for write load tests and must point to an isolated test database.");
  }

  const checks = [
    ["DATABASE_FILE", databaseFile],
    ["COMMUNITY_UPLOAD_DIR", communityUploadDir],
    ["OBSERVATION_UPLOAD_DIR", observationUploadDir],
  ];

  for (const [name, value] of checks) {
    if (!value) {
      throw new Error(`${name} is required for write load tests.`);
    }
    if (!isSafeTestPath(value)) {
      throw new Error(`${name} must include load-test, staging, or test and must not point to production: ${value}`);
    }
  }

  if (!isLocalUrl(API_BASE_URL) && process.env.ALLOW_REMOTE_LOAD_TEST !== "1") {
    throw new Error(
      `Refusing remote write load test target ${API_BASE_URL}. Set ALLOW_REMOTE_LOAD_TEST=1 only for isolated staging.`
    );
  }
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
        const name = cookiePair.slice(0, separatorIndex).trim();
        const value = cookiePair.slice(separatorIndex + 1).trim();
        if (!name) return;
        cookies.set(name, value);
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

function compactBody(body) {
  if (body === null || body === undefined) return "";
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return text
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[redacted-image-data]")
    .slice(0, 240);
}

class LoadRecorder {
  constructor() {
    this.results = [];
  }

  async request(options) {
    const {
      scenario,
      endpoint,
      method = "GET",
      target = "api",
      pathname,
      json,
      cookieJar,
      headers = {},
      skipOrigin = false,
      expectedStatuses = [200],
      responseType = "json",
      businessCategory = "",
    } = options;

    const methodName = String(method).toUpperCase();
    const url = resolveRequestUrl(target, pathname);
    const start = Date.now();
    const finalHeaders = {
      Accept: responseType === "buffer" ? "*/*" : "application/json",
      ...headers,
    };

    if (json) {
      finalHeaders["Content-Type"] = "application/json";
    }

    if (cookieJar && cookieJar.count() > 0) {
      finalHeaders.Cookie = cookieJar.toHeader();
    }

    if (!SAFE_METHODS.has(methodName) && !skipOrigin && !hasSourceHeader(finalHeaders)) {
      finalHeaders.Origin = TEST_ORIGIN;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: methodName,
        headers: finalHeaders,
        body: json ? JSON.stringify(json) : undefined,
        signal: controller.signal,
      });

      if (cookieJar) {
        cookieJar.storeFromHeaders(response.headers);
      }

      const parsed = await readResponseBody(response, responseType);
      const ms = Date.now() - start;
      const status = response.status;
      const expected = isExpectedStatus(status, expectedStatuses, parsed.body);
      const result = {
        scenario,
        endpoint,
        method: methodName,
        url,
        status,
        expected,
        success: expected && status < 500,
        timeout: false,
        ms,
        bytes: parsed.bytes,
        requestId: response.headers.get("x-request-id") || "",
        businessCategory,
        body: responseType === "json" ? parsed.body : null,
        bodySample: compactBody(parsed.body),
      };
      this.results.push(result);
      return result;
    } catch (error) {
      const ms = Date.now() - start;
      const isTimeout = error.name === "AbortError";
      const result = {
        scenario,
        endpoint,
        method: methodName,
        url,
        status: 0,
        expected: false,
        success: false,
        timeout: isTimeout,
        ms,
        bytes: 0,
        requestId: "",
        businessCategory,
        error: isTimeout ? `timeout after ${TIMEOUT_MS}ms` : error.message,
        bodySample: "",
      };
      this.results.push(result);
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function resolveRequestUrl(target, pathname) {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const base = target === "web" ? WEB_BASE_URL : API_BASE_URL;
  return `${base}${pathname.startsWith("/") ? "" : "/"}${pathname}`;
}

async function readResponseBody(response, responseType) {
  if (responseType === "buffer") {
    const raw = await response.arrayBuffer();
    return {
      body: null,
      bytes: raw.byteLength,
    };
  }

  const rawText = await response.text();
  if (responseType === "text") {
    return {
      body: rawText,
      bytes: Buffer.byteLength(rawText),
    };
  }

  try {
    return {
      body: rawText ? JSON.parse(rawText) : null,
      bytes: Buffer.byteLength(rawText),
    };
  } catch {
    return {
      body: rawText,
      bytes: Buffer.byteLength(rawText),
    };
  }
}

function isExpectedStatus(status, expectedStatuses, body) {
  if (typeof expectedStatuses === "function") return Boolean(expectedStatuses(status, body));
  return expectedStatuses.includes(status);
}

function summarizeResults(results) {
  const durations = results.filter((result) => !result.timeout).map((result) => result.ms);
  const fourXx = {};
  const businessCategories = {};
  let fiveXx = 0;
  let rateLimited429 = 0;
  let timeouts = 0;
  let success = 0;

  for (const result of results) {
    if (result.success) success += 1;
    if (result.timeout) timeouts += 1;
    if (result.status >= 500) fiveXx += 1;
    if (result.status >= 400 && result.status < 500) {
      fourXx[result.status] = (fourXx[result.status] || 0) + 1;
    }
    if (result.status === 429) rateLimited429 += 1;
    if (result.businessCategory) {
      businessCategories[result.businessCategory] = (businessCategories[result.businessCategory] || 0) + 1;
    }
  }

  const failures = results.length - success;
  return {
    total: results.length,
    success,
    failures,
    fiveXx,
    fourXx,
    rateLimited429,
    timeouts,
    average: average(durations),
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations.length ? Math.max(...durations) : 0,
    min: durations.length ? Math.min(...durations) : 0,
    requestIdSamples: results
      .filter((result) => result.requestId)
      .slice(0, 12)
      .map((result) => ({
        scenario: result.scenario,
        endpoint: result.endpoint,
        status: result.status,
        requestId: result.requestId,
      })),
    errorSamples: results
      .filter((result) => !result.success || result.status >= 500 || result.timeout)
      .slice(0, 12)
      .map((result) => ({
        scenario: result.scenario,
        endpoint: result.endpoint,
        method: result.method,
        status: result.status,
        timeout: result.timeout,
        requestId: result.requestId,
        businessCategory: result.businessCategory,
        error: result.error || result.bodySample || "",
      })),
    businessCategories,
  };
}

function summarizeBy(results, keyFn) {
  const grouped = new Map();
  for (const result of results) {
    const key = keyFn(result);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(result);
  }

  return Array.from(grouped.entries())
    .map(([key, groupResults]) => ({
      key,
      ...summarizeResults(groupResults),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

function printSummary(label, summary) {
  console.log(
    `${label}: total=${summary.total}, success=${summary.success}, failures=${summary.failures}, ` +
      `5xx=${summary.fiveXx}, 429=${summary.rateLimited429}, timeouts=${summary.timeouts}, ` +
      `avg=${summary.average}ms, p50=${summary.p50}ms, p90=${summary.p90}ms, ` +
      `p95=${summary.p95}ms, p99=${summary.p99}ms, max=${summary.max}ms`
  );
}

function makeObservationPayload(index, overrides = {}) {
  return {
    selectedSpeciesName: "Kingfisher",
    selectedSpeciesScientificName: "Alcedo atthis",
    confidence: 0.91,
    topCandidates: [
      ["Kingfisher", "Alcedo atthis", 0.91, 3334],
      ["Little Egret", "Egretta garzetta", 0.04, 3048],
      ["Tree Sparrow", "Passer montanus", 0.02, 2194],
      ["Black Drongo", "Dicrurus macrocercus", 0.02, 1201],
      ["Barn Swallow", "Hirundo rustica", 0.01, 1888],
    ].map(([speciesName, scientificName, probability, oseaIndex], candidateIndex) => ({
      rank: candidateIndex + 1,
      speciesName,
      scientificName,
      englishName: speciesName,
      probability,
      oseaIndex,
      isMapped: true,
    })),
    locationText: `${RUN_ID} wetland test point ${index}`,
    notes: `[${RUN_ID}] observation save loop ${index}`,
    source: RUN_ID,
    observedAt: new Date().toISOString(),
    imageDataUrl: tinyPngDataUrl,
    imageName: `${RUN_ID}-observation-${index}.png`,
    ...overrides,
  };
}

function makePostPayload(index, observationId = "", withImage = false, overrides = {}) {
  return {
    title: `[${RUN_ID}] community post ${index}`,
    body:
      `[${RUN_ID}] Load test post ${index}. A bird was observed near a wetland trail in clear weather, ` +
      "with location, behavior, and context included for copy analysis.",
    bird: "Kingfisher",
    ...(observationId ? { observationId } : {}),
    ...(withImage
      ? {
          imageDataUrl: tinyPngDataUrl,
          imageName: `${RUN_ID}-community-${index}.png`,
        }
      : {}),
    ...overrides,
  };
}

function makeOversizedPngDataUrl() {
  const buffer = Buffer.alloc(1024 * 1024 + 16, 0);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function runVisitors(count, worker) {
  await Promise.all(range(count).map((index) => worker(index)));
}

async function runScenario(name, recorder, validations, worker) {
  console.log(`\n=== ${name} ===`);
  const startIndex = recorder.results.length;
  const startedAt = Date.now();
  try {
    const value = await worker();
    const results = recorder.results.slice(startIndex);
    const summary = summarizeResults(results);
    printSummary(name, summary);
    validations.push({
      name: `${name} completed`,
      passed: true,
      detail: `${results.length} requests in ${Date.now() - startedAt}ms`,
    });
    return value;
  } catch (error) {
    const results = recorder.results.slice(startIndex);
    const summary = summarizeResults(results);
    printSummary(name, summary);
    validations.push({
      name: `${name} completed`,
      passed: false,
      detail: error.message,
    });
    throw error;
  }
}

function addValidation(validations, name, passed, detail = "") {
  validations.push({ name, passed: Boolean(passed), detail });
  console.log(`${name}: ${passed ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
}

function scenarioResults(recorder, scenarioPrefix) {
  return recorder.results.filter((result) => result.scenario.startsWith(scenarioPrefix));
}

async function scenarioAStatic(recorder, validations) {
  const resources = [
    { path: "/", endpoint: "GET /", responseType: "text", kind: "page" },
    { path: "/styles.css", endpoint: "GET /styles.css", responseType: "text", kind: "asset" },
    { path: "/script.js", endpoint: "GET /script.js", responseType: "text", kind: "asset" },
    { path: "/community-api.js", endpoint: "GET /community-api.js", responseType: "text", kind: "asset" },
    { path: "/observation-api.js", endpoint: "GET /observation-api.js", responseType: "text", kind: "asset" },
    { path: "/assets/hero-birdora.png", endpoint: "GET /assets/hero-birdora.png", responseType: "buffer", kind: "image" },
  ];

  await runVisitors(USER_COUNT, async () => {
    for (const resource of resources) {
      await recorder.request({
        scenario: "A static resources",
        endpoint: resource.endpoint,
        target: "web",
        pathname: resource.path,
        responseType: resource.responseType,
        expectedStatuses: [200],
      });
    }
  });

  const results = scenarioResults(recorder, "A ");
  const nonImage = results.filter((result) => !result.endpoint.includes("hero-birdora"));
  const images = results.filter((result) => result.endpoint.includes("hero-birdora"));
  const nonImageSummary = summarizeResults(nonImage);
  const imageSummary = summarizeResults(images);
  addValidation(validations, "Scenario A 5xx = 0", summarizeResults(results).fiveXx === 0);
  addValidation(validations, "Scenario A p95 < 1000ms", nonImageSummary.p95 < 1000, `p95=${nonImageSummary.p95}ms`);
  addValidation(validations, "Scenario A image p95 < 1500ms", imageSummary.p95 < 1500, `p95=${imageSummary.p95}ms`);
}

async function scenarioCAuth(recorder, state, validations) {
  await runVisitors(USER_COUNT, async (index) => {
    const account = {
      email: `${RUN_ID}-user-${index}@example.test`,
      nickname: `LoadUser${index}`,
      password: "12345678",
    };
    const registerJar = createCookieJar();
    const loginJar = createCookieJar();

    const register = await recorder.request({
      scenario: "C auth session",
      endpoint: "POST /api/auth/register",
      method: "POST",
      pathname: "/api/auth/register",
      cookieJar: registerJar,
      json: account,
      expectedStatuses: [201],
    });

    const login = await recorder.request({
      scenario: "C auth session",
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

    await recorder.request({
      scenario: "C auth session",
      endpoint: "GET /api/auth/status",
      pathname: "/api/auth/status",
      cookieJar: loginJar,
      expectedStatuses: [200],
    });

    await recorder.request({
      scenario: "C auth session",
      endpoint: "GET /api/auth/me",
      pathname: "/api/auth/me",
      cookieJar: loginJar,
      expectedStatuses: [200],
    });

    await recorder.request({
      scenario: "C auth session",
      endpoint: "POST /api/auth/logout",
      method: "POST",
      pathname: "/api/auth/logout",
      cookieJar: loginJar,
      expectedStatuses: [200],
    });

    state.users[index] = {
      index,
      account,
      cookieJar: registerJar,
      registerStatus: register.status,
      loginStatus: login.status,
    };
  });

  const usersReady = state.users.length === USER_COUNT && state.users.every((user) => user?.cookieJar?.count() > 0);
  addValidation(validations, "Scenario C active test sessions are available", usersReady);
}

async function scenarioDObservations(recorder, state, validations) {
  const badOrigin = await recorder.request({
    scenario: "D observation save",
    endpoint: "POST /api/observations bad Origin",
    method: "POST",
    pathname: "/api/observations",
    cookieJar: state.users[0].cookieJar,
    headers: { Origin: BAD_TEST_ORIGIN },
    json: makeObservationPayload("bad-origin"),
    expectedStatuses: [403],
    businessCategory: "expected_403_origin_guard",
  });
  addValidation(validations, "Scenario D illegal Origin returns 403", badOrigin.status === 403);

  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index];
    const created = await recorder.request({
      scenario: "D observation save",
      endpoint: "POST /api/observations",
      method: "POST",
      pathname: "/api/observations",
      cookieJar: user.cookieJar,
      json: makeObservationPayload(index),
      expectedStatuses: [201],
    });

    const observation = created.body?.observation || null;
    state.observations[index] = observation;

    await recorder.request({
      scenario: "D observation save",
      endpoint: "GET /api/observations/me",
      pathname: "/api/observations/me",
      cookieJar: user.cookieJar,
      expectedStatuses: [200],
    });

    if (observation?.id) {
      await recorder.request({
        scenario: "D observation save",
        endpoint: "GET /api/observations/:id",
        pathname: `/api/observations/${encodeURIComponent(observation.id)}`,
        cookieJar: user.cookieJar,
        expectedStatuses: [200],
      });

      await recorder.request({
        scenario: "D observation save",
        endpoint: "GET /api/observations/:id/image",
        pathname: observation.imageUrl || `/api/observations/${encodeURIComponent(observation.id)}/image`,
        cookieJar: user.cookieJar,
        responseType: "buffer",
        expectedStatuses: [200],
      });
    }
  });

  const firstObservation = state.observations[0];
  if (firstObservation?.id && state.users[1]) {
    const crossRead = await recorder.request({
      scenario: "D observation save",
      endpoint: "GET /api/observations/:id/image cross user",
      pathname: firstObservation.imageUrl || `/api/observations/${encodeURIComponent(firstObservation.id)}/image`,
      cookieJar: state.users[1].cookieJar,
      responseType: "buffer",
      expectedStatuses: [403],
      businessCategory: "expected_403_cross_user_observation_image",
    });
    addValidation(validations, "Scenario D cross-user observation image is forbidden", crossRead.status === 403);
  }

  const createdCount = state.observations.filter(Boolean).length;
  addValidation(validations, "Scenario D created one observation per user", createdCount === USER_COUNT, `${createdCount}/${USER_COUNT}`);
}

async function scenarioECommunityWrite(recorder, state, validations) {
  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index];
    const observation = state.observations[index];
    const post = await recorder.request({
      scenario: "E community write",
      endpoint: "POST /api/community/posts",
      method: "POST",
      pathname: "/api/community/posts",
      cookieJar: user.cookieJar,
      json: makePostPayload(index, index % 2 === 0 ? observation?.id || "" : "", index % 10 === 0),
      expectedStatuses: [201],
    });

    state.posts[index] = post.body?.post || null;
  });

  const targetPost = state.posts.find(Boolean);
  if (!targetPost?.id) {
    throw new Error("Scenario E could not create a target community post.");
  }
  state.targetPostId = targetPost.id;

  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index];
    await recorder.request({
      scenario: "E community write",
      endpoint: "POST /api/community/posts/:id/reactions",
      method: "POST",
      pathname: `/api/community/posts/${encodeURIComponent(targetPost.id)}/reactions`,
      cookieJar: user.cookieJar,
      json: { reactionType: "helpful" },
      expectedStatuses: [200],
    });

    await recorder.request({
      scenario: "E community write",
      endpoint: "POST /api/community/posts/:id/comments",
      method: "POST",
      pathname: `/api/community/posts/${encodeURIComponent(targetPost.id)}/comments`,
      cookieJar: user.cookieJar,
      json: { body: `[${RUN_ID}] comment ${index}` },
      expectedStatuses: [201],
    });

    await recorder.request({
      scenario: "E community write",
      endpoint: "POST /api/community/posts/:id/questions",
      method: "POST",
      pathname: `/api/community/posts/${encodeURIComponent(targetPost.id)}/questions`,
      cookieJar: user.cookieJar,
      json: { body: `[${RUN_ID}] question ${index}` },
      expectedStatuses: [201],
    });
  });

  const commentPage = await recorder.request({
    scenario: "E community write",
    endpoint: "GET /api/community/posts/:id/comments map ids",
    pathname: `/api/community/posts/${encodeURIComponent(targetPost.id)}/comments?limit=50&offset=0`,
    cookieJar: state.users[0].cookieJar,
    expectedStatuses: [200],
  });
  const comments = Array.isArray(commentPage.body?.comments) ? commentPage.body.comments : [];
  const commentsByBody = new Map(comments.map((comment) => [comment.body, comment.id]));
  state.commentIds = range(USER_COUNT).map((index) => commentsByBody.get(`[${RUN_ID}] comment ${index}`) || "");

  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index];
    const post = state.posts[index];
    if (!post?.id) return;
    await recorder.request({
      scenario: "E community write",
      endpoint: "PATCH /api/community/posts/:id",
      method: "PATCH",
      pathname: `/api/community/posts/${encodeURIComponent(post.id)}`,
      cookieJar: user.cookieJar,
      json: {
        title: `[${RUN_ID}] edited community post ${index}`,
        body:
          `[${RUN_ID}] Edited load test post ${index}. The observer added weather, distance, behavior, ` +
          "and habitat details to keep the copy analysis stable.",
      },
      expectedStatuses: [200],
    });
  });

  const createdCount = state.posts.filter(Boolean).length;
  addValidation(validations, "Scenario E created one post per user", createdCount === USER_COUNT, `${createdCount}/${USER_COUNT}`);
  addValidation(validations, "Scenario E mapped comments for deletion", state.commentIds.filter(Boolean).length === USER_COUNT);
}

async function scenarioBCommunityReadonly(recorder, state, validations) {
  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index] || {};
    await recorder.request({
      scenario: "B community readonly",
      endpoint: "GET /api/community/posts",
      pathname: "/api/community/posts?limit=50&offset=0",
      cookieJar: user.cookieJar,
      expectedStatuses: [200],
    });
  });

  const targetId = state.targetPostId;
  if (!targetId) throw new Error("Scenario B needs a target post from Scenario E.");

  await runVisitors(USER_COUNT, async (index) => {
    const user = state.users[index] || {};
    await recorder.request({
      scenario: "B community readonly",
      endpoint: "GET /api/community/posts/:id",
      pathname: `/api/community/posts/${encodeURIComponent(targetId)}`,
      cookieJar: user.cookieJar,
      expectedStatuses: [200],
    });

    await recorder.request({
      scenario: "B community readonly",
      endpoint: "GET /api/community/posts/:id/comments",
      pathname: `/api/community/posts/${encodeURIComponent(targetId)}/comments?limit=10&offset=0`,
      cookieJar: user.cookieJar,
      expectedStatuses: [200],
    });
  });

  const imagePost = state.posts.find((post) => post?.imageUrl);
  const imagePath = imagePost?.imageUrl || `/api/community/posts/${encodeURIComponent(targetId)}/image`;
  await runVisitors(USER_COUNT, async (index) => {
    await recorder.request({
      scenario: "B community readonly",
      endpoint: "GET /api/community/posts/:id/image",
      pathname: imagePath,
      cookieJar: state.users[index]?.cookieJar,
      responseType: "buffer",
      expectedStatuses: imagePost ? [200] : [404],
      businessCategory: imagePost ? "" : "expected_404_missing_community_image",
    });
  });

  const results = scenarioResults(recorder, "B ");
  const imageResults = results.filter((result) => result.endpoint.includes("/image"));
  addValidation(validations, "Scenario B 5xx = 0", summarizeResults(results).fiveXx === 0);
  addValidation(validations, "Scenario B image p95 < 1500ms", summarizeResults(imageResults).p95 < 1500);
}

async function scenarioEDeletes(recorder, state, validations) {
  const targetPostId = state.targetPostId;
  const firstCommentId = state.commentIds.find(Boolean);

  if (targetPostId && firstCommentId) {
    const badOriginDelete = await recorder.request({
      scenario: "E community write deletes",
      endpoint: "DELETE /api/community/posts/:postId/comments/:commentId bad Origin",
      method: "DELETE",
      pathname: `/api/community/posts/${encodeURIComponent(targetPostId)}/comments/${encodeURIComponent(firstCommentId)}`,
      cookieJar: state.users[0].cookieJar,
      headers: { Origin: BAD_TEST_ORIGIN },
      expectedStatuses: [403],
      businessCategory: "expected_403_origin_guard",
    });
    addValidation(validations, "Scenario E illegal Origin comment delete returns 403", badOriginDelete.status === 403);
  }

  await runVisitors(USER_COUNT, async (index) => {
    const commentId = state.commentIds[index];
    if (!targetPostId || !commentId) return;
    await recorder.request({
      scenario: "E community write deletes",
      endpoint: "DELETE /api/community/posts/:postId/comments/:commentId",
      method: "DELETE",
      pathname: `/api/community/posts/${encodeURIComponent(targetPostId)}/comments/${encodeURIComponent(commentId)}`,
      cookieJar: state.users[index].cookieJar,
      expectedStatuses: [204],
    });
  });

  await runVisitors(USER_COUNT, async (index) => {
    const post = state.posts[index];
    if (!post?.id) return;
    await recorder.request({
      scenario: "E community write deletes",
      endpoint: "DELETE /api/community/posts/:id",
      method: "DELETE",
      pathname: `/api/community/posts/${encodeURIComponent(post.id)}`,
      cookieJar: state.users[index].cookieJar,
      expectedStatuses: [204],
    });
  });
}

async function scenarioFModelFiles(recorder, validations) {
  const resources = [
    { path: "/assets/osea/bird_model.onnx", endpoint: "GET /assets/osea/bird_model.onnx", responseType: "buffer" },
    {
      path: "/assets/vendor/ort-wasm-simd-threaded.wasm",
      endpoint: "GET /assets/vendor/ort-wasm-simd-threaded.wasm",
      responseType: "buffer",
    },
    { path: "/assets/osea/bird_info.json", endpoint: "GET /assets/osea/bird_info.json", responseType: "text" },
  ];

  await runVisitors(USER_COUNT, async () => {
    for (const resource of resources) {
      await recorder.request({
        scenario: "F model static downloads",
        endpoint: resource.endpoint,
        target: "web",
        pathname: resource.path,
        responseType: resource.responseType,
        expectedStatuses: [200],
      });
    }
  });

  const results = scenarioResults(recorder, "F ");
  addValidation(validations, "Scenario F 5xx = 0", summarizeResults(results).fiveXx === 0);
}

async function scenarioGImageBoundaries(recorder, state, validations) {
  const user = state.users[0];
  const oversizedPng = makeOversizedPngDataUrl();

  const legalPost = await recorder.request({
    scenario: "G image boundaries",
    endpoint: "POST /api/community/posts legal image",
    method: "POST",
    pathname: "/api/community/posts",
    cookieJar: user.cookieJar,
    json: makePostPayload("image-boundary", "", true),
    expectedStatuses: [201],
  });

  if (legalPost.body?.post?.imageUrl) {
    await recorder.request({
      scenario: "G image boundaries",
      endpoint: "GET /api/community/posts/:id/image legal",
      pathname: legalPost.body.post.imageUrl,
      responseType: "buffer",
      expectedStatuses: [200],
    });
  }

  const legalObservation = await recorder.request({
    scenario: "G image boundaries",
    endpoint: "POST /api/observations legal image",
    method: "POST",
    pathname: "/api/observations",
    cookieJar: user.cookieJar,
    json: makeObservationPayload("image-boundary"),
    expectedStatuses: [201],
  });

  if (legalObservation.body?.observation?.imageUrl) {
    await recorder.request({
      scenario: "G image boundaries",
      endpoint: "GET /api/observations/:id/image legal",
      pathname: legalObservation.body.observation.imageUrl,
      cookieJar: user.cookieJar,
      responseType: "buffer",
      expectedStatuses: [200],
    });
  }

  const invalidPayloads = [
    ["invalid MIME", invalidMimeDataUrl],
    ["bad data URL", fakePngDataUrl],
    ["oversized image", oversizedPng],
  ];

  for (const [label, imageDataUrl] of invalidPayloads) {
    await recorder.request({
      scenario: "G image boundaries",
      endpoint: `POST /api/community/posts ${label}`,
      method: "POST",
      pathname: "/api/community/posts",
      cookieJar: user.cookieJar,
      json: makePostPayload(`invalid-${label}`, "", false, {
        imageDataUrl,
        imageName: `${RUN_ID}-${label}.png`,
      }),
      expectedStatuses: [400],
      businessCategory: "expected_400_invalid_image",
    });

    await recorder.request({
      scenario: "G image boundaries",
      endpoint: `POST /api/observations ${label}`,
      method: "POST",
      pathname: "/api/observations",
      cookieJar: user.cookieJar,
      json: makeObservationPayload(`invalid-${label}`, {
        imageDataUrl,
        imageName: `${RUN_ID}-${label}.png`,
      }),
      expectedStatuses: [400],
      businessCategory: "expected_400_invalid_image",
    });
  }

  const imageReads = scenarioResults(recorder, "G ").filter((result) => result.endpoint.includes("GET"));
  addValidation(validations, "Scenario G image read p95 < 1500ms", summarizeResults(imageReads).p95 < 1500);
}

function getSqliteInfo() {
  try {
    const db = getDatabase();
    const journalRow = db.prepare("PRAGMA journal_mode").get();
    const busyRow = db.prepare("PRAGMA busy_timeout").get();
    return {
      journalMode: String(Object.values(journalRow || {})[0] || ""),
      busyTimeoutMs: Number(Object.values(busyRow || {})[0] || 0),
    };
  } catch (error) {
    return {
      journalMode: "unknown",
      busyTimeoutMs: 0,
      error: error.message,
    };
  }
}

function makeThresholdValidations(recorder, validations) {
  const all = summarizeResults(recorder.results);
  addValidation(validations, "Overall 5xx = 0", all.fiveXx === 0, `5xx=${all.fiveXx}`);
  addValidation(validations, "Overall timeout = 0", all.timeouts === 0, `timeouts=${all.timeouts}`);

  const writeResults = recorder.results.filter((result) =>
    /^(C|D|E|G) /.test(result.scenario) && !SAFE_METHODS.has(result.method)
  );
  const writeSummary = summarizeResults(writeResults);
  const writeSuccessRate = writeSummary.total ? writeSummary.success / writeSummary.total : 1;
  addValidation(
    validations,
    "Write business success rate >= 99%",
    writeSuccessRate >= 0.99,
    `${Math.round(writeSuccessRate * 10000) / 100}%`
  );

  const apiResults = recorder.results.filter((result) => result.url.startsWith(API_BASE_URL));
  const apiSummary = summarizeResults(apiResults);
  addValidation(validations, "API p95 < 1000ms", apiSummary.p95 < 1000, `p95=${apiSummary.p95}ms`);
}

function endpointSummaries(results) {
  return summarizeBy(results, (result) => `${result.scenario} ${result.method} ${result.endpoint}`);
}

function getBottleneckJudgment(results, sqliteInfo) {
  const endpoints = endpointSummaries(results);
  const slowest = [...endpoints].sort((a, b) => b.p95 - a.p95).slice(0, 5);
  const busyErrors = results.filter((result) => /SQLITE_BUSY|database is locked/i.test(result.error || result.bodySample || ""));
  const imageWrite = endpoints.find((item) => item.key.includes("POST /api/observations")) ||
    endpoints.find((item) => item.key.includes("POST /api/community/posts"));
  const staticModel = endpoints.find((item) => item.key.includes("bird_model.onnx"));

  return {
    sqliteWalEnabled: /^wal$/i.test(sqliteInfo.journalMode),
    sqliteBusyTimeoutConfigured: sqliteInfo.busyTimeoutMs > 0,
    explicitSqliteBusyErrors: busyErrors.length,
    lockWaitJudgment: busyErrors.length
      ? "SQLite lock errors were observed."
      : "No explicit SQLITE_BUSY/database locked errors were observed.",
    imageTailLatencyJudgment:
      imageWrite && imageWrite.p95 > 1000
        ? "Image-related writes are among the slower API paths and should be watched."
        : "Image-related writes did not show a clear tail-latency spike in this run.",
    staticBandwidthJudgment:
      staticModel && staticModel.p95 > 3000
        ? "Model file download p95 is high; static bandwidth/cache behavior should be reviewed."
        : "Model static downloads did not dominate the run by p95 threshold.",
    slowestEndpoints: slowest,
    recommendations: [
      imageWrite && imageWrite.p95 > 1000
        ? "Consider async image persistence or a small write queue if image writes remain slow."
        : "Keep image write instrumentation; async image persistence is not urgent from this run alone.",
      staticModel && staticModel.p95 > 3000
        ? "Review static asset caching and bandwidth before browser model ramp tests."
        : "Proceed to 1/5/10 real-browser model ramp after this script is stable.",
      "If 50-concurrency writes pass repeatedly but p95 grows at 100 users, evaluate PostgreSQL or a queue-backed write path.",
    ],
  };
}

function buildReportPayload(recorder, validations, startedAt, finishedAt, runError, state) {
  const sqliteInfo = getSqliteInfo();
  const allResults = recorder.results;
  const rawResults = allResults.map(({ body, ...result }) => result);
  const scenarioSummaries = summarizeBy(allResults, (result) => result.scenario);
  const endpoints = endpointSummaries(allResults);
  const allSummary = summarizeResults(allResults);
  const bottleneck = getBottleneckJudgment(allResults, sqliteInfo);

  return {
    runId: RUN_ID,
    startedAt,
    finishedAt,
    durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
    status: runError ? "failed" : validations.every((item) => item.passed) ? "passed" : "completed_with_findings",
    error: runError ? runError.message : "",
    environment: {
      apiBaseUrl: API_BASE_URL,
      webBaseUrl: WEB_BASE_URL,
      testOrigin: TEST_ORIGIN,
      badTestOrigin: BAD_TEST_ORIGIN,
      peakUsers: USER_COUNT,
      loadTestDurationSeconds: DURATION_SECONDS,
      loadTestTimeoutMs: TIMEOUT_MS,
      databaseFile: process.env.DATABASE_FILE || "",
      databaseFileIsIsolated: isSafeTestPath(process.env.DATABASE_FILE || ""),
      communityUploadDir: process.env.COMMUNITY_UPLOAD_DIR || "",
      communityUploadDirIsIsolated: isSafeTestPath(process.env.COMMUNITY_UPLOAD_DIR || ""),
      observationUploadDir: process.env.OBSERVATION_UPLOAD_DIR || "",
      observationUploadDirIsIsolated: isSafeTestPath(process.env.OBSERVATION_UPLOAD_DIR || ""),
      remoteLoadTestAllowed: process.env.ALLOW_REMOTE_LOAD_TEST === "1",
    },
    sqlite: sqliteInfo,
    summary: allSummary,
    scenarioSummaries,
    endpointSummaries: endpoints,
    validations,
    requestIdSamples: allSummary.requestIdSamples,
    errorSamples: allSummary.errorSamples,
    bottleneck,
    generatedData: {
      userPrefix: RUN_ID,
      users: state.users.map((user) => user?.account?.email).filter(Boolean),
      observations: state.observations.map((observation) => observation?.id).filter(Boolean),
      posts: state.posts.map((post) => post?.id).filter(Boolean),
      cleanupCommand:
        `node scripts/cleanup-load-test-data.js --runId ${RUN_ID} --yes`,
    },
    rawResults,
  };
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Birdora Performance Report");
  lines.push("");
  lines.push(`- Test time: ${report.startedAt} - ${report.finishedAt}`);
  lines.push(`- runId: \`${report.runId}\``);
  lines.push(`- status: \`${report.status}\``);
  lines.push(`- API_BASE_URL: \`${report.environment.apiBaseUrl}\``);
  lines.push(`- WEB_BASE_URL: \`${report.environment.webBaseUrl}\``);
  lines.push(`- TEST_ORIGIN: \`${report.environment.testOrigin}\``);
  lines.push(`- DATABASE_FILE isolated: \`${report.environment.databaseFileIsIsolated}\` (${report.environment.databaseFile})`);
  lines.push(`- COMMUNITY_UPLOAD_DIR isolated: \`${report.environment.communityUploadDirIsIsolated}\` (${report.environment.communityUploadDir})`);
  lines.push(`- OBSERVATION_UPLOAD_DIR isolated: \`${report.environment.observationUploadDirIsIsolated}\` (${report.environment.observationUploadDir})`);
  lines.push(`- SQLite WAL: \`${report.sqlite.journalMode}\``);
  lines.push(`- SQLite busy_timeout: \`${report.sqlite.busyTimeoutMs}ms\``);
  lines.push("");
  lines.push("## Overall Metrics");
  lines.push("");
  lines.push(summaryTable([["overall", report.summary]]));
  lines.push("");
  lines.push("## Scenario Results");
  lines.push("");
  lines.push(summaryTable(report.scenarioSummaries.map((item) => [item.key, item])));
  lines.push("");
  lines.push("## Endpoint Results");
  lines.push("");
  lines.push(summaryTable(report.endpointSummaries.map((item) => [item.key, item])));
  lines.push("");
  lines.push("## Validation");
  lines.push("");
  lines.push("| Check | Result | Detail |");
  lines.push("| --- | --- | --- |");
  for (const item of report.validations) {
    lines.push(`| ${escapeMd(item.name)} | ${item.passed ? "PASS" : "FAIL"} | ${escapeMd(item.detail || "")} |`);
  }
  lines.push("");
  lines.push("## 4xx Classification");
  lines.push("");
  lines.push(codeBlock(JSON.stringify(report.summary.fourXx, null, 2)));
  lines.push("");
  lines.push("## 5xx Details");
  lines.push("");
  const fiveXx = report.rawResults.filter((result) => result.status >= 500);
  lines.push(fiveXx.length ? codeBlock(JSON.stringify(fiveXx.slice(0, 20), null, 2)) : "No 5xx responses observed.");
  lines.push("");
  lines.push("## Request Id Samples");
  lines.push("");
  lines.push(report.requestIdSamples.length ? codeBlock(JSON.stringify(report.requestIdSamples, null, 2)) : "No request id samples captured.");
  lines.push("");
  lines.push("## Error Samples");
  lines.push("");
  lines.push(report.errorSamples.length ? codeBlock(JSON.stringify(report.errorSamples, null, 2)) : "No unexpected errors captured.");
  lines.push("");
  lines.push("## Bottleneck Judgment");
  lines.push("");
  lines.push(`- SQLite WAL enabled: ${report.bottleneck.sqliteWalEnabled}`);
  lines.push(`- SQLite busy_timeout configured: ${report.bottleneck.sqliteBusyTimeoutConfigured}`);
  lines.push(`- SQLite lock wait judgment: ${report.bottleneck.lockWaitJudgment}`);
  lines.push(`- Image tail latency: ${report.bottleneck.imageTailLatencyJudgment}`);
  lines.push(`- Static/model bandwidth: ${report.bottleneck.staticBandwidthJudgment}`);
  lines.push("");
  lines.push("Slowest endpoints by p95:");
  lines.push("");
  lines.push(summaryTable(report.bottleneck.slowestEndpoints.map((item) => [item.key, item])));
  lines.push("");
  lines.push("## Next Steps");
  lines.push("");
  for (const recommendation of report.bottleneck.recommendations) {
    lines.push(`- ${recommendation}`);
  }
  lines.push("");
  lines.push("## Cleanup");
  lines.push("");
  lines.push("Dry run:");
  lines.push("");
  lines.push(codeBlock(`node scripts/cleanup-load-test-data.js --runId ${report.runId}`));
  lines.push("");
  lines.push("Apply cleanup:");
  lines.push("");
  lines.push(codeBlock(report.generatedData.cleanupCommand));
  lines.push("");
  return lines.join("\n");
}

function summaryTable(entries) {
  const lines = [
    "| Name | Total | Success | Failures | 5xx | 429 | Timeout | Avg | p50 | p90 | p95 | p99 | Max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const [name, summary] of entries) {
    lines.push(
      `| ${escapeMd(name)} | ${summary.total} | ${summary.success} | ${summary.failures} | ${summary.fiveXx} | ` +
        `${summary.rateLimited429} | ${summary.timeouts} | ${summary.average}ms | ${summary.p50}ms | ` +
        `${summary.p90}ms | ${summary.p95}ms | ${summary.p99}ms | ${summary.max}ms |`
    );
  }
  return lines.join("\n");
}

function codeBlock(value) {
  return ["```", value, "```"].join("\n");
}

function escapeMd(value) {
  return String(value || "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function writeReports(report) {
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(REPORT_MD_PATH, toMarkdown(report));
}

async function main() {
  const startedAt = new Date().toISOString();
  const recorder = new LoadRecorder();
  const validations = [];
  const state = {
    users: [],
    observations: [],
    posts: [],
    commentIds: [],
    targetPostId: "",
  };
  let runError = null;

  console.log(`Birdora load test runId: ${RUN_ID}`);
  console.log(`API_BASE_URL: ${API_BASE_URL}`);
  console.log(`WEB_BASE_URL: ${WEB_BASE_URL}`);
  console.log(`TEST_ORIGIN: ${TEST_ORIGIN}`);
  console.log(`PEAK_USERS: ${USER_COUNT}`);
  console.log(`LOAD_TEST_TIMEOUT_MS: ${TIMEOUT_MS}`);
  console.log(`LOAD_TEST_DURATION_SECONDS: ${DURATION_SECONDS}`);

  try {
    assertWriteSafety();
    addValidation(validations, "Write target safety check", true);

    await runScenario("Scenario A: static resources", recorder, validations, () =>
      scenarioAStatic(recorder, validations)
    );
    await runScenario("Scenario C: login and session", recorder, validations, () =>
      scenarioCAuth(recorder, state, validations)
    );
    await runScenario("Scenario D: observation save loop", recorder, validations, () =>
      scenarioDObservations(recorder, state, validations)
    );
    await runScenario("Scenario E: community write loop", recorder, validations, () =>
      scenarioECommunityWrite(recorder, state, validations)
    );
    await runScenario("Scenario B: community readonly", recorder, validations, () =>
      scenarioBCommunityReadonly(recorder, state, validations)
    );
    await runScenario("Scenario E: community delete loop", recorder, validations, () =>
      scenarioEDeletes(recorder, state, validations)
    );
    await runScenario("Scenario F: model static downloads", recorder, validations, () =>
      scenarioFModelFiles(recorder, validations)
    );
    await runScenario("Scenario G: image boundary checks", recorder, validations, () =>
      scenarioGImageBoundaries(recorder, state, validations)
    );

    makeThresholdValidations(recorder, validations);
  } catch (error) {
    runError = error;
    addValidation(validations, "Load test run completed without fatal error", false, error.message);
  } finally {
    const finishedAt = new Date().toISOString();
    const report = buildReportPayload(recorder, validations, startedAt, finishedAt, runError, state);
    writeReports(report);
    printSummary("Overall", report.summary);
    console.log(`Markdown report: ${REPORT_MD_PATH}`);
    console.log(`JSON report: ${REPORT_JSON_PATH}`);
    console.log(`Cleanup dry run: node scripts/cleanup-load-test-data.js --runId ${RUN_ID}`);
    console.log(`Cleanup apply: node scripts/cleanup-load-test-data.js --runId ${RUN_ID} --yes`);
  }

  if (runError || validations.some((item) => !item.passed)) {
    process.exitCode = 1;
  }
}

main();
