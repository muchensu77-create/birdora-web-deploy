const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function count(source, pattern) {
  return Array.from(source.matchAll(pattern)).length;
}

function check(label, callback) {
  callback();
  console.log(`PASS ${label}`);
}

check("missing-account login uses the configured-cost dummy password hash", () => {
  const source = read("app/controllers/auth.controller.js");
  assert.match(source, /DUMMY_PASSWORD_HASHES\[authConfig\.passwordHashCost\]/);
  assert.match(source, /verifyPassword\(password,\s*user\?\.passwordHash\s*\|\|\s*DUMMY_PASSWORD_HASH\)/);
  assert.match(source, /if\s*\(!user\s*\|\|\s*!passwordMatches\)/);
});

check("all rate limiters return a stable error code", () => {
  for (const relativePath of [
    "app/routes/auth.routes.js",
    "app/routes/community-post.routes.js",
    "app/routes/draft.routes.js",
    "app/routes/moderation.routes.js",
    "app/routes/notification.routes.js",
    "app/routes/observation.routes.js",
    "app/routes/recognition.routes.js",
    "app/routes/social.routes.js",
  ]) {
    const source = read(relativePath);
    assert.equal(
      count(source, /rateLimit\s*\(/g),
      count(source, /code:\s*["']RATE_LIMITED["']/g),
      `${relativePath} has a rate limiter without RATE_LIMITED`
    );
  }
});

check("error logs redact media, credentials, avatars, and precise location", () => {
  const source = read("server.js");
  for (const marker of ["data:(?:image|video)", "videoDataUrl", "avatarUrl", "location"]) {
    assert.ok(source.includes(marker), `server log sanitizer is missing ${marker}`);
  }
  assert.match(source, /statusCode\s*>=\s*500\s*\?\s*["']INTERNAL_ERROR["']\s*:\s*["']REQUEST_ERROR["']/);
});

check("recognition inference is protected by a bounded queue and source pixel limit", () => {
  const controller = read("app/controllers/recognition.controller.js");
  const queue = read("app/services/recognition-work-queue.js");
  const service = read("app/services/recognition.service.js");
  assert.match(controller, /runRecognitionTask\(\(\)\s*=>\s*recognitionService\.classifyJpegBuffer/);
  assert.match(queue, /RECOGNITION_BUSY/);
  assert.match(queue, /RECOGNITION_QUEUE_TIMEOUT/);
  assert.match(service, /MAX_SOURCE_RESOLUTION_MP\s*=\s*24/);
  assert.match(service, /maxResolutionInMP:\s*MAX_SOURCE_RESOLUTION_MP/);
});

console.log("Security contracts passed.");
