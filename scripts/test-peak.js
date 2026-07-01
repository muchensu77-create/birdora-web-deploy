const DEFAULT_PORT = process.env.PORT || "4000";
const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
const USER_COUNT = Number(process.env.PEAK_USERS || "50");

const fs = require("fs");
const path = require("path");
const { getDatabase } = require("../app/db/database");

const runId = Date.now();
const userPrefix = `peak-${runId}`;
const defaultDatabaseFile = path.join(__dirname, "..", "app", "data", "birdora.sqlite");
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=";

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

async function request(path, options = {}) {
  const start = Date.now();
  const {
    method = "GET",
    json,
    cookieJar,
    headers = {},
  } = options;

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

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
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
    body,
    ok: response.ok,
    status: response.status,
    ms: Date.now() - start,
  };
}

function percentile(values, pct) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((pct / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarize(label, results, acceptedStatuses = [200]) {
  const failures = results.filter((result) => !acceptedStatuses.includes(result.status));
  const durations = results.map((result) => result.ms);
  const summary = {
    label,
    count: results.length,
    failures: failures.length,
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    max: durations.length ? Math.max(...durations) : 0,
  };

  console.log(
    `${label}: count=${summary.count}, failures=${summary.failures}, p50=${summary.p50}ms, p95=${summary.p95}ms, max=${summary.max}ms`
  );

  if (failures.length) {
    const failure = failures[0];
    throw new Error(`${label} failed with HTTP ${failure.status}`);
  }

  return summary;
}

function getCommunityUploadDir() {
  if (process.env.COMMUNITY_UPLOAD_DIR) {
    return path.resolve(process.env.COMMUNITY_UPLOAD_DIR);
  }

  const databaseFile = path.resolve(process.env.DATABASE_FILE || defaultDatabaseFile);
  return path.join(path.dirname(databaseFile), "uploads", "community");
}

function removeStoredImageFiles(rows) {
  const uploadDir = path.resolve(getCommunityUploadDir());

  for (const row of rows) {
    const resolvedPath = path.resolve(uploadDir, row.storage_path || "");
    if (!resolvedPath.startsWith(`${uploadDir}${path.sep}`)) continue;
    fs.rmSync(resolvedPath, { force: true });
  }
}

async function registerAndLogin(index) {
  const account = {
    email: `${userPrefix}-${index}@example.com`,
    nickname: `PeakUser${index}`,
    password: "123456",
  };
  const cookieJar = createCookieJar();

  const register = await request("/api/auth/register", {
    method: "POST",
    json: account,
  });
  if (register.status !== 201) {
    throw new Error(`register user ${index} failed with HTTP ${register.status}`);
  }

  const login = await request("/api/auth/login", {
    method: "POST",
    cookieJar,
    json: {
      email: account.email,
      password: account.password,
    },
  });
  if (login.status !== 200 || cookieJar.count() < 1) {
    throw new Error(`login user ${index} failed with HTTP ${login.status}`);
  }

  return {
    account,
    cookieJar,
  };
}

function cleanupTestData() {
  try {
    const db = getDatabase();
    const imageRows = db.prepare(`
      SELECT images.storage_path
      FROM community_post_images AS images
      JOIN community_posts AS posts ON posts.id = images.post_id
      JOIN users ON users.id = posts.user_id
      WHERE users.email LIKE ?
    `).all(`${userPrefix}-%@example.com`);

    db.prepare("DELETE FROM users WHERE email LIKE ?").run(`${userPrefix}-%@example.com`);
    removeStoredImageFiles(imageRows);
    console.log("Cleaned generated peak test accounts.");
  } catch (error) {
    console.warn(`Could not clean generated peak data: ${error.message}`);
  }
}

async function main() {
  console.log(`Peak API base URL: ${BASE_URL}`);
  console.log(`Peak users: ${USER_COUNT}`);

  const users = [];
  for (let index = 0; index < USER_COUNT; index += 1) {
    users.push(await registerAndLogin(index));
  }

  const firstBrowse = await Promise.all(
    users.map((user) => request("/api/community/posts", { cookieJar: user.cookieJar }))
  );
  summarize("50 users browse community list", firstBrowse);

  const publishers = users.slice(0, Math.min(10, users.length));
  const publishResults = await Promise.all(
    publishers.map((user, index) =>
      request("/api/community/posts", {
        method: "POST",
        cookieJar: user.cookieJar,
        json: {
          title: `峰值测试观鸟笔记 ${index + 1}`,
          body: "用于模拟 50 人峰值下的图文文案发布。观察地点在湿地公园，记录到飞行和停枝行为。",
          bird: "观鸟笔记",
          ...(index < 3
            ? {
                imageDataUrl: tinyPngDataUrl,
                imageName: `peak-image-${index + 1}.png`,
              }
            : {}),
        },
      })
    )
  );
  summarize("10 users publish posts", publishResults, [201]);

  const createdPosts = publishResults.map((result) => result.body?.post).filter(Boolean);
  if (createdPosts.some((post) => !post.analysis?.summary)) {
    throw new Error("Created posts did not include copy analysis.");
  }

  const imagePosts = createdPosts.filter((post) => post.imageUrl);
  const imageResults = await Promise.all(
    imagePosts.map((post) => request(post.imageUrl, { cookieJar: publishers[0].cookieJar }))
  );
  summarize("3 uploaded post images are readable", imageResults);

  const targetPostId = createdPosts[0]?.id;
  if (!targetPostId) throw new Error("No target post was created for interactions.");

  const interactionUsers = users.slice(10, Math.min(30, users.length));
  const reactionResults = await Promise.all(
    interactionUsers.map((user) =>
      request(`/api/community/posts/${targetPostId}/reactions`, {
        method: "POST",
        cookieJar: user.cookieJar,
        json: { reactionType: "helpful" },
      })
    )
  );
  summarize("20 users react to one post", reactionResults);

  const commentResults = await Promise.all(
    interactionUsers.map((user, index) =>
      request(`/api/community/posts/${targetPostId}/comments`, {
        method: "POST",
        cookieJar: user.cookieJar,
        json: { body: `峰值测试评论 ${index + 1}` },
      })
    )
  );
  summarize("20 users comment on one post", commentResults, [201]);

  const questionUsers = users.slice(30, Math.min(40, users.length));
  const questionResults = await Promise.all(
    questionUsers.map((user, index) =>
      request(`/api/community/posts/${targetPostId}/questions`, {
        method: "POST",
        cookieJar: user.cookieJar,
        json: { body: `峰值测试提问 ${index + 1}` },
      })
    )
  );
  summarize("10 users ask questions", questionResults, [201]);

  const authorUpdate = await request(`/api/community/posts/${targetPostId}`, {
    method: "PATCH",
    cookieJar: publishers[0].cookieJar,
    json: {
      title: "峰值测试观鸟笔记 1（已编辑）",
      body: "作者在峰值测试中成功编辑自己的图文文案。",
    },
  });
  summarize("author edits own post", [authorUpdate]);

  const blockedUpdate = await request(`/api/community/posts/${targetPostId}`, {
    method: "PATCH",
    cookieJar: users[1].cookieJar,
    json: {
      title: "不应成功的编辑",
      body: "非作者不能编辑这条内容。",
    },
  });
  summarize("non-author edit is rejected", [blockedUpdate], [403]);

  const finalBrowse = await Promise.all(
    users.map((user) => request("/api/community/posts", { cookieJar: user.cookieJar }))
  );
  summarize("50 users refresh community list", finalBrowse);

  const finalPost = finalBrowse[0].body?.posts?.find((post) => post.id === targetPostId);
  if (!finalPost) throw new Error("Final browse could not find the target post.");
  if (finalPost.feedback?.helpful?.count !== interactionUsers.length) {
    throw new Error("Final browse did not preserve reaction count.");
  }
  if (finalPost.comments?.length !== interactionUsers.length) {
    throw new Error("Final browse did not preserve comments.");
  }
  if (finalPost.questions?.length !== questionUsers.length) {
    throw new Error("Final browse did not preserve questions.");
  }

  console.log("Peak test result: PASS");
}

main()
  .then(() => {
    cleanupTestData();
  })
  .catch((error) => {
    cleanupTestData();
    console.error("\nPeak test run failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
