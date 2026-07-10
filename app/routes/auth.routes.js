const express = require("express");
const rateLimit = require("express-rate-limit");

const authController = require("../controllers/auth.controller");
const authJwt = require("../middleware/auth-jwt");

const router = express.Router();
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

router.post("/register", authLimiter, asyncHandler(authController.register));
router.post("/login", authLimiter, asyncHandler(authController.login));
router.post("/logout", asyncHandler(authJwt.attachSession), asyncHandler(authController.logout));
router.get("/me", asyncHandler(authJwt.requireAuth), asyncHandler(authController.me));
router.patch("/profile", asyncHandler(authJwt.requireAuth), authLimiter, asyncHandler(authController.updateProfile));
router.delete("/account", asyncHandler(authJwt.requireAuth), authLimiter, asyncHandler(authController.removeAccount));
router.get("/status", asyncHandler(authJwt.attachSession), asyncHandler(authController.status));

module.exports = router;
