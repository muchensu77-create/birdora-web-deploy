"use strict";

const crypto = require("crypto");

const { getDatabase } = require("../db/database");
const communityPostService = require("./community-post.service");
const cursorService = require("./cursor.service");
const observationService = require("./observation.service");

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function mapDraft(row) {
  return {
    id: row.id,
    observationId: row.observation_id || "",
    title: row.title,
    body: row.body,
    bird: row.bird,
    locationText: row.location_text,
    visibility: row.visibility,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getOwnedDraftRow(db, draftId, userId) {
  const row = db.prepare(`
    SELECT * FROM post_drafts
    WHERE id = ? AND user_id = ? AND consumed_at IS NULL
  `).get(draftId, userId);
  if (!row) throw createError("draft not found", 404, "DRAFT_NOT_FOUND");
  return row;
}

async function listDrafts({ userId, limit = 20, cursor = "" }) {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const scope = `drafts:${userId}`;
  const decoded = cursorService.decodeCursor(cursor, scope);
  const rows = db.prepare(`
    SELECT * FROM post_drafts
    WHERE user_id = ? AND consumed_at IS NULL
      ${decoded ? "AND (updated_at < ? OR (updated_at = ? AND id < ?))" : ""}
    ORDER BY updated_at DESC, id DESC
    LIMIT ?
  `).all(userId, ...(decoded ? [decoded.sortTime, decoded.sortTime, decoded.id] : []), safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows.at(-1);
  return {
    drafts: pageRows.map(mapDraft),
    pageInfo: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore && last
        ? cursorService.encodeCursor(scope, { sortTime: last.updated_at, id: last.id })
        : null,
    },
  };
}

async function getDraft({ draftId, userId }) {
  return mapDraft(getOwnedDraftRow(getDatabase(), draftId, userId));
}

async function createDraft({ userId, fields }) {
  const db = getDatabase();
  if (fields.observationId) observationService.getOwnedObservationRow(db, fields.observationId, userId);
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    observationId: fields.observationId || null,
    title: fields.title || "",
    body: fields.body || "",
    bird: fields.bird || "观鸟笔记",
    locationText: fields.locationText || "",
    visibility: fields.visibility || "public",
  };
  db.prepare(`
    INSERT INTO post_drafts (
      id, user_id, observation_id, title, body, bird, location_text,
      visibility, version, consumed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)
  `).run(
    row.id, userId, row.observationId, row.title, row.body, row.bird,
    row.locationText, row.visibility, now, now
  );
  return getDraft({ draftId: row.id, userId });
}

async function updateDraft({ draftId, userId, version, changes }) {
  const db = getDatabase();
  const existing = getOwnedDraftRow(db, draftId, userId);
  if (Number(existing.version) !== version) {
    throw createError("draft was changed by another session", 409, "DRAFT_VERSION_CONFLICT");
  }
  if (Object.hasOwn(changes, "observationId") && changes.observationId) {
    observationService.getOwnedObservationRow(db, changes.observationId, userId);
  }
  const mapping = {
    observationId: "observation_id",
    title: "title",
    body: "body",
    bird: "bird",
    locationText: "location_text",
    visibility: "visibility",
  };
  const assignments = [];
  const values = [];
  for (const [field, column] of Object.entries(mapping)) {
    if (!Object.hasOwn(changes, field)) continue;
    assignments.push(`${column} = ?`);
    values.push(field === "observationId" ? changes[field] || null : changes[field]);
  }
  if (!assignments.length) return mapDraft(existing);
  const result = db.prepare(`
    UPDATE post_drafts
    SET ${assignments.join(", ")}, version = version + 1, updated_at = ?
    WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND version = ?
  `).run(...values, new Date().toISOString(), draftId, userId, version);
  if (result.changes !== 1) throw createError("draft was changed by another session", 409, "DRAFT_VERSION_CONFLICT");
  return getDraft({ draftId, userId });
}

async function deleteDraft({ draftId, userId }) {
  const db = getDatabase();
  getOwnedDraftRow(db, draftId, userId);
  db.prepare("DELETE FROM post_drafts WHERE id = ? AND user_id = ? AND consumed_at IS NULL").run(draftId, userId);
}

async function publishDraft(options) {
  return communityPostService.publishDraft(options);
}

module.exports = { createDraft, deleteDraft, getDraft, listDrafts, publishDraft, updateDraft };
