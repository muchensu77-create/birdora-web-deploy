const assert = require("assert/strict");
const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const jwt = require("jsonwebtoken");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_FILE = path.join(ROOT_DIR, "server.js");
const TEST_ORIGIN = "http://127.0.0.1:4174";
const IMAGE_LIMIT = 1024 * 1024;
const VIDEO_LIMIT = 8 * 1024 * 1024;

function assertStep(label, condition, detail = "") {
  assert.ok(condition, detail || label);
  console.log(`PASS ${label}`);
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function waitForServer(baseUrl, child, getLogs) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready.\n${getLogs()}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {
      // The listener may not be bound yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for server.\n${getLogs()}`);
}

async function startServer(flags = {}) {
  const port = await getFreePort();
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-phase0-"));
  const databaseFile = path.join(tempDirectory, "birdora.sqlite");
  const uploadDirectory = path.join(tempDirectory, "uploads");
  let output = "";

  const child = spawn(process.execPath, [SERVER_FILE], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      ALLOWED_ORIGINS: TEST_ORIGIN,
      JWT_SECRET: "phase0-test-secret-at-least-32-characters-long",
      DATABASE_FILE: databaseFile,
      COMMUNITY_UPLOAD_DIR: uploadDirectory,
      PASSWORD_WORKER_POOL_SIZE: "0",
      AUTH_RATE_LIMIT: "1000",
      COMMUNITY_WRITE_RATE_LIMIT: "1000",
      ...flags,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForServer(baseUrl, child, () => output);

  return {
    baseUrl,
    child,
    tempDirectory,
    getLogs: () => output,
  };
}

async function stopServer(server) {
  if (!server) return;
  if (server.child.exitCode === null) {
    const closed = new Promise((resolve) => server.child.once("close", resolve));
    server.child.kill();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 3_000))]);
  }
  fs.rmSync(server.tempDirectory, { recursive: true, force: true });
}

function createCookieJar() {
  const cookies = new Map();
  return {
    store(headers) {
      const values = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")]
          : [];
      for (const value of values) {
        const pair = value.split(";", 1)[0];
        const separator = pair.indexOf("=");
        if (separator > 0) cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    },
    header() {
      return Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; ");
    },
  };
}

async function request(baseUrl, route, { method = "GET", json, body, cookieJar, headers = {} } = {}) {
  const finalHeaders = { Accept: "application/json", ...headers };
  if (json !== undefined) finalHeaders["Content-Type"] = "application/json";
  if (cookieJar?.header()) finalHeaders.Cookie = cookieJar.header();
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && !finalHeaders.Origin) {
    finalHeaders.Origin = TEST_ORIGIN;
  }

  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  cookieJar?.store(response.headers);
  const raw = await response.text();
  let parsed = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    parsed = raw;
  }
  return {
    status: response.status,
    body: parsed,
    headers: response.headers,
    raw,
  };
}

async function register(baseUrl, label) {
  const cookieJar = createCookieJar();
  const account = {
    email: `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`,
    password: "phase0-password",
    nickname: label,
  };
  const result = await request(baseUrl, "/api/auth/register", {
    method: "POST",
    json: account,
    cookieJar,
  });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { account, cookieJar, user: result.body.user };
}

function makePng(size) {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  return buffer;
}

function makeMp4(size) {
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32BE(Math.min(size, 24), 0);
  buffer.write("ftyp", 4, "ascii");
  if (size >= 12) buffer.write("isom", 8, "ascii");
  return buffer;
}

function makeWebm(size) {
  const buffer = Buffer.alloc(size);
  Buffer.from([0x1a, 0x45, 0xdf, 0xa3]).copy(buffer);
  return buffer;
}

function dataUrl(mimeType, buffer) {
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function testDefaultFlagsAndProfile() {
  const server = await startServer({
    ACCOUNT_DELETION_ENABLED: "false",
    COMMUNITY_PUBLISH_ENABLED: "1",
    COMMUNITY_POST_EDIT_ENABLED: "yes",
    COMMUNITY_LEGACY_LIKE_ENABLED: "yes",
    COMMUNITY_DEMO_ENABLED: "FALSE",
  });

  try {
    const live = await request(server.baseUrl, "/api/health/live");
    const ready = await request(server.baseUrl, "/api/health/ready");
    const compatibilityHealth = await request(server.baseUrl, "/api/health");
    assertStep("liveness endpoint is independent and available", live.status === 200 && live.body.ok === true);
    assertStep("readiness exposes the migrated schema", ready.status === 200 && ready.body.ok === true && ready.body.schemaVersion === "V009");
    assertStep("legacy health endpoint preserves readiness semantics", compatibilityHealth.status === 200 && compatibilityHealth.body.schemaVersion === "V009");

    const capabilities = await request(server.baseUrl, "/api/v1/capabilities", {
      headers: { "X-Request-Id": "phase0-capabilities-default-001" },
    });
    assertStep("capabilities endpoint returns no-store", capabilities.headers.get("cache-control") === "no-store");
    const defaultFeatures = capabilities.body.data.features;
    assertStep("only literal true enables environment flags", [
      "accountDeletion", "communityPublish", "communityPostEdit", "communityLegacyLike", "communityDemo",
    ].every((feature) => defaultFeatures[feature] === false));
    assertStep("completed v1 services are advertised", [
      "socialFeedV1", "canonicalLike", "cloudDrafts", "notifications",
    ].every((feature) => defaultFeatures[feature] === true) && defaultFeatures.sse === false);
    assertStep("capabilities returns media limits", capabilities.body.data.limits.communityImageBytes === IMAGE_LIMIT && capabilities.body.data.limits.communityVideoBytes === VIDEO_LIMIT);
    assertStep("capabilities preserves requestId", capabilities.body.requestId === "phase0-capabilities-default-001");

    const nonStringRegistration = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: { email: { value: "object@example.com" }, password: ["phase0-password"] },
    });
    assertStep("registration rejects non-string credential fields", nonStringRegistration.status === 400 && nonStringRegistration.body.code === "INVALID_REGISTRATION");

    const numericPasswordRegistration = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: {
        email: `numeric-password-${Date.now()}@example.com`,
        password: 12345678,
        nickname: "numeric-password",
      },
    });
    assertStep("registration never coerces a numeric password", numericPasswordRegistration.status === 400 && numericPasswordRegistration.body.code === "INVALID_REGISTRATION");

    const oversizedEmail = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: {
        email: `${"a".repeat(243)}@example.com`,
        password: "phase0-password",
        nickname: "oversized-email",
      },
    });
    assertStep("registration rejects email above 254 bytes", oversizedEmail.status === 400);

    const oversizedNickname = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: {
        email: `nickname-limit-${Date.now()}@example.com`,
        password: "phase0-password",
        nickname: "n".repeat(41),
      },
    });
    assertStep("registration rejects nickname above 40 characters", oversizedNickname.status === 400 && oversizedNickname.body.code === "INVALID_NICKNAME");

    const oversizedPassword = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: {
        email: `password-limit-${Date.now()}@example.com`,
        password: "p".repeat(73),
        nickname: "password-limit",
      },
    });
    assertStep("registration rejects passwords beyond bcrypt UTF-8 boundary", oversizedPassword.status === 400 && oversizedPassword.body.code === "INVALID_PASSWORD");

    const oversizedMultibytePassword = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      json: {
        email: `password-utf8-${Date.now()}@example.com`,
        password: "密".repeat(25),
        nickname: "password-utf8",
      },
    });
    assertStep("password boundary is measured in UTF-8 bytes", oversizedMultibytePassword.status === 400 && oversizedMultibytePassword.body.code === "INVALID_PASSWORD");

    const boundaryCookieJar = createCookieJar();
    const boundaryRegistration = await request(server.baseUrl, "/api/auth/register", {
      method: "POST",
      cookieJar: boundaryCookieJar,
      json: {
        email: `password-boundary-${Date.now()}@example.com`,
        password: "p".repeat(72),
        nickname: "password-boundary",
      },
    });
    const sessionToken = boundaryCookieJar.header().split("=", 2)[1] || "";
    const sessionPayload = JSON.parse(Buffer.from(sessionToken.split(".")[1] || "", "base64url").toString("utf8") || "{}");
    const sessionHeader = jwt.decode(sessionToken, { complete: true })?.header || {};
    assertStep("password at 72-byte boundary is accepted", boundaryRegistration.status === 201);
    assertStep("session JWT contains identifiers only", sessionToken.length < 1024 && !Object.hasOwn(sessionPayload, "email") && !Object.hasOwn(sessionPayload, "nickname") && Boolean(sessionPayload.sub) && Boolean(sessionPayload.jti));
    assertStep("session JWT is issued with HS256", sessionHeader.alg === "HS256");

    const alternateAlgorithmToken = jwt.sign(
      { jti: `alternate-algorithm-${Date.now()}` },
      "phase0-test-secret-at-least-32-characters-long",
      { algorithm: "HS384", subject: sessionPayload.sub, expiresIn: "5m" }
    );
    const alternateAlgorithmSession = await request(server.baseUrl, "/api/auth/me", {
      headers: { Cookie: `birdora_token=${alternateAlgorithmToken}` },
    });
    assertStep("session JWT rejects alternate HMAC algorithms", alternateAlgorithmSession.status === 401);

    const { cookieJar } = await register(server.baseUrl, "phase0-profile");
    const avatar = dataUrl("image/png", makePng(600 * 1024));
    const initial = await request(server.baseUrl, "/api/auth/profile", {
      method: "PATCH",
      cookieJar,
      json: {
        nickname: "稀疏更新测试",
        bio: "待清空简介",
        gender: "prefer_not_to_say",
        age: 28,
        avatarUrl: avatar,
        emailNotifications: false,
        publicProfile: false,
      },
    });
    assertStep("profile accepts avatar at 600 KiB", initial.status === 200, JSON.stringify(initial.body));
    assertStep("profile preserves explicit false", initial.body.user.emailNotifications === false && initial.body.user.publicProfile === false);

    const sparseAge = await request(server.baseUrl, "/api/auth/profile", {
      method: "PATCH",
      cookieJar,
      json: { age: null },
    });
    assertStep("profile preserves explicit null", sparseAge.status === 200 && sparseAge.body.user.age === null);
    assertStep("sparse age patch keeps other fields", sparseAge.body.user.nickname === "稀疏更新测试" && sparseAge.body.user.bio === "待清空简介" && sparseAge.body.user.publicProfile === false);

    const sparseEmpty = await request(server.baseUrl, "/api/auth/profile", {
      method: "PATCH",
      cookieJar,
      json: { bio: "", gender: null, avatarUrl: "" },
    });
    assertStep("profile preserves explicit empty clears", sparseEmpty.status === 200 && sparseEmpty.body.user.bio === "" && sparseEmpty.body.user.gender === "" && sparseEmpty.body.user.avatarUrl === "");
    assertStep("empty clears do not reset false", sparseEmpty.body.user.emailNotifications === false && sparseEmpty.body.user.publicProfile === false);

    const invalidBoolean = await request(server.baseUrl, "/api/auth/profile", {
      method: "PATCH",
      cookieJar,
      json: { publicProfile: "false" },
    });
    assertStep("profile rejects non-boolean flags with stable code", invalidBoolean.status === 400 && invalidBoolean.body.code === "INVALID_PROFILE" && Boolean(invalidBoolean.body.requestId));

    const plainTextLogin = await request(server.baseUrl, "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ email: "nobody@example.com", password: "bad-password" }),
    });
    assertStep("auth writes reject non-JSON media types", plainTextLogin.status === 415 && plainTextLogin.body.code === "UNSUPPORTED_MEDIA_TYPE");

    const publishDisabled = await request(server.baseUrl, "/api/community/posts", {
      method: "POST",
      cookieJar,
      headers: { "X-Request-Id": "phase0-publish-disabled-001" },
      json: { title: "blocked", body: "blocked" },
    });
    assertStep("disabled publish returns stable error", publishDisabled.status === 503 && publishDisabled.body.code === "PUBLISH_DISABLED" && publishDisabled.body.requestId === "phase0-publish-disabled-001");

    const editDisabled = await request(server.baseUrl, "/api/community/posts/not-needed", {
      method: "PATCH",
      cookieJar,
      headers: { "X-Request-Id": "phase0-edit-disabled-001" },
      json: { title: "blocked", body: "blocked" },
    });
    assertStep("disabled edit returns stable error", editDisabled.status === 503 && editDisabled.body.code === "EDIT_DISABLED" && editDisabled.body.requestId === "phase0-edit-disabled-001");

    const legacyLikeDisabled = await request(server.baseUrl, "/api/community/posts/not-needed/reactions", {
      method: "POST",
      cookieJar,
      json: { reactionType: "helpful" },
    });
    assertStep("legacy like path is fail-closed", legacyLikeDisabled.status === 503 && legacyLikeDisabled.body.code === "LEGACY_LIKE_DISABLED");

    const deletionDisabled = await request(server.baseUrl, "/api/auth/account", {
      method: "DELETE",
      cookieJar,
      headers: { "X-Request-Id": "phase0-delete-disabled-001" },
      json: { password: "phase0-password", confirmation: "注销我的账号" },
    });
    assertStep("disabled account deletion returns stable error", deletionDisabled.status === 503 && deletionDisabled.body.code === "FEATURE_DISABLED" && deletionDisabled.body.requestId === "phase0-delete-disabled-001");

    const oversizedOrdinaryBody = await request(server.baseUrl, "/api/auth/login", {
      method: "POST",
      json: { email: "nobody@example.com", password: "bad-password", padding: "x".repeat(2 * 1024 * 1024) },
    });
    assertStep("ordinary API body parser remains bounded", oversizedOrdinaryBody.status === 413);
  } finally {
    await stopServer(server);
  }
}

async function createVideoPost(baseUrl, cookieJar, mimeType, buffer, suffix) {
  return request(baseUrl, "/api/community/posts", {
    method: "POST",
    cookieJar,
    json: {
      title: `视频签名测试-${suffix}`,
      body: "用于阶段 0 后端媒体契约回归。",
      bird: "观鸟笔记",
      videoName: `sample-${suffix}`,
      videoDataUrl: dataUrl(mimeType, buffer),
    },
  });
}

async function testEnabledFlagsAndMedia() {
  const server = await startServer({
    ACCOUNT_DELETION_ENABLED: "true",
    COMMUNITY_PUBLISH_ENABLED: " TRUE ",
    COMMUNITY_POST_EDIT_ENABLED: "true",
    COMMUNITY_LEGACY_LIKE_ENABLED: "true",
    COMMUNITY_DEMO_ENABLED: "true",
  });

  try {
    const capabilities = await request(server.baseUrl, "/api/v1/capabilities");
    assertStep("explicit true enables all phase 0 flags", [
      "accountDeletion", "communityPublish", "communityPostEdit", "communityLegacyLike", "communityDemo",
    ].every((feature) => capabilities.body.data.features[feature] === true));
    assertStep("only unfinished SSE remains disabled", capabilities.body.data.features.sse === false && Object.keys(capabilities.body.data.disabledReasons).length === 1 && Object.hasOwn(capabilities.body.data.disabledReasons, "sse"));

    const { account, cookieJar } = await register(server.baseUrl, "phase0-media");

    const plainTextPublish = await request(server.baseUrl, "/api/community/posts", {
      method: "POST",
      cookieJar,
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({ title: "wrong type", body: "wrong type" }),
    });
    assertStep("community writes reject non-JSON media types", plainTextPublish.status === 415 && plainTextPublish.body.code === "UNSUPPORTED_MEDIA_TYPE");

    const arrayPublish = await request(server.baseUrl, "/api/community/posts", {
      method: "POST",
      cookieJar,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    assertStep("community writes reject non-object JSON", arrayPublish.status === 400 && arrayPublish.body.code === "INVALID_REQUEST_BODY");

    const validMp4 = await createVideoPost(server.baseUrl, cookieJar, "video/mp4", makeMp4(12), "mp4");
    assertStep("valid MP4 signature is accepted", validMp4.status === 201, JSON.stringify(validMp4.body));
    const mp4Read = await request(server.baseUrl, `/api/community/posts/${validMp4.body.post.id}/video`);
    assertStep("stored MP4 is readable with content type", mp4Read.status === 200 && mp4Read.headers.get("content-type")?.startsWith("video/mp4"));

    const validWebm = await createVideoPost(server.baseUrl, cookieJar, "video/webm", makeWebm(4), "webm");
    assertStep("valid WebM signature is accepted", validWebm.status === 201, JSON.stringify(validWebm.body));
    const webmRead = await request(server.baseUrl, `/api/community/posts/${validWebm.body.post.id}/video`);
    assertStep("stored WebM is readable with content type", webmRead.status === 200 && webmRead.headers.get("content-type")?.startsWith("video/webm"));

    const invalidMp4 = await createVideoPost(server.baseUrl, cookieJar, "video/mp4", Buffer.alloc(12), "bad-mp4");
    assertStep("invalid MP4 signature is rejected", invalidMp4.status === 400);
    const invalidWebm = await createVideoPost(server.baseUrl, cookieJar, "video/webm", Buffer.alloc(4), "bad-webm");
    assertStep("invalid WebM signature is rejected", invalidWebm.status === 400);

    const exactVideo = await createVideoPost(server.baseUrl, cookieJar, "video/mp4", makeMp4(VIDEO_LIMIT), "boundary");
    assertStep("video at 8 MiB boundary passes 14 MiB route parser", exactVideo.status === 201, JSON.stringify(exactVideo.body));
    const oversizedVideo = await createVideoPost(server.baseUrl, cookieJar, "video/mp4", makeMp4(VIDEO_LIMIT + 1), "oversized");
    assertStep("video above 8 MiB boundary is rejected", oversizedVideo.status === 400);

    const exactImage = await request(server.baseUrl, "/api/community/posts", {
      method: "POST",
      cookieJar,
      json: {
        title: "图片边界测试",
        body: "用于阶段 0 后端媒体大小契约回归。",
        bird: "观鸟笔记",
        imageDataUrl: dataUrl("image/png", makePng(IMAGE_LIMIT)),
      },
    });
    assertStep("image at 1 MiB boundary is accepted", exactImage.status === 201, JSON.stringify(exactImage.body));

    const updated = await request(server.baseUrl, `/api/community/posts/${validMp4.body.post.id}`, {
      method: "PATCH",
      cookieJar,
      json: { title: "MP4 帖子已编辑", body: "显式开启编辑功能后，旧路径仍可用。" },
    });
    assertStep("explicit edit flag opens legacy edit path", updated.status === 200 && updated.body.post.title === "MP4 帖子已编辑");
    assertStep("video media analysis survives editing", updated.body.post.analysis?.tags?.includes("带配图") === true);

    const deleted = await request(server.baseUrl, "/api/auth/account", {
      method: "DELETE",
      cookieJar,
      json: { password: account.password, confirmation: "注销我的账号" },
    });
    assertStep("explicit account deletion flag opens legacy delete path", deleted.status === 204);
  } finally {
    await stopServer(server);
  }
}

async function main() {
  await testDefaultFlagsAndProfile();
  await testEnabledFlagsAndMedia();
  console.log("\nPhase 0 backend contract tests passed.");
}

main().catch((error) => {
  console.error("\nPhase 0 backend contract tests failed.");
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
