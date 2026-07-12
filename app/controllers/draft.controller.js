"use strict";

const draftService = require("../services/draft.service");
const communityController = require("./community-post.controller");

const FIELD_LIMITS = Object.freeze({ title: 80, body: 600, bird: 80, locationText: 160 });
const VISIBILITIES = new Set(["public", "followers", "private"]);

function envelope(req, data, pageInfo) {
  return { data, ...(pageInfo ? { pageInfo } : {}), requestId: req.requestId || "" };
}

function requireIdentifier(value, label = "draftId") {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return id;
}

function parseFields(body, { partial = false } = {}) {
  const allowed = new Set(["title", "body", "bird", "locationText", "visibility", "observationId", ...(partial ? ["version"] : [])]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw Object.assign(new Error(`unsupported draft field: ${key}`), { statusCode: 400, code: "VALIDATION_ERROR" });
  }
  const fields = {};
  for (const [field, max] of Object.entries(FIELD_LIMITS)) {
    if (!Object.hasOwn(body, field)) continue;
    if (typeof body[field] !== "string" || body[field].trim().length > max) {
      throw Object.assign(new Error(`${field} is invalid`), { statusCode: 400, code: "VALIDATION_ERROR" });
    }
    fields[field] = body[field].trim();
  }
  if (Object.hasOwn(body, "visibility")) {
    if (typeof body.visibility !== "string" || !VISIBILITIES.has(body.visibility)) {
      throw Object.assign(new Error("visibility is invalid"), { statusCode: 400, code: "VALIDATION_ERROR" });
    }
    fields.visibility = body.visibility;
  }
  if (Object.hasOwn(body, "observationId")) {
    if (body.observationId !== "" && body.observationId !== null) fields.observationId = requireIdentifier(body.observationId, "observationId");
    else fields.observationId = "";
  }
  return fields;
}

async function list(req, res) {
  const result = await draftService.listDrafts({
    userId: req.user.id,
    limit: Math.max(1, Math.min(50, Number(req.query.limit) || 20)),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.drafts, result.pageInfo));
}

async function create(req, res) {
  res.status(201).json(envelope(req, await draftService.createDraft({ userId: req.user.id, fields: parseFields(req.body) })));
}

async function get(req, res) {
  res.json(envelope(req, await draftService.getDraft({ draftId: requireIdentifier(req.params.draftId), userId: req.user.id })));
}

async function update(req, res) {
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 1) {
    res.status(400).json({ message: "version is required", code: "VALIDATION_ERROR" });
    return;
  }
  const fields = parseFields(req.body, { partial: true });
  delete fields.version;
  res.json(envelope(req, await draftService.updateDraft({
    draftId: requireIdentifier(req.params.draftId),
    userId: req.user.id,
    version: req.body.version,
    changes: fields,
  })));
}

async function remove(req, res) {
  await draftService.deleteDraft({ draftId: requireIdentifier(req.params.draftId), userId: req.user.id });
  res.status(204).end();
}

async function publish(req, res) {
  const idempotencyKey = String(req.get("Idempotency-Key") || "");
  if (!/^[A-Za-z0-9._:-]{8,128}$/u.test(idempotencyKey)) {
    res.status(400).json({ message: "a valid Idempotency-Key is required", code: "IDEMPOTENCY_KEY_REQUIRED" });
    return;
  }
  if (!Number.isSafeInteger(req.body.version) || req.body.version < 1) {
    res.status(400).json({ message: "version is required", code: "VALIDATION_ERROR" });
    return;
  }
  const image = communityController.validatePostImage(req, res);
  if (image === false) return;
  const video = communityController.validatePostVideo(req, res);
  if (video === false) return;
  if (image && video) {
    res.status(400).json({ message: "a post can include either one image or one video", code: "VALIDATION_ERROR" });
    return;
  }
  const post = await draftService.publishDraft({
    draftId: requireIdentifier(req.params.draftId),
    userId: req.user.id,
    version: req.body.version,
    idempotencyKey,
    image,
    video,
  });
  res.status(201).json(envelope(req, post));
}

module.exports = { create, get, list, publish, remove, update };
