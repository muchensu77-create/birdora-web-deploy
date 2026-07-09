const { getDatabase } = require("../db/database");

const cleanupIntervalMs = Number(process.env.REVOKED_TOKEN_CLEANUP_INTERVAL_MS || 5 * 60 * 1000);
let lastCleanupAt = 0;

async function cleanupRevokedTokens(options = {}) {
  const now = Date.now();
  if (!options.force && cleanupIntervalMs > 0 && now - lastCleanupAt < cleanupIntervalMs) {
    return;
  }

  const db = getDatabase();
  db.prepare("DELETE FROM revoked_tokens WHERE expires_at <= ?").run(new Date().toISOString());
  lastCleanupAt = now;
}

async function revokeToken({ jti, expiresAt }) {
  if (!jti || !expiresAt) return;

  await cleanupRevokedTokens({ force: true });

  const db = getDatabase();
  db.prepare(`
    INSERT OR IGNORE INTO revoked_tokens (
      jti,
      expires_at
    ) VALUES (?, ?)
  `).run(jti, expiresAt);
}

async function isTokenRevoked(jti) {
  if (!jti) return false;

  const db = getDatabase();
  const token = db.prepare("SELECT jti FROM revoked_tokens WHERE jti = ?").get(jti);
  return Boolean(token);
}

module.exports = {
  cleanupRevokedTokens,
  revokeToken,
  isTokenRevoked,
};
