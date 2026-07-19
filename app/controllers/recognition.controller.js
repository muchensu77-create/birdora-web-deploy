const recognitionService = require("../services/recognition.service");
const { runRecognitionTask } = require("../services/recognition-work-queue");

const RECOGNITION_IMAGE_MAX_BYTES = 1024 * 1024;
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];

function hasBytePrefix(buffer, bytes) {
  return buffer.length >= bytes.length && bytes.every((byte, index) => buffer[index] === byte);
}

function validateRecognitionImage(req, res) {
  const imageDataUrl = String(req.body.imageDataUrl || "").trim();
  if (!imageDataUrl) {
    res.status(400).json({ message: "imageDataUrl is required" });
    return null;
  }

  const match = imageDataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  if (!match) {
    res.status(400).json({ message: "imageDataUrl must be a jpeg data URL" });
    return null;
  }

  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > RECOGNITION_IMAGE_MAX_BYTES) {
    res.status(400).json({ message: `image must be smaller than ${RECOGNITION_IMAGE_MAX_BYTES} bytes` });
    return null;
  }

  if (!hasBytePrefix(buffer, JPEG_SIGNATURE)) {
    res.status(400).json({ message: "imageDataUrl content does not match image/jpeg" });
    return null;
  }

  return buffer;
}

async function classify(req, res) {
  const imageBuffer = validateRecognitionImage(req, res);
  if (!imageBuffer) return;

  const result = await runRecognitionTask(() => recognitionService.classifyJpegBuffer(imageBuffer));
  res.json({ result });
}

module.exports = {
  classify,
};
