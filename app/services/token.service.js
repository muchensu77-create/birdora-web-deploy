const { getDatabase } = require("../db/database");

async function cleanupRevokedTokens() {
  const db = getDatabase();
  db.prepare("DELETE FROM revoked_tokens WHERE expires_at <= ?").run(new Date().toISOString());
}

async function revokeToken({ jti, expiresAt }) {
  if (!jti || !expiresAt) return;

  await cleanupRevokedTokens();

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
  await cleanupRevokedTokens();

  const db = getDatabase();
  const token = db.prepare("SELECT jti FROM revoked_tokens WHERE jti = ?").get(jti);
  return Boolean(token);
}

module.exports = {
  revokeToken,
  isTokenRevoked,
};
