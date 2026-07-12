"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");

const socialController = require("../controllers/social.controller");
const authJwt = require("../middleware/auth-jwt");

const router = express.Router();
const socialWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.SOCIAL_WRITE_RATE_LIMIT || 240),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    return req.user?.id || rateLimit.ipKeyGenerator(req.ip);
  },
  message: { message: "Too many social requests, please try again later.", code: "RATE_LIMITED" },
});

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

router.get("/feed", asyncHandler(authJwt.attachSession), asyncHandler(socialController.feed));
router.get("/me/stats", asyncHandler(authJwt.requireAuth), asyncHandler(socialController.myStats));
router.get("/me/posts", asyncHandler(authJwt.requireAuth), asyncHandler(socialController.myPosts));
router.put("/posts/:postId/like", asyncHandler(authJwt.requireAuth), socialWriteLimiter, asyncHandler(socialController.like));
router.delete("/posts/:postId/like", asyncHandler(authJwt.requireAuth), socialWriteLimiter, asyncHandler(socialController.unlike));
router.get("/users/:userId/followers", asyncHandler(authJwt.attachSession), asyncHandler(socialController.followers));
router.get("/users/:userId/following", asyncHandler(authJwt.attachSession), asyncHandler(socialController.following));
router.put("/users/:userId/follow", asyncHandler(authJwt.requireAuth), socialWriteLimiter, asyncHandler(socialController.follow));
router.delete("/users/:userId/follow", asyncHandler(authJwt.requireAuth), socialWriteLimiter, asyncHandler(socialController.unfollow));
router.get("/users/:userId", asyncHandler(authJwt.attachSession), asyncHandler(socialController.profile));

module.exports = router;
