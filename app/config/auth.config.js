const cookieName = process.env.JWT_COOKIE_NAME || "birdora_token";
const jwtSecret = process.env.JWT_SECRET || "birdora-dev-secret-change-me";
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const usesHttpsOrigin = corsOrigins.some((origin) => origin.startsWith("https://"));
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
  getCookieOptions,
};
