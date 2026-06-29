const crypto = require("crypto");

const { getDatabase, mapUserRow } = require("../db/database");

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

async function findByEmail(email) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  return mapUserRow(row);
}

async function findById(id) {
  const db = getDatabase();
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  return mapUserRow(row);
}

async function createUser({ email, passwordHash, nickname }) {
  const db = getDatabase();
  const now = new Date().toISOString();

  const user = {
    id: crypto.randomUUID(),
    email: email.toLowerCase(),
    nickname: nickname || email.split("@")[0],
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };

  try {
    db.prepare(`
      INSERT INTO users (
        id,
        email,
        nickname,
        password_hash,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      user.id,
      user.email,
      user.nickname,
      user.passwordHash,
      user.createdAt,
      user.updatedAt
    );
  } catch (error) {
    if (String(error.message).includes("UNIQUE constraint failed")) {
      const duplicateError = new Error("email is already registered");
      duplicateError.statusCode = 409;
      throw duplicateError;
    }

    throw error;
  }

  return user;
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  sanitizeUser,
};
