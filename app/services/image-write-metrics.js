const fs = require("fs");
const path = require("path");

function recordImageWriteMetric(metric) {
  const metricsFile = process.env.IMAGE_WRITE_METRICS_FILE;
  if (!metricsFile) return;

  const payload = {
    timestamp: new Date().toISOString(),
    runId: process.env.LOAD_TEST_RUN_ID || process.env.RUN_ID || "",
    ...metric,
  };

  try {
    fs.mkdirSync(path.dirname(metricsFile), { recursive: true });
    fs.appendFileSync(metricsFile, `${JSON.stringify(payload)}\n`);
  } catch {
    // Metrics are best-effort and must never affect user uploads.
  }
}

module.exports = {
  recordImageWriteMetric,
};
