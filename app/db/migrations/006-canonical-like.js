"use strict";

const VERSION = "V006";
const NAME = "canonical-like";

function helpfulRelationshipCount(db) {
  return Number(db.prepare(`
    SELECT COUNT(*) AS count FROM (
      SELECT post_id, user_id FROM community_post_reactions
      WHERE reaction_type = 'helpful'
      GROUP BY post_id, user_id
    )
  `).get().count) || 0;
}

function validate(db) {
  const columns = new Set(db.prepare("PRAGMA table_info(community_post_likes)").all().map((row) => row.name));
  for (const column of ["post_id", "user_id", "created_at"]) {
    if (!columns.has(column)) throw new Error(`V006 community_post_likes.${column} is missing`);
  }
  const likeCount = Number(db.prepare("SELECT COUNT(*) AS count FROM community_post_likes").get().count) || 0;
  if (likeCount < helpfulRelationshipCount(db)) {
    throw new Error("V006 canonical likes lost legacy helpful relationships");
  }
  const foreignKeyErrors = db.prepare("PRAGMA foreign_key_check(community_post_likes)").all();
  if (foreignKeyErrors.length) throw new Error("V006 community_post_likes contains orphan rows");
}

function up(db) {
  db.exec(`
    CREATE TABLE community_post_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (post_id, user_id),
      FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX idx_community_post_likes_user_created
      ON community_post_likes(user_id, created_at DESC, post_id DESC);

    INSERT INTO community_post_likes (post_id, user_id, created_at)
    SELECT post_id, user_id, MIN(created_at)
    FROM community_post_reactions
    WHERE reaction_type = 'helpful'
    GROUP BY post_id, user_id;
  `);
  validate(db);
}

module.exports = { version: VERSION, name: NAME, up, validate };
