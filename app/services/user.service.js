const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getDatabase, mapUserRow } = require("../db/database");

function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    nickname: user.nickname,
    bio: user.bio || "",
    gender: user.gender || "",
    age: Number.isInteger(user.age) ? user.age : null,
    avatarUrl: user.avatarUrl || "",
    emailNotifications: user.emailNotifications !== false,
    publicProfile: user.publicProfile !== false,
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

async function updateProfile(id, profile) {
  const db = getDatabase();
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE users
    SET nickname = ?, bio = ?, gender = ?, age = ?, avatar_url = ?, email_notifications = ?, public_profile = ?, updated_at = ?
    WHERE id = ?
  `).run(
    profile.nickname,
    profile.bio,
    profile.gender,
    profile.age,
    profile.avatarUrl,
    profile.emailNotifications ? 1 : 0,
    profile.publicProfile ? 1 : 0,
    now,
    id
  );
  return findById(id);
}

async function deleteUser(id) {
  const db = getDatabase();
  const mediaRows = db.prepare(`
    SELECT images.storage_path AS storage_path FROM community_post_images AS images
    JOIN community_posts AS posts ON posts.id = images.post_id WHERE posts.user_id = ?
    UNION ALL
    SELECT videos.storage_path AS storage_path FROM community_post_videos AS videos
    JOIN community_posts AS posts ON posts.id = videos.post_id WHERE posts.user_id = ?
  `).all(id, id);
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  const databaseFile = path.resolve(process.env.DATABASE_FILE || path.join(__dirname, "..", "data", "birdora.sqlite"));
  const uploadDirectory = path.resolve(process.env.COMMUNITY_UPLOAD_DIR || path.join(path.dirname(databaseFile), "uploads", "community"));
  for (const row of mediaRows) {
    const filePath = path.resolve(uploadDirectory, row.storage_path || "");
    if (filePath.startsWith(`${uploadDirectory}${path.sep}`)) fs.rmSync(filePath, { force: true });
  }
}

module.exports = {
  createUser,
  findByEmail,
  findById,
  updateProfile,
  deleteUser,
  sanitizeUser,
};
