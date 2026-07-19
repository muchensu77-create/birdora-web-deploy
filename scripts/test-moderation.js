"use strict";

const path = require("path");
const { spawnSync } = require("child_process");

const { getDatabase } = require("../app/db/database");
const { assertApiWriteTargetSafety } = require("./test-safety");

const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${process.env.PORT || 4000}`;
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const PROJECT_ROOT = path.resolve(__dirname, "..");
const suffix = Date.now();
const accounts = ["author", "reporter", "moderator", "stranger"].map((name) => ({
  name,
  email: `moderation-${name}-${suffix}@example.com`,
  nickname: name[0].toUpperCase() + name.slice(1),
  password: "12345678",
  jar: new Map(),
  id: "",
}));
let postId = "";

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

async function request(requestPath, { method = "GET", jar, json } = {}) {
  const headers = { Accept: "application/json" };
  if (jar?.size) headers.Cookie = cookieHeader(jar);
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (!new Set(["GET", "HEAD", "OPTIONS"]).has(method)) headers.Origin = TEST_ORIGIN;
  const response = await fetch(`${BASE_URL}${requestPath}`, {
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

async function waitForCondition(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
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

function runRoleCommand(command, account, extraEnv = {}) {
  return spawnSync(process.execPath, [
    "scripts/admin-role.js",
    command,
    "--user", account.email,
    "--reason", `Moderation integration ${command}`,
    "--actor-label", "integration-test",
  ], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
    encoding: "utf8",
  });
}

function cleanup() {
  try {
    assertApiWriteTargetSafety({ scriptName: "Moderation API test", baseUrl: BASE_URL });
    const db = getDatabase();
    if (postId) db.prepare("DELETE FROM outbox_events WHERE aggregate_type = 'post' AND aggregate_id = ?").run(postId);
    for (const account of accounts) {
      if (account.id) db.prepare("DELETE FROM users WHERE id = ?").run(account.id);
    }
  } catch (error) {
    console.error(`Moderation test cleanup failed: ${error.message}`);
  }
}

async function main() {
  const [author, reporter, moderator, stranger] = accounts;
  await Promise.all(accounts.map(register));

  const created = await request("/api/community/posts", {
    method: "POST",
    jar: author.jar,
    json: {
      title: "用于审核闭环测试的公开观鸟记录",
      body: "这是一条会被举报、隐藏并恢复的公开观鸟记录。",
      bird: "翠鸟",
      visibility: "public",
    },
  });
  postId = created.body?.post?.id || "";
  check("create moderation target", created.status === 201 && postId, `HTTP ${created.status}`);

  const anonymousReport = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    json: { reason: "spam" },
  });
  check("report requires authentication", anonymousReport.status === 401);

  const selfReport = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: author.jar,
    json: { reason: "spam" },
  });
  check("author cannot report own post", selfReport.status === 400 && selfReport.body?.code === "SELF_REPORT_FORBIDDEN");

  const unknownField = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: reporter.jar,
    json: { reason: "spam", actorUserId: author.id },
  });
  check("report rejects unknown fields", unknownField.status === 400 && unknownField.body?.code === "VALIDATION_ERROR");

  const invalidReason = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: reporter.jar,
    json: { reason: "remove_anything" },
  });
  check("report reason uses an allowlist", invalidReason.status === 400 && invalidReason.body?.code === "INVALID_REPORT_REASON");

  const firstReport = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: reporter.jar,
    json: { reason: "privacy", detail: "记录中可能包含敏感鸟巢位置。" },
  });
  check("visible post can be reported", firstReport.status === 201 && firstReport.body?.data?.status === "open");
  const duplicate = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: reporter.jar,
    json: { reason: "privacy", detail: "重复举报不应新增。" },
  });
  check("same reporter post and reason is deduplicated", duplicate.status === 409 && duplicate.body?.code === "REPORT_ALREADY_EXISTS");
  const secondReason = await request(`/api/v1/posts/${postId}/reports`, {
    method: "POST",
    jar: reporter.jar,
    json: { reason: "other", detail: "请求人工复核。" },
  });
  check("a second reason reuses the active case", secondReason.status === 201);

  const unauthorizedQueue = await request("/api/v1/admin/moderation/cases", { jar: stranger.jar });
  check("ordinary users cannot read moderation queue", unauthorizedQueue.status === 403 && unauthorizedQueue.body?.code === "MODERATOR_REQUIRED");

  const disabledCli = runRoleCommand("grant-moderator", moderator);
  check("role bootstrap fails closed without explicit gate", disabledCli.status !== 0 && disabledCli.stderr.includes("ADMIN_ROLE_CLI_ENABLED"));
  const granted = runRoleCommand("grant-moderator", moderator, { ADMIN_ROLE_CLI_ENABLED: "true" });
  check("controlled CLI grants moderator", granted.status === 0 && JSON.parse(granted.stdout).changed === true, granted.stderr.trim());
  const idempotentGrant = runRoleCommand("grant-moderator", moderator, { ADMIN_ROLE_CLI_ENABLED: "true" });
  check("repeated role grant is desired-state idempotent", idempotentGrant.status === 0 && JSON.parse(idempotentGrant.stdout).changed === false);
  const ownRoles = await request("/api/v1/me/roles", { jar: moderator.jar });
  check("authenticated user can discover own roles", ownRoles.status === 200 && ownRoles.body?.data?.roles?.includes("moderator"));

  const queue = await request("/api/v1/admin/moderation/cases?queue=reported&status=active&limit=10", { jar: moderator.jar });
  const moderationCase = queue.body?.data?.find((item) => item.postId === postId);
  check("moderator sees one report case", queue.status === 200 && moderationCase?.reportCount === 2 && moderationCase?.openReportCount === 2);
  const caseId = moderationCase?.id || "";

  const detail = await request(`/api/v1/admin/moderation/cases/${caseId}`, { jar: moderator.jar });
  check("case detail contains reports and content", detail.status === 200 && detail.body?.data?.reports?.length === 2 && detail.body?.data?.post?.body);
  check("case detail is never publicly cached", detail.headers.get("cache-control") === "private, no-store");
  const db = getDatabase();
  const decisionsBeforeAction = db.prepare(`
    SELECT COUNT(*) AS count FROM moderation_actions WHERE case_id = ?
  `).get(caseId);
  check("case GET remains read-only in the business database", Number(decisionsBeforeAction.count) === 0);

  const badDecision = await request(`/api/v1/admin/moderation/cases/${caseId}/decision`, {
    method: "PUT",
    jar: moderator.jar,
    json: { decision: "hide", reason: "x" },
  });
  check("moderation decision requires a meaningful reason", badDecision.status === 400 && badDecision.body?.code === "VALIDATION_ERROR");

  const hidden = await request(`/api/v1/admin/moderation/cases/${caseId}/decision`, {
    method: "PUT",
    jar: moderator.jar,
    json: { decision: "hide", reason: "人工确认需要先隐藏并等待进一步核实。" },
  });
  check("moderator can hide reported content", hidden.status === 200 && hidden.body?.data?.post?.moderationStatus === "hidden");
  check("decision response contains immutable action", hidden.body?.data?.actions?.some((action) => action.decision === "hide" && action.reason.includes("人工确认")));

  const publicAfterHide = await request(`/api/community/posts/${postId}`);
  const reporterAfterHide = await request(`/api/community/posts/${postId}`, { jar: reporter.jar });
  const ownerAfterHide = await request(`/api/community/posts/${postId}`, { jar: author.jar });
  check("hidden content disappears for public and reporter", publicAfterHide.status === 404 && reporterAfterHide.status === 404);
  check("hidden content remains visible to its author", ownerAfterHide.status === 200 && ownerAfterHide.body?.post?.moderationStatus === "hidden");

  const authorNotifications = await request("/api/v1/notifications?limit=20", { jar: author.jar });
  check("moderation decision notifies the author", authorNotifications.status === 200 && authorNotifications.body?.data?.some((item) => item.type === "post_moderation_updated"));
  const outbox = db.prepare(`
    SELECT payload_json FROM outbox_events
    WHERE event_type = 'post.moderation_changed' AND aggregate_id = ?
  `).all(postId);
  check("moderation decision writes reliable outbox event", outbox.length === 1 && !outbox[0].payload_json.includes(author.email));
  const outboxProcessed = await waitForCondition(() => Boolean(db.prepare(`
    SELECT processed_at FROM outbox_events
    WHERE event_type = 'post.moderation_changed' AND aggregate_id = ?
    ORDER BY created_at ASC LIMIT 1
  `).get(postId)?.processed_at));
  check("embedded outbox worker processes event", outboxProcessed);

  const closedDecision = await request(`/api/v1/admin/moderation/cases/${caseId}/decision`, {
    method: "PUT",
    jar: moderator.jar,
    json: { decision: "hide", reason: "重复决定必须被拒绝。" },
  });
  check("closed case rejects repeated non-restore decision", closedDecision.status === 409 && closedDecision.body?.code === "MODERATION_CASE_CLOSED");

  const restored = await request(`/api/v1/admin/moderation/cases/${caseId}/decision`, {
    method: "PUT",
    jar: moderator.jar,
    json: { decision: "restore", reason: "复核后确认可以恢复公开展示。" },
  });
  check("moderator can restore hidden content", restored.status === 200 && restored.body?.data?.post?.moderationStatus === "approved");
  const publicAfterRestore = await request(`/api/community/posts/${postId}`);
  check("restored content returns to the public policy", publicAfterRestore.status === 200);

  const roleAuditsBeforeRevoke = db.prepare(`
    SELECT COUNT(*) AS count FROM user_role_audit
    WHERE target_user_id = ? AND role = 'moderator'
  `).get(moderator.id);
  check("idempotent grant does not create fake audit rows", Number(roleAuditsBeforeRevoke.count) === 1);
  const revoked = runRoleCommand("revoke-moderator", moderator, { ADMIN_ROLE_CLI_ENABLED: "true" });
  check("controlled CLI revokes moderator", revoked.status === 0 && JSON.parse(revoked.stdout).changed === true, revoked.stderr.trim());
  const queueAfterRevoke = await request("/api/v1/admin/moderation/cases", { jar: moderator.jar });
  check("revoked moderator immediately loses access", queueAfterRevoke.status === 403 && queueAfterRevoke.body?.code === "MODERATOR_REQUIRED");
  const roleAuditsAfterRevoke = db.prepare(`
    SELECT action FROM user_role_audit
    WHERE target_user_id = ? AND role = 'moderator'
    ORDER BY created_at ASC, id ASC
  `).all(moderator.id);
  check("grant and revoke have separate role audit rows", roleAuditsAfterRevoke.map((row) => row.action).join(",") === "grant,revoke");
}

main().then(cleanup).catch((error) => {
  cleanup();
  console.error(`Moderation API test failed: ${error.message}`);
  process.exitCode = 1;
});
