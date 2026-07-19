"use strict";

const moderationService = require("../services/moderation.service");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function envelope(req, data, pageInfo) {
  return { data, ...(pageInfo ? { pageInfo } : {}), requestId: req.requestId || "" };
}

function requireIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!UUID_V4.test(identifier)) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return identifier;
}

function rejectUnknownFields(body, allowedFields) {
  const unknown = Object.keys(body).filter((field) => !allowedFields.has(field));
  if (unknown.length) {
    const error = new Error("request contains unsupported fields");
    error.statusCode = 400;
    error.code = "VALIDATION_ERROR";
    throw error;
  }
}

function parseLimit(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(50, Math.trunc(parsed))) : 20;
}

async function createReport(req, res) {
  rejectUnknownFields(req.body, new Set(["reason", "detail"]));
  if (typeof req.body.reason !== "string") {
    res.status(400).json({ message: "report reason is required", code: "VALIDATION_ERROR" });
    return;
  }
  if (req.body.detail !== undefined && typeof req.body.detail !== "string") {
    res.status(400).json({ message: "report detail is invalid", code: "VALIDATION_ERROR" });
    return;
  }
  const detail = String(req.body.detail || "").trim();
  if (detail.length > 500) {
    res.status(400).json({ message: "report detail must not exceed 500 characters", code: "VALIDATION_ERROR" });
    return;
  }
  const data = await moderationService.createReport({
    postId: requireIdentifier(req.params.postId, "postId"),
    reporterUserId: req.user.id,
    reason: req.body.reason,
    detail,
  });
  res.status(201).json(envelope(req, data));
}

async function myRoles(req, res) {
  res.set("Cache-Control", "private, no-store");
  res.json(envelope(req, { roles: moderationService.getUserRoles(req.user.id) }));
}

async function listCases(req, res) {
  const result = await moderationService.listCases({
    moderatorUserId: req.user.id,
    queue: String(req.query.queue || "reported"),
    status: String(req.query.status || "active"),
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.cases, result.pageInfo));
}

async function getCase(req, res) {
  const caseId = requireIdentifier(req.params.caseId, "caseId");
  const data = await moderationService.getCase({
    caseId,
    moderatorUserId: req.user.id,
  });
  console.info(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    component: "moderation-access-audit",
    action: "view_case",
    caseId,
    moderatorUserId: req.user.id,
    requestId: req.requestId || "",
  }));
  res.set("Cache-Control", "private, no-store");
  res.json(envelope(req, data));
}

async function decideCase(req, res) {
  rejectUnknownFields(req.body, new Set(["decision", "reason"]));
  if (typeof req.body.decision !== "string" || typeof req.body.reason !== "string") {
    res.status(400).json({ message: "decision and reason are required", code: "VALIDATION_ERROR" });
    return;
  }
  const reason = req.body.reason.trim();
  if (reason.length < 3 || reason.length > 500) {
    res.status(400).json({ message: "decision reason must contain 3 to 500 characters", code: "VALIDATION_ERROR" });
    return;
  }
  const data = await moderationService.decideCase({
    caseId: requireIdentifier(req.params.caseId, "caseId"),
    moderatorUserId: req.user.id,
    decision: req.body.decision,
    reason,
  });
  res.json(envelope(req, data));
}

module.exports = { createReport, decideCase, getCase, listCases, myRoles };
