const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const TEST_ORIGIN = "http://127.0.0.1:4174";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("Could not allocate a local port."));
      });
    });
    server.on("error", reject);
  });
}

function requestJson(baseUrl, pathname, options = {}) {
  const url = new URL(pathname, baseUrl);
  const body = options.body ? JSON.stringify(options.body) : "";

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: options.method || "GET",
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
          ...(options.origin ? { Origin: options.origin } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString("utf8");
          let data = null;
          try {
            data = raw ? JSON.parse(raw) : null;
          } catch {
            data = raw;
          }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30000;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const response = await requestJson(baseUrl, "/api/health");
      if (response.status === 200 && response.data?.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw lastError || new Error("API health check timed out.");
}

function makeSampleImageDataUrl() {
  const imagePath = path.join(PROJECT_ROOT, "assets", "birds", "kingfisher.jpg");
  return `data:image/jpeg;base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

async function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-recognition-server-"));
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_FILE: path.join(tempDir, "birdora-recognition.sqlite"),
      COMMUNITY_UPLOAD_DIR: path.join(tempDir, "community-uploads"),
      OBSERVATION_UPLOAD_DIR: path.join(tempDir, "observation-uploads"),
      JWT_SECRET: "recognition-server-local-secret-with-more-than-32-chars",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));

  try {
    await waitForHealth(baseUrl);

    const blocked = await requestJson(baseUrl, "/api/recognition/classify", {
      method: "POST",
      body: { imageDataUrl: makeSampleImageDataUrl(), imageName: "kingfisher.jpg" },
    });
    if (blocked.status !== 403) {
      throw new Error(`origin guard should reject missing Origin POST, got HTTP ${blocked.status}`);
    }

    const response = await requestJson(baseUrl, "/api/recognition/classify", {
      method: "POST",
      origin: TEST_ORIGIN,
      body: { imageDataUrl: makeSampleImageDataUrl(), imageName: "kingfisher.jpg" },
    });

    if (response.status !== 200) {
      throw new Error(`recognition classify failed: HTTP ${response.status} ${JSON.stringify(response.data)}`);
    }

    const result = response.data?.result;
    if (!result?.top || result.top.cn !== "普通翠鸟" || result.top.en !== "Common Kingfisher") {
      throw new Error(`unexpected Top 1: ${JSON.stringify(result?.top)}`);
    }

    if (!result.isConfident || result.candidates?.length !== 5 || result.outputCount !== 11000) {
      throw new Error(`unexpected recognition result shape: ${JSON.stringify(result)}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          top: result.top,
          candidates: result.candidates.length,
          outputCount: result.outputCount,
          labelCount: result.labelCount,
          source: result.source,
          tempDir,
        },
        null,
        2
      )
    );
  } finally {
    if (child.exitCode === null) {
      const closed = new Promise((resolve) => child.once("close", resolve));
      child.kill();
      await Promise.race([
        closed,
        new Promise((resolve) => setTimeout(resolve, 10_000)),
      ]);
    }
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(`Recognition server test failed: ${error.message}`);
  process.exit(1);
});
