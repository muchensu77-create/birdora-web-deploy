"use strict";

const communityPostService = require("../services/community-post.service");
const socialService = require("../services/social.service");

function parseLimit(value, fallback = 20) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(50, Math.trunc(number)));
}

function requireIdentifier(value, label) {
  const identifier = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(identifier)) {
    const error = new Error(`${label} is invalid`);
    error.statusCode = 400;
    error.code = "INVALID_IDENTIFIER";
    throw error;
  }
  return identifier;
}

function envelope(req, data, pageInfo) {
  return {
    data,
    ...(pageInfo ? { pageInfo } : {}),
    requestId: req.requestId || "",
  };
}

async function feed(req, res) {
  const result = await communityPostService.listFeed({
    type: String(req.query.type || "recommended"),
    viewerId: req.user?.id || "",
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.posts, result.pageInfo));
}

async function profile(req, res) {
  const data = await socialService.getPublicProfile({
    userId: requireIdentifier(req.params.userId, "userId"),
    viewerId: req.user?.id || "",
  });
  res.json(envelope(req, data));
}

async function follow(req, res) {
  const data = await socialService.setFollow({
    followerUserId: req.user.id,
    followedUserId: requireIdentifier(req.params.userId, "userId"),
    following: true,
  });
  res.json(envelope(req, data));
}

async function unfollow(req, res) {
  const data = await socialService.setFollow({
    followerUserId: req.user.id,
    followedUserId: requireIdentifier(req.params.userId, "userId"),
    following: false,
  });
  res.json(envelope(req, data));
}

async function followers(req, res) {
  const result = await socialService.listConnections({
    userId: requireIdentifier(req.params.userId, "userId"),
    viewerId: req.user?.id || "",
    direction: "followers",
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.users, result.pageInfo));
}

async function following(req, res) {
  const result = await socialService.listConnections({
    userId: requireIdentifier(req.params.userId, "userId"),
    viewerId: req.user?.id || "",
    direction: "following",
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.users, result.pageInfo));
}

async function myStats(req, res) {
  res.json(envelope(req, await socialService.getMyStats(req.user.id)));
}

async function myPosts(req, res) {
  const result = await socialService.getMyPosts({
    userId: req.user.id,
    limit: parseLimit(req.query.limit),
    cursor: String(req.query.cursor || ""),
  });
  res.json(envelope(req, result.posts, result.pageInfo));
}

async function like(req, res) {
  const post = await communityPostService.setPostLike({
    postId: requireIdentifier(req.params.postId, "postId"),
    userId: req.user.id,
    liked: true,
  });
  res.json(envelope(req, { post, liked: true }));
}

async function unlike(req, res) {
  const post = await communityPostService.setPostLike({
    postId: requireIdentifier(req.params.postId, "postId"),
    userId: req.user.id,
    liked: false,
  });
  res.json(envelope(req, { post, liked: false }));
}

module.exports = { feed, follow, followers, following, like, myPosts, myStats, profile, unfollow, unlike };
