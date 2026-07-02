const DEFAULT_SITE_URL = "https://birdora.birdai-glasses.com";
const DEFAULT_NEIGHBOR_URL = "https://jewelry-api.birdai-glasses.com";

const SITE_URL = (process.env.PROD_SITE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");
const NEIGHBOR_URL = (process.env.NEIGHBOR_HEALTH_URL || DEFAULT_NEIGHBOR_URL).replace(/\/$/, "");

const checks = [
  { label: "site home", url: `${SITE_URL}/`, expect: 200 },
  {
    label: "site favicon",
    url: `${SITE_URL}/assets/favicon.svg`,
    expect: 200,
    minBytes: 200,
    contentTypeIncludes: "image/svg+xml",
  },
  { label: "api health", url: `${SITE_URL}/api/health`, expect: 200, bodyIncludes: "birdora-auth-api" },
  { label: "server source hidden", url: `${SITE_URL}/server.js`, expect: 404 },
  { label: "sqlite hidden", url: `${SITE_URL}/app/data/birdora.sqlite`, expect: 404 },
  { label: "env hidden", url: `${SITE_URL}/.env`, expect: 404 },
  { label: "osea model reachable", url: `${SITE_URL}/assets/osea/bird_model.onnx`, expect: 200, minBytes: 1000000 },
  {
    label: "ort wasm module reachable",
    url: `${SITE_URL}/assets/vendor/ort-wasm-simd-threaded.mjs`,
    expect: 200,
    minBytes: 10000,
    contentTypeIncludes: "application/javascript",
    cacheControlIncludes: "no-store",
    headerAbsent: "etag",
  },
  {
    label: "ort wasm module stale cache bypassed",
    url: `${SITE_URL}/assets/vendor/ort-wasm-simd-threaded.mjs`,
    expect: 200,
    minBytes: 10000,
    contentTypeIncludes: "application/javascript",
    cacheControlIncludes: "no-store",
    headerAbsent: "etag",
    requestHeaders: {
      "If-Modified-Since": "Wed, 31 Dec 2099 23:59:59 GMT",
    },
  },
  {
    label: "ort wasm reachable",
    url: `${SITE_URL}/assets/vendor/ort-wasm-simd-threaded.wasm`,
    expect: 200,
    minBytes: 1000000,
    contentTypeIncludes: "application/wasm",
  },
  { label: "neighbor service", url: NEIGHBOR_URL, expect: 200 },
];

async function runCheck(check) {
  const response = await fetch(check.url, {
    method: "GET",
    redirect: "manual",
    headers: check.requestHeaders || {},
  });
  const raw = await response.arrayBuffer();
  const text = Buffer.from(raw).toString("utf8", 0, Math.min(raw.byteLength, 512));

  if (response.status !== check.expect) {
    throw new Error(`${check.label} expected HTTP ${check.expect}, got ${response.status}`);
  }

  if (check.bodyIncludes && !text.includes(check.bodyIncludes)) {
    throw new Error(`${check.label} response did not include ${check.bodyIncludes}`);
  }

  if (check.minBytes && raw.byteLength < check.minBytes) {
    throw new Error(`${check.label} response too small: ${raw.byteLength} bytes`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (check.contentTypeIncludes && !contentType.toLowerCase().includes(check.contentTypeIncludes.toLowerCase())) {
    throw new Error(`${check.label} expected Content-Type containing ${check.contentTypeIncludes}, got ${contentType || "(missing)"}`);
  }

  const cacheControl = response.headers.get("cache-control") || "";
  if (check.cacheControlIncludes && !cacheControl.toLowerCase().includes(check.cacheControlIncludes.toLowerCase())) {
    throw new Error(`${check.label} expected Cache-Control containing ${check.cacheControlIncludes}, got ${cacheControl || "(missing)"}`);
  }

  if (check.headerAbsent && response.headers.has(check.headerAbsent)) {
    throw new Error(`${check.label} expected response header ${check.headerAbsent} to be absent`);
  }

  return {
    label: check.label,
    status: response.status,
    bytes: raw.byteLength,
    cacheControl,
    contentType,
  };
}

async function main() {
  console.log(`Production readonly target: ${SITE_URL}`);
  const results = [];

  for (const check of checks) {
    const result = await runCheck(check);
    results.push(result);
    console.log(`${result.label}: PASS (HTTP ${result.status}, ${result.bytes} bytes, ${result.contentType || "no content type"})`);
  }

  console.log("Production readonly result: PASS");
}

main().catch((error) => {
  console.error("\nProduction readonly check failed.");
  console.error(error.message);
  process.exitCode = 1;
});
