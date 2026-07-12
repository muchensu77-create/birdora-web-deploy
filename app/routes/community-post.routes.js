const express = require("express");
const rateLimit = require("express-rate-limit");

const communityPostController = require("../controllers/community-post.controller");
const authJwt = require("../middleware/auth-jwt");
const { requireFeature } = require("../middleware/feature-guard");
const { requireJsonObject } = require("../middleware/require-json-object");

const router = express.Router();
const communityPublishBodyParsers = [
  express.json({ limit: "14mb" }),
];
const communityWriteBodyParsers = [
  express.json({ limit: "64kb" }),
];
const communityWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.COMMUNITY_WRITE_RATE_LIMIT || 240),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    return req.user?.id || rateLimit.ipKeyGenerator(req.ip);
  },
  message: {
    message: "Too many community requests, please try again later.",
  },
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.get("/", asyncHandler(authJwt.attachSession), asyncHandler(communityPostController.list));
router.post(
  "/",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  requireFeature("communityPublish", {
    code: "PUBLISH_DISABLED",
    message: "Community publishing is currently disabled",
  }),
  ...communityPublishBodyParsers,
  requireJsonObject,
  asyncHandler(communityPostController.create)
);
router.get("/:id/image", asyncHandler(authJwt.attachSession), asyncHandler(communityPostController.image));
router.get("/:id/video", asyncHandler(authJwt.attachSession), asyncHandler(communityPostController.video));
router.get(
  "/:id/comments",
  asyncHandler(authJwt.attachSession),
  asyncHandler(communityPostController.comments)
);
router.post(
  "/:id/comments",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  ...communityWriteBodyParsers,
  requireJsonObject,
  asyncHandler(communityPostController.comment)
);
router.post(
  "/:id/questions",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  ...communityWriteBodyParsers,
  requireJsonObject,
  asyncHandler(communityPostController.question)
);
router.get(
  "/:id/questions",
  asyncHandler(authJwt.attachSession),
  asyncHandler(communityPostController.questions)
);
router.post(
  "/:id/reactions",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  requireFeature("communityLegacyLike", {
    code: "LEGACY_LIKE_DISABLED",
    message: "Legacy community reactions are currently disabled",
  }),
  ...communityWriteBodyParsers,
  requireJsonObject,
  asyncHandler(communityPostController.react)
);
router.delete(
  "/:postId/comments/:commentId",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  asyncHandler(communityPostController.removeComment)
);
router.get("/:id", asyncHandler(authJwt.attachSession), asyncHandler(communityPostController.detail));
router.patch(
  "/:id",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  requireFeature("communityPostEdit", {
    code: "EDIT_DISABLED",
    message: "Community post editing is currently disabled",
  }),
  ...communityWriteBodyParsers,
  requireJsonObject,
  asyncHandler(communityPostController.update)
);
router.delete(
  "/:id",
  asyncHandler(authJwt.requireAuth),
  communityWriteLimiter,
  asyncHandler(communityPostController.remove)
);

module.exports = router;
