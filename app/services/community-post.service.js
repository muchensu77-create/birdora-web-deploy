const crypto = require("crypto");

const { getDatabase } = require("../db/database");

function mapPostRow(row, viewerId = "") {
  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    body: row.body,
    bird: row.bird,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canManage: Boolean(viewerId && row.user_id === viewerId),
  };
}

function selectPostById(db, id) {
  return db.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.title,
      posts.body,
      posts.bird,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author
    FROM community_posts AS posts
    JOIN users ON users.id = posts.user_id
    WHERE posts.id = ?
  `).get(id);
}

async function listPosts(viewerId = "") {
  const db = getDatabase();
  const rows = db.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.title,
      posts.body,
      posts.bird,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author
    FROM community_posts AS posts
    JOIN users ON users.id = posts.user_id
    ORDER BY posts.created_at DESC, posts.id DESC
  `).all();

  return rows.map((row) => mapPostRow(row, viewerId));
}

async function createPost({ userId, title, body, bird }) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();

  db.prepare(`
    INSERT INTO community_posts (
      id,
      user_id,
      title,
      body,
      bird,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, title, body, bird, now, now);

  return mapPostRow(selectPostById(db, id), userId);
}

function getOwnedPost(db, id, userId) {
  const row = selectPostById(db, id);
  if (!row) {
    const error = new Error("post not found");
    error.statusCode = 404;
    throw error;
  }

  if (row.user_id !== userId) {
    const error = new Error("you can only manage your own posts");
    error.statusCode = 403;
    throw error;
  }

  return row;
}

async function updatePost({ id, userId, title, body }) {
  const db = getDatabase();
  getOwnedPost(db, id, userId);
  const updatedAt = new Date().toISOString();

  db.prepare(`
    UPDATE community_posts
    SET title = ?, body = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(title, body, updatedAt, id, userId);

  return mapPostRow(selectPostById(db, id), userId);
}

async function deletePost({ id, userId }) {
  const db = getDatabase();
  getOwnedPost(db, id, userId);
  db.prepare("DELETE FROM community_posts WHERE id = ? AND user_id = ?").run(id, userId);
}

module.exports = {
  createPost,
  deletePost,
  listPosts,
  updatePost,
};
