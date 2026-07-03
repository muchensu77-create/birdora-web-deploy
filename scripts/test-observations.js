const DEFAULT_PORT = process.env.PORT || "4000";
const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const BAD_TEST_ORIGIN = process.env.BAD_TEST_ORIGIN || "https://evil.example";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const fs = require("fs");
const path = require("path");
const { getDatabase } = require("../app/db/database");
const { assertApiWriteTargetSafety } = require("./test-safety");

const suffix = Date.now();
const defaultDatabaseFile = path.join(__dirname, "..", "app", "data", "birdora.sqlite");
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=";
const accounts = {
  author: {
    email: `observation-author-${suffix}@example.com`,
    nickname: "Observation Author",
    password: "12345678",
  },
  reader: {
    email: `observation-reader-${suffix}@example.com`,
    nickname: "Observation Reader",
    password: "12345678",
  },
};

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

function hasSourceHeader(headers) {
  return Object.keys(headers).some((name) => ["origin", "referer"].includes(name.toLowerCase()));
}

async function request(pathname, options = {}) {
  const {
    method = "GET",
    json,
    cookieJar,
    headers = {},
    skipOrigin = false,
  } = options;
  const methodName = String(method).toUpperCase();

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

  if (!SAFE_METHODS.has(methodName) && !skipOrigin && !hasSourceHeader(finalHeaders)) {
    finalHeaders.Origin = TEST_ORIGIN;
  }

  const response = await fetch(`${BASE_URL}${pathname}`, {
    method: methodName,
    headers: finalHeaders,
    body: json ? JSON.stringify(json) : undefined,
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

  return {
    ok: response.ok,
    status: response.status,
    body,
  };
}

function assertStep(label, condition, detail = "") {
  console.log(`${label}: ${condition ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
  if (!condition) {
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
}

function getObservationUploadDir() {
  if (process.env.OBSERVATION_UPLOAD_DIR) {
    return path.resolve(process.env.OBSERVATION_UPLOAD_DIR);
  }

  const databaseFile = path.resolve(process.env.DATABASE_FILE || defaultDatabaseFile);
  return path.join(path.dirname(databaseFile), "uploads", "observations");
}

function removeStoredObservationImages(rows) {
  const uploadDir = path.resolve(getObservationUploadDir());

  for (const row of rows) {
    const resolvedPath = path.resolve(uploadDir, row.image_url || "");
    if (!resolvedPath.startsWith(`${uploadDir}${path.sep}`)) continue;
    fs.rmSync(resolvedPath, { force: true });
  }
}

function observationPayload(overrides = {}) {
  return {
    selectedSpeciesName: "翠鸟",
    selectedSpeciesScientificName: "Alcedo atthis",
    confidence: 0.91,
    topCandidates: [
      {
        rank: 1,
        speciesName: "翠鸟",
        scientificName: "Alcedo atthis",
        englishName: "Common Kingfisher",
        probability: 0.91,
        oseaIndex: 3334,
        isMapped: true,
      },
      {
        rank: 2,
        speciesName: "白鹭",
        scientificName: "Egretta garzetta",
        englishName: "Little Egret",
        probability: 0.04,
        oseaIndex: 3048,
        isMapped: true,
      },
    ],
    source: "test",
    observedAt: new Date().toISOString(),
    imageDataUrl: tinyPngDataUrl,
    imageName: "observation-test.png",
    ...overrides,
  };
}

async function registerAndLogin(account) {
  const jar = createCookieJar();
  const register = await request("/api/auth/register", {
    method: "POST",
    json: account,
  });
  assertStep(`register ${account.nickname}`, register.status === 201, `HTTP ${register.status}`);

  const login = await request("/api/auth/login", {
    method: "POST",
    cookieJar: jar,
    json: {
      email: account.email,
      password: account.password,
    },
  });
  assertStep(`login ${account.nickname}`, login.status === 200 && jar.count() > 0, `HTTP ${login.status}`);
  return jar;
}

function cleanupTestData() {
  try {
    const db = getDatabase();
    const imageRows = db.prepare(`
      SELECT observations.image_url
      FROM observations
      JOIN users ON users.id = observations.user_id
      WHERE users.email IN (?, ?)
    `).all(accounts.author.email, accounts.reader.email);

    db.prepare(`
      DELETE FROM community_posts
      WHERE user_id IN (
        SELECT id FROM users WHERE email IN (?, ?)
      )
    `).run(accounts.author.email, accounts.reader.email);
    db.prepare(`
      DELETE FROM observations
      WHERE user_id IN (
        SELECT id FROM users WHERE email IN (?, ?)
      )
    `).run(accounts.author.email, accounts.reader.email);
    db.prepare("DELETE FROM users WHERE email IN (?, ?)").run(
      accounts.author.email,
      accounts.reader.email
    );
    removeStoredObservationImages(imageRows);
    console.log("Cleaned generated observation test accounts.");
  } catch (error) {
    console.warn(`Could not clean generated observation data: ${error.message}`);
  }
}

async function main() {
  console.log(`Observation API base URL: ${BASE_URL}`);
  assertApiWriteTargetSafety({
    scriptName: "test-observations",
    baseUrl: BASE_URL,
    requireDatabaseFile: true,
  });

  const badOriginCreate = await request("/api/observations", {
    method: "POST",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
    json: observationPayload(),
  });
  assertStep(
    "non-allowlisted Origin observation create is blocked",
    badOriginCreate.status === 403 && badOriginCreate.body?.message === "Forbidden",
    `HTTP ${badOriginCreate.status}`
  );

  const anonymousCreate = await request("/api/observations", {
    method: "POST",
    json: observationPayload(),
  });
  assertStep("anonymous observation create is blocked", anonymousCreate.status === 401, `HTTP ${anonymousCreate.status}`);

  const authorJar = await registerAndLogin(accounts.author);
  const readerJar = await registerAndLogin(accounts.reader);

  const authorObservation = await request("/api/observations", {
    method: "POST",
    cookieJar: authorJar,
    json: observationPayload(),
  });
  assertStep(
    "author creates observation",
    authorObservation.status === 201 && authorObservation.body?.observation?.id,
    `HTTP ${authorObservation.status}`
  );
  const authorObservationId = authorObservation.body.observation.id;
  assertStep("observation image URL returned", Boolean(authorObservation.body.observation.imageUrl));
  assertStep("observation confidence persisted", authorObservation.body.observation.confidence === 0.91);
  assertStep("observation candidates persisted", authorObservation.body.observation.topCandidates?.length === 2);
  const authorObservationImageUrl = authorObservation.body.observation.imageUrl;

  const imageResponse = await request(authorObservationImageUrl, {
    method: "GET",
    cookieJar: authorJar,
  });
  assertStep("author can read own observation image", imageResponse.status === 200, `HTTP ${imageResponse.status}`);

  const imageWithBadOrigin = await request(authorObservationImageUrl, {
    method: "GET",
    cookieJar: authorJar,
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep("observation image GET is not origin-guarded", imageWithBadOrigin.status === 200, `HTTP ${imageWithBadOrigin.status}`);

  const blockedImageResponse = await request(authorObservationImageUrl, {
    method: "GET",
    cookieJar: readerJar,
  });
  assertStep("reader cannot read author observation image", blockedImageResponse.status === 403, `HTTP ${blockedImageResponse.status}`);

  const authorSecondObservation = await request("/api/observations", {
    method: "POST",
    cookieJar: authorJar,
    json: observationPayload({ selectedSpeciesName: "白鹭", confidence: 0.77 }),
  });
  assertStep("author creates second observation", authorSecondObservation.status === 201, `HTTP ${authorSecondObservation.status}`);
  const authorSecondObservationId = authorSecondObservation.body.observation.id;

  const readerObservation = await request("/api/observations", {
    method: "POST",
    cookieJar: readerJar,
    json: observationPayload({ selectedSpeciesName: "麻雀", confidence: 0.82 }),
  });
  assertStep("reader creates observation", readerObservation.status === 201, `HTTP ${readerObservation.status}`);
  const readerObservationId = readerObservation.body.observation.id;

  const authorList = await request("/api/observations/me", {
    method: "GET",
    cookieJar: authorJar,
  });
  const authorIds = new Set((authorList.body?.observations || []).map((observation) => observation.id));
  assertStep("author list includes own observation", authorList.status === 200 && authorIds.has(authorObservationId), `HTTP ${authorList.status}`);
  assertStep("author list excludes reader observation", !authorIds.has(readerObservationId));

  const blockedRead = await request(`/api/observations/${readerObservationId}`, {
    method: "GET",
    cookieJar: authorJar,
  });
  assertStep("author cannot read reader observation", blockedRead.status === 403, `HTTP ${blockedRead.status}`);

  const missingRead = await request("/api/observations/missing-observation-id", {
    method: "GET",
    cookieJar: authorJar,
  });
  assertStep("missing observation returns 404", missingRead.status === 404, `HTTP ${missingRead.status}`);

  const blockedDelete = await request(`/api/observations/${readerObservationId}`, {
    method: "DELETE",
    cookieJar: authorJar,
  });
  assertStep("author cannot delete reader observation", blockedDelete.status === 403, `HTTP ${blockedDelete.status}`);

  const badOriginDelete = await request(`/api/observations/${authorObservationId}`, {
    method: "DELETE",
    cookieJar: authorJar,
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep(
    "non-allowlisted Origin observation delete is blocked",
    badOriginDelete.status === 403 && badOriginDelete.body?.message === "Forbidden",
    `HTTP ${badOriginDelete.status}`
  );

  const ordinaryPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "普通观鸟笔记",
      body: "这是一条不关联观测记录的普通社区帖子。",
      bird: "观鸟笔记",
    },
  });
  assertStep("ordinary community post still works", ordinaryPost.status === 201 && !ordinaryPost.body.post.observationId, `HTTP ${ordinaryPost.status}`);

  const linkedPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "从观测记录发布",
      body: "这条帖子应当关联 observation_id。",
      bird: "翠鸟",
      observationId: authorObservationId,
    },
  });
  assertStep(
    "author creates post from own observation",
    linkedPost.status === 201 && linkedPost.body.post.observationId === authorObservationId,
    `HTTP ${linkedPost.status}`
  );

  const deleteLinked = await request(`/api/observations/${authorObservationId}`, {
    method: "DELETE",
    cookieJar: authorJar,
  });
  assertStep("linked observation delete is blocked", deleteLinked.status === 409, `HTTP ${deleteLinked.status}`);

  const blockedForeignPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "不应关联别人的记录",
      body: "这条帖子不应该创建成功。",
      bird: "麻雀",
      observationId: readerObservationId,
    },
  });
  assertStep("foreign observation post is blocked", blockedForeignPost.status === 403, `HTTP ${blockedForeignPost.status}`);

  const blockedMissingPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "不存在的观测记录",
      body: "这条帖子不应该创建成功。",
      bird: "翠鸟",
      observationId: "missing-observation-id",
    },
  });
  assertStep("missing observation post is blocked", blockedMissingPost.status === 404, `HTTP ${blockedMissingPost.status}`);

  const deleteOwnUnlinked = await request(`/api/observations/${authorSecondObservationId}`, {
    method: "DELETE",
    cookieJar: authorJar,
  });
  assertStep("author deletes own unlinked observation", deleteOwnUnlinked.status === 204, `HTTP ${deleteOwnUnlinked.status}`);
}

main()
  .then(() => {
    cleanupTestData();
  })
  .catch((error) => {
    cleanupTestData();
    console.error("\nObservation test run failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
