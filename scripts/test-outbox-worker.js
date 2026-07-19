"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-outbox-test-"));
process.env.NODE_ENV = "test";
process.env.DATABASE_FILE = path.join(tempDirectory, "birdora.sqlite");
process.env.JWT_SECRET = process.env.JWT_SECRET || "outbox-test-secret-at-least-32-characters";

const { closeDatabase, getDatabase } = require("../app/db/database");
const {
  PermanentOutboxError,
  claimNextEvent,
  completeEvent,
  getOutboxHealth,
  processNextEvent,
  retryDelayMs,
  sanitizeErrorMessage,
} = require("../app/services/outbox.service");

function check(label, condition, detail = "") {
  console.log(`${label}: ${condition ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
  if (!condition) throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
}

function insertEvent(db, {
  eventType = "test.event",
  payload = { value: "safe" },
  availableAt = "2026-01-01T00:00:00.000Z",
  createdAt = "2026-01-01T00:00:00.000Z",
  attempts = 0,
} = {}) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO outbox_events (
      id, event_type, aggregate_type, aggregate_id, payload_json, dedupe_key,
      attempts, available_at, lock_owner, locked_until, processed_at,
      dead_lettered_at, last_error, created_at
    ) VALUES (?, ?, 'test', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, '', ?)
  `).run(
    id,
    eventType,
    id,
    JSON.stringify(payload),
    `test:${id}`,
    attempts,
    availableAt,
    createdAt
  );
  return id;
}

async function main() {
  const db = getDatabase();
  const firstId = insertEvent(db);
  const first = claimNextEvent({
    db,
    workerId: "worker:test:first",
    now: "2026-01-01T00:00:01.000Z",
    leaseMs: 5_000,
  });
  check("eligible event is claimed", first?.id === firstId && first.lockOwner === "worker:test:first");
  const whileLeased = claimNextEvent({
    db,
    workerId: "worker:test:second",
    now: "2026-01-01T00:00:02.000Z",
    leaseMs: 5_000,
  });
  check("active lease prevents a second claim", whileLeased === null);
  check("wrong owner cannot complete event", completeEvent({
    db,
    eventId: firstId,
    workerId: "worker:test:second",
    now: "2026-01-01T00:00:02.000Z",
  }) === false);
  check("lease owner completes event", completeEvent({
    db,
    eventId: firstId,
    workerId: "worker:test:first",
    now: "2026-01-01T00:00:02.000Z",
  }) === true);

  const reclaimId = insertEvent(db);
  claimNextEvent({ db, workerId: "worker:test:old", now: "2026-01-01T00:00:01.000Z", leaseMs: 1_000 });
  const reclaimed = claimNextEvent({ db, workerId: "worker:test:new", now: "2026-01-01T00:00:03.000Z", leaseMs: 1_000 });
  check("expired lease can be reclaimed", reclaimed?.id === reclaimId && reclaimed.lockOwner === "worker:test:new");
  completeEvent({ db, eventId: reclaimId, workerId: "worker:test:new", now: "2026-01-01T00:00:03.000Z" });

  const retryId = insertEvent(db, { eventType: "retry.event" });
  const firstFailure = await processNextEvent({
    db,
    workerId: "worker:test:retry",
    now: "2026-01-01T00:00:01.000Z",
    clock: () => new Date("2026-01-01T00:00:01.000Z"),
    retry: { baseMs: 1_000, maximumMs: 10_000 },
    handlers: { "retry.event": async () => { throw new Error("temporary password=secret-value failure"); } },
  });
  check("transient failure schedules retry", firstFailure.state === "retry-scheduled" && firstFailure.eventId === retryId && firstFailure.attempts === 1);
  const retryRow = db.prepare("SELECT * FROM outbox_events WHERE id = ?").get(retryId);
  check("retry releases lease and advances availability", retryRow.lock_owner === null && retryRow.available_at === "2026-01-01T00:00:02.000Z");
  check("outbox errors redact secrets", retryRow.last_error.includes("password=[redacted]") && !retryRow.last_error.includes("secret-value"));
  const tooEarly = await processNextEvent({
    db,
    workerId: "worker:test:retry",
    now: "2026-01-01T00:00:01.500Z",
    handlers: { "retry.event": async () => {} },
  });
  check("retry is not claimed before availableAt", tooEarly.state === "idle");
  const retried = await processNextEvent({
    db,
    workerId: "worker:test:retry",
    now: "2026-01-01T00:00:03.000Z",
    clock: () => new Date("2026-01-01T00:00:03.000Z"),
    handlers: { "retry.event": async () => {} },
  });
  check("retry can complete idempotently", retried.state === "processed" && retried.eventId === retryId);

  const permanentId = insertEvent(db, { eventType: "permanent.event" });
  const permanent = await processNextEvent({
    db,
    workerId: "worker:test:permanent",
    now: "2026-01-01T00:00:01.000Z",
    clock: () => new Date("2026-01-01T00:00:01.000Z"),
    handlers: {
      "permanent.event": async () => {
        throw new PermanentOutboxError("payload contract is unsupported", "UNSUPPORTED_PAYLOAD");
      },
    },
  });
  check("permanent error goes directly to dead letter", permanent.state === "dead-lettered" && permanent.eventId === permanentId);

  const maxAttemptId = insertEvent(db, { eventType: "max.event", attempts: 1 });
  const maxAttempt = await processNextEvent({
    db,
    workerId: "worker:test:max",
    now: "2026-01-01T00:00:01.000Z",
    clock: () => new Date("2026-01-01T00:00:01.000Z"),
    maxAttempts: 2,
    handlers: { "max.event": async () => { throw new Error("still failing"); } },
  });
  check("maximum attempts dead-letters event", maxAttempt.state === "dead-lettered" && maxAttempt.attempts === 2 && maxAttempt.eventId === maxAttemptId);

  const pausedId = insertEvent(db, { eventType: "paused.event" });
  const paused = await processNextEvent({
    db,
    workerId: "worker:test:paused",
    canWrite: () => false,
    now: "2026-01-01T00:00:01.000Z",
    handlers: { "paused.event": async () => {} },
  });
  check("activation write gate pauses worker before claim", paused.state === "paused");
  check("paused worker leaves event unlocked", db.prepare("SELECT lock_owner FROM outbox_events WHERE id = ?").get(pausedId).lock_owner === null);

  const health = getOutboxHealth({
    db,
    now: "2026-01-01T00:10:00.000Z",
    thresholds: { maxBacklogEvents: 1, maxBacklogPayloadBytes: 1024, maxOldestAgeSeconds: 60 },
  });
  check("health exposes backlog and dead letters", health.backlogCount === 1 && health.deadLetterCount === 2);
  check("capacity and dead letters fail readiness health", health.healthy === false && health.capacityExceeded === true);
  check("retry backoff is bounded exponential", retryDelayMs(1, { baseMs: 1000, maximumMs: 2500 }) === 1000 && retryDelayMs(4, { baseMs: 1000, maximumMs: 2500 }) === 2500);
  check("standalone sanitizer redacts bearer token", !sanitizeErrorMessage(new Error("Bearer abc.def.ghi")).includes("abc.def.ghi"));
}

main().catch((error) => {
  console.error(`Outbox worker test failed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => {
  closeDatabase();
  fs.rmSync(tempDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
