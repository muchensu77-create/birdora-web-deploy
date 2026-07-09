const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../db/database");
const { recordImageWriteMetric } = require("./image-write-metrics");

const DEFAULT_DATABASE_FILE = path.join(__dirname, "..", "data", "birdora.sqlite");
const databaseFile = path.resolve(process.env.DATABASE_FILE || DEFAULT_DATABASE_FILE);
const uploadRoot = process.env.OBSERVATION_UPLOAD_DIR
  ? path.resolve(process.env.OBSERVATION_UPLOAD_DIR)
  : path.join(path.dirname(databaseFile), "uploads", "observations");
const UPLOAD_DIR = uploadRoot;
const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function createNotFoundError() {
  const error = new Error("observation not found");
  error.statusCode = 404;
  return error;
}

function createForbiddenError() {
  const error = new Error("you can only access your own observations");
  error.statusCode = 403;
  return error;
}

function createLinkedPostConflictError() {
  const error = new Error("observation is linked to a community post");
  error.statusCode = 409;
  return error;
}

function isLinkedObservationConstraintError(error) {
  return /observation is linked to a community post/i.test(error?.message || "");
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapObservationRow(row) {
  if (!row) return null;

  return {
    id: row.id,
    selectedSpeciesName: row.selected_species_name,
    selectedSpeciesScientificName: row.selected_species_scientific_name || "",
    confidence: Number(row.confidence),
    topCandidates: parseJsonArray(row.top_candidates_json),
    locationText: row.location_text || "",
    notes: row.notes || "",
    source: row.source || "osea-browser",
    observedAt: row.observed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    imageUrl: row.image_url ? `/api/observations/${encodeURIComponent(row.id)}/image` : "",
    imageAlt: row.image_original_name || row.selected_species_name,
    imageMimeType: row.image_mime_type || "",
    imageSizeBytes: Number(row.image_size_bytes) || 0,
  };
}

function selectObservationById(db, id) {
  return db.prepare(`
    SELECT
      id,
      user_id,
      image_url,
      image_original_name,
      image_mime_type,
      image_size_bytes,
      selected_species_name,
      selected_species_scientific_name,
      confidence,
      top_candidates_json,
      location_text,
      notes,
      source,
      observed_at,
      created_at,
      updated_at
    FROM observations
    WHERE id = ?
  `).get(id);
}

function getOwnedObservationRow(db, id, userId) {
  const row = selectObservationById(db, id);
  if (!row) throw createNotFoundError();
  if (row.user_id !== userId) throw createForbiddenError();
  return row;
}

function getObservationForUser(db, id, userId) {
  return mapObservationRow(getOwnedObservationRow(db, id, userId));
}

function removeImageFile(storageFile) {
  if (!storageFile) return;

  const resolvedPath = path.resolve(UPLOAD_DIR, storageFile);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`)) return;
  fs.rmSync(resolvedPath, { force: true });
}

function prepareObservationImage(image) {
  if (!image) return null;

  const extension = IMAGE_EXTENSIONS[image.mimeType];
  if (!extension) {
    const error = new Error("unsupported image type");
    error.statusCode = 400;
    throw error;
  }

  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const storageFile = `${crypto.randomUUID()}.${extension}`;
  const storagePath = path.join(UPLOAD_DIR, storageFile);
  const startedAt = Date.now();

  try {
    fs.writeFileSync(storagePath, image.buffer);
    recordImageWriteMetric({
      kind: "observation",
      storageFile,
      mimeType: image.mimeType,
      bytes: image.buffer.length,
      durationMs: Date.now() - startedAt,
      ok: true,
    });
  } catch (error) {
    recordImageWriteMetric({
      kind: "observation",
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
    storageFile,
    originalName: image.originalName || `observation-image.${extension}`,
    mimeType: image.mimeType,
    sizeBytes: image.buffer.length,
  };
}

async function createObservation({
  userId,
  selectedSpeciesName,
  selectedSpeciesScientificName = "",
  confidence,
  topCandidates,
  locationText = "",
  notes = "",
  source = "osea-browser",
  observedAt,
  image,
}) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const finalObservedAt = observedAt || now;
  const preparedImage = prepareObservationImage(image);
  let transactionStarted = false;

  try {
    db.exec("BEGIN");
    transactionStarted = true;

    db.prepare(`
      INSERT INTO observations (
        id,
        user_id,
        image_url,
        image_original_name,
        image_mime_type,
        image_size_bytes,
        selected_species_name,
        selected_species_scientific_name,
        confidence,
        top_candidates_json,
        location_text,
        notes,
        source,
        observed_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      preparedImage?.storageFile || "",
      preparedImage?.originalName || "",
      preparedImage?.mimeType || "",
      preparedImage?.sizeBytes || 0,
      selectedSpeciesName,
      selectedSpeciesScientificName,
      confidence,
      JSON.stringify(topCandidates),
      locationText,
      notes,
      source,
      finalObservedAt,
      now,
      now
    );

    db.exec("COMMIT");
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec("ROLLBACK");
    removeImageFile(preparedImage?.storageFile);
    throw error;
  }

  return getObservationForUser(db, id, userId);
}

async function listObservationsForUser({ userId, limit = 20, offset = 0 }) {
  const db = getDatabase();
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 20));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const rows = db.prepare(`
    SELECT
      id,
      user_id,
      image_url,
      image_original_name,
      image_mime_type,
      image_size_bytes,
      selected_species_name,
      selected_species_scientific_name,
      confidence,
      top_candidates_json,
      location_text,
      notes,
      source,
      observed_at,
      created_at,
      updated_at
    FROM observations
    WHERE user_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(userId, safeLimit + 1, safeOffset);

  const hasMore = rows.length > safeLimit;
  const pageRows = hasMore ? rows.slice(0, safeLimit) : rows;

  return {
    observations: pageRows.map(mapObservationRow),
    pageInfo: {
      limit: safeLimit,
      offset: safeOffset,
      nextOffset: safeOffset + pageRows.length,
      hasMore,
    },
  };
}

async function getObservation({ id, userId }) {
  const db = getDatabase();
  return getObservationForUser(db, id, userId);
}

async function getObservationImage({ id, userId }) {
  const db = getDatabase();
  const row = getOwnedObservationRow(db, id, userId);
  if (!row.image_url) throw createNotFoundError();

  const resolvedPath = path.resolve(UPLOAD_DIR, row.image_url);
  if (!resolvedPath.startsWith(`${path.resolve(UPLOAD_DIR)}${path.sep}`) || !fs.existsSync(resolvedPath)) {
    throw createNotFoundError();
  }

  return {
    filePath: resolvedPath,
    mimeType: row.image_mime_type,
    originalName: row.image_original_name,
    sizeBytes: Number(row.image_size_bytes) || 0,
  };
}

async function deleteObservation({ id, userId }) {
  const db = getDatabase();
  const row = getOwnedObservationRow(db, id, userId);
  const linkedPost = db.prepare(`
    SELECT id
    FROM community_posts
    WHERE observation_id = ?
    LIMIT 1
  `).get(id);

  if (linkedPost) {
    throw createLinkedPostConflictError();
  }

  try {
    db.prepare("DELETE FROM observations WHERE id = ? AND user_id = ?").run(id, userId);
  } catch (error) {
    if (isLinkedObservationConstraintError(error)) {
      throw createLinkedPostConflictError();
    }
    throw error;
  }
  removeImageFile(row.image_url);
}

module.exports = {
  createObservation,
  deleteObservation,
  getObservation,
  getObservationForUser,
  getObservationImage,
  getOwnedObservationRow,
  listObservationsForUser,
};
