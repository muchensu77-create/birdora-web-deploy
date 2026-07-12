"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const controller = require("../controllers/notification.controller");
const authJwt = require("../middleware/auth-jwt");
const { requireJsonObject } = require("../middleware/require-json-object");

const router = express.Router();
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.NOTIFICATION_WRITE_RATE_LIMIT || 300),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || rateLimit.ipKeyGenerator(req.ip),
  message: { message: "Too many notification requests", code: "RATE_LIMITED" },
});
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get("/notifications", asyncHandler(authJwt.requireAuth), asyncHandler(controller.list));
router.get("/notifications/unread-count", asyncHandler(authJwt.requireAuth), asyncHandler(controller.unread));
router.post("/notifications/read-all", asyncHandler(authJwt.requireAuth), writeLimiter, asyncHandler(controller.readAll));
router.post("/notifications/:notificationId/read", asyncHandler(authJwt.requireAuth), writeLimiter, asyncHandler(controller.read));
router.get("/notification-preferences", asyncHandler(authJwt.requireAuth), asyncHandler(controller.preferences));
router.patch(
  "/notification-preferences",
  asyncHandler(authJwt.requireAuth),
  writeLimiter,
  express.json({ limit: "16kb" }),
  requireJsonObject,
  asyncHandler(controller.updatePreferences)
);

module.exports = router;
