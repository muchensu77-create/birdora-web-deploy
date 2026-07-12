"use strict";

const notificationService = require("../services/notification.service");

function parseLimit(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(50, Math.trunc(number))) : 20;
}

function requireIdentifier(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    const error = new Error("notification id is invalid");
    error.statusCode = 400;
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return id;
}

function envelope(req, data, pageInfo) {
  return { data, ...(pageInfo ? { pageInfo } : {}), requestId: req.requestId || "" };
}

async function list(req, res) {
  const result = await notificationService.listNotifications({
    userId: req.user.id,
    unreadOnly: String(req.query.unreadOnly || "false") === "true",
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.notifications, result.pageInfo));
}

async function unread(req, res) {
  res.json(envelope(req, { count: await notificationService.unreadCount(req.user.id) }));
}

async function read(req, res) {
  const readAt = await notificationService.markRead({
    userId: req.user.id,
    notificationId: requireIdentifier(req.params.notificationId),
  });
  res.json(envelope(req, { id: req.params.notificationId, readAt }));
}

async function readAll(req, res) {
  res.json(envelope(req, { updated: await notificationService.markAllRead(req.user.id) }));
}

async function preferences(req, res) {
  res.json(envelope(req, await notificationService.getPreferences(req.user.id)));
}

async function updatePreferences(req, res) {
  const allowed = new Set([
    "inAppEnabled", "likesEnabled", "commentsEnabled", "followsEnabled",
    "moderationEnabled", "systemEnabled", "emailEnabled",
  ]);
  const changes = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (!allowed.has(key) || typeof value !== "boolean") {
      res.status(400).json({ message: "notification preference fields are invalid", code: "VALIDATION_ERROR" });
      return;
    }
    changes[key] = value;
  }
  if (!Object.keys(changes).length) {
    res.status(400).json({ message: "at least one preference is required", code: "VALIDATION_ERROR" });
    return;
  }
  res.json(envelope(req, await notificationService.updatePreferences({ userId: req.user.id, changes })));
}

module.exports = { list, preferences, read, readAll, unread, updatePreferences };
