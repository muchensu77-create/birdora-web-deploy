"use strict";

const { getDatabase } = require("../db/database");
const communityPostService = require("./community-post.service");
const cursorService = require("./cursor.service");
const notificationService = require("./notification.service");

function createError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getUserRow(db, userId) {
  const row = db.prepare(`
    SELECT id, nickname, bio, avatar_url, public_profile, account_status, created_at, updated_at
    FROM users
    WHERE id = ? AND account_status = 'active'
  `).get(userId);
  if (!row) throw createError("user not found", 404, "USER_NOT_FOUND");
  return row;
}

function relationshipState(db, userId, viewerId) {
  if (!viewerId) return { isSelf: false, isFollowing: false, followsViewer: false };
  if (viewerId === userId) return { isSelf: true, isFollowing: false, followsViewer: false };
  const relationships = db.prepare(`
    SELECT follower_user_id, followed_user_id
    FROM user_follows
    WHERE (follower_user_id = ? AND followed_user_id = ?)
       OR (follower_user_id = ? AND followed_user_id = ?)
  `).all(viewerId, userId, userId, viewerId);
  return {
    isSelf: false,
    isFollowing: relationships.some((row) => row.follower_user_id === viewerId),
    followsViewer: relationships.some((row) => row.follower_user_id === userId),
  };
}

function profileCounts(db, userId) {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM community_posts
       WHERE user_id = ? AND status = 'published' AND moderation_status = 'approved' AND deleted_at IS NULL) AS posts,
      (SELECT COUNT(*) FROM observations WHERE user_id = ?) AS observations,
      (SELECT COUNT(*) FROM user_follows WHERE followed_user_id = ?) AS followers,
      (SELECT COUNT(*) FROM user_follows WHERE follower_user_id = ?) AS following
  `).get(userId, userId, userId, userId);
  return {
    posts: Number(row.posts) || 0,
    observations: Number(row.observations) || 0,
    followers: Number(row.followers) || 0,
    following: Number(row.following) || 0,
  };
}

function serializePublicUser(db, row, viewerId = "") {
  const ownerView = viewerId === row.id;
  const publicProfile = Boolean(row.public_profile);
  return {
    id: row.id,
    nickname: publicProfile || ownerView ? row.nickname : "Birdora 用户",
    bio: publicProfile || ownerView ? row.bio || "" : "",
    avatarUrl: publicProfile || ownerView ? row.avatar_url || "" : "",
    publicProfile,
    counts: profileCounts(db, row.id),
    viewer: relationshipState(db, row.id, viewerId),
    createdAt: publicProfile || ownerView ? row.created_at : "",
    updatedAt: publicProfile || ownerView ? row.updated_at : "",
  };
}

async function getPublicProfile({ userId, viewerId = "" }) {
  const db = getDatabase();
  return serializePublicUser(db, getUserRow(db, userId), viewerId);
}

async function setFollow({ followerUserId, followedUserId, following }) {
  if (followerUserId === followedUserId) {
    throw createError("you cannot follow yourself", 400, "SELF_FOLLOW_FORBIDDEN");
  }
  const db = getDatabase();
  const actor = getUserRow(db, followerUserId);
  const target = getUserRow(db, followedUserId);
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (following) {
      const inserted = db.prepare(`
        INSERT INTO user_follows (follower_user_id, followed_user_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(follower_user_id, followed_user_id) DO NOTHING
      `).run(followerUserId, followedUserId, now);
      if (inserted.changes === 1) {
        notificationService.createNotification(db, {
          recipientUserId: followedUserId,
          actorUserId: followerUserId,
          type: "user_followed",
          entityType: "user",
          entityId: followerUserId,
          payload: { actorNickname: actor.nickname },
          dedupeKey: `user_followed:${followedUserId}:${followerUserId}`,
          now,
        });
      }
    } else {
      db.prepare(`
        DELETE FROM user_follows WHERE follower_user_id = ? AND followed_user_id = ?
      `).run(followerUserId, followedUserId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return serializePublicUser(db, target, followerUserId);
}

async function listConnections({ userId, viewerId = "", direction, limit = 20, cursor = "" }) {
  if (!new Set(["followers", "following"]).has(direction)) {
    throw createError("invalid relationship direction", 400, "INVALID_RELATIONSHIP_DIRECTION");
  }
  const db = getDatabase();
  const owner = getUserRow(db, userId);
  if (!owner.public_profile && viewerId !== userId) {
    throw createError("this profile is private", 403, "PROFILE_PRIVATE");
  }
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const scope = `connections:${direction}:${userId}`;
  const decoded = cursorService.decodeCursor(cursor, scope);
  const relationColumn = direction === "followers" ? "followed_user_id" : "follower_user_id";
  const selectedUserColumn = direction === "followers" ? "follower_user_id" : "followed_user_id";
  const cursorSql = decoded
    ? "AND (follows.created_at < ? OR (follows.created_at = ? AND users.id < ?))"
    : "";
  const cursorParams = decoded ? [decoded.sortTime, decoded.sortTime, decoded.id] : [];
  const rows = db.prepare(`
    SELECT
      users.id,
      users.nickname,
      users.bio,
      users.avatar_url,
      users.public_profile,
      users.account_status,
      users.created_at,
      users.updated_at,
      follows.created_at AS relationship_created_at
    FROM user_follows AS follows
    JOIN users ON users.id = follows.${selectedUserColumn}
    WHERE follows.${relationColumn} = ?
      AND users.account_status = 'active'
      ${cursorSql}
    ORDER BY follows.created_at DESC, users.id DESC
    LIMIT ?
  `).all(userId, ...cursorParams, safeLimit + 1);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows.at(-1);
  return {
    users: pageRows.map((row) => ({
      ...serializePublicUser(db, row, viewerId),
      relationshipCreatedAt: row.relationship_created_at,
    })),
    pageInfo: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore && last
        ? cursorService.encodeCursor(scope, { sortTime: last.relationship_created_at, id: last.id })
        : null,
    },
  };
}

async function getMyStats(userId) {
  const db = getDatabase();
  getUserRow(db, userId);
  return profileCounts(db, userId);
}

async function getMyPosts({ userId, limit, cursor }) {
  return communityPostService.listPostsByAuthor({
    authorId: userId,
    viewerId: userId,
    limit,
    cursor,
  });
}

module.exports = {
  getMyPosts,
  getMyStats,
  getPublicProfile,
  listConnections,
  setFollow,
};
