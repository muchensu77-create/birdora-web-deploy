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
    accountStatus: user.accountStatus || "active",
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

  let transactionStarted = false;
  try {
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;
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
    db.prepare(`
      INSERT INTO notification_preferences (
        user_id, in_app_enabled, likes_enabled, comments_enabled, follows_enabled,
        moderation_enabled, system_enabled, email_enabled, updated_at
      ) VALUES (?, 1, 1, 1, 1, 1, 1, 1, ?)
    `).run(user.id, user.updatedAt);
    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
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
  const columnMappings = {
    nickname: ["nickname", (value) => value],
    bio: ["bio", (value) => value],
    gender: ["gender", (value) => value],
    age: ["age", (value) => value],
    avatarUrl: ["avatar_url", (value) => value],
    emailNotifications: ["email_notifications", (value) => (value ? 1 : 0)],
    publicProfile: ["public_profile", (value) => (value ? 1 : 0)],
  };
  const assignments = [];
  const values = [];

  for (const [field, [column, serialize]] of Object.entries(columnMappings)) {
    if (!Object.prototype.hasOwnProperty.call(profile, field)) continue;
    assignments.push(`${column} = ?`);
    values.push(serialize(profile[field]));
  }

  if (!assignments.length) return findById(id);

  const now = new Date().toISOString();
  assignments.push("updated_at = ?");
  values.push(now, id);
  db.prepare(`UPDATE users SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
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
