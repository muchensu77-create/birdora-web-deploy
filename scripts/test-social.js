"use strict";

const { getDatabase } = require("../app/db/database");
const { assertApiWriteTargetSafety } = require("./test-safety");

const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const suffix = Date.now();
const accounts = ["alice", "birder", "charlie"].map((name) => ({
  name,
  email: `social-${name}-${suffix}@example.com`,
  nickname: name[0].toUpperCase() + name.slice(1),
  password: "12345678",
  jar: new Map(),
  id: "",
}));

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

async function request(path, { method = "GET", jar, json } = {}) {
  const headers = { Accept: "application/json" };
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
  return { status: response.status, body };
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

async function createPost(account, title) {
  const response = await request("/api/community/posts", {
    method: "POST",
    jar: account.jar,
    json: {
      title,
      body: `${title} 的正文，记录清晨鸟类活动。`,
      bird: "观鸟笔记",
      locationText: "杭州·西湖公园",
      visibility: "public",
    },
  });
  check(`create ${title}`, response.status === 201, `HTTP ${response.status}`);
  return response.body.post;
}

function cleanup() {
  try {
    assertApiWriteTargetSafety({ scriptName: "Social API test", baseUrl: BASE_URL });
    const db = getDatabase();
    for (const account of accounts) {
      if (account.id) db.prepare("DELETE FROM users WHERE id = ?").run(account.id);
    }
  } catch (error) {
    console.error(`Social test cleanup failed: ${error.message}`);
  }
}

async function main() {
  const [alice, birder, charlie] = accounts;
  await register(alice);
  await register(birder);
  await register(charlie);
  const birderPost = await createPost(birder, "Birder 的翠鸟记录");
  const charliePost = await createPost(charlie, "Charlie 的林鸟记录");

  const recommended = await request("/api/v1/feed?type=recommended&limit=10");
  check(
    "anonymous recommended feed works",
    recommended.status === 200 && recommended.body?.data?.length >= 2,
    recommended.status === 200 && recommended.body?.data?.length >= 2
      ? ""
      : `HTTP ${recommended.status}; ${JSON.stringify(recommended.body)}`
  );
  const recommendedBirder = recommended.body.data.find((post) => post.id === birderPost.id);
  check("feed exposes stable author id and location", recommendedBirder?.authorId === birder.id && recommendedBirder?.locationText === "杭州·西湖公园");
  check("public feed never exposes author email", !JSON.stringify(recommendedBirder).includes(birder.email));

  const emptyFollowing = await request("/api/v1/feed?type=following&limit=10", { jar: alice.jar });
  check("empty following feed is truly empty", emptyFollowing.status === 200 && emptyFollowing.body?.data?.length === 0);

  const selfFollow = await request(`/api/v1/users/${alice.id}/follow`, { method: "PUT", jar: alice.jar });
  check("self follow is rejected", selfFollow.status === 400 && selfFollow.body?.code === "SELF_FOLLOW_FORBIDDEN");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const followed = await request(`/api/v1/users/${birder.id}/follow`, { method: "PUT", jar: alice.jar });
    check(`follow is idempotent ${attempt + 1}`, followed.status === 200 && followed.body?.data?.viewer?.isFollowing === true);
  }
  const followingFeed = await request("/api/v1/feed?type=following&limit=10", { jar: alice.jar });
  const followingIds = followingFeed.body?.data?.map((post) => post.id) || [];
  check("following feed contains followed author", followingFeed.status === 200 && followingIds.includes(birderPost.id));
  check("following feed excludes unfollowed author", !followingIds.includes(charliePost.id));

  const followers = await request(`/api/v1/users/${birder.id}/followers?limit=10`, { jar: alice.jar });
  check("followers list contains alice", followers.status === 200 && followers.body?.data?.some((user) => user.id === alice.id));
  const following = await request(`/api/v1/users/${alice.id}/following?limit=10`, { jar: alice.jar });
  check("following list contains birder", following.status === 200 && following.body?.data?.some((user) => user.id === birder.id));

  const profile = await request(`/api/v1/users/${birder.id}`, { jar: alice.jar });
  check("public profile has authoritative counts", profile.status === 200 && profile.body?.data?.counts?.followers === 1);
  check("public profile omits private fields", !Object.hasOwn(profile.body.data, "email") && !Object.hasOwn(profile.body.data, "gender") && !Object.hasOwn(profile.body.data, "age"));

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const liked = await request(`/api/v1/posts/${birderPost.id}/like`, { method: "PUT", jar: alice.jar });
    check(`like is idempotent ${attempt + 1}`, liked.status === 200 && liked.body?.data?.post?.likeCount === 1 && liked.body?.data?.post?.viewerHasLiked === true);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const unliked = await request(`/api/v1/posts/${birderPost.id}/like`, { method: "DELETE", jar: alice.jar });
    check(`unlike is idempotent ${attempt + 1}`, unliked.status === 200 && unliked.body?.data?.post?.likeCount === 0 && unliked.body?.data?.post?.viewerHasLiked === false);
  }

  await createPost(birder, "Birder 的第二条记录");
  const firstPage = await request("/api/v1/feed?type=recommended&limit=1", { jar: alice.jar });
  check("feed returns an opaque cursor", firstPage.status === 200 && firstPage.body?.pageInfo?.hasMore && typeof firstPage.body.pageInfo.nextCursor === "string");
  const secondPage = await request(`/api/v1/feed?type=recommended&limit=1&cursor=${encodeURIComponent(firstPage.body.pageInfo.nextCursor)}`, { jar: alice.jar });
  check("feed cursor advances without duplicate", secondPage.status === 200 && secondPage.body?.data?.[0]?.id !== firstPage.body?.data?.[0]?.id);
  const tampered = `${firstPage.body.pageInfo.nextCursor.slice(0, -1)}x`;
  const tamperedPage = await request(`/api/v1/feed?type=recommended&cursor=${encodeURIComponent(tampered)}`, { jar: alice.jar });
  check("tampered cursor fails closed", tamperedPage.status === 400 && tamperedPage.body?.code === "INVALID_CURSOR");

  const stats = await request("/api/v1/me/stats", { jar: birder.jar });
  check("me stats come from database", stats.status === 200 && stats.body?.data?.posts === 2 && stats.body?.data?.followers === 1);
  const myPosts = await request("/api/v1/me/posts?limit=10", { jar: birder.jar });
  check("me posts returns only owner posts", myPosts.status === 200 && myPosts.body?.data?.length === 2 && myPosts.body.data.every((post) => post.authorId === birder.id));

  await request("/api/auth/profile", { method: "PATCH", jar: birder.jar, json: { publicProfile: false } });
  const privateProfile = await request(`/api/v1/users/${birder.id}`);
  check("private profile masks nickname bio and avatar", privateProfile.status === 200 && privateProfile.body?.data?.nickname === "Birdora 用户" && privateProfile.body.data.bio === "" && privateProfile.body.data.avatarUrl === "");

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const unfollowed = await request(`/api/v1/users/${birder.id}/follow`, { method: "DELETE", jar: alice.jar });
    check(`unfollow is idempotent ${attempt + 1}`, unfollowed.status === 200 && unfollowed.body?.data?.viewer?.isFollowing === false);
  }
  const afterUnfollow = await request("/api/v1/feed?type=following&limit=10", { jar: alice.jar });
  check("following feed updates after unfollow", afterUnfollow.status === 200 && afterUnfollow.body?.data?.length === 0);
}

main().then(cleanup).catch((error) => {
  cleanup();
  console.error(`Social API test failed: ${error.message}`);
  process.exitCode = 1;
});
