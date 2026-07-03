const express = require("express");
const rateLimit = require("express-rate-limit");

const recognitionController = require("../controllers/recognition.controller");

const router = express.Router();
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
  asyncHandler(recognitionController.classify)
);

module.exports = router;
