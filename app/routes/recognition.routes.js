const express = require("express");
const rateLimit = require("express-rate-limit");

const recognitionController = require("../controllers/recognition.controller");
const { requireJsonObject } = require("../middleware/require-json-object");

const router = express.Router();
const recognitionJson = express.json({ limit: "2mb" });
const recognitionLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.RECOGNITION_RATE_LIMIT || 120),
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator(req) {
    return req.user?.id || rateLimit.ipKeyGenerator(req.ip);
  },
  message: {
    message: "Too many recognition requests, please try again later.",
    code: "RATE_LIMITED",
  },
});

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

router.post(
  "/classify",
  recognitionLimiter,
  recognitionJson,
  requireJsonObject,
  asyncHandler(recognitionController.classify)
);

module.exports = router;
