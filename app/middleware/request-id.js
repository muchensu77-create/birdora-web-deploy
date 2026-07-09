const crypto = require("crypto");

const REQUEST_ID_HEADER = "X-Request-Id";
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

function normalizeRequestId(value) {
  const requestId = String(value || "").trim();
  return SAFE_REQUEST_ID_PATTERN.test(requestId) ? requestId : "";
}

function requestIdMiddleware(req, res, next) {
  const requestId = normalizeRequestId(req.get(REQUEST_ID_HEADER)) || crypto.randomUUID();
  req.requestId = requestId;
  res.set(REQUEST_ID_HEADER, requestId);
  next();
}

module.exports = {
  requestIdMiddleware,
};
