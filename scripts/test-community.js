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
const fakePngDataUrl = "data:image/png;base64,aGVsbG8=";
const accounts = {
  author: {
    email: `community-author-${suffix}@example.com`,
    nickname: "Author",
    password: "12345678",
  },
  reader: {
    email: `community-reader-${suffix}@example.com`,
    nickname: "Reader",
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

async function request(path, options = {}) {
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

  const response = await fetch(`${BASE_URL}${path}`, {
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

function getCommunityUploadDir() {
  if (process.env.COMMUNITY_UPLOAD_DIR) {
    return path.resolve(process.env.COMMUNITY_UPLOAD_DIR);
  }

  const databaseFile = path.resolve(process.env.DATABASE_FILE || defaultDatabaseFile);
  return path.join(path.dirname(databaseFile), "uploads", "community");
}

function getObservationUploadDir() {
  if (process.env.OBSERVATION_UPLOAD_DIR) {
    return path.resolve(process.env.OBSERVATION_UPLOAD_DIR);
  }

  const databaseFile = path.resolve(process.env.DATABASE_FILE || defaultDatabaseFile);
  return path.join(path.dirname(databaseFile), "uploads", "observations");
}

function removeStoredImageFiles(rows) {
  const uploadDir = path.resolve(getCommunityUploadDir());

  for (const row of rows) {
    const resolvedPath = path.resolve(uploadDir, row.storage_path || "");
    if (!resolvedPath.startsWith(`${uploadDir}${path.sep}`)) continue;
    fs.rmSync(resolvedPath, { force: true });
  }
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
    ],
    source: "community-test",
    observedAt: new Date().toISOString(),
    imageDataUrl: tinyPngDataUrl,
    imageName: "community-observation.png",
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
      SELECT images.storage_path
      FROM community_post_images AS images
      JOIN community_posts AS posts ON posts.id = images.post_id
      JOIN users ON users.id = posts.user_id
      WHERE users.email IN (?, ?)
    `).all(accounts.author.email, accounts.reader.email);
    const observationImageRows = db.prepare(`
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
    removeStoredImageFiles(imageRows);
    removeStoredObservationImages(observationImageRows);
    console.log("Cleaned generated community test accounts.");
  } catch (error) {
    console.warn(`Could not clean generated community data: ${error.message}`);
  }
}

async function main() {
  console.log(`Community API base URL: ${BASE_URL}`);
  assertApiWriteTargetSafety({
    scriptName: "test-community",
    baseUrl: BASE_URL,
    requireDatabaseFile: true,
  });

  const listWithBadOrigin = await request("/api/community/posts", {
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep("community list is not origin-guarded", listWithBadOrigin.status === 200, `HTTP ${listWithBadOrigin.status}`);

  const anonymousCreate = await request("/api/community/posts", {
    method: "POST",
    json: {
      title: "未登录发帖",
      body: "这条内容不应该创建成功。",
      bird: "观鸟笔记",
    },
  });
  assertStep("anonymous create is blocked", anonymousCreate.status === 401, `HTTP ${anonymousCreate.status}`);

  const badOriginCreate = await request("/api/community/posts", {
    method: "POST",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
    json: {
      title: "恶意来源发帖",
      body: "这条内容不应该创建成功。",
      bird: "观鸟笔记",
    },
  });
  assertStep(
    "non-allowlisted Origin community post is blocked",
    badOriginCreate.status === 403 && badOriginCreate.body?.message === "Forbidden",
    `HTTP ${badOriginCreate.status}`
  );

  const badOriginPatch = await request("/api/community/posts/origin-guard-test", {
    method: "PATCH",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
    json: {
      title: "恶意来源编辑",
      body: "这条内容不应该更新成功。",
    },
  });
  assertStep(
    "non-allowlisted Origin community patch is blocked",
    badOriginPatch.status === 403 && badOriginPatch.body?.message === "Forbidden",
    `HTTP ${badOriginPatch.status}`
  );

  const badOriginDelete = await request("/api/community/posts/origin-guard-test", {
    method: "DELETE",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep(
    "non-allowlisted Origin community delete is blocked",
    badOriginDelete.status === 403 && badOriginDelete.body?.message === "Forbidden",
    `HTTP ${badOriginDelete.status}`
  );

  const authorJar = await registerAndLogin(accounts.author);
  const readerJar = await registerAndLogin(accounts.reader);

  const authorObservation = await request("/api/observations", {
    method: "POST",
    cookieJar: authorJar,
    json: observationPayload(),
  });
  assertStep("author creates observation for community link", authorObservation.status === 201 && authorObservation.body?.observation?.id, `HTTP ${authorObservation.status}`);
  const authorObservationId = authorObservation.body.observation.id;

  const readerObservation = await request("/api/observations", {
    method: "POST",
    cookieJar: readerJar,
    json: observationPayload({ selectedSpeciesName: "麻雀", confidence: 0.82 }),
  });
  assertStep("reader creates observation for foreign link test", readerObservation.status === 201 && readerObservation.body?.observation?.id, `HTTP ${readerObservation.status}`);
  const readerObservationId = readerObservation.body.observation.id;

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
  assertStep("ordinary community post has no observationId", !created.body.post.observationId);
  assertStep("author can manage own post", created.body.post.canManage === true);
  assertStep("post image URL returned", Boolean(created.body.post.imageUrl));
  assertStep("copy analysis generated", created.body.post.analysis?.score > 0);
  assertStep("copy analysis suggestions returned", Array.isArray(created.body.post.analysis?.suggestions));
  const postImageUrl = created.body.post.imageUrl;

  const imageResponse = await request(postImageUrl);
  assertStep("post image is readable", imageResponse.status === 200, `HTTP ${imageResponse.status}`);

  const linkedPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "从观测记录发布",
      body: "这条帖子应当关联自己的 observationId。",
      bird: "翠鸟",
      observationId: authorObservationId,
    },
  });
  assertStep(
    "author creates post from own observation",
    linkedPost.status === 201 && linkedPost.body?.post?.observationId === authorObservationId,
    `HTTP ${linkedPost.status}`
  );
  const linkedPostId = linkedPost.body?.post?.id;

  const blockedForeignObservationPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "不应关联别人的记录",
      body: "这条帖子不应该创建成功。",
      bird: "麻雀",
      observationId: readerObservationId,
    },
  });
  assertStep("foreign observationId post is blocked", blockedForeignObservationPost.status === 403, `HTTP ${blockedForeignObservationPost.status}`);

  const blockedMissingObservationPost = await request("/api/community/posts", {
    method: "POST",
    cookieJar: authorJar,
    json: {
      title: "不存在的观测记录",
      body: "这条帖子不应该创建成功。",
      bird: "翠鸟",
      observationId: "missing-observation-id",
    },
  });
  assertStep("missing observationId post is blocked", blockedMissingObservationPost.status === 404, `HTTP ${blockedMissingObservationPost.status}`);

  const readerList = await request("/api/community/posts", {
    method: "GET",
    cookieJar: readerJar,
  });
  const readerPost = readerList.body?.posts?.find((post) => post.id === postId);
  assertStep("reader sees author post", readerList.status === 200 && readerPost, `HTTP ${readerList.status}`);
  assertStep("reader cannot manage author post", readerPost.canManage === false);
  assertStep("reader sees copy analysis", readerPost.analysis?.summary, "analysis summary present");
  assertStep("list returns comment count", Number.isFinite(Number(readerPost.commentCount)));

  const pagedList = await request("/api/community/posts?limit=1&offset=0", {
    method: "GET",
    cookieJar: readerJar,
  });
  assertStep("community list returns page info", pagedList.status === 200 && pagedList.body?.pageInfo, `HTTP ${pagedList.status}`);
  assertStep("community list respects limit", pagedList.body?.posts?.length <= 1);

  const anonymousDetail = await request(`/api/community/posts/${postId}`, {
    method: "GET",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep("anonymous can read post detail", anonymousDetail.status === 200 && anonymousDetail.body?.post?.id === postId, `HTTP ${anonymousDetail.status}`);
  assertStep("anonymous detail cannot manage", anonymousDetail.body?.post?.canManage === false);

  const authorDetail = await request(`/api/community/posts/${postId}`, {
    method: "GET",
    cookieJar: authorJar,
  });
  assertStep("author detail can manage", authorDetail.status === 200 && authorDetail.body?.post?.canManage === true, `HTTP ${authorDetail.status}`);

  const linkedPostDetail = await request(`/api/community/posts/${linkedPostId}`, {
    method: "GET",
  });
  const observationSummary = linkedPostDetail.body?.post?.observationSummary;
  assertStep("linked post detail returns observation summary", linkedPostDetail.status === 200 && observationSummary?.id === authorObservationId, `HTTP ${linkedPostDetail.status}`);
  assertStep("observation summary includes species", observationSummary?.selectedSpeciesName === "翠鸟");
  assertStep(
    "observation summary omits private image fields",
    !("imageUrl" in observationSummary) && !("imagePath" in observationSummary) && !("imageToken" in observationSummary)
  );

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
  const readerCommentId = commented.body.post.comments[0].id;
  assertStep("comment response marks author can manage", commented.body.post.comments[0].canManage === true);

  const authorCommented = await request(`/api/community/posts/${postId}/comments`, {
    method: "POST",
    cookieJar: authorJar,
    json: { body: "作者补充：它当时停在靠近水面的枝条上。" },
  });
  assertStep("author adds second comment", authorCommented.status === 201, `HTTP ${authorCommented.status}`);

  const badOriginComments = await request(`/api/community/posts/${postId}/comments?limit=1&offset=0`, {
    method: "GET",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep("comment pagination GET is not origin-guarded", badOriginComments.status === 200, `HTTP ${badOriginComments.status}`);

  const firstCommentPage = await request(`/api/community/posts/${postId}/comments?limit=1&offset=0`, {
    method: "GET",
    cookieJar: readerJar,
  });
  assertStep("comment pagination returns page info", firstCommentPage.status === 200 && firstCommentPage.body?.pageInfo, `HTTP ${firstCommentPage.status}`);
  assertStep("comment pagination respects limit", firstCommentPage.body?.comments?.length === 1);
  assertStep("comment pagination has more", firstCommentPage.body?.pageInfo?.hasMore === true);
  assertStep("comment pagination next offset", firstCommentPage.body?.pageInfo?.nextOffset === 1);
  assertStep("comment pagination count", firstCommentPage.body?.pageInfo?.commentCount >= 2 || firstCommentPage.body?.pageInfo?.total >= 2);

  const secondCommentPage = await request(`/api/community/posts/${postId}/comments?limit=1&offset=1`, {
    method: "GET",
    cookieJar: authorJar,
  });
  assertStep("comment pagination offset works", secondCommentPage.status === 200 && secondCommentPage.body?.comments?.length === 1, `HTTP ${secondCommentPage.status}`);

  const anonymousCommentDelete = await request(`/api/community/posts/${postId}/comments/${readerCommentId}`, {
    method: "DELETE",
  });
  assertStep("anonymous comment delete is blocked", anonymousCommentDelete.status === 401, `HTTP ${anonymousCommentDelete.status}`);

  const badOriginCommentDelete = await request(`/api/community/posts/${postId}/comments/${readerCommentId}`, {
    method: "DELETE",
    cookieJar: readerJar,
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  assertStep("non-allowlisted Origin comment delete is blocked", badOriginCommentDelete.status === 403, `HTTP ${badOriginCommentDelete.status}`);

  const otherUserCommentDelete = await request(`/api/community/posts/${postId}/comments/${readerCommentId}`, {
    method: "DELETE",
    cookieJar: authorJar,
  });
  assertStep("post author cannot delete reader comment", otherUserCommentDelete.status === 403, `HTTP ${otherUserCommentDelete.status}`);

  const missingCommentDelete = await request(`/api/community/posts/${postId}/comments/missing-comment-id`, {
    method: "DELETE",
    cookieJar: readerJar,
  });
  assertStep("missing comment delete returns 404", missingCommentDelete.status === 404, `HTTP ${missingCommentDelete.status}`);

  const ownCommentDelete = await request(`/api/community/posts/${postId}/comments/${readerCommentId}`, {
    method: "DELETE",
    cookieJar: readerJar,
  });
  assertStep("comment author deletes own comment", ownCommentDelete.status === 204, `HTTP ${ownCommentDelete.status}`);

  const commentsAfterDelete = await request(`/api/community/posts/${postId}/comments?limit=10&offset=0`, {
    method: "GET",
    cookieJar: readerJar,
  });
  const deletedCommentStillVisible = (commentsAfterDelete.body?.comments || []).some((comment) => comment.id === readerCommentId);
  assertStep("deleted comment is absent from comment list", commentsAfterDelete.status === 200 && !deletedCommentStillVisible, `HTTP ${commentsAfterDelete.status}`);

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

  const questionPage = await request(`/api/community/posts/${postId}/questions?limit=1&offset=0`, {
    method: "GET",
    cookieJar: readerJar,
  });
  assertStep("question pagination returns page info", questionPage.status === 200 && questionPage.body?.pageInfo, `HTTP ${questionPage.status}`);
  assertStep("question pagination respects limit", questionPage.body?.questions?.length === 1);
  assertStep("question pagination count", questionPage.body?.pageInfo?.questionCount >= 1 || questionPage.body?.pageInfo?.total >= 1);

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
