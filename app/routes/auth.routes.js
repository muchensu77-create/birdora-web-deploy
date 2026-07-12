const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/auth.controller");
const authJwt = require("../middleware/auth-jwt");
const { requireFeature } = require("../middleware/feature-guard");
const { requireJsonObject } = require("../middleware/require-json-object");

const router = express.Router();
const authSmallJson = express.json({ limit: "64kb" });
const authProfileJson = express.json({ limit: "1mb" });
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT || 120),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    message: "Too many auth requests, please try again later.",
  },
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post("/register", authLimiter, authSmallJson, requireJsonObject, asyncHandler(authController.register));
router.post("/login", authLimiter, authSmallJson, requireJsonObject, asyncHandler(authController.login));
router.post("/logout", asyncHandler(authJwt.attachSession), asyncHandler(authController.logout));
router.get("/me", asyncHandler(authJwt.requireAuth), asyncHandler(authController.me));
router.patch("/profile", asyncHandler(authJwt.requireAuth), authLimiter, authProfileJson, requireJsonObject, asyncHandler(authController.updateProfile));
router.delete(
  "/account",
  asyncHandler(authJwt.requireAuth),
  authLimiter,
  requireFeature("accountDeletion", {
    code: "FEATURE_DISABLED",
    message: "Account deletion is currently disabled",
  }),
  authSmallJson,
  requireJsonObject,
  asyncHandler(authController.removeAccount)
);
router.get("/status", asyncHandler(authJwt.attachSession), asyncHandler(authController.status));

module.exports = router;
