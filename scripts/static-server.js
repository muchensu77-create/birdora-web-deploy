const fs = require("fs");
const http = require("http");
const path = require("path");

const port = Number(process.env.PUBLIC_PORT) || 4174;
const host = process.env.PUBLIC_HOST || "127.0.0.1";
const publicDir = path.resolve(__dirname, "..", "public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".mjs": "application/javascript; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
}

function resolvePublicPath(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }

  const normalizedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.resolve(publicDir, `.${normalizedPath}`);

  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== publicDir) {
    return null;
  }

  return filePath;
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    send(res, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
    return;
  }

  const filePath = resolvePublicPath(req.url || "/");
  if (!filePath) {
    send(res, 403, "Forbidden");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    send(res, 404, "Not Found");
    return;
  }

  if (!stat.isFile()) {
    send(res, 404, "Not Found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": contentTypes[extension] || "application/octet-stream",
    "Content-Length": stat.size,
    "X-Content-Type-Options": "nosniff",
  };

  if (extension === ".json") {
    headers["Cache-Control"] = "no-cache";
  } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  } else {
    headers["Cache-Control"] = "no-cache";
  }

  if (req.method === "HEAD") {
    send(res, 200, "", headers);
    return;
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Birdora public site listening on http://${host}:${port}`);
  console.log(`Static root: ${publicDir}`);
});
