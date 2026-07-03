const express = require("express");
const rateLimit = require("express-rate-limit");

const observationController = require("../controllers/observation.controller");
const authJwt = require("../middleware/auth-jwt");

const router = express.Router();
const observationWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.OBSERVATION_WRITE_RATE_LIMIT || 240),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    return req.user?.id || rateLimit.ipKeyGenerator(req.ip);
  },
  message: {
    message: "Too many observation requests, please try again later.",
  },
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post(
  "/",
  asyncHandler(authJwt.requireAuth),
  observationWriteLimiter,
  asyncHandler(observationController.create)
);
router.get("/", asyncHandler(authJwt.requireAuth), asyncHandler(observationController.listMine));
router.get("/me", asyncHandler(authJwt.requireAuth), asyncHandler(observationController.listMine));
router.get("/:id/image", asyncHandler(authJwt.requireAuth), asyncHandler(observationController.image));
router.get("/:id", asyncHandler(authJwt.requireAuth), asyncHandler(observationController.get));
router.delete(
  "/:id",
  asyncHandler(authJwt.requireAuth),
  observationWriteLimiter,
  asyncHandler(observationController.remove)
);

module.exports = router;
