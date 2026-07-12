"use strict";

const crypto = require("crypto");

const { getDatabase } = require("../db/database");
const cursorService = require("./cursor.service");

const TYPE_PREFERENCE = Object.freeze({
  post_liked: "likes_enabled",
  post_commented: "comments_enabled",
  comment_replied: "comments_enabled",
  user_followed: "follows_enabled",
  post_moderation_updated: "moderation_enabled",
  system_announcement: "system_enabled",
});

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function safePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (!/^[a-z][A-Za-z0-9]{0,31}$/u.test(key)) continue;
    if (typeof child === "string") result[key] = child.slice(0, 160);
    else if (typeof child === "boolean" || Number.isSafeInteger(child) || child === null) result[key] = child;
  }
  return result;
}

function parsePayload(value) {
  try { return safePayload(JSON.parse(value || "{}")); } catch { return {}; }
}

function createNotification(db, {
  recipientUserId,
  actorUserId = null,
  type,
  entityType,
  entityId,
  payload = {},
  dedupeKey,
  now = new Date().toISOString(),
}) {
  if (!Object.hasOwn(TYPE_PREFERENCE, type)) throw createError("notification type is invalid", 500, "INVALID_NOTIFICATION_TYPE");
  if (!recipientUserId || recipientUserId === actorUserId) return false;
  const preferences = db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").get(recipientUserId);
  if (!preferences || !preferences.in_app_enabled || !preferences[TYPE_PREFERENCE[type]]) return false;
  const result = db.prepare(`
    INSERT INTO notifications (
      id, recipient_user_id, actor_user_id, type, entity_type, entity_id,
      payload_json, dedupe_key, read_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
    ON CONFLICT(dedupe_key) DO NOTHING
  `).run(
    crypto.randomUUID(),
    recipientUserId,
    actorUserId || null,
    type,
    String(entityType || "").slice(0, 40),
    String(entityId || "").slice(0, 128),
    JSON.stringify(safePayload(payload)),
    String(dedupeKey || "").slice(0, 240),
    now
  );
  return result.changes === 1;
}

function mapNotification(row) {
  return {
    id: row.id,
    type: row.type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: parsePayload(row.payload_json),
    actor: row.actor_user_id ? {
      id: row.actor_user_id,
      nickname: row.actor_public_profile ? row.actor_nickname : "Birdora 用户",
      avatarUrl: row.actor_public_profile ? row.actor_avatar_url || "" : "",
    } : null,
    readAt: row.read_at || null,
    createdAt: row.created_at,
  };
}

async function listNotifications({ userId, unreadOnly = false, limit = 20, cursor = "" }) {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const scope = `notifications:${unreadOnly ? "unread" : "all"}:${userId}`;
  const decoded = cursorService.decodeCursor(cursor, scope);
  const rows = db.prepare(`
    SELECT
      notifications.*,
      actors.nickname AS actor_nickname,
      actors.avatar_url AS actor_avatar_url,
      actors.public_profile AS actor_public_profile
    FROM notifications
    LEFT JOIN users AS actors ON actors.id = notifications.actor_user_id
    WHERE notifications.recipient_user_id = ?
      ${unreadOnly ? "AND notifications.read_at IS NULL" : ""}
      ${decoded ? "AND (notifications.created_at < ? OR (notifications.created_at = ? AND notifications.id < ?))" : ""}
    ORDER BY notifications.created_at DESC, notifications.id DESC
    LIMIT ?
  `).all(userId, ...(decoded ? [decoded.sortTime, decoded.sortTime, decoded.id] : []), safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows.at(-1);
  return {
    notifications: pageRows.map(mapNotification),
    pageInfo: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore && last
        ? cursorService.encodeCursor(scope, { sortTime: last.created_at, id: last.id })
        : null,
    },
  };
}

async function unreadCount(userId) {
  const db = getDatabase();
  const row = db.prepare(`
    SELECT COUNT(*) AS count FROM notifications
    WHERE recipient_user_id = ? AND read_at IS NULL
  `).get(userId);
  return Number(row.count) || 0;
}

async function markRead({ userId, notificationId }) {
  const db = getDatabase();
  const existing = db.prepare("SELECT id FROM notifications WHERE id = ? AND recipient_user_id = ?").get(notificationId, userId);
  if (!existing) throw createError("notification not found", 404, "NOTIFICATION_NOT_FOUND");
  db.prepare(`
    UPDATE notifications SET read_at = COALESCE(read_at, ?)
    WHERE id = ? AND recipient_user_id = ?
  `).run(new Date().toISOString(), notificationId, userId);
  return db.prepare("SELECT read_at FROM notifications WHERE id = ?").get(notificationId).read_at;
}

async function markAllRead(userId) {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE notifications SET read_at = ?
    WHERE recipient_user_id = ? AND read_at IS NULL
  `).run(new Date().toISOString(), userId);
  return Number(result.changes) || 0;
}

function mapPreferences(row) {
  return {
    inAppEnabled: Boolean(row.in_app_enabled),
    likesEnabled: Boolean(row.likes_enabled),
    commentsEnabled: Boolean(row.comments_enabled),
    followsEnabled: Boolean(row.follows_enabled),
    moderationEnabled: Boolean(row.moderation_enabled),
    systemEnabled: Boolean(row.system_enabled),
    emailEnabled: Boolean(row.email_enabled),
    updatedAt: row.updated_at,
  };
}

async function getPreferences(userId) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").get(userId);
  if (!row) throw createError("notification preferences not found", 500, "NOTIFICATION_PREFERENCES_MISSING");
  return mapPreferences(row);
}

async function updatePreferences({ userId, changes }) {
  const db = getDatabase();
  const mapping = {
    inAppEnabled: "in_app_enabled",
    likesEnabled: "likes_enabled",
    commentsEnabled: "comments_enabled",
    followsEnabled: "follows_enabled",
    moderationEnabled: "moderation_enabled",
    systemEnabled: "system_enabled",
    emailEnabled: "email_enabled",
  };
  const assignments = [];
  const values = [];
  for (const [field, column] of Object.entries(mapping)) {
    if (!Object.hasOwn(changes, field)) continue;
    assignments.push(`${column} = ?`);
    values.push(changes[field] ? 1 : 0);
  }
  if (assignments.length) {
    const now = new Date().toISOString();
    assignments.push("updated_at = ?");
    values.push(now, userId);
    db.prepare(`UPDATE notification_preferences SET ${assignments.join(", ")} WHERE user_id = ?`).run(...values);
    if (Object.hasOwn(changes, "emailEnabled")) {
      db.prepare("UPDATE users SET email_notifications = ?, updated_at = ? WHERE id = ?")
        .run(changes.emailEnabled ? 1 : 0, now, userId);
    }
  }
  return getPreferences(userId);
}

module.exports = {
  createNotification,
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  updatePreferences,
};
