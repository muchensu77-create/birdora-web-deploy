"use strict";

const crypto = require("crypto");

const { getDatabase } = require("../db/database");
const communityPostService = require("./community-post.service");
const cursorService = require("./cursor.service");
const notificationService = require("./notification.service");

const REPORT_REASONS = Object.freeze([
  "spam",
  "harassment",
  "misinformation",
  "graphic_content",
  "privacy",
  "copyright",
  "other",
]);
const REPORT_REASON_SET = new Set(REPORT_REASONS);
const CASE_STATUSES = new Set(["active", "open", "reviewing", "approved", "rejected", "closed"]);
const CASE_QUEUES = new Set(["reported", "pending", "all"]);
const DECISIONS = new Set(["approve", "reject", "hide", "restore"]);
const MODERATOR_ROLES = new Set(["moderator", "admin"]);

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

function hasModeratorRole(db, userId) {
  if (!userId) return false;
  return Boolean(db.prepare(`
    SELECT 1 FROM user_roles
    WHERE user_id = ? AND role IN ('moderator', 'admin')
    LIMIT 1
  `).get(userId));
}

function requireModerator(userId, db = getDatabase()) {
  if (!hasModeratorRole(db, userId)) {
    throw createError("moderator role is required", 403, "MODERATOR_REQUIRED");
  }
}

function getUserRoles(userId, db = getDatabase()) {
  return db.prepare(`
    SELECT role FROM user_roles
    WHERE user_id = ?
    ORDER BY role ASC
  `).all(userId).map((row) => row.role).filter((role) => MODERATOR_ROLES.has(role));
}

function normalizeReportReason(reason) {
  const normalized = String(reason || "").trim().toLowerCase();
  if (!REPORT_REASON_SET.has(normalized)) {
    throw createError("report reason is invalid", 400, "INVALID_REPORT_REASON");
  }
  return normalized;
}

function mapReport(row) {
  return {
    id: row.id,
    postId: row.post_id,
    reason: row.reason,
    detail: row.detail || "",
    status: row.status,
    createdAt: row.created_at,
    handledAt: row.handled_at || null,
  };
}

function mapCaseSummary(row) {
  return {
    id: row.id,
    postId: row.post_id,
    revisionId: row.revision_id || null,
    source: row.source,
    status: row.status,
    assignedUserId: row.assigned_user_id || null,
    openedAt: row.opened_at,
    closedAt: row.closed_at || null,
    reportCount: Number(row.report_count) || 0,
    openReportCount: Number(row.open_report_count) || 0,
    post: {
      id: row.post_id,
      title: row.post_title,
      status: row.post_status,
      moderationStatus: row.post_moderation_status,
      visibility: row.post_visibility,
      publishedAt: row.post_published_at || null,
      author: {
        id: row.author_user_id,
        nickname: row.author_public_profile ? row.author_nickname : "Birdora 用户",
      },
    },
  };
}

function selectCaseSummary(db, caseId) {
  return db.prepare(`
    SELECT
      cases.*,
      posts.title AS post_title,
      posts.status AS post_status,
      posts.moderation_status AS post_moderation_status,
      posts.visibility AS post_visibility,
      posts.published_at AS post_published_at,
      posts.user_id AS author_user_id,
      authors.nickname AS author_nickname,
      authors.public_profile AS author_public_profile,
      (SELECT COUNT(*) FROM content_reports AS reports WHERE reports.post_id = cases.post_id) AS report_count,
      (SELECT COUNT(*) FROM content_reports AS reports
       WHERE reports.post_id = cases.post_id AND reports.status IN ('open', 'reviewing')) AS open_report_count
    FROM moderation_cases AS cases
    JOIN community_posts AS posts ON posts.id = cases.post_id
    JOIN users AS authors ON authors.id = posts.user_id
    WHERE cases.id = ?
  `).get(caseId);
}

async function createReport({ postId, reporterUserId, reason, detail = "" }) {
  const db = getDatabase();
  const safeReason = normalizeReportReason(reason);
  const safeDetail = String(detail || "").trim();
  let transactionStarted = false;

  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const post = await communityPostService.getPostDetails({ id: postId, viewerId: reporterUserId });
    if (post.authorId === reporterUserId) {
      throw createError("you cannot report your own post", 400, "SELF_REPORT_FORBIDDEN");
    }

    const now = new Date().toISOString();
    const reportId = crypto.randomUUID();
    db.prepare(`
      INSERT INTO content_reports (
        id, post_id, reporter_user_id, reason, detail, status, created_at, handled_at
      ) VALUES (?, ?, ?, ?, ?, 'open', ?, NULL)
    `).run(reportId, postId, reporterUserId, safeReason, safeDetail, now);

    let moderationCase = db.prepare(`
      SELECT id FROM moderation_cases
      WHERE post_id = ? AND source = 'report' AND status IN ('open', 'reviewing')
      ORDER BY opened_at ASC, id ASC
      LIMIT 1
    `).get(postId);
    if (!moderationCase) {
      moderationCase = { id: crypto.randomUUID() };
      db.prepare(`
        INSERT INTO moderation_cases (
          id, post_id, revision_id, source, status, assigned_user_id, opened_at, closed_at
        ) VALUES (?, ?, NULL, 'report', 'open', NULL, ?, NULL)
      `).run(moderationCase.id, postId, now);
    }

    const report = db.prepare("SELECT * FROM content_reports WHERE id = ?").get(reportId);
    db.exec("COMMIT");
    transactionStarted = false;
    return mapReport(report);
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    if (String(error?.message || "").includes("UNIQUE constraint failed: content_reports")) {
      throw createError("this report has already been submitted", 409, "REPORT_ALREADY_EXISTS");
    }
    throw error;
  }
}

async function listCases({ moderatorUserId, queue = "reported", status = "active", limit = 20, cursor = "" }) {
  const db = getDatabase();
  requireModerator(moderatorUserId, db);
  if (!CASE_QUEUES.has(queue)) throw createError("moderation queue is invalid", 400, "INVALID_MODERATION_QUEUE");
  if (!CASE_STATUSES.has(status)) throw createError("moderation status is invalid", 400, "INVALID_MODERATION_STATUS");
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const scope = `moderation-cases:${queue}:${status}`;
  const decoded = cursorService.decodeCursor(cursor, scope);
  const predicates = [];
  const parameters = [];

  if (queue === "reported") predicates.push("cases.source = 'report'");
  else if (queue === "pending") predicates.push("cases.source <> 'report'");
  if (status === "active") predicates.push("cases.status IN ('open', 'reviewing')");
  else {
    predicates.push("cases.status = ?");
    parameters.push(status);
  }
  if (decoded) {
    predicates.push("(cases.opened_at < ? OR (cases.opened_at = ? AND cases.id < ?))");
    parameters.push(decoded.sortTime, decoded.sortTime, decoded.id);
  }

  const rows = db.prepare(`
    SELECT
      cases.*,
      posts.title AS post_title,
      posts.status AS post_status,
      posts.moderation_status AS post_moderation_status,
      posts.visibility AS post_visibility,
      posts.published_at AS post_published_at,
      posts.user_id AS author_user_id,
      authors.nickname AS author_nickname,
      authors.public_profile AS author_public_profile,
      (SELECT COUNT(*) FROM content_reports AS reports WHERE reports.post_id = cases.post_id) AS report_count,
      (SELECT COUNT(*) FROM content_reports AS reports
       WHERE reports.post_id = cases.post_id AND reports.status IN ('open', 'reviewing')) AS open_report_count
    FROM moderation_cases AS cases
    JOIN community_posts AS posts ON posts.id = cases.post_id
    JOIN users AS authors ON authors.id = posts.user_id
    WHERE ${predicates.join(" AND ")}
    ORDER BY cases.opened_at DESC, cases.id DESC
    LIMIT ?
  `).all(...parameters, safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows.at(-1);
  return {
    cases: pageRows.map(mapCaseSummary),
    pageInfo: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore && last
        ? cursorService.encodeCursor(scope, { sortTime: last.opened_at, id: last.id })
        : null,
    },
  };
}

function mapAction(row) {
  const metadata = parseJsonObject(row.metadata_json);
  return {
    id: row.id,
    moderatorUserId: row.moderator_user_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    decision: typeof metadata.decision === "string" ? metadata.decision : null,
    createdAt: row.created_at,
    metadata,
  };
}

async function getCase({ caseId, moderatorUserId }) {
  const db = getDatabase();
  requireModerator(moderatorUserId, db);
  const row = selectCaseSummary(db, caseId);
  if (!row) throw createError("moderation case not found", 404, "MODERATION_CASE_NOT_FOUND");
  const reports = db.prepare(`
      SELECT
        reports.*,
        reporters.nickname AS reporter_nickname,
        reporters.public_profile AS reporter_public_profile
      FROM content_reports AS reports
      JOIN users AS reporters ON reporters.id = reports.reporter_user_id
      WHERE reports.post_id = ?
      ORDER BY reports.created_at ASC, reports.id ASC
  `).all(row.post_id).map((report) => ({
    ...mapReport(report),
    reporter: {
      id: report.reporter_user_id,
      nickname: report.reporter_public_profile ? report.reporter_nickname : "Birdora 用户",
    },
  }));
  const post = db.prepare(`
      SELECT id, user_id, title, body, bird, location_text, visibility, status,
             moderation_status, moderation_source, published_at, version, deleted_at
      FROM community_posts WHERE id = ?
  `).get(row.post_id);
  const revision = row.revision_id
    ? db.prepare("SELECT * FROM post_revisions WHERE id = ?").get(row.revision_id)
    : null;
  const safetyResults = db.prepare(`
      SELECT results.*, media.kind AS media_kind
      FROM content_safety_results AS results
      LEFT JOIN media_assets AS media ON media.id = results.media_id
      WHERE results.revision_id = ?
         OR results.media_id IN (SELECT id FROM media_assets WHERE bound_post_id = ?)
      ORDER BY results.created_at ASC, results.id ASC
  `).all(row.revision_id || "", row.post_id).map((result) => ({
    id: result.id,
    target: result.revision_id ? "revision" : "media",
    targetId: result.revision_id || result.media_id,
    mediaKind: result.media_kind || null,
    ruleSetVersion: result.rule_set_version,
    decision: result.decision,
    reasons: parseJsonArray(result.reasons_json),
    createdAt: result.created_at,
  }));
  const actions = db.prepare(`
      SELECT * FROM moderation_actions
      WHERE case_id = ?
      ORDER BY created_at ASC, id ASC
  `).all(caseId).map(mapAction);

  return {
    ...mapCaseSummary(row),
    post: {
      id: post.id,
      title: post.title,
      body: post.body,
      bird: post.bird,
      locationText: post.location_text,
      visibility: post.visibility,
      status: post.status,
      moderationStatus: post.moderation_status,
      moderationSource: post.moderation_source,
      publishedAt: post.published_at || null,
      version: Number(post.version),
      author: mapCaseSummary(row).post.author,
      media: {
        imageUrl: `/api/community/posts/${post.id}/image`,
        videoUrl: `/api/community/posts/${post.id}/video`,
      },
    },
    revision: revision ? {
      id: revision.id,
      baseVersion: Number(revision.base_version),
      title: revision.title,
      body: revision.body,
      locationText: revision.location_text,
      visibility: revision.visibility,
      status: revision.status,
      createdAt: revision.created_at,
      decidedAt: revision.decided_at || null,
    } : null,
    reports,
    safetyResults,
    actions,
  };
}

function decisionTarget(currentStatus, decision) {
  const transitions = {
    approve: { allowed: new Set(["pending", "approved", "under_review", "rejected"]), target: "approved", caseStatus: "approved", reportStatus: "dismissed" },
    reject: { allowed: new Set(["pending", "approved", "under_review"]), target: "rejected", caseStatus: "rejected", reportStatus: "resolved" },
    hide: { allowed: new Set(["pending", "approved", "under_review", "rejected"]), target: "hidden", caseStatus: "closed", reportStatus: "resolved" },
    restore: { allowed: new Set(["hidden", "rejected", "under_review"]), target: "approved", caseStatus: "closed", reportStatus: "dismissed" },
  };
  const transition = transitions[decision];
  if (!transition || !transition.allowed.has(currentStatus)) {
    throw createError("moderation decision is not allowed from the current state", 409, "INVALID_MODERATION_TRANSITION");
  }
  return transition;
}

async function decideCase({ caseId, moderatorUserId, decision, reason }) {
  const db = getDatabase();
  requireModerator(moderatorUserId, db);
  const safeDecision = String(decision || "").trim().toLowerCase();
  if (!DECISIONS.has(safeDecision)) throw createError("moderation decision is invalid", 400, "INVALID_MODERATION_DECISION");
  const safeReason = String(reason || "").trim();
  let transactionStarted = false;

  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
    const moderationCase = db.prepare(`
      SELECT cases.*, posts.user_id AS author_user_id, posts.title AS post_title,
             posts.status AS post_status, posts.moderation_status AS post_moderation_status,
             posts.deleted_at AS post_deleted_at
      FROM moderation_cases AS cases
      JOIN community_posts AS posts ON posts.id = cases.post_id
      WHERE cases.id = ?
    `).get(caseId);
    if (!moderationCase) throw createError("moderation case not found", 404, "MODERATION_CASE_NOT_FOUND");
    if (moderationCase.post_deleted_at || moderationCase.post_status === "deleted") {
      throw createError("deleted content cannot be moderated", 409, "MODERATION_TARGET_DELETED");
    }
    if (!new Set(["open", "reviewing"]).has(moderationCase.status) && safeDecision !== "restore") {
      throw createError("moderation case is already closed", 409, "MODERATION_CASE_CLOSED");
    }

    const transition = decisionTarget(moderationCase.post_moderation_status, safeDecision);
    const now = new Date().toISOString();
    const actionId = crypto.randomUUID();
    db.prepare(`
      UPDATE community_posts
      SET moderation_status = ?, moderation_source = 'manual_moderation', updated_at = ?
      WHERE id = ?
    `).run(transition.target, now, moderationCase.post_id);
    db.prepare(`
      UPDATE moderation_cases
      SET status = ?, assigned_user_id = ?, closed_at = ?
      WHERE id = ?
    `).run(transition.caseStatus, moderatorUserId, now, caseId);
    db.prepare(`
      UPDATE content_reports
      SET status = ?, handled_at = ?
      WHERE post_id = ? AND status IN ('open', 'reviewing')
    `).run(transition.reportStatus, now, moderationCase.post_id);
    db.prepare(`
      INSERT INTO moderation_actions (
        id, case_id, post_id, revision_id, moderator_user_id,
        from_status, to_status, reason, metadata_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      actionId, caseId, moderationCase.post_id, moderationCase.revision_id || null,
      moderatorUserId, moderationCase.post_moderation_status, transition.target,
      safeReason, JSON.stringify({
        kind: "decision",
        decision: safeDecision,
        previousCaseStatus: moderationCase.status,
      }), now
    );
    notificationService.createNotification(db, {
      recipientUserId: moderationCase.author_user_id,
      actorUserId: moderatorUserId,
      type: "post_moderation_updated",
      entityType: "post",
      entityId: moderationCase.post_id,
      payload: {
        postTitle: moderationCase.post_title,
        moderationStatus: transition.target,
        decision: safeDecision,
      },
      dedupeKey: `post_moderation_updated:${actionId}:${moderationCase.author_user_id}`,
      now,
    });
    db.prepare(`
      INSERT INTO outbox_events (
        id, event_type, aggregate_type, aggregate_id, payload_json, dedupe_key,
        attempts, available_at, lock_owner, locked_until, processed_at,
        dead_lettered_at, last_error, created_at
      ) VALUES (?, 'post.moderation_changed', 'post', ?, ?, ?, 0, ?, NULL, NULL, NULL, NULL, '', ?)
      ON CONFLICT(dedupe_key) DO NOTHING
    `).run(
      crypto.randomUUID(), moderationCase.post_id,
      JSON.stringify({
        actionId,
        caseId,
        postId: moderationCase.post_id,
        authorUserId: moderationCase.author_user_id,
        moderatorUserId,
        postTitle: moderationCase.post_title,
        moderationStatus: transition.target,
        decision: safeDecision,
      }),
      `post.moderation_changed:${actionId}`, now, now
    );
    db.exec("COMMIT");
    transactionStarted = false;
    return getCase({ caseId, moderatorUserId });
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    throw error;
  }
}

function setUserRoleFromCli({ target, role, grant, reason, actorUserId = null, actorLabel }) {
  const db = getDatabase();
  if (!MODERATOR_ROLES.has(role)) throw createError("role is invalid", 400, "INVALID_ROLE");
  const normalizedTarget = String(target || "").trim();
  const user = /^[0-9a-f-]{36}$/iu.test(normalizedTarget)
    ? db.prepare("SELECT id, email FROM users WHERE id = ?").get(normalizedTarget)
    : db.prepare("SELECT id, email FROM users WHERE email = ?").get(normalizedTarget.toLowerCase());
  if (!user) throw createError("target user was not found", 404, "USER_NOT_FOUND");
  if (actorUserId && !db.prepare("SELECT 1 FROM users WHERE id = ?").get(actorUserId)) {
    throw createError("actor user was not found", 404, "ACTOR_NOT_FOUND");
  }

  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = grant
      ? db.prepare(`
          INSERT INTO user_roles (user_id, role, created_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id, role) DO NOTHING
        `).run(user.id, role, now)
      : db.prepare("DELETE FROM user_roles WHERE user_id = ? AND role = ?").run(user.id, role);
    if (result.changes === 1) {
      db.prepare(`
        INSERT INTO user_role_audit (
          id, target_user_id, role, action, actor_user_id, actor_label, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), user.id, role, grant ? "grant" : "revoke",
        actorUserId || null, actorLabel, reason, now
      );
    }
    db.exec("COMMIT");
    return { changed: result.changes === 1, userId: user.id, email: user.email, role, granted: grant };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  CASE_QUEUES,
  CASE_STATUSES,
  DECISIONS,
  REPORT_REASONS,
  createReport,
  decideCase,
  getCase,
  getUserRoles,
  hasModeratorRole,
  listCases,
  requireModerator,
  setUserRoleFromCli,
};
