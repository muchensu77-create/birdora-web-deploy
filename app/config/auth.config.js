const cookieName = process.env.JWT_COOKIE_NAME || "birdora_token";
const jwtSecret = process.env.JWT_SECRET || "birdora-dev-secret-change-me";
const unsafeProductionSecrets = new Set([
  "birdora-dev-secret-change-me",
  "change-this-in-production",
  "replace-with-at-least-32-random-characters",
  "replace-with-a-long-random-secret-at-least-32-chars",
]);

if (
  process.env.NODE_ENV === "production" &&
  (unsafeProductionSecrets.has(jwtSecret) || jwtSecret.length < 32)
) {
  throw new Error("JWT_SECRET must be set to a strong production secret.");
}

function getCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

module.exports = {
  jwtSecret,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  jwtCookieName: cookieName,
  getCookieOptions,
};
