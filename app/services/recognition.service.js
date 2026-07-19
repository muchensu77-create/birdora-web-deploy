const fs = require("fs");
const path = require("path");

const jpeg = require("jpeg-js");
const ort = require("onnxruntime-node");

const MODEL_PATH = path.join(__dirname, "..", "..", "assets", "osea", "bird_model.onnx");
const LABELS_PATH = path.join(__dirname, "..", "..", "assets", "osea", "bird_info.json");
const OSEA_TOP_K = 5;
const OSEA_CONFIDENCE_THRESHOLD = 0.05;
const OSEA_EXPECTED_OUTPUT_COUNT = 11000;
const INPUT_SIZE = 224;
const MAX_SOURCE_RESOLUTION_MP = 24;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

let classifierPromise = null;
let labelsPromise = null;

function loadLabels() {
  if (!labelsPromise) {
    labelsPromise = fs.promises.readFile(LABELS_PATH, "utf8").then((content) => {
      const labels = JSON.parse(content);
      if (!Array.isArray(labels)) {
        throw new Error("bird label file is invalid");
      }
      return labels;
    });
  }

  return labelsPromise;
}

function getClassifier() {
  if (!classifierPromise) {
    classifierPromise = ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    }).catch((error) => {
      classifierPromise = null;
      throw error;
    });
  }

  return classifierPromise;
}

function normalizeOseaLabel(entry, index) {
  const [cn, en, latin] = Array.isArray(entry) ? entry : [];
  const isMapped = Boolean(cn || en || latin);

  return {
    index,
    cn: cn || `未映射 OSEA 输出标签 ${index + 1}`,
    en: en || "",
    latin: latin || "",
    isMapped,
  };
}

function insertTopCandidate(candidates, candidate, limit) {
  const insertAt = candidates.findIndex((item) => candidate.raw > item.raw);

  if (insertAt === -1) {
    candidates.push(candidate);
  } else {
    candidates.splice(insertAt, 0, candidate);
  }

  if (candidates.length > limit) {
    candidates.pop();
  }
}

function topOseaCandidates(logits, labels, limit = OSEA_TOP_K) {
  let maxLogit = -Infinity;
  for (let index = 0; index < logits.length; index += 1) {
    const raw = Number(logits[index]);
    if (Number.isFinite(raw) && raw > maxLogit) {
      maxLogit = raw;
    }
  }

  if (!Number.isFinite(maxLogit)) return [];

  let sumExp = 0;
  const candidates = [];
  for (let index = 0; index < logits.length; index += 1) {
    const raw = Number(logits[index]);
    if (!Number.isFinite(raw)) continue;

    const exp = Math.exp(raw - maxLogit);
    sumExp += exp;
    insertTopCandidate(candidates, {
      ...normalizeOseaLabel(labels[index], index),
      raw,
      exp,
    }, limit);
  }

  return candidates.map(({ raw, exp, ...candidate }) => ({
    ...candidate,
    probability: sumExp > 0 ? exp / sumExp : 0,
  }));
}

function sourcePixel(data, width, height, targetX, targetY) {
  const sourceX = Math.min(width - 1, Math.max(0, Math.round(((targetX + 0.5) * width) / INPUT_SIZE - 0.5)));
  const sourceY = Math.min(height - 1, Math.max(0, Math.round(((targetY + 0.5) * height) / INPUT_SIZE - 0.5)));
  return (sourceY * width + sourceX) * 4;
}

function imageBufferToTensor(buffer) {
  let image;
  try {
    image = jpeg.decode(buffer, {
      useTArray: true,
      maxMemoryUsageInMB: 256,
      maxResolutionInMP: MAX_SOURCE_RESOLUTION_MP,
    });
  } catch (error) {
    const wrapped = new Error("JPEG 图片解码失败，请换一张清晰的 JPG/PNG 截图后重试。");
    wrapped.cause = error;
    wrapped.statusCode = 400;
    throw wrapped;
  }

  if (!image?.width || !image?.height || !image.data?.length) {
    const error = new Error("JPEG 图片像素数据为空。");
    error.statusCode = 400;
    throw error;
  }

  const channelSize = INPUT_SIZE * INPUT_SIZE;
  const input = new Float32Array(3 * channelSize);

  for (let y = 0; y < INPUT_SIZE; y += 1) {
    for (let x = 0; x < INPUT_SIZE; x += 1) {
      const targetIndex = y * INPUT_SIZE + x;
      const sourceIndex = sourcePixel(image.data, image.width, image.height, x, y);
      input[targetIndex] = (image.data[sourceIndex] / 255 - MEAN[0]) / STD[0];
      input[channelSize + targetIndex] = (image.data[sourceIndex + 1] / 255 - MEAN[1]) / STD[1];
      input[channelSize * 2 + targetIndex] = (image.data[sourceIndex + 2] / 255 - MEAN[2]) / STD[2];
    }
  }

  return new ort.Tensor("float32", input, [1, 3, INPUT_SIZE, INPUT_SIZE]);
}

async function classifyJpegBuffer(buffer) {
  const [classifier, labels] = await Promise.all([getClassifier(), loadLabels()]);
  const tensor = imageBufferToTensor(buffer);
  const feeds = { [classifier.inputNames[0]]: tensor };
  const outputMap = await classifier.run(feeds);
  const output = outputMap[classifier.outputNames[0]];
  const candidates = topOseaCandidates(output.data, labels);
  const top = candidates[0] || null;

  return {
    candidates,
    outputCount: output.data.length || OSEA_EXPECTED_OUTPUT_COUNT,
    labelCount: labels.length,
    unmappedOutputCount: Math.max(0, (output.data.length || OSEA_EXPECTED_OUTPUT_COUNT) - labels.length),
    top,
    isConfident: Boolean(top && top.isMapped && top.probability >= OSEA_CONFIDENCE_THRESHOLD),
    source: "osea-server",
  };
}

module.exports = {
  classifyJpegBuffer,
};
