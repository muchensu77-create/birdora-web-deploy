const fs = require("fs");
const path = require("path");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const EXPECTED_COUNT = Number(process.env.BIRDORA_BROWSER_EXPECTED_COUNT || "50");
const RESULT_DIR =
  process.env.BIRDORA_BROWSER_RESULT_DIR ||
  path.join(PROJECT_ROOT, "docs", "browser-50-agent-results", process.env.BIRDORA_BROWSER_RUN_ID || "");
const REPORT_JSON_PATH =
  process.env.BIRDORA_BROWSER_REPORT_JSON ||
  path.join(PROJECT_ROOT, "docs", "browser-50-agent-flow-report.json");
const REPORT_MD_PATH =
  process.env.BIRDORA_BROWSER_REPORT_MD ||
  path.join(PROJECT_ROOT, "docs", "browser-50-agent-flow-report.md");

function percentile(values, p) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

function average(values) {
  const finite = values.filter((value) => Number.isFinite(value));
  if (!finite.length) return null;
  return Math.round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function summarizeDurations(values) {
  return {
    count: values.filter((value) => Number.isFinite(value)).length,
    avgMs: average(values),
    p50Ms: percentile(values, 50),
    p95Ms: percentile(values, 95),
    p99Ms: percentile(values, 99),
    maxMs: percentile(values, 100),
  };
}

function readResults() {
  if (!fs.existsSync(RESULT_DIR)) {
    throw new Error(`Result directory does not exist: ${RESULT_DIR}`);
  }

  return fs
    .readdirSync(RESULT_DIR)
    .filter((name) => /^agent-\d+\.json$/.test(name))
    .sort()
    .map((name) => {
      const filePath = path.join(RESULT_DIR, name);
      return {
        fileName: name,
        filePath,
        ...JSON.parse(fs.readFileSync(filePath, "utf8")),
      };
    });
}

function summarizePhase(results, phaseName) {
  const phaseResults = results.map((result) => result.phases?.[phaseName]).filter(Boolean);
  return {
    total: results.length,
    completed: phaseResults.length,
    passed: phaseResults.filter((phase) => phase.ok).length,
    failed: phaseResults.filter((phase) => !phase.ok).length,
    durations: summarizeDurations(phaseResults.map((phase) => phase.durationMs)),
  };
}

function summarizeResources(results) {
  const grouped = new Map();
  for (const result of results) {
    const resources = result.recognition?.resources || [];
    for (const resource of resources) {
      const values = grouped.get(resource.name) || [];
      values.push(resource.duration);
      grouped.set(resource.name, values);
    }
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, values]) => ({
      name,
      ...summarizeDurations(values),
    }));
}

function buildSummary(results) {
  const expectedLabels = Array.from({ length: EXPECTED_COUNT }, (_, index) => {
    return `agent-${String(index + 1).padStart(2, "0")}.json`;
  });
  const present = new Set(results.map((result) => result.fileName));
  const missing = expectedLabels.filter((name) => !present.has(name));
  const passed = results.filter((result) => result.ok);
  const failed = results.filter((result) => !result.ok);
  const recognitionResults = results.map((result) => result.recognition).filter(Boolean);
  const topLabels = new Map();

  for (const recognition of recognitionResults) {
    const top = recognition.classifyResult?.top || recognition.terminal?.result?.top;
    const label = top ? `${top.cn || ""} / ${top.en || ""}`.trim() : "(none)";
    topLabels.set(label, (topLabels.get(label) || 0) + 1);
  }

  const diagnostics = results.reduce(
    (acc, result) => {
      const next = result.diagnostics || {};
      acc.consoleErrors += (next.consoleErrors || []).length;
      acc.consoleWarnings += (next.consoleWarnings || []).length;
      acc.exceptions += (next.exceptions || []).length;
      acc.networkFailures += (next.networkFailures || []).length;
      acc.crashes += next.crashed ? 1 : 0;
      return acc;
    },
    {
      consoleErrors: 0,
      consoleWarnings: 0,
      exceptions: 0,
      networkFailures: 0,
      crashes: 0,
    }
  );

  return {
    generatedAt: new Date().toISOString(),
    resultDir: RESULT_DIR,
    expectedCount: EXPECTED_COUNT,
    observedCount: results.length,
    missing,
    passed: passed.length,
    failed: failed.length,
    allPassed: missing.length === 0 && passed.length === EXPECTED_COUNT && failed.length === 0,
    phases: {
      register: summarizePhase(results, "register"),
      logout: summarizePhase(results, "logout"),
      login: summarizePhase(results, "login"),
      publishPost: summarizePhase(results, "publishPost"),
      recognition: summarizePhase(results, "recognition"),
    },
    recognition: {
      statusCounts: recognitionResults.reduce((acc, recognition) => {
        const status = recognition.status || "missing";
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {}),
      durations: summarizeDurations(recognitionResults.map((recognition) => recognition.totalMs)),
      classifyDurations: summarizeDurations(recognitionResults.map((recognition) => recognition.classifyMs)),
      topLabels: Object.fromEntries(topLabels.entries()),
      resources: summarizeResources(results),
    },
    diagnostics,
    failures: failed.map((result) => ({
      label: result.label,
      fileName: result.fileName,
      error: result.error,
      failedPhases: Object.entries(result.phases || {})
        .filter(([, phase]) => !phase.ok)
        .map(([name, phase]) => ({
          name,
          error: phase.error,
          durationMs: phase.durationMs,
        })),
    })),
  };
}

function formatMs(value) {
  return Number.isFinite(value) ? `${value}ms` : "n/a";
}

function phaseRow(name, phase) {
  return `| ${name} | ${phase.passed}/${phase.total} | ${phase.failed} | ${formatMs(phase.durations.p50Ms)} | ${formatMs(phase.durations.p95Ms)} | ${formatMs(phase.durations.p99Ms)} | ${formatMs(phase.durations.maxMs)} |`;
}

function writeMarkdown(summary) {
  const lines = [
    "# Birdora 50 Sub-Agent Browser Flow Report",
    "",
    `- Generated at: ${summary.generatedAt}`,
    `- Expected sub-agents: ${summary.expectedCount}`,
    `- Observed result files: ${summary.observedCount}`,
    `- Passed: ${summary.passed}`,
    `- Failed: ${summary.failed}`,
    `- Missing: ${summary.missing.length}`,
    `- Overall: ${summary.allPassed ? "PASS" : "FAIL"}`,
    `- Result directory: \`${summary.resultDir}\``,
    "",
    "## Phase Summary",
    "",
    "| Phase | Passed | Failed | p50 | p95 | p99 | max |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    phaseRow("register", summary.phases.register),
    phaseRow("logout", summary.phases.logout),
    phaseRow("login", summary.phases.login),
    phaseRow("publishPost", summary.phases.publishPost),
    phaseRow("recognition", summary.phases.recognition),
    "",
    "## Recognition",
    "",
    `- Status counts: \`${JSON.stringify(summary.recognition.statusCounts)}\``,
    `- Total p95: ${formatMs(summary.recognition.durations.p95Ms)}`,
    `- Classify p95: ${formatMs(summary.recognition.classifyDurations.p95Ms)}`,
    `- Top labels: \`${JSON.stringify(summary.recognition.topLabels)}\``,
    "",
    "| Resource | Count | p50 | p95 | max |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...summary.recognition.resources.map((resource) => {
      return `| ${resource.name} | ${resource.count} | ${formatMs(resource.p50Ms)} | ${formatMs(resource.p95Ms)} | ${formatMs(resource.maxMs)} |`;
    }),
    "",
    "## Browser Diagnostics",
    "",
    `- Console errors: ${summary.diagnostics.consoleErrors}`,
    `- Console warnings: ${summary.diagnostics.consoleWarnings}`,
    `- Exceptions: ${summary.diagnostics.exceptions}`,
    `- Network failures: ${summary.diagnostics.networkFailures}`,
    `- Crashes: ${summary.diagnostics.crashes}`,
  ];

  if (summary.missing.length) {
    lines.push("", "## Missing Results", "", ...summary.missing.map((name) => `- ${name}`));
  }

  if (summary.failures.length) {
    lines.push("", "## Failures", "");
    for (const failure of summary.failures) {
      lines.push(`- ${failure.label}: ${failure.error || "unknown error"}`);
      for (const phase of failure.failedPhases) {
        lines.push(`  - ${phase.name}: ${phase.error || "unknown error"} (${formatMs(phase.durationMs)})`);
      }
    }
  }

  fs.mkdirSync(path.dirname(REPORT_MD_PATH), { recursive: true });
  fs.writeFileSync(REPORT_MD_PATH, `${lines.join("\n")}\n`);
}

function main() {
  const results = readResults();
  const summary = buildSummary(results);
  fs.mkdirSync(path.dirname(REPORT_JSON_PATH), { recursive: true });
  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`);
  writeMarkdown(summary);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.allPassed) {
    process.exitCode = 1;
  }
}

main();
