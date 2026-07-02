const communityPostService = require("../services/community-post.service");

const TITLE_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 600;
const BIRD_MAX_LENGTH = 80;
const COMMENT_MAX_LENGTH = 180;
const QUESTION_MAX_LENGTH = 180;
const IMAGE_MAX_BYTES = 1024 * 1024;
const POSTS_DEFAULT_LIMIT = 20;
const POSTS_MAX_LIMIT = 100;
const COMMENTS_DEFAULT_LIMIT = 10;
const COMMENTS_MAX_LIMIT = 50;
const REACTION_TYPES = new Set(["helpful", "curious"]);
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function normalizeRequiredText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function normalizeOptionalId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length <= 120 ? text : null;
}

function hasBytePrefix(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

function imageMatchesMimeType(buffer, mimeType) {
  if (mimeType === "image/png") {
    return hasBytePrefix(buffer, PNG_SIGNATURE);
  }

  if (mimeType === "image/jpeg") {
    return hasBytePrefix(buffer, JPEG_SIGNATURE);
  }

  if (mimeType === "image/webp") {
    return (
      buffer.length >= 12 &&
      buffer.toString("ascii", 0, 4) === "RIFF" &&
      buffer.toString("ascii", 8, 12) === "WEBP"
    );
  }

  return false;
}

function validatePostBody(req, res, options = {}) {
  const title = normalizeRequiredText(req.body.title, TITLE_MAX_LENGTH);
  const body = normalizeRequiredText(req.body.body, BODY_MAX_LENGTH);
  const bird = normalizeRequiredText(req.body.bird || "观鸟笔记", BIRD_MAX_LENGTH);

  if (!title || !body || (!options.ignoreBird && !bird)) {
    res.status(400).json({
      message: `title and body are required and must not exceed ${TITLE_MAX_LENGTH}/${BODY_MAX_LENGTH} characters`,
    });
    return null;
  }

  return { title, body, bird };
}

function validatePostImage(req, res) {
  const imageDataUrl = String(req.body.imageDataUrl || "").trim();
  if (!imageDataUrl) return null;

  const match = imageDataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    res.status(400).json({ message: "imageDataUrl must be a jpeg, png, or webp data URL" });
    return false;
  }

  const mimeType = match[1];
  if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
    res.status(400).json({ message: "unsupported image type" });
    return false;
  }

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > IMAGE_MAX_BYTES) {
    res.status(400).json({ message: `image must be smaller than ${IMAGE_MAX_BYTES} bytes` });
    return false;
  }

  if (!imageMatchesMimeType(buffer, mimeType)) {
    res.status(400).json({ message: "imageDataUrl content does not match image type" });
    return false;
  }

  return {
    buffer,
    mimeType,
    originalName: String(req.body.imageName || "post-image").trim().slice(0, 120),
  };
}

function validateRequiredBody(req, res, maxLength, label) {
  const body = normalizeRequiredText(req.body.body, maxLength);
  if (!body) {
    res.status(400).json({
      message: `${label} is required and must not exceed ${maxLength} characters`,
    });
    return null;
  }

  return body;
}

function normalizeNumber(value, fallback, max = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(number)));
}

async function list(req, res) {
  const result = await communityPostService.listPosts({
    viewerId: req.user?.id || "",
    limit: normalizeNumber(req.query.limit, POSTS_DEFAULT_LIMIT, POSTS_MAX_LIMIT),
    offset: normalizeNumber(req.query.offset, 0),
  });
  res.json(result);
}

async function detail(req, res) {
  const post = await communityPostService.getPostDetails({
    id: req.params.id,
    viewerId: req.user?.id || "",
    commentsLimit: normalizeNumber(req.query.limit || req.query.commentLimit, COMMENTS_DEFAULT_LIMIT, COMMENTS_MAX_LIMIT),
    commentsOffset: normalizeNumber(req.query.offset || req.query.commentOffset, 0),
  });
  res.json({ post });
}

async function create(req, res) {
  const postBody = validatePostBody(req, res);
  if (!postBody) return;
  const observationId = normalizeOptionalId(req.body.observationId);
  if (observationId === null) {
    res.status(400).json({ message: "observationId is invalid" });
    return;
  }
  const image = validatePostImage(req, res);
  if (image === false) return;

  const post = await communityPostService.createPost({
    userId: req.user.id,
    observationId,
    image,
    ...postBody,
  });
  res.status(201).json({ post });
}

async function update(req, res) {
  const postBody = validatePostBody(req, res, { ignoreBird: true });
  if (!postBody) return;

  const post = await communityPostService.updatePost({
    id: req.params.id,
    userId: req.user.id,
    title: postBody.title,
    body: postBody.body,
  });
  res.json({ post });
}

async function remove(req, res) {
  await communityPostService.deletePost({
    id: req.params.id,
    userId: req.user.id,
  });
  res.status(204).end();
}

async function comment(req, res) {
  const body = validateRequiredBody(req, res, COMMENT_MAX_LENGTH, "comment");
  if (!body) return;

  const post = await communityPostService.createComment({
    postId: req.params.id,
    userId: req.user.id,
    body,
  });
  res.status(201).json({ post });
}

async function comments(req, res) {
  const result = await communityPostService.listCommentsForPost({
    postId: req.params.id,
    viewerId: req.user?.id || "",
    limit: normalizeNumber(req.query.limit, COMMENTS_DEFAULT_LIMIT, COMMENTS_MAX_LIMIT),
    offset: normalizeNumber(req.query.offset, 0),
  });
  res.json(result);
}

async function removeComment(req, res) {
  await communityPostService.deleteComment({
    postId: req.params.postId,
    commentId: req.params.commentId,
    userId: req.user.id,
  });
  res.status(204).end();
}

async function question(req, res) {
  const body = validateRequiredBody(req, res, QUESTION_MAX_LENGTH, "question");
  if (!body) return;

  const post = await communityPostService.createQuestion({
    postId: req.params.id,
    userId: req.user.id,
    body,
  });
  res.status(201).json({ post });
}

async function react(req, res) {
  const reactionType = String(req.body.reactionType || "").trim();
  if (!REACTION_TYPES.has(reactionType)) {
    res.status(400).json({ message: "unsupported reaction type" });
    return;
  }

  const post = await communityPostService.toggleReaction({
    postId: req.params.id,
    userId: req.user.id,
    reactionType,
  });
  res.json({ post });
}

async function image(req, res) {
  const postImage = await communityPostService.getPostImage({ id: req.params.id });
  res.set("Content-Type", postImage.mimeType);
  res.set("Cache-Control", "public, max-age=31536000, immutable");
  res.sendFile(postImage.filePath);
}

module.exports = {
  comment,
  comments,
  create,
  detail,
  image,
  list,
  question,
  react,
  remove,
  removeComment,
  update,
};
