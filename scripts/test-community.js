const DEFAULT_PORT = process.env.PORT || "4000";
const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;

const fs = require("fs");
const path = require("path");
const { getDatabase } = require("../app/db/database");

const suffix = Date.now();
const defaultDatabaseFile = path.join(__dirname, "..", "app", "data", "birdora.sqlite");
const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p94AAAAASUVORK5CYII=";
const fakePngDataUrl = "data:image/png;base64,aGVsbG8=";
const accounts = {
  author: {
    email: `community-author-${suffix}@example.com`,
    nickname: "Author",
    password: "123456",
  },
  reader: {
    email: `community-reader-${suffix}@example.com`,
    nickname: "Reader",
    password: "123456",
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

async function request(path, options = {}) {
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
      SELECT images.storage_path
      FROM community_post_images AS images
      JOIN community_posts AS posts ON posts.id = images.post_id
      JOIN users ON users.id = posts.user_id
      WHERE users.email IN (?, ?)
    `).all(accounts.author.email, accounts.reader.email);

    db.prepare("DELETE FROM users WHERE email IN (?, ?)").run(
      accounts.author.email,
      accounts.reader.email
    );
    removeStoredImageFiles(imageRows);
    console.log("Cleaned generated community test accounts.");
  } catch (error) {
    console.warn(`Could not clean generated community data: ${error.message}`);
  }
}

async function main() {
  console.log(`Community API base URL: ${BASE_URL}`);

  const anonymousCreate = await request("/api/community/posts", {
    method: "POST",
    json: {
      title: "未登录发帖",
      body: "这条内容不应该创建成功。",
      bird: "观鸟笔记",
    },
  });
  assertStep("anonymous create is blocked", anonymousCreate.status === 401, `HTTP ${anonymousCreate.status}`);

  const authorJar = await registerAndLogin(accounts.author);
  const readerJar = await registerAndLogin(accounts.reader);

  const invalidImage = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "伪装图片测试",
      body: "这条内容携带伪装成 PNG 的文本。",
      bird: "观鸟笔记",
      imageDataUrl: fakePngDataUrl,
      imageName: "fake.png",
    },
  });
  assertStep("invalid image data is blocked", invalidImage.status === 400, `HTTP ${invalidImage.status}`);

  const created = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "清晨的翠鸟记录",
      body: "在河边看到翠鸟停在低枝上，随后俯冲入水。",
      bird: "翠鸟",
      imageDataUrl: tinyPngDataUrl,
      imageName: "kingfisher-note.png",
    },
  });
  assertStep("author creates post", created.status === 201 && created.body?.post?.id, `HTTP ${created.status}`);
  const postId = created.body.post.id;
  assertStep("author can manage own post", created.body.post.canManage === true);
  assertStep("post image URL returned", Boolean(created.body.post.imageUrl));
  assertStep("copy analysis generated", created.body.post.analysis?.score > 0);
  assertStep("copy analysis suggestions returned", Array.isArray(created.body.post.analysis?.suggestions));
  const postImageUrl = created.body.post.imageUrl;

  const imageResponse = await request(postImageUrl);
  assertStep("post image is readable", imageResponse.status === 200, `HTTP ${imageResponse.status}`);

  const readerList = await request("/api/community/posts", {
    method: "GET",
    cookieJar: readerJar,
  });
  const readerPost = readerList.body?.posts?.find((post) => post.id === postId);
  assertStep("reader sees author post", readerList.status === 200 && readerPost, `HTTP ${readerList.status}`);
  assertStep("reader cannot manage author post", readerPost.canManage === false);
  assertStep("reader sees copy analysis", readerPost.analysis?.summary, "analysis summary present");

  const pagedList = await request("/api/community/posts?limit=1&offset=0", {
    method: "GET",
    cookieJar: readerJar,
  });
  assertStep("community list returns page info", pagedList.status === 200 && pagedList.body?.pageInfo, `HTTP ${pagedList.status}`);
  assertStep("community list respects limit", pagedList.body?.posts?.length <= 1);

  const reacted = await request(`/api/community/posts/${postId}/reactions`, {
    method: "POST",
    cookieJar: readerJar,
    json: { reactionType: "helpful" },
  });
  assertStep(
    "reader reacts to post",
    reacted.status === 200 && reacted.body?.post?.feedback?.helpful?.count === 1,
    `HTTP ${reacted.status}`
  );

  const commented = await request(`/api/community/posts/${postId}/comments`, {
    method: "POST",
    cookieJar: readerJar,
    json: { body: "这条记录很清楚，地点描述也有帮助。" },
  });
  assertStep(
    "reader comments on post",
    commented.status === 201 && commented.body?.post?.comments?.length === 1,
    `HTTP ${commented.status}`
  );

  const questioned = await request(`/api/community/posts/${postId}/questions`, {
    method: "POST",
    cookieJar: readerJar,
    json: { body: "它停留的位置离水面大概多高？" },
  });
  assertStep(
    "reader asks question",
    questioned.status === 201 && questioned.body?.post?.questions?.length === 1,
    `HTTP ${questioned.status}`
  );

  const blockedEdit = await request(`/api/community/posts/${postId}`, {
    method: "PATCH",
    cookieJar: readerJar,
    json: {
      title: "不应该成功",
      body: "读者不能修改作者帖子。",
    },
  });
  assertStep("reader edit is blocked", blockedEdit.status === 403, `HTTP ${blockedEdit.status}`);

  const blockedDelete = await request(`/api/community/posts/${postId}`, {
    method: "DELETE",
    cookieJar: readerJar,
  });
  assertStep("reader delete is blocked", blockedDelete.status === 403, `HTTP ${blockedDelete.status}`);

  const updated = await request(`/api/community/posts/${postId}`, {
    method: "PATCH",
    cookieJar: authorJar,
    json: {
      title: "清晨的翠鸟记录（已补充）",
      body: "在河边看到翠鸟停在低枝上，随后俯冲入水。补充：观察点在步道东侧。",
    },
  });
  assertStep(
    "author updates own post",
    updated.status === 200 && updated.body?.post?.title.includes("已补充") && updated.body?.post?.analysis?.score > 0,
    `HTTP ${updated.status}`
  );

  const finalList = await request("/api/community/posts", {
    method: "GET",
    cookieJar: readerJar,
  });
  const finalPost = finalList.body?.posts?.find((post) => post.id === postId);
  assertStep("reader sees updated post", finalPost?.title.includes("已补充"));
  assertStep("reader sees persisted comment", finalPost?.comments?.length === 1);
  assertStep("reader sees persisted question", finalPost?.questions?.length === 1);
  assertStep("reader sees persisted reaction", finalPost?.feedback?.helpful?.count === 1);

  const deleted = await request(`/api/community/posts/${postId}`, {
    method: "DELETE",
    cookieJar: authorJar,
  });
  assertStep("author deletes own post", deleted.status === 204, `HTTP ${deleted.status}`);

  const missingImage = await request(postImageUrl);
  assertStep("deleted post image is gone", missingImage.status === 404, `HTTP ${missingImage.status}`);
}

main()
  .then(() => {
    cleanupTestData();
  })
  .catch((error) => {
    cleanupTestData();
    console.error("\nCommunity test run failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
