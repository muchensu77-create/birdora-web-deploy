"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const controller = require("../controllers/moderation.controller");
const authJwt = require("../middleware/auth-jwt");
const { requireJsonObject } = require("../middleware/require-json-object");
const { requireModerator } = require("../middleware/moderator-role");

const router = express.Router();
const jsonParser = express.json({ limit: "16kb" });
const reportLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.CONTENT_REPORT_RATE_LIMIT || 20),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || rateLimit.ipKeyGenerator(req.ip),
  message: { message: "Too many reports, please try again later.", code: "RATE_LIMITED" },
});
const decisionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.MODERATION_DECISION_RATE_LIMIT || 120),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || rateLimit.ipKeyGenerator(req.ip),
  message: { message: "Too many moderation requests, please try again later.", code: "RATE_LIMITED" },
});
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get("/me/roles", asyncHandler(authJwt.requireAuth), asyncHandler(controller.myRoles));
router.post(
  "/posts/:postId/reports",
  asyncHandler(authJwt.requireAuth),
  reportLimiter,
  jsonParser,
  requireJsonObject,
  asyncHandler(controller.createReport)
);
router.get(
  "/admin/moderation/cases",
  asyncHandler(authJwt.requireAuth),
  requireModerator,
  asyncHandler(controller.listCases)
);
router.get(
  "/admin/moderation/cases/:caseId",
  asyncHandler(authJwt.requireAuth),
  requireModerator,
  asyncHandler(controller.getCase)
);
router.put(
  "/admin/moderation/cases/:caseId/decision",
  asyncHandler(authJwt.requireAuth),
  requireModerator,
  decisionLimiter,
  jsonParser,
  requireJsonObject,
  asyncHandler(controller.decideCase)
);

module.exports = router;
