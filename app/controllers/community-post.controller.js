const communityPostService = require("../services/community-post.service");

const TITLE_MAX_LENGTH = 80;
const BODY_MAX_LENGTH = 600;
const BIRD_MAX_LENGTH = 80;

function normalizeRequiredText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
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

async function list(req, res) {
  const posts = await communityPostService.listPosts(req.user?.id || "");
  res.json({ posts });
}

async function create(req, res) {
  const postBody = validatePostBody(req, res);
  if (!postBody) return;

  const post = await communityPostService.createPost({
    userId: req.user.id,
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

module.exports = {
  create,
  list,
  remove,
  update,
};
