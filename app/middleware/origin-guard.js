const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_ALLOWED_ORIGINS = [
  "http://localhost:4174",
  "http://127.0.0.1:4174",
];

function normalizeAllowedOrigin(value, label = "origin") {
  const origin = String(value || "").trim();
  if (!origin) return "";
  if (origin === "*") {
    throw new Error(`${label} must not use wildcard origin '*'.`);
  }

  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`${label} contains invalid origin: ${origin}`);
  }

  const hasPath = parsed.pathname && parsed.pathname !== "/";
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    hasPath ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an http(s) origin without path, query, or hash: ${origin}`);
  }

  return parsed.origin;
}

function parseOriginList(value, label) {
  const origins = String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .map((origin) => normalizeAllowedOrigin(origin, label));

  return Array.from(new Set(origins));
}

function resolveAllowedOrigins(env = process.env) {
  const configuredOrigins = env.ALLOWED_ORIGINS || env.APP_ORIGIN || env.CORS_ORIGIN || "";
  const parsedOrigins = parseOriginList(configuredOrigins, "allowed origin");
  return parsedOrigins.length ? parsedOrigins : DEFAULT_ALLOWED_ORIGINS;
}

function extractHeaderOrigin(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";

  try {
    return new URL(rawValue).origin;
  } catch {
    return "";
  }
}

function getRequestSourceOrigin(req) {
  const origin = extractHeaderOrigin(req.headers.origin);
  if (origin) return origin;

  return extractHeaderOrigin(req.headers.referer);
}

function createOriginGuard(options = {}) {
  const allowedOrigins = new Set(options.allowedOrigins || resolveAllowedOrigins());

  return function originGuard(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const sourceOrigin = getRequestSourceOrigin(req);
    if (sourceOrigin && allowedOrigins.has(sourceOrigin)) {
      next();
      return;
    }

    const error = new Error("Forbidden");
    error.statusCode = 403;
    error.code = "ORIGIN_GUARD_REJECTED";
    next(error);
  };
}

module.exports = {
  DEFAULT_ALLOWED_ORIGINS,
  createOriginGuard,
  resolveAllowedOrigins,
};
