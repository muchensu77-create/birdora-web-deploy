const observationService = require("../services/observation.service");

const SPECIES_NAME_MAX_LENGTH = 120;
const SCIENTIFIC_NAME_MAX_LENGTH = 160;
const LOCATION_MAX_LENGTH = 160;
const NOTES_MAX_LENGTH = 600;
const SOURCE_MAX_LENGTH = 60;
const OBSERVATION_IMAGE_MAX_BYTES = 1024 * 1024;
const OBSERVATIONS_DEFAULT_LIMIT = 20;
const OBSERVATIONS_MAX_LIMIT = 100;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function normalizeRequiredText(value, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function normalizeOptionalText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? null : text;
}

function normalizeNumber(value, fallback, max = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(max, Math.trunc(number)));
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

function validateObservationImage(req, res) {
  const imageDataUrl = String(req.body.imageDataUrl || "").trim();
  if (!imageDataUrl) {
    res.status(400).json({ message: "imageDataUrl is required" });
    return false;
  }

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
  if (!buffer.length || buffer.length > OBSERVATION_IMAGE_MAX_BYTES) {
    res.status(400).json({ message: `image must be smaller than ${OBSERVATION_IMAGE_MAX_BYTES} bytes` });
    return false;
  }

  if (!imageMatchesMimeType(buffer, mimeType)) {
    res.status(400).json({ message: "imageDataUrl content does not match image type" });
    return false;
  }

  return {
    buffer,
    mimeType,
    originalName: String(req.body.imageName || "observation-image").trim().slice(0, 120),
  };
}

function validateTopCandidates(value) {
  if (!Array.isArray(value) || !value.length || value.length > 5) return null;

  const normalized = value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return null;
    const speciesName = normalizeRequiredText(
      candidate.speciesName || candidate.cn || candidate.name,
      SPECIES_NAME_MAX_LENGTH
    );
    if (!speciesName) return null;

    const probability = Number(candidate.probability ?? candidate.confidence ?? 0);
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) return null;

    const rank = normalizeNumber(candidate.rank, index + 1, 5) || index + 1;
    const scientificName = normalizeOptionalText(
      candidate.scientificName || candidate.latin || "",
      SCIENTIFIC_NAME_MAX_LENGTH
    );
    const englishName = normalizeOptionalText(candidate.englishName || candidate.en || "", SPECIES_NAME_MAX_LENGTH);

    if (scientificName === null || englishName === null) return null;

    return {
      rank,
      speciesName,
      scientificName,
      englishName,
      probability,
      oseaIndex: Number.isInteger(Number(candidate.oseaIndex ?? candidate.index))
        ? Number(candidate.oseaIndex ?? candidate.index)
        : null,
      isMapped: Boolean(candidate.isMapped),
    };
  });

  return normalized.every(Boolean) ? normalized : null;
}

function validateObservedAt(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function validateCreateBody(req, res) {
  const selectedSpeciesName = normalizeRequiredText(req.body.selectedSpeciesName, SPECIES_NAME_MAX_LENGTH);
  const selectedSpeciesScientificName = normalizeOptionalText(
    req.body.selectedSpeciesScientificName,
    SCIENTIFIC_NAME_MAX_LENGTH
  );
  const locationText = normalizeOptionalText(req.body.locationText, LOCATION_MAX_LENGTH);
  const notes = normalizeOptionalText(req.body.notes, NOTES_MAX_LENGTH);
  const source = normalizeOptionalText(req.body.source || "osea-browser", SOURCE_MAX_LENGTH);
  const confidence = Number(req.body.confidence);
  const topCandidates = validateTopCandidates(req.body.topCandidates);
  const observedAt = validateObservedAt(req.body.observedAt);
  const image = validateObservationImage(req, res);

  if (image === false) return null;

  if (
    !selectedSpeciesName ||
    selectedSpeciesScientificName === null ||
    locationText === null ||
    notes === null ||
    source === null ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1 ||
    !topCandidates ||
    observedAt === null
  ) {
    res.status(400).json({
      message:
        "selectedSpeciesName, confidence, topCandidates, observedAt, and optional text fields must be valid",
    });
    return null;
  }

  return {
    selectedSpeciesName,
    selectedSpeciesScientificName,
    confidence,
    topCandidates,
    locationText,
    notes,
    source,
    observedAt,
    image,
  };
}

async function create(req, res) {
  const body = validateCreateBody(req, res);
  if (!body) return;

  const observation = await observationService.createObservation({
    userId: req.user.id,
    ...body,
  });

  res.status(201).json({ observation });
}

async function listMine(req, res) {
  const result = await observationService.listObservationsForUser({
    userId: req.user.id,
    limit: normalizeNumber(req.query.limit, OBSERVATIONS_DEFAULT_LIMIT, OBSERVATIONS_MAX_LIMIT),
    offset: normalizeNumber(req.query.offset, 0),
  });

  res.json(result);
}

async function get(req, res) {
  const observation = await observationService.getObservation({
    id: req.params.id,
    userId: req.user.id,
  });

  res.json({ observation });
}

async function image(req, res) {
  const observationImage = await observationService.getObservationImage({
    id: req.params.id,
    userId: req.user.id,
  });

  res.set("Content-Type", observationImage.mimeType);
  res.set("Cache-Control", "private, max-age=3600");
  res.sendFile(observationImage.filePath);
}

async function remove(req, res) {
  await observationService.deleteObservation({
    id: req.params.id,
    userId: req.user.id,
  });

  res.status(204).end();
}

module.exports = {
  create,
  get,
  image,
  listMine,
  remove,
};
