const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../db/database");
const observationService = require("./observation.service");

const REACTION_TYPES = new Set(["helpful", "curious"]);
const DEFAULT_DATABASE_FILE = path.join(__dirname, "..", "data", "birdora.sqlite");
const databaseFile = path.resolve(process.env.DATABASE_FILE || DEFAULT_DATABASE_FILE);
const uploadRoot = process.env.COMMUNITY_UPLOAD_DIR
  ? path.resolve(process.env.COMMUNITY_UPLOAD_DIR)
  : path.join(path.dirname(databaseFile), "uploads", "community");
const UPLOAD_DIR = uploadRoot;
const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const PLACE_KEYWORDS = [
  "公园",
  "湿地",
  "河",
  "湖",
  "池塘",
  "校园",
  "树林",
  "林地",
  "步道",
  "稻田",
  "海边",
  "山",
  "村",
  "小区",
  "水边",
  "芦苇",
  "杭州",
  "西溪",
];
const BEHAVIOR_KEYWORDS = [
  "觅食",
  "飞",
  "停",
  "鸣叫",
  "整理",
  "俯冲",
  "游",
  "行走",
  "筑巢",
  "梳理",
  "捕食",
  "拍到",
  "看到",
  "观察",
];
const CONTEXT_KEYWORDS = [
  "清晨",
  "早上",
  "上午",
  "中午",
  "下午",
  "傍晚",
  "晚上",
  "天气",
  "晴",
  "阴",
  "雨",
  "风",
  "距离",
  "光线",
  "声音",
  "颜色",
  "体型",
  "高度",
];

function createEmptyFeedback() {
  return {
    helpful: { count: 0, selected: false },
    curious: { count: 0, selected: false },
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasAnyKeyword(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
}

function analyzePostCopy({ title, body, bird, hasImage }) {
  const text = `${title} ${body}`;
  const hasNamedBird = Boolean(bird && bird !== "观鸟笔记" && text.includes(bird));
  const hasPlace = hasAnyKeyword(text, PLACE_KEYWORDS);
  const hasBehavior = hasAnyKeyword(text, BEHAVIOR_KEYWORDS);
  const hasContext = hasAnyKeyword(text, CONTEXT_KEYWORDS);
  const hasUsefulLength = body.length >= 45;
  const hasClearTitle = title.length >= 8;
  const suggestions = [];
  const tags = [];
  let score = 30;

  if (hasClearTitle) {
    score += 10;
    tags.push("标题清晰");
  } else {
    suggestions.push("标题可以写得更具体，例如包含鸟名、地点或行为。");
  }

  if (hasUsefulLength) {
    score += 16;
    tags.push("正文信息充足");
  } else {
    suggestions.push("正文略短，可以补充观察距离、环境或动作细节。");
  }

  if (hasNamedBird) {
    score += 12;
    tags.push("鸟种明确");
  } else {
    suggestions.push("如果已识别出鸟种，可以在正文里带上鸟名。");
  }

  if (hasPlace) {
    score += 12;
    tags.push("地点线索");
  } else {
    suggestions.push("补充公园、湿地、河边或校园等地点，会更方便其他人判断。");
  }

  if (hasBehavior) {
    score += 12;
    tags.push("行为描述");
  } else {
    suggestions.push("可以补充停枝、觅食、飞行、鸣叫等行为。");
  }

  if (hasContext) {
    score += 8;
    tags.push("环境细节");
  } else {
    suggestions.push("加上时间、天气、距离、声音或光线，会让记录更完整。");
  }

  if (hasImage) {
    score += 10;
    tags.push("带配图");
  } else {
    suggestions.push("有照片时可以加一张配图，其他账号更容易理解和评价。");
  }

  const normalizedScore = Math.max(0, Math.min(100, score));
  const summary = normalizedScore >= 82
    ? "这条观鸟文案信息比较完整，适合直接发布交流。"
    : normalizedScore >= 64
      ? "这条观鸟文案已经可读，继续补充观察细节会更容易获得反馈。"
      : "这条观鸟文案偏简略，建议补充鸟种、地点、行为和环境信息。";

  return {
    score: normalizedScore,
    summary,
    tags: tags.slice(0, 5),
    suggestions: suggestions.slice(0, 3),
    updatedAt: new Date().toISOString(),
  };
}

function mapInteractionRow(row, viewerId = "") {
  return {
    id: row.id,
    body: row.body,
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canManage: Boolean(viewerId && row.user_id === viewerId),
  };
}

function mapObservationSummary(row) {
  if (!row.observation_summary_id) return null;

  return {
    id: row.observation_summary_id,
    selectedSpeciesName: row.observation_selected_species_name || "",
    selectedSpeciesScientificName: row.observation_selected_species_scientific_name || "",
    confidence: Number(row.observation_confidence) || 0,
    observedAt: row.observation_observed_at || "",
    source: row.observation_source || "",
    createdAt: row.observation_created_at || "",
  };
}

function mapPostRow(row, viewerId = "", interactions = {}) {
  if (!row) return null;

  const comments = interactions.comments || [];
  const commentCount = Number(interactions.commentCount ?? comments.length) || 0;
  const commentsPageInfo = interactions.commentsPageInfo || {
    limit: comments.length,
    offset: 0,
    nextOffset: comments.length,
    hasMore: commentCount > comments.length,
    total: commentCount,
    commentCount,
  };
  const questions = interactions.questions || [];

  return {
    id: row.id,
    observationId: row.observation_id || "",
    observationSummary: mapObservationSummary(row),
    title: row.title,
    body: row.body,
    bird: row.bird,
    analysis: {
      summary: row.analysis_summary || "",
      score: Number(row.analysis_score) || 0,
      tags: parseJsonArray(row.analysis_tags),
      suggestions: parseJsonArray(row.analysis_suggestions),
      updatedAt: row.analysis_updated_at || "",
    },
    author: row.author,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canManage: Boolean(viewerId && row.user_id === viewerId),
    feedback: interactions.feedback || createEmptyFeedback(),
    commentCount,
    commentPreview: comments,
    comments,
    commentsPageInfo,
    questions,
    questionCount: Number(interactions.questionCount ?? questions.length) || 0,
    imageUrl: row.image_storage_path ? `/api/community/posts/${encodeURIComponent(row.id)}/image` : "",
    imageAlt: row.image_original_name || "",
  };
}

function selectPostById(db, id) {
  return db.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.observation_id,
      posts.title,
      posts.body,
      posts.bird,
      posts.analysis_summary,
      posts.analysis_score,
      posts.analysis_tags,
      posts.analysis_suggestions,
      posts.analysis_updated_at,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author,
      images.storage_path AS image_storage_path,
      images.original_name AS image_original_name,
      images.mime_type AS image_mime_type,
      images.size_bytes AS image_size_bytes,
      observations.id AS observation_summary_id,
      observations.selected_species_name AS observation_selected_species_name,
      observations.selected_species_scientific_name AS observation_selected_species_scientific_name,
      observations.confidence AS observation_confidence,
      observations.observed_at AS observation_observed_at,
      observations.source AS observation_source,
      observations.created_at AS observation_created_at
    FROM community_posts AS posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN community_post_images AS images ON images.post_id = posts.id
    LEFT JOIN observations ON observations.id = posts.observation_id
    WHERE posts.id = ?
  `).get(id);
}

function createPostNotFoundError() {
  const error = new Error("post not found");
  error.statusCode = 404;
  return error;
}

function createCommentNotFoundError() {
  const error = new Error("comment not found");
  error.statusCode = 404;
  return error;
}

function ensureReactionType(reactionType) {
  if (REACTION_TYPES.has(reactionType)) return;

  const error = new Error("unsupported reaction type");
  error.statusCode = 400;
  throw error;
}

function fetchInteractions(db, postIds, viewerId = "", options = {}) {
  const commentPreviewLimit = Math.max(0, Math.min(10, Number(options.commentPreviewLimit ?? 3) || 0));
  const detailsByPostId = new Map(
    postIds.map((postId) => [
      postId,
      {
        feedback: createEmptyFeedback(),
        comments: [],
        commentCount: 0,
        questions: [],
        questionCount: 0,
      },
    ])
  );

  if (!postIds.length) return detailsByPostId;

  const placeholders = postIds.map(() => "?").join(", ");

  const commentCountRows = db.prepare(`
    SELECT
      post_id,
      COUNT(*) AS comment_count
    FROM community_post_comments
    WHERE post_id IN (${placeholders})
    GROUP BY post_id
  `).all(...postIds);

  for (const row of commentCountRows) {
    const detail = detailsByPostId.get(row.post_id);
    if (detail) detail.commentCount = Number(row.comment_count) || 0;
  }

  if (commentPreviewLimit > 0) {
    const commentRows = db.prepare(`
      SELECT
        id,
        post_id,
        user_id,
        body,
        created_at,
        updated_at,
        author
      FROM (
        SELECT
          comments.id,
          comments.post_id,
          comments.user_id,
          comments.body,
          comments.created_at,
          comments.updated_at,
          users.nickname AS author,
          ROW_NUMBER() OVER (
            PARTITION BY comments.post_id
            ORDER BY comments.created_at DESC, comments.id DESC
          ) AS comment_rank
        FROM community_post_comments AS comments
        JOIN users ON users.id = comments.user_id
        WHERE comments.post_id IN (${placeholders})
      )
      WHERE comment_rank <= ?
      ORDER BY post_id ASC, created_at ASC, id ASC
    `).all(...postIds, commentPreviewLimit);

    for (const row of commentRows) {
      detailsByPostId.get(row.post_id)?.comments.push(mapInteractionRow(row, viewerId));
    }
  }

  const questionCountRows = db.prepare(`
    SELECT
      post_id,
      COUNT(*) AS question_count
    FROM community_post_questions
    WHERE post_id IN (${placeholders})
    GROUP BY post_id
  `).all(...postIds);

  for (const row of questionCountRows) {
    const detail = detailsByPostId.get(row.post_id);
    if (detail) detail.questionCount = Number(row.question_count) || 0;
  }

  const questionRows = db.prepare(`
    SELECT
      questions.id,
      questions.post_id,
      questions.user_id,
      questions.body,
      questions.created_at,
      questions.updated_at,
      users.nickname AS author
    FROM community_post_questions AS questions
    JOIN users ON users.id = questions.user_id
    WHERE questions.post_id IN (${placeholders})
    ORDER BY questions.created_at ASC, questions.id ASC
  `).all(...postIds);

  for (const row of questionRows) {
    detailsByPostId.get(row.post_id)?.questions.push(mapInteractionRow(row, viewerId));
  }

  const reactionRows = db.prepare(`
    SELECT
      post_id,
      reaction_type,
      COUNT(*) AS reaction_count,
      SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS viewer_selected
    FROM community_post_reactions
    WHERE post_id IN (${placeholders})
    GROUP BY post_id, reaction_type
  `).all(viewerId, ...postIds);

  for (const row of reactionRows) {
    const detail = detailsByPostId.get(row.post_id);
    if (!detail || !REACTION_TYPES.has(row.reaction_type)) continue;

    detail.feedback[row.reaction_type] = {
      count: Number(row.reaction_count) || 0,
      selected: Boolean(row.viewer_selected),
    };
  }

  for (const detail of detailsByPostId.values()) {
    detail.commentsPageInfo = {
      limit: commentPreviewLimit,
      offset: 0,
      nextOffset: detail.comments.length,
      hasMore: detail.commentCount > detail.comments.length,
      total: detail.commentCount,
      commentCount: detail.commentCount,
    };
  }

  return detailsByPostId;
}

function hydratePostRows(db, rows, viewerId = "", options = {}) {
  const postIds = rows.map((row) => row.id);
  const interactionsByPostId = fetchInteractions(db, postIds, viewerId, options);
  return rows.map((row) => mapPostRow(row, viewerId, interactionsByPostId.get(row.id)));
}

function getPostForViewer(db, id, viewerId = "", options = {}) {
  const row = selectPostById(db, id);
  if (!row) throw createPostNotFoundError();

  return hydratePostRows(db, [row], viewerId, options)[0];
}

async function listPosts({ viewerId = "", limit = 50, offset = 0 } = {}) {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = db.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.observation_id,
      posts.title,
      posts.body,
      posts.bird,
      posts.analysis_summary,
      posts.analysis_score,
      posts.analysis_tags,
      posts.analysis_suggestions,
      posts.analysis_updated_at,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author,
      images.storage_path AS image_storage_path,
      images.original_name AS image_original_name,
      images.mime_type AS image_mime_type,
      images.size_bytes AS image_size_bytes,
      observations.id AS observation_summary_id,
      observations.selected_species_name AS observation_selected_species_name,
      observations.selected_species_scientific_name AS observation_selected_species_scientific_name,
      observations.confidence AS observation_confidence,
      observations.observed_at AS observation_observed_at,
      observations.source AS observation_source,
      observations.created_at AS observation_created_at
    FROM community_posts AS posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN community_post_images AS images ON images.post_id = posts.id
    LEFT JOIN observations ON observations.id = posts.observation_id
    ORDER BY posts.created_at DESC, posts.id DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit + 1, safeOffset);

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    posts: hydratePostRows(db, pageRows, viewerId, { commentPreviewLimit: 3 }),
    pageInfo: {
      limit: safeLimit,
      offset: safeOffset,
      nextOffset: safeOffset + pageRows.length,
      hasMore,
    },
  };
}

function getCommentsPage(db, postId, viewerId = "", limit = 10, offset = 0) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const countRow = db.prepare(`
    SELECT COUNT(*) AS comment_count
    FROM community_post_comments
    WHERE post_id = ?
  `).get(postId);
  const commentCount = Number(countRow?.comment_count) || 0;
  const rows = db.prepare(`
    SELECT
      comments.id,
      comments.post_id,
      comments.user_id,
      comments.body,
      comments.created_at,
      comments.updated_at,
      users.nickname AS author
    FROM community_post_comments AS comments
    JOIN users ON users.id = comments.user_id
    WHERE comments.post_id = ?
    ORDER BY comments.created_at ASC, comments.id ASC
    LIMIT ? OFFSET ?
  `).all(postId, safeLimit + 1, safeOffset);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    comments: pageRows.map((row) => mapInteractionRow(row, viewerId)),
    pageInfo: {
      limit: safeLimit,
      offset: safeOffset,
      nextOffset: safeOffset + pageRows.length,
      hasMore,
      total: commentCount,
      commentCount,
    },
  };
}

async function getPostDetails({ id, viewerId = "", commentsLimit = 10, commentsOffset = 0 } = {}) {
  const db = getDatabase();
  const row = selectPostById(db, id);
  if (!row) throw createPostNotFoundError();

  const post = hydratePostRows(db, [row], viewerId, { commentPreviewLimit: 0 })[0];
  const commentsPage = getCommentsPage(db, id, viewerId, commentsLimit, commentsOffset);
  post.comments = commentsPage.comments;
  post.commentPreview = commentsPage.comments;
  post.commentCount = commentsPage.pageInfo.commentCount;
  post.commentsPageInfo = commentsPage.pageInfo;
  return post;
}

async function listCommentsForPost({ postId, viewerId = "", limit = 10, offset = 0 } = {}) {
  const db = getDatabase();
  const row = selectPostById(db, postId);
  if (!row) throw createPostNotFoundError();
  return getCommentsPage(db, postId, viewerId, limit, offset);
}

function savePostImage(db, postId, image) {
  if (!image) return "";

  const extension = IMAGE_EXTENSIONS[image.mimeType];
  if (!extension) {
    const error = new Error("unsupported image type");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const storageFile = `${id}.${extension}`;
  const storagePath = path.join(UPLOAD_DIR, storageFile);

  try {
    fs.writeFileSync(storagePath, image.buffer);

    db.prepare(`
      INSERT INTO community_post_images (
        id,
        post_id,
        storage_path,
        original_name,
        mime_type,
        size_bytes,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      postId,
      storageFile,
      image.originalName || `post-image.${extension}`,
      image.mimeType,
      image.buffer.length,
      new Date().toISOString()
    );

    return storageFile;
  } catch (error) {
    removeImageFile(storageFile);
    throw error;
  }
}

function removeImageFile(storageFile) {
  if (!storageFile) return;

  const resolvedPath = path.resolve(UPLOAD_DIR, storageFile);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`)) return;
  fs.rmSync(resolvedPath, { force: true });
}

async function createPost({ userId, observationId = "", title, body, bird, image }) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const analysis = analyzePostCopy({ title, body, bird, hasImage: Boolean(image) });
  let savedImageFile = "";

  db.exec("BEGIN");
  try {
    if (observationId) {
      observationService.getOwnedObservationRow(db, observationId, userId);
    }

    db.prepare(`
      INSERT INTO community_posts (
        id,
        user_id,
        observation_id,
        title,
        body,
        bird,
        analysis_summary,
        analysis_score,
        analysis_tags,
        analysis_suggestions,
        analysis_updated_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      observationId || null,
      title,
      body,
      bird,
      analysis.summary,
      analysis.score,
      JSON.stringify(analysis.tags),
      JSON.stringify(analysis.suggestions),
      analysis.updatedAt,
      now,
      now
    );

    savedImageFile = savePostImage(db, id, image);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    removeImageFile(savedImageFile);
    throw error;
  }

  return getPostForViewer(db, id, userId);
}

function getOwnedPost(db, id, userId) {
  const row = selectPostById(db, id);
  if (!row) throw createPostNotFoundError();

  if (row.user_id !== userId) {
    const error = new Error("you can only manage your own posts");
    error.statusCode = 403;
    throw error;
  }

  return row;
}

async function updatePost({ id, userId, title, body }) {
  const db = getDatabase();
  const existingPost = getOwnedPost(db, id, userId);
  const updatedAt = new Date().toISOString();
  const analysis = analyzePostCopy({
    title,
    body,
    bird: existingPost.bird,
    hasImage: Boolean(existingPost.image_storage_path),
  });

  db.prepare(`
    UPDATE community_posts
    SET
      title = ?,
      body = ?,
      analysis_summary = ?,
      analysis_score = ?,
      analysis_tags = ?,
      analysis_suggestions = ?,
      analysis_updated_at = ?,
      updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    title,
    body,
    analysis.summary,
    analysis.score,
    JSON.stringify(analysis.tags),
    JSON.stringify(analysis.suggestions),
    analysis.updatedAt,
    updatedAt,
    id,
    userId
  );

  return getPostForViewer(db, id, userId);
}

async function deletePost({ id, userId }) {
  const db = getDatabase();
  getOwnedPost(db, id, userId);
  const image = db.prepare("SELECT storage_path FROM community_post_images WHERE post_id = ?").get(id);
  db.prepare("DELETE FROM community_posts WHERE id = ? AND user_id = ?").run(id, userId);
  removeImageFile(image?.storage_path);
}

async function getPostImage({ id }) {
  const db = getDatabase();
  const image = db.prepare(`
    SELECT
      storage_path,
      original_name,
      mime_type,
      size_bytes
    FROM community_post_images
    WHERE post_id = ?
  `).get(id);

  if (!image) throw createPostNotFoundError();

  const resolvedPath = path.resolve(UPLOAD_DIR, image.storage_path);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createPostNotFoundError();
  }

  return {
    filePath: resolvedPath,
    mimeType: image.mime_type,
    originalName: image.original_name,
    sizeBytes: image.size_bytes,
  };
}

async function createComment({ postId, userId, body }) {
  const db = getDatabase();
  getPostForViewer(db, postId, userId);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO community_post_comments (
      id,
      post_id,
      user_id,
      body,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), postId, userId, body, now, now);

  return getPostForViewer(db, postId, userId);
}

async function deleteComment({ postId, commentId, userId }) {
  const db = getDatabase();
  const comment = db.prepare(`
    SELECT
      id,
      post_id,
      user_id
    FROM community_post_comments
    WHERE id = ? AND post_id = ?
  `).get(commentId, postId);

  if (!comment) throw createCommentNotFoundError();

  if (comment.user_id !== userId) {
    const error = new Error("you can only delete your own comments");
    error.statusCode = 403;
    throw error;
  }

  db.prepare(`
    DELETE FROM community_post_comments
    WHERE id = ? AND post_id = ? AND user_id = ?
  `).run(commentId, postId, userId);
}

async function createQuestion({ postId, userId, body }) {
  const db = getDatabase();
  getPostForViewer(db, postId, userId);
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO community_post_questions (
      id,
      post_id,
      user_id,
      body,
      status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), postId, userId, body, "open", now, now);

  return getPostForViewer(db, postId, userId);
}

async function toggleReaction({ postId, userId, reactionType }) {
  ensureReactionType(reactionType);

  const db = getDatabase();
  getPostForViewer(db, postId, userId);

  const existing = db.prepare(`
    SELECT 1
    FROM community_post_reactions
    WHERE post_id = ? AND user_id = ? AND reaction_type = ?
  `).get(postId, userId, reactionType);

  if (existing) {
    db.prepare(`
      DELETE FROM community_post_reactions
      WHERE post_id = ? AND user_id = ? AND reaction_type = ?
    `).run(postId, userId, reactionType);
  } else {
    db.prepare(`
      INSERT INTO community_post_reactions (
        post_id,
        user_id,
        reaction_type,
        created_at
      ) VALUES (?, ?, ?, ?)
    `).run(postId, userId, reactionType, new Date().toISOString());
  }

  return getPostForViewer(db, postId, userId);
}

module.exports = {
  createPost,
  createComment,
  createQuestion,
  deleteComment,
  deletePost,
  getPostImage,
  getPostDetails,
  listCommentsForPost,
  listPosts,
  toggleReaction,
  updatePost,
};
