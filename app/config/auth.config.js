const os = require("os");

const { resolveAllowedOrigins } = require("../middleware/origin-guard");

const cookieName = process.env.JWT_COOKIE_NAME || "birdora_token";
const jwtSecret = process.env.JWT_SECRET || "birdora-dev-secret-change-me";
const allowedOrigins = resolveAllowedOrigins();
const usesHttpsOrigin = allowedOrigins.some((origin) => origin.startsWith("https://"));
const usesProductionDataPath = String(process.env.DATABASE_FILE || "").startsWith("/var/lib/birdora");
const isProductionLike =
  process.env.NODE_ENV === "production" ||
  usesHttpsOrigin ||
  usesProductionDataPath ||
  process.env.PORT === "3003";
const unsafeProductionSecrets = new Set([
  "birdora-dev-secret-change-me",
  "change-this-in-production",
  "replace-with-at-least-32-random-characters",
  "replace-with-a-long-random-secret-at-least-32-chars",
]);
const availableParallelism =
  typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
const defaultPasswordWorkerPoolSize = Math.min(4, Math.max(1, availableParallelism - 1));

function parseBoundedInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const passwordHashCost = parseBoundedInt(process.env.PASSWORD_BCRYPT_ROUNDS, 10, {
  min: 10,
  max: 14,
});
const passwordWorkerPoolSize = parseBoundedInt(
  process.env.PASSWORD_WORKER_POOL_SIZE,
  defaultPasswordWorkerPoolSize,
  {
    min: 0,
    max: 16,
  }
);
const authTimingHeadersEnabled = /^(1|true|yes)$/i.test(process.env.AUTH_TIMING_HEADERS || "");

if (
  isProductionLike &&
  (unsafeProductionSecrets.has(jwtSecret) || jwtSecret.length < 32)
) {
  throw new Error("JWT_SECRET must be set to a strong secret for production-like deployments.");
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" || usesHttpsOrigin,
    path: "/",
  };
}

module.exports = {
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtCookieName: cookieName,
  passwordHashCost,
  passwordWorkerPoolSize,
  authTimingHeadersEnabled,
  getCookieOptions,
};
