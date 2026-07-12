"use strict";

const { getDatabase } = require("../app/db/database");
const { assertApiWriteTargetSafety } = require("./test-safety");

const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const suffix = Date.now();
const accounts = ["author", "actor", "stranger"].map((name) => ({
  name,
  email: `draft-notification-${name}-${suffix}@example.com`,
  nickname: name[0].toUpperCase() + name.slice(1),
  password: "12345678",
  jar: new Map(),
  id: "",
}));
const jpegDataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64")}`;

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function storeCookies(jar, headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : headers.get("set-cookie") ? [headers.get("set-cookie")] : [];
  for (const raw of values) {
    const [pair] = raw.split(";");
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

async function request(path, { method = "GET", jar, json, headers: extraHeaders = {} } = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (jar?.size) headers.Cookie = cookieHeader(jar);
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) headers.Origin = TEST_ORIGIN;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  if (jar) storeCookies(jar, response.headers);
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, headers: response.headers };
}

function check(label, condition, detail = "") {
  console.log(`${label}: ${condition ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
  if (!condition) throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
}

async function register(account) {
  const response = await request("/api/auth/register", {
    method: "POST",
    jar: account.jar,
    json: { email: account.email, nickname: account.nickname, password: account.password },
  });
  account.id = response.body?.user?.id || "";
  check(`register ${account.name}`, response.status === 201 && account.id, `HTTP ${response.status}`);
}

async function createPost(account, fields) {
  return request("/api/community/posts", {
    method: "POST",
    jar: account.jar,
    json: {
      title: fields.title,
      body: fields.body || `${fields.title} 的观鸟记录正文。`,
      bird: "观鸟笔记",
      visibility: fields.visibility || "public",
      ...(fields.imageDataUrl ? { imageDataUrl: fields.imageDataUrl, imageName: "bird.jpg" } : {}),
    },
  });
}

function cleanup() {
  try {
    assertApiWriteTargetSafety({ scriptName: "Draft and notification API test", baseUrl: BASE_URL });
    const db = getDatabase();
    for (const account of accounts) {
      if (account.id) db.prepare("DELETE FROM users WHERE id = ?").run(account.id);
    }
  } catch (error) {
    console.error(`Draft/notification cleanup failed: ${error.message}`);
  }
}

async function main() {
  const [author, actor, stranger] = accounts;
  await Promise.all(accounts.map(register));

  const anonymousDrafts = await request("/api/v1/drafts");
  check("draft list requires authentication", anonymousDrafts.status === 401, `HTTP ${anonymousDrafts.status}`);

  const unsupportedDraft = await request("/api/v1/drafts", {
    method: "POST",
    jar: author.jar,
    json: { title: "非法草稿", secret: "must-not-be-accepted" },
  });
  check("draft rejects unknown fields", unsupportedDraft.status === 400 && unsupportedDraft.body?.code === "VALIDATION_ERROR");

  const created = await request("/api/v1/drafts", {
    method: "POST",
    jar: author.jar,
    json: {
      title: "待发布的私密草稿",
      body: "这是用于验证云草稿、版本控制和发布幂等性的观鸟记录。",
      bird: "翠鸟",
      locationText: "杭州·西湖",
      visibility: "private",
    },
  });
  const draft = created.body?.data;
  check("cloud draft is created", created.status === 201 && draft?.version === 1, `HTTP ${created.status}`);

  const updated = await request(`/api/v1/drafts/${draft.id}`, {
    method: "PATCH",
    jar: author.jar,
    json: { version: draft.version, body: `${draft.body} 已完成校对。` },
  });
  check("draft update increments optimistic version", updated.status === 200 && updated.body?.data?.version === 2);
  const currentDraft = updated.body.data;

  const stale = await request(`/api/v1/drafts/${draft.id}`, {
    method: "PATCH",
    jar: author.jar,
    json: { version: 1, title: "过期客户端写入" },
  });
  check("stale draft update is rejected", stale.status === 409 && stale.body?.code === "DRAFT_VERSION_CONFLICT");

  const missingKey = await request(`/api/v1/drafts/${draft.id}/publish`, {
    method: "POST",
    jar: author.jar,
    json: { version: currentDraft.version },
  });
  check("draft publish requires idempotency key", missingKey.status === 400 && missingKey.body?.code === "IDEMPOTENCY_KEY_REQUIRED");

  const idempotencyKey = `draft-publish-${suffix}`;
  const publishBody = {
    version: currentDraft.version,
    imageDataUrl: jpegDataUrl,
    imageName: "private-bird.jpg",
  };
  const published = await request(`/api/v1/drafts/${draft.id}/publish`, {
    method: "POST",
    jar: author.jar,
    headers: { "Idempotency-Key": idempotencyKey },
    json: publishBody,
  });
  const privatePost = published.body?.data;
  check("draft publishes atomically", published.status === 201 && privatePost?.visibility === "private" && privatePost?.imageUrl, `HTTP ${published.status}`);

  const retried = await request(`/api/v1/drafts/${draft.id}/publish`, {
    method: "POST",
    jar: author.jar,
    headers: { "Idempotency-Key": idempotencyKey },
    json: publishBody,
  });
  check("same publish request returns the same post", retried.status === 201 && retried.body?.data?.id === privatePost.id);

  const reusedKey = await request(`/api/v1/drafts/${draft.id}/publish`, {
    method: "POST",
    jar: author.jar,
    headers: { "Idempotency-Key": idempotencyKey },
    json: { ...publishBody, version: currentDraft.version + 1 },
  });
  check("idempotency key cannot be reused for another request", reusedKey.status === 409 && reusedKey.body?.code === "IDEMPOTENCY_KEY_REUSED");

  const draftsAfterPublish = await request("/api/v1/drafts", { jar: author.jar });
  check("consumed draft leaves active draft list", draftsAfterPublish.status === 200 && !draftsAfterPublish.body.data.some((item) => item.id === draft.id));
  const consumedDraft = await request(`/api/v1/drafts/${draft.id}`, { jar: author.jar });
  check("consumed draft is no longer editable", consumedDraft.status === 404 && consumedDraft.body?.code === "DRAFT_NOT_FOUND");

  const ownerDetail = await request(`/api/community/posts/${privatePost.id}`, { jar: author.jar });
  const anonymousDetail = await request(`/api/community/posts/${privatePost.id}`);
  const otherDetail = await request(`/api/community/posts/${privatePost.id}`, { jar: actor.jar });
  check("private post detail is visible to owner", ownerDetail.status === 200);
  check("private post detail fails closed for anonymous and other users", anonymousDetail.status === 404 && otherDetail.status === 404);
  const ownerImage = await request(privatePost.imageUrl, { jar: author.jar });
  const anonymousImage = await request(privatePost.imageUrl);
  const otherImage = await request(privatePost.imageUrl, { jar: actor.jar });
  check("private media is visible to owner", ownerImage.status === 200 && ownerImage.headers.get("cache-control") === "private, no-store");
  check("private media direct link fails closed", anonymousImage.status === 404 && otherImage.status === 404);

  const followersPostResponse = await createPost(author, {
    title: "仅关注者可见的记录",
    visibility: "followers",
    imageDataUrl: jpegDataUrl,
  });
  const followersPost = followersPostResponse.body?.post;
  check("followers-only post is created", followersPostResponse.status === 201 && followersPost?.imageUrl);
  const beforeFollow = await request(`/api/community/posts/${followersPost.id}`, { jar: actor.jar });
  check("unrelated user cannot read followers-only post", beforeFollow.status === 404);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const follow = await request(`/api/v1/users/${author.id}/follow`, { method: "PUT", jar: actor.jar });
    check(`follow notification source is idempotent ${attempt + 1}`, follow.status === 200);
  }
  const afterFollow = await request(`/api/community/posts/${followersPost.id}`, { jar: actor.jar });
  const followerImage = await request(followersPost.imageUrl, { jar: actor.jar });
  const anonymousFollowerImage = await request(followersPost.imageUrl);
  check("follower can read followers-only post and media", afterFollow.status === 200 && followerImage.status === 200);
  check("followers-only media is private-cache and anonymous-safe", followerImage.headers.get("cache-control") === "private, no-store" && anonymousFollowerImage.status === 404);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const like = await request(`/api/v1/posts/${followersPost.id}/like`, { method: "PUT", jar: actor.jar });
    check(`like notification source is idempotent ${attempt + 1}`, like.status === 200);
  }
  const comment = await request(`/api/community/posts/${followersPost.id}/comments`, {
    method: "POST",
    jar: actor.jar,
    json: { body: "这条记录非常有帮助。" },
  });
  check("comment notification source succeeds", comment.status === 201);

  const notifications = await request("/api/v1/notifications?limit=20", { jar: author.jar });
  const types = notifications.body?.data?.map((item) => item.type) || [];
  check("follow, like and comment notifications are persisted once", notifications.status === 200 && types.filter((type) => type === "user_followed").length === 1 && types.filter((type) => type === "post_liked").length === 1 && types.filter((type) => type === "post_commented").length === 1);
  check("notification payload exposes no recipient secrets", !JSON.stringify(notifications.body.data).includes(author.email));

  const unread = await request("/api/v1/notifications/unread-count", { jar: author.jar });
  check("unread count is authoritative", unread.status === 200 && unread.body?.data?.count === 3);
  const foreignRead = await request(`/api/v1/notifications/${notifications.body.data[0].id}/read`, { method: "POST", jar: stranger.jar });
  check("another user cannot mark notification read", foreignRead.status === 404 && foreignRead.body?.code === "NOTIFICATION_NOT_FOUND");
  const ownRead = await request(`/api/v1/notifications/${notifications.body.data[0].id}/read`, { method: "POST", jar: author.jar });
  check("recipient can mark one notification read", ownRead.status === 200 && ownRead.body?.data?.readAt);
  const readAll = await request("/api/v1/notifications/read-all", { method: "POST", jar: author.jar });
  check("recipient can mark all notifications read", readAll.status === 200 && readAll.body?.data?.updated === 2);

  const preferences = await request("/api/v1/notification-preferences", { jar: author.jar });
  check("notification preferences exist for registered user", preferences.status === 200 && preferences.body?.data?.likesEnabled === true);
  const disableLikes = await request("/api/v1/notification-preferences", {
    method: "PATCH",
    jar: author.jar,
    json: { likesEnabled: false },
  });
  check("notification preference update is persisted", disableLikes.status === 200 && disableLikes.body?.data?.likesEnabled === false);

  const publicPostResponse = await createPost(author, { title: "用于验证通知偏好的公开记录" });
  const publicPost = publicPostResponse.body?.post;
  const strangerLike = await request(`/api/v1/posts/${publicPost.id}/like`, { method: "PUT", jar: stranger.jar });
  check("like operation still succeeds when recipient disabled alerts", strangerLike.status === 200);
  const unreadAfterDisabledLike = await request("/api/v1/notifications/unread-count", { jar: author.jar });
  check("disabled like preference suppresses new notification", unreadAfterDisabledLike.status === 200 && unreadAfterDisabledLike.body?.data?.count === 0);
}

main().then(cleanup).catch((error) => {
  cleanup();
  console.error(`Draft/notification API test failed: ${error.message}`);
  process.exitCode = 1;
});
