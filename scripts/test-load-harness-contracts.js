const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

const harness = read("scripts/browser-50-agent-harness.ps1");
const peak = read("scripts/test-peak.js");
const browserWorker = read("scripts/test-browser-user-flow-worker.js");
const summarizer = read("scripts/summarize-browser-agent-results.js");
const browserRunner = read("scripts/run-browser-50-page-flow.js");

assert.match(harness, /HttpClientHandler/);
assert.match(harness, /UseProxy\s*=\s*\$false/);
assert.doesNotMatch(harness, /Invoke-WebRequest/);

assert.match(peak, /\/api\/v1\/drafts/);
assert.match(peak, /\/publish/);
assert.ok(peak.includes("/api/v1/posts/${encodeURIComponent(targetPost.id)}/like"));
assert.doesNotMatch(peak, /pathname:\s*["']\/api\/community\/posts["']/);

assert.match(browserWorker, /register\.html/);
assert.match(browserWorker, /explore\.html/);
assert.match(browserWorker, /upload\.html/);
assert.match(browserWorker, /\/api\/v1\/drafts/);
assert.match(browserWorker, /data-detail-comment-input/);
assert.match(browserWorker, /observationSaveRefresh/);
assert.match(browserWorker, /commentUi/);
assert.match(browserWorker, /--no-proxy-server/);
assert.match(browserWorker, /Refusing non-local target/);

assert.match(summarizer, /diagnosticsClean/);
assert.match(summarizer, /observationSaveRefresh/);
assert.match(summarizer, /commentUi/);
assert.match(browserRunner, /BIRDORA_BROWSER_MAX_CONCURRENCY/);
assert.match(browserRunner, /maxConcurrency/);

console.log("load harness contracts: PASS");
