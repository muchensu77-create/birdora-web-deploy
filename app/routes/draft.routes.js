"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const controller = require("../controllers/draft.controller");
const authJwt = require("../middleware/auth-jwt");
const { requireJsonObject } = require("../middleware/require-json-object");

const router = express.Router();
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.DRAFT_WRITE_RATE_LIMIT || 180),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || rateLimit.ipKeyGenerator(req.ip),
  message: { message: "Too many draft requests", code: "RATE_LIMITED" },
});
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get("/drafts", asyncHandler(authJwt.requireAuth), asyncHandler(controller.list));
router.post("/drafts", asyncHandler(authJwt.requireAuth), writeLimiter, express.json({ limit: "64kb" }), requireJsonObject, asyncHandler(controller.create));
router.post("/drafts/:draftId/publish", asyncHandler(authJwt.requireAuth), writeLimiter, express.json({ limit: "14mb" }), requireJsonObject, asyncHandler(controller.publish));
router.get("/drafts/:draftId", asyncHandler(authJwt.requireAuth), asyncHandler(controller.get));
router.patch("/drafts/:draftId", asyncHandler(authJwt.requireAuth), writeLimiter, express.json({ limit: "64kb" }), requireJsonObject, asyncHandler(controller.update));
router.delete("/drafts/:draftId", asyncHandler(authJwt.requireAuth), writeLimiter, asyncHandler(controller.remove));

module.exports = router;
