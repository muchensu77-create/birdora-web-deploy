require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./app/routes/auth.routes");
const communityPostRoutes = require("./app/routes/community-post.routes");
const observationRoutes = require("./app/routes/observation.routes");
const recognitionRoutes = require("./app/routes/recognition.routes");
const { createOriginGuard, resolveAllowedOrigins } = require("./app/middleware/origin-guard");
const { requestIdMiddleware } = require("./app/middleware/request-id");

const app = express();
const port = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === "production";
const configuredSiteOrigin = process.env.ALLOWED_ORIGINS || process.env.APP_ORIGIN || process.env.CORS_ORIGIN || "";
const allowedOrigins = resolveAllowedOrigins();
const usesHttpsOrigin = Boolean(configuredSiteOrigin) && allowedOrigins.some((origin) => origin.startsWith("https://"));
const usesProductionDataPath = String(process.env.DATABASE_FILE || "").startsWith("/var/lib/birdora");
const isProductionLike =
  isProduction ||
  usesHttpsOrigin ||
  usesProductionDataPath ||
  process.env.PORT === "3003";

function parseTrustProxy(value) {
  if (!value || value === "false") return false;
  if (value === "true") return true;

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? value : numericValue;
}

if (isProductionLike && !configuredSiteOrigin.trim()) {
  throw new Error("ALLOWED_ORIGINS, APP_ORIGIN, or CORS_ORIGIN must be set in production-like deployments.");
}

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY || (isProductionLike ? "1" : ""));

app.disable("x-powered-by");

if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

app.use(requestIdMiddleware);
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400 && body && typeof body === "object" && !Array.isArray(body)) {
      return originalJson({
        ...body,
        code: body.code || (res.statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
        requestId: body.requestId || req.requestId || "",
      });
    }

    return originalJson(body);
  };
  next();
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
  })
);

app.use(createOriginGuard({ allowedOrigins }));

// Community video is sent as a bounded data URL; keep the global parser above its 8MB file limit.
app.use(express.json({ limit: "12mb" }));
app.use(express.urlencoded({ extended: true, limit: "12mb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "birdora-auth-api",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/recognition", recognitionRoutes);
app.use("/api/observations", observationRoutes);
app.use("/api/community/posts", communityPostRoutes);

function sanitizeLogMessage(message) {
  return String(message || "Internal server error")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/g, "[redacted-image-data]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/\b(password|token|authorization|cookie|imageDataUrl)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, 500);
}

function sanitizeLogPath(value) {
  try {
    const url = new URL(value || "/", "http://birdora.local");
    for (const key of Array.from(url.searchParams.keys())) {
      if (/password|token|authorization|cookie|imageDataUrl/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return String(value || "").slice(0, 200);
  }
}

function isJsonParseError(err) {
  return err?.type === "entity.parse.failed" || (err instanceof SyntaxError && err.status === 400 && "body" in err);
}

app.use((err, req, res, _next) => {
  const parseError = isJsonParseError(err);
  const statusCode = parseError ? 400 : err.statusCode || err.status || 500;
  const message =
    parseError
      ? "Invalid JSON body"
      : isProduction && statusCode >= 500
      ? "Internal server error"
      : err.message || "Internal server error";
  const code = parseError
    ? "INVALID_JSON_BODY"
    : err.code || err.name || (statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");

  console.error(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    requestId: req.requestId || "",
    method: req.method,
    path: sanitizeLogPath(req.originalUrl || req.url),
    status: statusCode,
    errorCode: code,
    message: sanitizeLogMessage(err.message || message),
  }));

  res.status(statusCode).json({
    message,
    code,
    requestId: req.requestId || "",
  });
});

app.listen(port, () => {
  console.log(`Birdora auth API listening on http://localhost:${port}`);
});
