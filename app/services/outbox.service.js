"use strict";

const crypto = require("crypto");

const { getDatabase } = require("../db/database");
const notificationService = require("./notification.service");

class PermanentOutboxError extends Error {
  constructor(message, code = "PERMANENT_OUTBOX_ERROR") {
    super(message);
    this.name = "PermanentOutboxError";
    this.code = code;
  }
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.trunc(parsed)));
}

function isoTime(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("outbox time is invalid");
  return date.toISOString();
}

function parsePayload(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("payload is not an object");
    }
    return parsed;
  } catch {
    throw new PermanentOutboxError("outbox payload is invalid", "INVALID_OUTBOX_PAYLOAD");
  }
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    payload: parsePayload(row.payload_json),
    dedupeKey: row.dedupe_key,
    attempts: Number(row.attempts) || 0,
    availableAt: row.available_at,
    lockOwner: row.lock_owner,
    lockedUntil: row.locked_until,
    createdAt: row.created_at,
  };
}

function sanitizeErrorMessage(error) {
  return String(error?.message || "outbox handler failed")
    .replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=]+/giu, "[redacted-data]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/\b(password|token|authorization|cookie)=([^&\s]+)/giu, "$1=[redacted]")
    .slice(0, 500);
}

function claimNextEvent({
  db = getDatabase(),
  workerId,
  now = new Date(),
  leaseMs = 30_000,
} = {}) {
  const owner = String(workerId || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u.test(owner)) throw new Error("outbox worker id is invalid");
  const claimedAt = isoTime(now);
  const lockedUntil = new Date(new Date(claimedAt).getTime() + boundedInteger(leaseMs, 30_000, 1_000, 10 * 60_000)).toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const candidate = db.prepare(`
      SELECT * FROM outbox_events
      WHERE processed_at IS NULL
        AND dead_lettered_at IS NULL
        AND available_at <= ?
        AND (lock_owner IS NULL OR locked_until IS NULL OR locked_until <= ?)
      ORDER BY available_at ASC, created_at ASC, id ASC
      LIMIT 1
    `).get(claimedAt, claimedAt);
    if (!candidate) {
      db.exec("COMMIT");
      return null;
    }
    const claimed = db.prepare(`
      UPDATE outbox_events
      SET lock_owner = ?, locked_until = ?
      WHERE id = ?
        AND processed_at IS NULL
        AND dead_lettered_at IS NULL
        AND (lock_owner IS NULL OR locked_until IS NULL OR locked_until <= ?)
    `).run(owner, lockedUntil, candidate.id, claimedAt);
    if (claimed.changes !== 1) {
      db.exec("ROLLBACK");
      return null;
    }
    const event = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(candidate.id);
    db.exec("COMMIT");
    return mapEvent(event);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function completeEvent({ db = getDatabase(), eventId, workerId, now = new Date() }) {
  const result = db.prepare(`
    UPDATE outbox_events
    SET processed_at = ?, lock_owner = NULL, locked_until = NULL, last_error = ''
    WHERE id = ? AND lock_owner = ?
      AND processed_at IS NULL AND dead_lettered_at IS NULL
  `).run(isoTime(now), eventId, workerId);
  return result.changes === 1;
}

function retryDelayMs(attempts, options = {}) {
  const baseMs = boundedInteger(options.baseMs, 1_000, 100, 60_000);
  const maximumMs = boundedInteger(options.maximumMs, 15 * 60_000, baseMs, 24 * 60 * 60_000);
  return Math.min(maximumMs, baseMs * (2 ** Math.max(0, attempts - 1)));
}

function failEvent({
  db = getDatabase(),
  event,
  workerId,
  error,
  now = new Date(),
  maxAttempts = 5,
  retry = {},
} = {}) {
  const failedAt = isoTime(now);
  const attempts = Number(event.attempts) + 1;
  const permanent = error instanceof PermanentOutboxError;
  const deadLetter = permanent || attempts >= boundedInteger(maxAttempts, 5, 1, 100);
  const availableAt = deadLetter
    ? failedAt
    : new Date(new Date(failedAt).getTime() + retryDelayMs(attempts, retry)).toISOString();
  const result = db.prepare(`
    UPDATE outbox_events
    SET attempts = ?, available_at = ?, lock_owner = NULL, locked_until = NULL,
        dead_lettered_at = ?, last_error = ?
    WHERE id = ? AND lock_owner = ?
      AND processed_at IS NULL AND dead_lettered_at IS NULL
  `).run(
    attempts,
    availableAt,
    deadLetter ? failedAt : null,
    sanitizeErrorMessage(error),
    event.id,
    workerId
  );
  return { updated: result.changes === 1, attempts, deadLetter, availableAt };
}

function requireString(payload, field, maxLength = 160) {
  const value = payload[field];
  if (typeof value !== "string" || value.length < 1 || value.length > maxLength) {
    throw new PermanentOutboxError(`outbox payload field ${field} is invalid`, "INVALID_OUTBOX_PAYLOAD");
  }
  return value;
}

function handlePostModerationChanged(event, db) {
  const payload = event.payload;
  const actionId = requireString(payload, "actionId", 64);
  const postId = requireString(payload, "postId", 64);
  const authorUserId = requireString(payload, "authorUserId", 64);
  const moderatorUserId = requireString(payload, "moderatorUserId", 64);
  const moderationStatus = requireString(payload, "moderationStatus", 40);
  const decision = requireString(payload, "decision", 40);
  const postTitle = requireString(payload, "postTitle", 160);
  notificationService.createNotification(db, {
    recipientUserId: authorUserId,
    actorUserId: moderatorUserId,
    type: "post_moderation_updated",
    entityType: "post",
    entityId: postId,
    payload: { postTitle, moderationStatus, decision },
    dedupeKey: `post_moderation_updated:${actionId}:${authorUserId}`,
    now: new Date().toISOString(),
  });
}

const DEFAULT_HANDLERS = Object.freeze({
  "post.moderation_changed": handlePostModerationChanged,
});

async function processNextEvent({
  db = getDatabase(),
  workerId,
  handlers = DEFAULT_HANDLERS,
  canWrite = () => true,
  now,
  clock = () => new Date(),
  leaseMs = 30_000,
  maxAttempts = 5,
  retry = {},
} = {}) {
  if (!canWrite()) return { state: "paused" };
  const event = claimNextEvent({ db, workerId, now: now || clock(), leaseMs });
  if (!event) return { state: "idle" };
  try {
    const handler = handlers[event.eventType];
    if (typeof handler !== "function") {
      throw new PermanentOutboxError(`unsupported outbox event type: ${event.eventType}`, "UNSUPPORTED_OUTBOX_EVENT");
    }
    await handler(event, db);
    if (!completeEvent({ db, eventId: event.id, workerId, now: clock() })) {
      return { state: "lease-lost", eventId: event.id };
    }
    return { state: "processed", eventId: event.id };
  } catch (error) {
    const result = failEvent({ db, event, workerId, error, now: clock(), maxAttempts, retry });
    return {
      state: result.deadLetter ? "dead-lettered" : "retry-scheduled",
      eventId: event.id,
      attempts: result.attempts,
      errorCode: error?.code || "OUTBOX_HANDLER_FAILED",
    };
  }
}

function getOutboxHealth({ db = getDatabase(), now = new Date(), thresholds = {} } = {}) {
  const currentTime = isoTime(now);
  const row = db.prepare(`
    SELECT
      SUM(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN 1 ELSE 0 END) AS backlog_count,
      SUM(CASE WHEN dead_lettered_at IS NOT NULL THEN 1 ELSE 0 END) AS dead_letter_count,
      SUM(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL AND lock_owner IS NOT NULL AND locked_until > ? THEN 1 ELSE 0 END) AS locked_count,
      MIN(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN created_at ELSE NULL END) AS oldest_created_at,
      SUM(CASE WHEN processed_at IS NULL AND dead_lettered_at IS NULL THEN LENGTH(payload_json) ELSE 0 END) AS backlog_payload_bytes
    FROM outbox_events
  `).get(currentTime);
  const backlogCount = Number(row.backlog_count) || 0;
  const deadLetterCount = Number(row.dead_letter_count) || 0;
  const lockedCount = Number(row.locked_count) || 0;
  const backlogPayloadBytes = Number(row.backlog_payload_bytes) || 0;
  const oldestCreatedAt = row.oldest_created_at || null;
  const oldestAgeSeconds = oldestCreatedAt
    ? Math.max(0, Math.floor((new Date(currentTime).getTime() - new Date(oldestCreatedAt).getTime()) / 1000))
    : 0;
  const limits = {
    maxBacklogEvents: boundedInteger(thresholds.maxBacklogEvents ?? process.env.OUTBOX_MAX_BACKLOG_EVENTS, 10_000, 1, 10_000_000),
    maxBacklogPayloadBytes: boundedInteger(thresholds.maxBacklogPayloadBytes ?? process.env.OUTBOX_MAX_BACKLOG_PAYLOAD_BYTES, 16 * 1024 * 1024, 1024, 1024 * 1024 * 1024),
    maxOldestAgeSeconds: boundedInteger(thresholds.maxOldestAgeSeconds ?? process.env.OUTBOX_MAX_OLDEST_AGE_SECONDS, 3600, 1, 30 * 24 * 60 * 60),
  };
  const capacityExceeded = backlogCount > limits.maxBacklogEvents
    || backlogPayloadBytes > limits.maxBacklogPayloadBytes
    || oldestAgeSeconds > limits.maxOldestAgeSeconds;
  return {
    healthy: !capacityExceeded && deadLetterCount === 0,
    capacityExceeded,
    backlogCount,
    backlogPayloadBytes,
    deadLetterCount,
    lockedCount,
    oldestCreatedAt,
    oldestAgeSeconds,
    limits,
  };
}

class OutboxWorker {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.intervalMs = boundedInteger(options.intervalMs ?? process.env.OUTBOX_POLL_INTERVAL_MS, 1_000, 100, 60_000);
    this.workerId = options.workerId || `api:${process.pid}:${crypto.randomUUID()}`;
    this.options = options;
    this.timer = null;
    this.stopped = true;
    this.running = null;
  }

  start() {
    if (!this.enabled || !this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }

  schedule(delay) {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => {
        this.running = null;
        this.schedule(this.intervalMs);
      });
    }, delay);
    this.timer.unref();
  }

  async tick() {
    const result = await processNextEvent({
      workerId: this.workerId,
      handlers: this.options.handlers || DEFAULT_HANDLERS,
      canWrite: this.options.canWrite || (() => true),
      leaseMs: this.options.leaseMs,
      maxAttempts: this.options.maxAttempts ?? boundedInteger(process.env.OUTBOX_MAX_ATTEMPTS, 5, 1, 100),
      retry: this.options.retry,
    });
    if (result.state === "dead-lettered") {
      console.error(JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        component: "outbox-worker",
        eventId: result.eventId,
        attempts: result.attempts,
        errorCode: result.errorCode,
      }));
    }
    return result;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    return this.running || Promise.resolve();
  }
}

module.exports = {
  DEFAULT_HANDLERS,
  OutboxWorker,
  PermanentOutboxError,
  claimNextEvent,
  completeEvent,
  failEvent,
  getOutboxHealth,
  processNextEvent,
  retryDelayMs,
  sanitizeErrorMessage,
};
