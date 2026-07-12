const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../db/database");
const cursorService = require("./cursor.service");
const notificationService = require("./notification.service");
const { recordImageWriteMetric } = require("./image-write-metrics");
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
const VIDEO_EXTENSIONS = {
  "video/mp4": "mp4",
  "video/webm": "webm",
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

function visibleAuthor(row, viewerId = "") {
  const isOwner = Boolean(viewerId && row.user_id === viewerId);
  return Number(row.author_public_profile) === 1 || isOwner
    ? row.author
    : "Birdora 用户";
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
    author: visibleAuthor(row, viewerId),
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
  const questionCount = Number(interactions.questionCount ?? questions.length) || 0;
  const questionsPageInfo = interactions.questionsPageInfo || {
    limit: questions.length,
    offset: 0,
    nextOffset: questions.length,
    hasMore: questionCount > questions.length,
    total: questionCount,
    questionCount,
  };

  return {
    id: row.id,
    authorId: row.user_id,
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
    author: visibleAuthor(row, viewerId),
    authorAvatarUrl: Number(row.author_public_profile) === 1 || row.user_id === viewerId
      ? row.author_avatar_url || ""
      : "",
    viewerFollowsAuthor: Boolean(row.viewer_follows_author),
    locationText: row.location_text || "",
    visibility: row.visibility || "public",
    status: row.status || "published",
    moderationStatus: row.moderation_status || "approved",
    publishedAt: row.published_at || row.created_at,
    version: Number(row.version) || 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    canManage: Boolean(viewerId && row.user_id === viewerId),
    feedback: interactions.feedback || createEmptyFeedback(),
    likeCount: Number(interactions.like?.count) || 0,
    viewerHasLiked: interactions.like?.selected === true,
    commentCount,
    commentPreview: comments,
    comments,
    commentsPageInfo,
    questionPreview: questions,
    questions,
    questionsPageInfo,
    questionCount,
    imageUrl: row.image_storage_path ? `/api/community/posts/${encodeURIComponent(row.id)}/image` : "",
    imageAlt: row.image_original_name || "",
    videoUrl: row.video_storage_path ? `/api/community/posts/${encodeURIComponent(row.id)}/video` : "",
    videoAlt: row.video_original_name || "",
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
      posts.location_text,
      posts.visibility,
      posts.status,
      posts.moderation_status,
      posts.published_at,
      posts.deleted_at,
      posts.version,
      posts.analysis_summary,
      posts.analysis_score,
      posts.analysis_tags,
      posts.analysis_suggestions,
      posts.analysis_updated_at,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author,
      users.avatar_url AS author_avatar_url,
      users.public_profile AS author_public_profile,
      images.storage_path AS image_storage_path,
      images.original_name AS image_original_name,
      images.mime_type AS image_mime_type,
      images.size_bytes AS image_size_bytes,
      videos.storage_path AS video_storage_path,
      videos.original_name AS video_original_name,
      videos.mime_type AS video_mime_type,
      videos.size_bytes AS video_size_bytes,
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
    LEFT JOIN community_post_videos AS videos ON videos.post_id = posts.id
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

function isMissingObservationConstraintError(error) {
  return /observation_id references missing observation/i.test(error?.message || "");
}

function createObservationLinkConflictError() {
  const error = new Error("linked observation changed before the community post was saved");
  error.statusCode = 409;
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
  const questionPreviewLimit = Math.max(0, Math.min(10, Number(options.questionPreviewLimit ?? 3) || 0));
  const detailsByPostId = new Map(
    postIds.map((postId) => [
      postId,
      {
        feedback: createEmptyFeedback(),
        like: { count: 0, selected: false },
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
        author,
        author_public_profile
      FROM (
        SELECT
          comments.id,
          comments.post_id,
          comments.user_id,
          comments.body,
          comments.created_at,
          comments.updated_at,
          users.nickname AS author,
          users.public_profile AS author_public_profile,
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

  if (questionPreviewLimit > 0) {
    const questionRows = db.prepare(`
      SELECT
        id,
        post_id,
        user_id,
        body,
        created_at,
        updated_at,
        author,
        author_public_profile
      FROM (
        SELECT
          questions.id,
          questions.post_id,
          questions.user_id,
          questions.body,
          questions.created_at,
          questions.updated_at,
          users.nickname AS author,
          users.public_profile AS author_public_profile,
          ROW_NUMBER() OVER (
            PARTITION BY questions.post_id
            ORDER BY questions.created_at DESC, questions.id DESC
          ) AS question_rank
        FROM community_post_questions AS questions
        JOIN users ON users.id = questions.user_id
        WHERE questions.post_id IN (${placeholders})
      )
      WHERE question_rank <= ?
      ORDER BY post_id ASC, created_at ASC, id ASC
    `).all(...postIds, questionPreviewLimit);

    for (const row of questionRows) {
      detailsByPostId.get(row.post_id)?.questions.push(mapInteractionRow(row, viewerId));
    }
  }

  const likeRows = db.prepare(`
    SELECT
      post_id,
      COUNT(*) AS like_count,
      SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS viewer_selected
    FROM community_post_likes
    WHERE post_id IN (${placeholders})
    GROUP BY post_id
  `).all(viewerId, ...postIds);

  for (const row of likeRows) {
    const detail = detailsByPostId.get(row.post_id);
    if (!detail) continue;
    detail.like = {
      count: Number(row.like_count) || 0,
      selected: Boolean(row.viewer_selected),
    };
    detail.feedback.helpful = { ...detail.like };
  }

  const reactionRows = db.prepare(`
    SELECT
      post_id,
      reaction_type,
      COUNT(*) AS reaction_count,
      SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS viewer_selected
    FROM community_post_reactions
    WHERE post_id IN (${placeholders}) AND reaction_type = 'curious'
    GROUP BY post_id, reaction_type
  `).all(viewerId, ...postIds);

  for (const row of reactionRows) {
    const detail = detailsByPostId.get(row.post_id);
    if (!detail || row.reaction_type !== "curious") continue;

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
    detail.questionsPageInfo = {
      limit: questionPreviewLimit,
      offset: 0,
      nextOffset: detail.questions.length,
      hasMore: detail.questionCount > detail.questions.length,
      total: detail.questionCount,
      questionCount: detail.questionCount,
    };
  }

  return detailsByPostId;
}

function hydratePostRows(db, rows, viewerId = "", options = {}) {
  const postIds = rows.map((row) => row.id);
  const authorIds = [...new Set(rows.map((row) => row.user_id).filter(Boolean))];
  const followedAuthorIds = new Set();
  if (viewerId && authorIds.length) {
    const placeholders = authorIds.map(() => "?").join(", ");
    const followedRows = db.prepare(`
      SELECT followed_user_id
      FROM user_follows
      WHERE follower_user_id = ? AND followed_user_id IN (${placeholders})
    `).all(viewerId, ...authorIds);
    for (const row of followedRows) followedAuthorIds.add(row.followed_user_id);
  }
  const interactionsByPostId = fetchInteractions(db, postIds, viewerId, options);
  return rows.map((row) => mapPostRow({
    ...row,
    viewer_follows_author: followedAuthorIds.has(row.user_id),
  }, viewerId, interactionsByPostId.get(row.id)));
}

function canViewPostRow(db, row, viewerId = "") {
  if (!row || row.status === "deleted" || row.deleted_at) return false;
  if (viewerId && row.user_id === viewerId) return true;
  if (row.status !== "published" || row.moderation_status !== "approved") return false;
  if (row.visibility === "public") return true;
  if (row.visibility !== "followers" || !viewerId) return false;
  return Boolean(db.prepare(`
    SELECT 1
    FROM user_follows
    WHERE follower_user_id = ? AND followed_user_id = ?
  `).get(viewerId, row.user_id));
}

function requireVisiblePostRow(db, row, viewerId = "") {
  if (!canViewPostRow(db, row, viewerId)) throw createPostNotFoundError();
  return row;
}

function getPostForViewer(db, id, viewerId = "", options = {}) {
  const row = selectPostById(db, id);
  requireVisiblePostRow(db, row, viewerId);

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
      posts.location_text,
      posts.visibility,
      posts.status,
      posts.moderation_status,
      posts.published_at,
      posts.version,
      posts.analysis_summary,
      posts.analysis_score,
      posts.analysis_tags,
      posts.analysis_suggestions,
      posts.analysis_updated_at,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author,
      users.avatar_url AS author_avatar_url,
      users.public_profile AS author_public_profile,
      images.storage_path AS image_storage_path,
      images.original_name AS image_original_name,
      images.mime_type AS image_mime_type,
      images.size_bytes AS image_size_bytes,
      videos.storage_path AS video_storage_path,
      videos.original_name AS video_original_name,
      videos.mime_type AS video_mime_type,
      videos.size_bytes AS video_size_bytes,
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
    LEFT JOIN community_post_videos AS videos ON videos.post_id = posts.id
    LEFT JOIN observations ON observations.id = posts.observation_id
    WHERE posts.status = 'published'
      AND posts.moderation_status = 'approved'
      AND posts.deleted_at IS NULL
      AND (
        posts.visibility = 'public'
        OR posts.user_id = ?
        OR (
          posts.visibility = 'followers'
          AND EXISTS (
            SELECT 1 FROM user_follows AS follows
            WHERE follows.follower_user_id = ?
              AND follows.followed_user_id = posts.user_id
          )
        )
      )
    ORDER BY posts.created_at DESC, posts.id DESC
    LIMIT ? OFFSET ?
  `).all(viewerId, viewerId, safeLimit + 1, safeOffset);

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

function queryCursorPosts(db, {
  scope,
  whereSql,
  params,
  viewerId,
  limit = 20,
  cursor = "",
}) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const decodedCursor = cursorService.decodeCursor(cursor, scope);
  const sortExpression = "COALESCE(NULLIF(posts.published_at, ''), posts.created_at)";
  const cursorSql = decodedCursor
    ? `AND (${sortExpression} < ? OR (${sortExpression} = ? AND posts.id < ?))`
    : "";
  const cursorParams = decodedCursor
    ? [decodedCursor.sortTime, decodedCursor.sortTime, decodedCursor.id]
    : [];
  const rows = db.prepare(`
    SELECT
      posts.id,
      posts.user_id,
      posts.observation_id,
      posts.title,
      posts.body,
      posts.bird,
      posts.location_text,
      posts.visibility,
      posts.status,
      posts.moderation_status,
      posts.published_at,
      posts.version,
      posts.analysis_summary,
      posts.analysis_score,
      posts.analysis_tags,
      posts.analysis_suggestions,
      posts.analysis_updated_at,
      posts.created_at,
      posts.updated_at,
      users.nickname AS author,
      users.avatar_url AS author_avatar_url,
      users.public_profile AS author_public_profile,
      images.storage_path AS image_storage_path,
      images.original_name AS image_original_name,
      images.mime_type AS image_mime_type,
      images.size_bytes AS image_size_bytes,
      videos.storage_path AS video_storage_path,
      videos.original_name AS video_original_name,
      videos.mime_type AS video_mime_type,
      videos.size_bytes AS video_size_bytes,
      observations.id AS observation_summary_id,
      observations.selected_species_name AS observation_selected_species_name,
      observations.selected_species_scientific_name AS observation_selected_species_scientific_name,
      observations.confidence AS observation_confidence,
      observations.observed_at AS observation_observed_at,
      observations.source AS observation_source,
      observations.created_at AS observation_created_at,
      ${sortExpression} AS feed_sort_time
    FROM community_posts AS posts
    JOIN users ON users.id = posts.user_id
    LEFT JOIN community_post_images AS images ON images.post_id = posts.id
    LEFT JOIN community_post_videos AS videos ON videos.post_id = posts.id
    LEFT JOIN observations ON observations.id = posts.observation_id
    WHERE ${whereSql}
      ${cursorSql}
    ORDER BY feed_sort_time DESC, posts.id DESC
    LIMIT ?
  `).all(...params, ...cursorParams, safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = pageRows.at(-1);
  return {
    posts: hydratePostRows(db, pageRows, viewerId, { commentPreviewLimit: 3 }),
    pageInfo: {
      limit: safeLimit,
      hasMore,
      nextCursor: hasMore && last
        ? cursorService.encodeCursor(scope, { sortTime: last.feed_sort_time, id: last.id })
        : null,
    },
  };
}

async function listFeed({ type = "recommended", viewerId = "", limit = 20, cursor = "" } = {}) {
  if (!new Set(["recommended", "following"]).has(type)) {
    const error = new Error("feed type must be recommended or following");
    error.statusCode = 400;
    error.code = "INVALID_FEED_TYPE";
    throw error;
  }
  if (type === "following" && !viewerId) {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  const db = getDatabase();
  const eligible = `
    posts.status = 'published'
    AND posts.moderation_status = 'approved'
    AND posts.deleted_at IS NULL
  `;
  if (type === "following") {
    return queryCursorPosts(db, {
      scope: "feed:following",
      whereSql: `${eligible}
        AND posts.visibility IN ('public', 'followers')
        AND EXISTS (
          SELECT 1 FROM user_follows AS follows
          WHERE follows.follower_user_id = ?
            AND follows.followed_user_id = posts.user_id
        )`,
      params: [viewerId],
      viewerId,
      limit,
      cursor,
    });
  }
  return queryCursorPosts(db, {
    scope: "feed:recommended",
    whereSql: `${eligible}
      AND (
        posts.visibility = 'public'
        OR posts.user_id = ?
        OR (
          posts.visibility = 'followers'
          AND EXISTS (
            SELECT 1 FROM user_follows AS follows
            WHERE follows.follower_user_id = ?
              AND follows.followed_user_id = posts.user_id
          )
        )
      )`,
    params: [viewerId, viewerId],
    viewerId,
    limit,
    cursor,
  });
}

async function listPostsByAuthor({ authorId, viewerId = "", limit = 20, cursor = "" }) {
  const db = getDatabase();
  const ownerView = Boolean(viewerId && viewerId === authorId);
  const visibilitySql = ownerView
    ? "posts.status <> 'deleted' AND posts.deleted_at IS NULL"
    : `posts.status = 'published'
       AND posts.moderation_status = 'approved'
       AND posts.deleted_at IS NULL
       AND (
         posts.visibility = 'public'
         OR (
           posts.visibility = 'followers'
           AND EXISTS (
             SELECT 1 FROM user_follows AS follows
             WHERE follows.follower_user_id = ?
               AND follows.followed_user_id = posts.user_id
           )
         )
       )`;
  return queryCursorPosts(db, {
    scope: `user-posts:${authorId}`,
    whereSql: `posts.user_id = ? AND ${visibilitySql}`,
    params: ownerView ? [authorId] : [authorId, viewerId],
    viewerId,
    limit,
    cursor,
  });
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
      users.nickname AS author,
      users.public_profile AS author_public_profile
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

function getQuestionsPage(db, postId, viewerId = "", limit = 10, offset = 0) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const countRow = db.prepare(`
    SELECT COUNT(*) AS question_count
    FROM community_post_questions
    WHERE post_id = ?
  `).get(postId);
  const questionCount = Number(countRow?.question_count) || 0;
  const rows = db.prepare(`
    SELECT
      questions.id,
      questions.post_id,
      questions.user_id,
      questions.body,
      questions.created_at,
      questions.updated_at,
      users.nickname AS author,
      users.public_profile AS author_public_profile
    FROM community_post_questions AS questions
    JOIN users ON users.id = questions.user_id
    WHERE questions.post_id = ?
    ORDER BY questions.created_at ASC, questions.id ASC
    LIMIT ? OFFSET ?
  `).all(postId, safeLimit + 1, safeOffset);
  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    questions: pageRows.map((row) => mapInteractionRow(row, viewerId)),
    pageInfo: {
      limit: safeLimit,
      offset: safeOffset,
      nextOffset: safeOffset + pageRows.length,
      hasMore,
      total: questionCount,
      questionCount,
    },
  };
}

async function getPostDetails({
  id,
  viewerId = "",
  commentsLimit = 10,
  commentsOffset = 0,
  questionsLimit = 10,
  questionsOffset = 0,
} = {}) {
  const db = getDatabase();
  const row = selectPostById(db, id);
  requireVisiblePostRow(db, row, viewerId);

  const post = hydratePostRows(db, [row], viewerId, { commentPreviewLimit: 0, questionPreviewLimit: 0 })[0];
  const commentsPage = getCommentsPage(db, id, viewerId, commentsLimit, commentsOffset);
  const questionsPage = getQuestionsPage(db, id, viewerId, questionsLimit, questionsOffset);
  post.comments = commentsPage.comments;
  post.commentPreview = commentsPage.comments;
  post.commentCount = commentsPage.pageInfo.commentCount;
  post.commentsPageInfo = commentsPage.pageInfo;
  post.questions = questionsPage.questions;
  post.questionPreview = questionsPage.questions;
  post.questionCount = questionsPage.pageInfo.questionCount;
  post.questionsPageInfo = questionsPage.pageInfo;
  return post;
}

async function listCommentsForPost({ postId, viewerId = "", limit = 10, offset = 0 } = {}) {
  const db = getDatabase();
  const row = selectPostById(db, postId);
  requireVisiblePostRow(db, row, viewerId);
  return getCommentsPage(db, postId, viewerId, limit, offset);
}

async function listQuestionsForPost({ postId, viewerId = "", limit = 10, offset = 0 } = {}) {
  const db = getDatabase();
  const row = selectPostById(db, postId);
  requireVisiblePostRow(db, row, viewerId);
  return getQuestionsPage(db, postId, viewerId, limit, offset);
}

function preparePostImage(image) {
  if (!image) return null;

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
  const startedAt = Date.now();

  try {
    fs.writeFileSync(storagePath, image.buffer);
    recordImageWriteMetric({
      kind: "community",
      storageFile,
      mimeType: image.mimeType,
      bytes: image.buffer.length,
      durationMs: Date.now() - startedAt,
      ok: true,
    });
  } catch (error) {
    recordImageWriteMetric({
      kind: "community",
      storageFile,
      mimeType: image.mimeType,
      bytes: image.buffer.length,
      durationMs: Date.now() - startedAt,
      ok: false,
      error: error.message,
    });
    removeImageFile(storageFile);
    throw error;
  }

  return {
    id,
    storageFile,
    originalName: image.originalName || `post-image.${extension}`,
    mimeType: image.mimeType,
    sizeBytes: image.buffer.length,
  };
}

function insertPostImage(db, postId, preparedImage) {
  if (!preparedImage) return "";

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
    preparedImage.id,
    postId,
    preparedImage.storageFile,
    preparedImage.originalName,
    preparedImage.mimeType,
    preparedImage.sizeBytes,
    new Date().toISOString()
  );

  return preparedImage.storageFile;
}

function preparePostVideo(video) {
  if (!video) return null;
  const extension = VIDEO_EXTENSIONS[video.mimeType];
  if (!extension) {
    const error = new Error("unsupported video type");
    error.statusCode = 400;
    throw error;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const id = crypto.randomUUID();
  const storageFile = `${id}.${extension}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storageFile), video.buffer);
  return { id, storageFile, originalName: video.originalName || `post-video.${extension}`, mimeType: video.mimeType, sizeBytes: video.buffer.length };
}

function insertPostVideo(db, postId, preparedVideo) {
  if (!preparedVideo) return;
  db.prepare(`
    INSERT INTO community_post_videos (id, post_id, storage_path, original_name, mime_type, size_bytes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    preparedVideo.id,
    postId,
    preparedVideo.storageFile,
    preparedVideo.originalName,
    preparedVideo.mimeType,
    preparedVideo.sizeBytes,
    new Date().toISOString()
  );
}

function removeImageFile(storageFile) {
  if (!storageFile) return;

  const resolvedPath = path.resolve(UPLOAD_DIR, storageFile);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`)) return;
  fs.rmSync(resolvedPath, { force: true });
}

async function createPost({
  userId,
  observationId = "",
  title,
  body,
  bird,
  locationText = "",
  visibility = "public",
  image,
  video,
}) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const analysis = analyzePostCopy({ title, body, bird, hasImage: Boolean(image || video) });
  let preparedImage = null;
  let preparedVideo = null;
  let transactionStarted = false;

  try {
    if (observationId) {
      observationService.getOwnedObservationRow(db, observationId, userId);
    }

    preparedImage = preparePostImage(image);
    preparedVideo = preparePostVideo(video);
    db.exec("BEGIN");
    transactionStarted = true;

    db.prepare(`
      INSERT INTO community_posts (
        id,
        user_id,
        observation_id,
        title,
        body,
        bird,
        location_text,
        visibility,
        status,
        moderation_status,
        moderation_source,
        published_at,
        version,
        analysis_summary,
        analysis_score,
        analysis_tags,
        analysis_suggestions,
        analysis_updated_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', 'approved', 'direct_publish', ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      observationId || null,
      title,
      body,
      bird,
      locationText,
      visibility,
      now,
      analysis.summary,
      analysis.score,
      JSON.stringify(analysis.tags),
      JSON.stringify(analysis.suggestions),
      analysis.updatedAt,
      now,
      now
    );

    insertPostImage(db, id, preparedImage);
    insertPostVideo(db, id, preparedVideo);
    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    removeImageFile(preparedImage?.storageFile);
    removeImageFile(preparedVideo?.storageFile);
    if (isMissingObservationConstraintError(error)) {
      throw createObservationLinkConflictError();
    }
    throw error;
  }

  return getPostForViewer(db, id, userId);
}

function createServiceError(message, statusCode, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function hashPublishRequest({ draftId, version, image, video }) {
  const media = image || video;
  const mediaHash = media?.buffer
    ? crypto.createHash("sha256").update(media.buffer).digest("hex")
    : "";
  return crypto.createHash("sha256").update(JSON.stringify({
    draftId,
    version,
    mediaKind: image ? "image" : video ? "video" : "none",
    mediaMimeType: media?.mimeType || "",
    mediaHash,
  })).digest("hex");
}

function resolveCompletedPublish(db, record, requestHash, userId) {
  if (!record) return null;
  if (record.request_hash !== requestHash) {
    throw createServiceError(
      "idempotency key was already used for a different publish request",
      409,
      "IDEMPOTENCY_KEY_REUSED"
    );
  }
  if (record.state !== "completed" || !record.resource_id) {
    throw createServiceError("publish request is still being processed", 409, "IDEMPOTENCY_IN_PROGRESS");
  }
  return getPostForViewer(db, record.resource_id, userId);
}

async function publishDraft({
  draftId,
  userId,
  version,
  idempotencyKey,
  image,
  video,
}) {
  const db = getDatabase();
  const scope = "draft.publish";
  const requestHash = hashPublishRequest({ draftId, version, image, video });
  const existingRecord = db.prepare(`
    SELECT request_hash, state, resource_id
    FROM idempotency_records
    WHERE user_id = ? AND scope = ? AND key = ?
  `).get(userId, scope, idempotencyKey);
  const completed = resolveCompletedPublish(db, existingRecord, requestHash, userId);
  if (completed) return completed;

  const draft = db.prepare(`
    SELECT * FROM post_drafts
    WHERE id = ? AND user_id = ? AND consumed_at IS NULL
  `).get(draftId, userId);
  if (!draft) throw createServiceError("draft not found", 404, "DRAFT_NOT_FOUND");
  if (Number(draft.version) !== version) {
    throw createServiceError("draft was changed by another session", 409, "DRAFT_VERSION_CONFLICT");
  }
  if (!String(draft.title || "").trim() || !String(draft.body || "").trim()) {
    throw createServiceError("title and body are required before publishing", 400, "DRAFT_INCOMPLETE");
  }
  if (image && video) {
    throw createServiceError("a post can include either one image or one video", 400, "VALIDATION_ERROR");
  }
  if (draft.observation_id) {
    observationService.getOwnedObservationRow(db, draft.observation_id, userId);
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const postId = crypto.randomUUID();
  const analysis = analyzePostCopy({
    title: draft.title,
    body: draft.body,
    bird: draft.bird,
    hasImage: Boolean(image || video),
  });
  let preparedImage = null;
  let preparedVideo = null;
  let transactionStarted = false;

  try {
    preparedImage = preparePostImage(image);
    preparedVideo = preparePostVideo(video);
    db.exec("BEGIN IMMEDIATE");
    transactionStarted = true;

    const concurrentRecord = db.prepare(`
      SELECT request_hash, state, resource_id
      FROM idempotency_records
      WHERE user_id = ? AND scope = ? AND key = ?
    `).get(userId, scope, idempotencyKey);
    const concurrentCompleted = resolveCompletedPublish(db, concurrentRecord, requestHash, userId);
    if (concurrentCompleted) {
      db.exec("ROLLBACK");
      transactionStarted = false;
      removeImageFile(preparedImage?.storageFile);
      removeImageFile(preparedVideo?.storageFile);
      return concurrentCompleted;
    }

    const lockedDraft = db.prepare(`
      SELECT * FROM post_drafts
      WHERE id = ? AND user_id = ? AND consumed_at IS NULL
    `).get(draftId, userId);
    if (!lockedDraft) throw createServiceError("draft not found", 404, "DRAFT_NOT_FOUND");
    if (Number(lockedDraft.version) !== version) {
      throw createServiceError("draft was changed by another session", 409, "DRAFT_VERSION_CONFLICT");
    }

    db.prepare(`
      INSERT INTO idempotency_records (
        user_id, scope, key, request_hash, state, status_code, response_json,
        resource_id, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'processing', NULL, NULL, NULL, ?, ?, ?)
    `).run(userId, scope, idempotencyKey, requestHash, expiresAt, now, now);

    db.prepare(`
      INSERT INTO community_posts (
        id, user_id, observation_id, title, body, bird, location_text, visibility,
        status, moderation_status, moderation_source, published_at, version,
        analysis_summary, analysis_score, analysis_tags, analysis_suggestions,
        analysis_updated_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published', 'approved', 'draft_publish', ?, 1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      postId,
      userId,
      lockedDraft.observation_id,
      lockedDraft.title,
      lockedDraft.body,
      lockedDraft.bird,
      lockedDraft.location_text,
      lockedDraft.visibility,
      now,
      analysis.summary,
      analysis.score,
      JSON.stringify(analysis.tags),
      JSON.stringify(analysis.suggestions),
      analysis.updatedAt,
      now,
      now
    );
    insertPostImage(db, postId, preparedImage);
    insertPostVideo(db, postId, preparedVideo);

    const consumed = db.prepare(`
      UPDATE post_drafts
      SET consumed_at = ?, updated_at = ?
      WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND version = ?
    `).run(now, now, draftId, userId, version);
    if (consumed.changes !== 1) {
      throw createServiceError("draft was changed by another session", 409, "DRAFT_VERSION_CONFLICT");
    }

    db.prepare(`
      UPDATE idempotency_records
      SET state = 'completed', status_code = 201, response_json = ?, resource_id = ?, updated_at = ?
      WHERE user_id = ? AND scope = ? AND key = ? AND state = 'processing'
    `).run(JSON.stringify({ postId }), postId, now, userId, scope, idempotencyKey);
    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    removeImageFile(preparedImage?.storageFile);
    removeImageFile(preparedVideo?.storageFile);
    if (isMissingObservationConstraintError(error)) throw createObservationLinkConflictError();
    throw error;
  }

  return getPostForViewer(db, postId, userId);
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

async function updatePost({ id, userId, title, body, locationText = "", visibility = "public" }) {
  const db = getDatabase();
  const existingPost = getOwnedPost(db, id, userId);
  const updatedAt = new Date().toISOString();
  const analysis = analyzePostCopy({
    title,
    body,
    bird: existingPost.bird,
    hasImage: Boolean(existingPost.image_storage_path || existingPost.video_storage_path),
  });

  db.prepare(`
    UPDATE community_posts
    SET
      title = ?,
      body = ?,
      location_text = ?,
      visibility = ?,
      version = version + 1,
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
    locationText,
    visibility,
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
  const video = db.prepare("SELECT storage_path FROM community_post_videos WHERE post_id = ?").get(id);
  db.prepare("DELETE FROM community_posts WHERE id = ? AND user_id = ?").run(id, userId);
  removeImageFile(image?.storage_path);
  removeImageFile(video?.storage_path);
}

async function getPostImage({ id, viewerId = "" }) {
  const db = getDatabase();
  const post = selectPostById(db, id);
  requireVisiblePostRow(db, post, viewerId);
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
    publiclyCacheable: post.visibility === "public",
  };
}

async function getPostVideo({ id, viewerId = "" }) {
  const db = getDatabase();
  const post = selectPostById(db, id);
  requireVisiblePostRow(db, post, viewerId);
  const video = db.prepare(`SELECT storage_path, original_name, mime_type, size_bytes FROM community_post_videos WHERE post_id = ?`).get(id);
  if (!video) throw createPostNotFoundError();
  const resolvedPath = path.resolve(UPLOAD_DIR, video.storage_path);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`) || !fs.existsSync(resolvedPath)) throw createPostNotFoundError();
  return {
    filePath: resolvedPath,
    mimeType: video.mime_type,
    originalName: video.original_name,
    sizeBytes: video.size_bytes,
    publiclyCacheable: post.visibility === "public",
  };
}

async function createComment({ postId, userId, body }) {
  const db = getDatabase();
  const postRow = selectPostById(db, postId);
  if (!postRow) throw createPostNotFoundError();
  getPostForViewer(db, postId, userId);
  const now = new Date().toISOString();
  const commentId = crypto.randomUUID();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO community_post_comments (
        id,
        post_id,
        user_id,
        body,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(commentId, postId, userId, body, now, now);
    notificationService.createNotification(db, {
      recipientUserId: postRow.user_id,
      actorUserId: userId,
      type: "post_commented",
      entityType: "post",
      entityId: postId,
      payload: { postTitle: postRow.title, commentId },
      dedupeKey: `post_commented:${commentId}:${postRow.user_id}`,
      now,
    });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

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

  if (reactionType === "helpful") {
    const existingLike = db.prepare(`
      SELECT 1 FROM community_post_likes WHERE post_id = ? AND user_id = ?
    `).get(postId, userId);
    return setPostLike({ postId, userId, liked: !existingLike });
  }

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

async function setPostLike({ postId, userId, liked }) {
  const db = getDatabase();
  const postRow = selectPostById(db, postId);
  if (!postRow) throw createPostNotFoundError();
  getPostForViewer(db, postId, userId);
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (liked) {
      db.prepare(`
        INSERT INTO community_post_likes (post_id, user_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(post_id, user_id) DO NOTHING
      `).run(postId, userId, now);
      db.prepare(`
        INSERT INTO community_post_reactions (post_id, user_id, reaction_type, created_at)
        VALUES (?, ?, 'helpful', ?)
        ON CONFLICT(post_id, user_id, reaction_type) DO NOTHING
      `).run(postId, userId, now);
      notificationService.createNotification(db, {
        recipientUserId: postRow.user_id,
        actorUserId: userId,
        type: "post_liked",
        entityType: "post",
        entityId: postId,
        payload: { postTitle: postRow.title },
        dedupeKey: `post_liked:${postId}:${userId}:${postRow.user_id}`,
        now,
      });
    } else {
      db.prepare("DELETE FROM community_post_likes WHERE post_id = ? AND user_id = ?").run(postId, userId);
      db.prepare(`
        DELETE FROM community_post_reactions
        WHERE post_id = ? AND user_id = ? AND reaction_type = 'helpful'
      `).run(postId, userId);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
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
  getPostVideo,
  getPostDetails,
  listCommentsForPost,
  listQuestionsForPost,
  listFeed,
  listPosts,
  listPostsByAuthor,
  publishDraft,
  setPostLike,
  toggleReaction,
  updatePost,
};
