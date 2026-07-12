-- Frozen production schema fixture.
-- Source: commit 896c453019581de0c46948fd724311d606017fa0,
-- app/db/database.js, captured before the versioned migration runner existed.
-- user_point_events is included as the retained pre-retirement compatibility
-- table so adoption tests prove V001/V002 never discard it.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  age INTEGER DEFAULT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  email_notifications INTEGER NOT NULL DEFAULT 1,
  public_profile INTEGER NOT NULL DEFAULT 1,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE revoked_tokens (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE observations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  image_original_name TEXT NOT NULL DEFAULT '',
  image_mime_type TEXT NOT NULL DEFAULT '',
  image_size_bytes INTEGER NOT NULL DEFAULT 0,
  selected_species_name TEXT NOT NULL,
  selected_species_scientific_name TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL,
  top_candidates_json TEXT NOT NULL DEFAULT '[]',
  location_text TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'osea-browser',
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE community_posts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  observation_id TEXT DEFAULT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  bird TEXT NOT NULL DEFAULT '观鸟笔记',
  analysis_summary TEXT NOT NULL DEFAULT '',
  analysis_score INTEGER NOT NULL DEFAULT 0,
  analysis_tags TEXT NOT NULL DEFAULT '[]',
  analysis_suggestions TEXT NOT NULL DEFAULT '[]',
  analysis_updated_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE RESTRICT
);

CREATE TABLE community_post_reactions (
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reaction_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (post_id, user_id, reaction_type),
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE community_post_comments (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE community_post_questions (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE community_post_images (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL UNIQUE,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
);

CREATE TABLE community_post_videos (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL UNIQUE,
  storage_path TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE
);

CREATE TABLE user_point_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_revoked_tokens_expires_at ON revoked_tokens(expires_at);
CREATE INDEX idx_community_posts_created_at ON community_posts(created_at DESC);
CREATE INDEX idx_community_posts_user_id_created_at
  ON community_posts(user_id, created_at DESC);
CREATE INDEX idx_community_posts_observation_id
  ON community_posts(observation_id);
CREATE INDEX idx_community_post_reactions_post_id
  ON community_post_reactions(post_id);
CREATE INDEX idx_community_post_comments_post_id_created_at
  ON community_post_comments(post_id, created_at ASC);
CREATE INDEX idx_community_post_questions_post_id_created_at
  ON community_post_questions(post_id, created_at ASC);
CREATE INDEX idx_community_post_images_post_id
  ON community_post_images(post_id);
CREATE INDEX idx_community_post_videos_post_id
  ON community_post_videos(post_id);
CREATE INDEX idx_observations_user_id_created_at
  ON observations(user_id, created_at DESC);
CREATE INDEX idx_observations_created_at
  ON observations(created_at DESC);

CREATE TRIGGER trg_community_posts_observation_insert
BEFORE INSERT ON community_posts
FOR EACH ROW
WHEN NEW.observation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM observations WHERE id = NEW.observation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
END;

CREATE TRIGGER trg_community_posts_observation_update
BEFORE UPDATE OF observation_id ON community_posts
FOR EACH ROW
WHEN NEW.observation_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM observations WHERE id = NEW.observation_id
  )
BEGIN
  SELECT RAISE(ABORT, 'community_posts.observation_id references missing observation');
END;

CREATE TRIGGER trg_observations_linked_delete
BEFORE DELETE ON observations
FOR EACH ROW
WHEN EXISTS (
  SELECT 1 FROM community_posts WHERE observation_id = OLD.id
)
BEGIN
  SELECT RAISE(ABORT, 'observation is linked to a community post');
END;
