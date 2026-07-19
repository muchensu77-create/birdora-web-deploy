require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./app/routes/auth.routes");
const capabilitiesRoutes = require("./app/routes/capabilities.routes");
const communityPostRoutes = require("./app/routes/community-post.routes");
const draftRoutes = require("./app/routes/draft.routes");
const moderationRoutes = require("./app/routes/moderation.routes");
const observationRoutes = require("./app/routes/observation.routes");
const notificationRoutes = require("./app/routes/notification.routes");
const recognitionRoutes = require("./app/routes/recognition.routes");
const socialRoutes = require("./app/routes/social.routes");
const { closeDatabase, getDatabaseHealth, initializeDatabase } = require("./app/db/database");
const { isExplicitlyEnabled } = require("./app/config/capabilities.config");
const {
  activationWriteGate,
  assertActivationStartupAllowed,
  getActivationRuntimeState,
} = require("./app/middleware/activation-write-gate");
const { assertSharedDatabaseLifecycleLock } = require("./app/runtime/database-lifecycle-lock");
const { createOriginGuard, resolveAllowedOrigins } = require("./app/middleware/origin-guard");
const { requestIdMiddleware } = require("./app/middleware/request-id");
const { getOutboxHealth, OutboxWorker } = require("./app/services/outbox.service");

const app = express();
let shuttingDown = false;
let shutdownStarted = false;
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
const host = process.env.HOST || (isProductionLike ? "127.0.0.1" : "0.0.0.0");
const releaseIdentity = {
  revision: process.env.BIRDORA_RELEASE_REVISION || null,
  manifestSha256: process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || null,
};

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

app.use(cookieParser());
app.use(activationWriteGate);

// Community publishing has its own bounded parser inside the router. Mount it before
// the ordinary parsers so an 8 MiB video data URL does not raise the global limit.
app.use("/api/community/posts", communityPostRoutes);

app.get("/api/health/live", (_req, res) => {
  res.json({
    ok: true,
    service: "birdora-auth-api",
    release: releaseIdentity,
    timestamp: new Date().toISOString(),
  });
});

function readinessHandler(_req, res) {
  const databaseHealth = getDatabaseHealth();
  const outbox = getOutboxHealth();
  const activation = getActivationRuntimeState();
  const activationReady = activation.activationPending || activation.markerVerified;
  const ready = !shuttingDown && databaseHealth.ready && activationReady && outbox.healthy;
  res.status(ready ? 200 : 503).json({
    ok: ready,
    service: "birdora-auth-api",
    release: releaseIdentity,
    activation,
    outbox,
    schemaVersion: databaseHealth.schemaVersion,
    timestamp: new Date().toISOString(),
  });
}

app.get("/api/health/ready", readinessHandler);
// Compatibility endpoint: historically deployment checks used /api/health.
app.get("/api/health", readinessHandler);

app.use("/api/v1/capabilities", capabilitiesRoutes);
app.use("/api/v1", notificationRoutes);
app.use("/api/v1", draftRoutes);
app.use("/api/v1", moderationRoutes);
app.use("/api/v1", socialRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/recognition", recognitionRoutes);
app.use("/api/observations", observationRoutes);

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

// A stale deployment journal blocks ordinary process resurrection before the
// database is opened. A matching controlled candidate starts read-only until
// the verified marker is committed and the journal is removed.
assertActivationStartupAllowed();
if (isProductionLike) assertSharedDatabaseLifecycleLock();

// Run all schema migrations before binding the port. A failed migration must
// terminate startup instead of exposing a half-initialized API instance.
initializeDatabase();

const outboxWorker = new OutboxWorker({
  enabled: isExplicitlyEnabled(process.env.OUTBOX_WORKER_ENABLED),
  canWrite: () => getActivationRuntimeState().writesEnabled,
});
outboxWorker.start();

const httpServer = app.listen(port, host, () => {
  console.log(`Birdora auth API listening on http://${host}:${port}`);
  if (typeof process.send === "function") process.send("ready");
});

function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  shuttingDown = true;
  const forceTimer = setTimeout(() => {
    closeDatabase();
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  const workerStopped = outboxWorker.stop();
  httpServer.close(async () => {
    await workerStopped;
    closeDatabase();
    process.exit(0);
  });

  console.log(`Birdora auth API received ${signal}; waiting for active requests to finish.`);
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
