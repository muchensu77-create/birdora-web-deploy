const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const HEADLESS = process.env.E2E_HEADLESS !== "0";
const CHROME_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 45000);
const RECOGNITION_TIMEOUT_MS = Number(process.env.BIRD_RECOGNITION_TIMEOUT_MS || 90000);
const WEB_BASE_URL_ENV = (process.env.WEB_BASE_URL || "").replace(/\/$/, "");
const API_BASE_URL_ENV = (process.env.E2E_API_BASE_URL || "").replace(/\/$/, "");
const SAMPLE_IMAGE_URL = process.env.BIRD_RECOGNITION_SAMPLE_URL || "./assets/birds/kingfisher.jpg";
const DESKTOP_RAMPS = parseRampList(process.env.BIRD_RECOGNITION_RAMPS ?? "1,5,10,20");
const MOBILE_RAMPS = parseRampList(process.env.BIRD_RECOGNITION_MOBILE_RAMPS ?? "5");
const REPORT_JSON_PATH = process.env.BIRD_RECOGNITION_REPORT_JSON || "";

const DESKTOP_VIEWPORT = {
  name: "desktop-1366x768",
  width: 1366,
  height: 768,
  deviceScaleFactor: 1,
  mobile: false,
};
const MOBILE_VIEWPORT = {
  name: "mobile-390x844",
  width: 390,
  height: 844,
  deviceScaleFactor: 3,
  mobile: true,
  userAgent:
    process.env.BIRD_RECOGNITION_MOBILE_UA ||
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
};

function parseRampList(value) {
  return String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isInteger(item) && item > 0);
}

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

function summarizeDurations(results) {
  const completed = results.filter((result) => result && !result.error);
  const durations = completed
    .filter((result) => result.status === "success" || result.status === "unknown")
    .map((result) => result.totalMs);
  const classifyDurations = completed
    .filter((result) => result.status === "success" || result.status === "unknown")
    .map((result) => result.classifyMs);

  return {
    total: results.length,
    completed: durations.length,
    failed: results.length - durations.length,
    avgMs: average(durations),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    maxMs: percentile(durations, 100),
    classifyAvgMs: average(classifyDurations),
    classifyP95Ms: percentile(classifyDurations, 95),
  };
}

function assertLocalUrl(value, label) {
  if (!value) return;
  const url = new URL(value);
  const isLocal =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (!isLocal) {
    throw new Error(`${label} must be local for recognition ramp testing: ${value}`);
  }
}

function findChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return process.platform === "win32" ? null : "google-chrome";
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("could not allocate a free port"));
      });
    });
    server.on("error", reject);
  });
}

function waitForHttp(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      http
        .get(url, (res) => {
          res.resume();
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
            return;
          }
          retry(new Error(`HTTP ${res.statusCode}`));
        })
        .on("error", retry);
    }

    function retry(error) {
      if (Date.now() >= deadline) {
        reject(error);
        return;
      }
      setTimeout(attempt, 250);
    }

    attempt();
  });
}

function waitForJson(url, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function attempt() {
      http
        .get(url, (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            raw += chunk;
          });
          res.on("end", () => {
            try {
              resolve(JSON.parse(raw));
            } catch (error) {
              retry(error);
            }
          });
        })
        .on("error", retry);
    }

    function retry(error) {
      if (Date.now() >= deadline) {
        reject(error);
        return;
      }
      setTimeout(attempt, 250);
    }

    attempt();
  });
}

function collectOutput(child) {
  const chunks = [];
  const addChunk = (chunk) => {
    chunks.push(String(chunk));
    if (chunks.length > 50) chunks.shift();
  };
  child.stdout?.on("data", addChunk);
  child.stderr?.on("data", addChunk);
  return () => chunks.join("");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 2500);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function startApiServer(webBaseUrl) {
  const port = await getFreePort();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-recognition-ramp-api-"));
  const databaseFile = path.join(tempDir, "ramp.sqlite");
  const apiBaseUrl = `http://127.0.0.1:${port}`;
  const api = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      CORS_ORIGIN: webBaseUrl,
      DATABASE_FILE: databaseFile,
      COMMUNITY_UPLOAD_DIR: path.join(tempDir, "community-uploads"),
      OBSERVATION_UPLOAD_DIR: path.join(tempDir, "observation-uploads"),
      JWT_SECRET: "recognition-ramp-local-secret-with-more-than-32-characters",
      AUTH_RATE_LIMIT: "10000",
      COMMUNITY_WRITE_RATE_LIMIT: "10000",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const getOutput = collectOutput(api);

  try {
    await waitForHttp(`${apiBaseUrl}/api/health`, 15000);
  } catch (error) {
    await stopProcess(api);
    throw new Error(`API server did not start: ${error.message}\n${getOutput()}`);
  }

  return { api, apiBaseUrl, tempDir };
}

async function startWebServer() {
  const port = await getFreePort();
  const webBaseUrl = `http://127.0.0.1:${port}`;
  const web = spawn(process.execPath, ["scripts/static-server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      PUBLIC_HOST: "127.0.0.1",
      PUBLIC_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const getOutput = collectOutput(web);

  try {
    await waitForHttp(`${webBaseUrl}/index.html`, 15000);
  } catch (error) {
    await stopProcess(web);
    throw new Error(`Static server did not start: ${error.message}\n${getOutput()}`);
  }

  return { web, webBaseUrl };
}

async function createCdpTab(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new`, { method: "PUT" });
  if (!response.ok) {
    throw new Error(`could not create Chrome tab: HTTP ${response.status}`);
  }
  return response.json();
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 0;
  const pending = new Map();
  const eventWaiters = new Map();
  const eventHandlers = new Map();

  function rejectPending(error) {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  }

  function emitEvent(message) {
    const handlers = eventHandlers.get(message.method) || [];
    for (const handler of handlers) {
      try {
        handler(message.params || {}, message);
      } catch {
        // Event handlers are diagnostics only.
      }
    }

    const waiters = eventWaiters.get(message.method);
    if (!waiters || !waiters.length) return;
    const waiter = waiters.shift();
    clearTimeout(waiter.timer);
    waiter.resolve(message);
  }

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(JSON.stringify(message.error)));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    if (message.method) emitEvent(message);
  });

  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          const id = ++nextId;
          socket.send(JSON.stringify({ id, method, params }));
          return new Promise((resolve, reject) => {
            pending.set(id, { resolve, reject });
          });
        },
        waitForEvent(method, timeoutMs = 10000) {
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              const waiters = eventWaiters.get(method) || [];
              const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
              if (index >= 0) waiters.splice(index, 1);
              reject(new Error(`timed out waiting for ${method}`));
            }, timeoutMs);
            const waiters = eventWaiters.get(method) || [];
            waiters.push({ resolve, reject, timer });
            eventWaiters.set(method, waiters);
          });
        },
        on(method, handler) {
          const handlers = eventHandlers.get(method) || [];
          handlers.push(handler);
          eventHandlers.set(method, handlers);
          return () => {
            const nextHandlers = eventHandlers.get(method) || [];
            const index = nextHandlers.indexOf(handler);
            if (index >= 0) nextHandlers.splice(index, 1);
          };
        },
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", reject);
    socket.addEventListener("close", () => {
      rejectPending(new Error("CDP socket closed"));
    });
  });
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}

async function evaluate(cdp, expression, label = "evaluation", timeoutMs = 10000) {
  const result = await withTimeout(
    cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      returnByValue: true,
      expression,
    }),
    timeoutMs,
    label
  );

  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
    throw new Error(`${label} failed: ${text || "runtime exception"}`);
  }

  return result.result?.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, expression, label, 5000);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(lastValue)}`);
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitForEvent("Page.loadEventFired", 20000).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

function pageScript(fn, ...args) {
  return `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function collectTabDiagnostics(cdp, label) {
  const diagnostics = {
    label,
    consoleErrors: [],
    consoleWarnings: [],
    exceptions: [],
    networkFailures: [],
    crashed: false,
  };

  const readRemoteValue = (arg) => {
    if (Object.prototype.hasOwnProperty.call(arg, "value")) return String(arg.value);
    return arg.description || arg.unserializableValue || arg.type || "";
  };

  cdp.on("Runtime.consoleAPICalled", (params) => {
    const message = (params.args || []).map(readRemoteValue).join(" ");
    if (params.type === "error") {
      diagnostics.consoleErrors.push(message);
    } else if (params.type === "warning") {
      diagnostics.consoleWarnings.push(message);
    }
  });

  cdp.on("Runtime.exceptionThrown", (params) => {
    diagnostics.exceptions.push(
      params.exceptionDetails?.exception?.description ||
        params.exceptionDetails?.text ||
        "runtime exception"
    );
  });

  cdp.on("Log.entryAdded", (params) => {
    const entry = params.entry || {};
    if (entry.level === "error") {
      diagnostics.consoleErrors.push(entry.text || "log error");
    } else if (entry.level === "warning") {
      diagnostics.consoleWarnings.push(entry.text || "log warning");
    }
  });

  cdp.on("Network.loadingFailed", (params) => {
    if (params.canceled) return;
    diagnostics.networkFailures.push({
      requestId: params.requestId,
      errorText: params.errorText,
      blockedReason: params.blockedReason || "",
      type: params.type || "",
    });
  });

  cdp.on("Inspector.targetCrashed", () => {
    diagnostics.crashed = true;
  });

  return diagnostics;
}

async function setupClient({
  browserPort,
  webBaseUrl,
  apiBaseUrl,
  viewport,
  scenarioId,
  index,
}) {
  const tab = await createCdpTab(browserPort);
  const cdp = await connectCdp(tab.webSocketDebuggerUrl);
  const label = `${scenarioId}-tab-${index + 1}`;
  const diagnostics = collectTabDiagnostics(cdp, label);

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.enable");
  await cdp.send("Log.enable").catch(() => null);
  await cdp.send("Inspector.enable").catch(() => null);
  await cdp.send("Performance.enable").catch(() => null);

  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.deviceScaleFactor,
    mobile: viewport.mobile,
  });

  if (viewport.userAgent) {
    await cdp.send("Emulation.setUserAgentOverride", { userAgent: viewport.userAgent });
  }

  if (apiBaseUrl) {
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source:
        `Object.defineProperty(window, "BIRDORA_API_BASE_URL", ` +
        `{ value: ${JSON.stringify(apiBaseUrl)}, configurable: true });`,
    });
  }

  const url = `${webBaseUrl}/index.html?recognitionRamp=${encodeURIComponent(label)}`;
  await navigate(cdp, url);
  await waitFor(
    cdp,
    `Boolean(document.querySelector("#birdUpload")) && typeof window.classifyImageElement === "function"`,
    `${label} recognition UI ready`,
    25000
  );
  await evaluate(cdp, pageScript(installRecognitionProbe), `${label} install recognition probe`);

  return { cdp, diagnostics, label };
}

function installRecognitionProbe() {
  if (window.__birdoraRecognitionRampProbe?.installed) {
    return true;
  }

  const probe = {
    installed: true,
    runs: [],
    pageErrors: [],
    activeRun: null,
  };
  window.__birdoraRecognitionRampProbe = probe;

  const summarizeCandidate = (candidate) => {
    if (!candidate) return null;
    return {
      index: candidate.index,
      cn: candidate.cn || candidate.name || "",
      en: candidate.en || "",
      latin: candidate.latin || "",
      probability: Number(candidate.probability || 0),
      isMapped: Boolean(candidate.isMapped),
      hasAtlasBird: Boolean(candidate.atlasBird),
    };
  };

  const summarizeResult = (result) => {
    if (!result) return null;
    return {
      top: summarizeCandidate(result.top),
      outputCount: result.outputCount || null,
      labelCount: result.labelCount || null,
      unmappedOutputCount: result.unmappedOutputCount || 0,
      isConfident: Boolean(result.isConfident),
      candidates: Array.isArray(result.candidates)
        ? result.candidates.map(summarizeCandidate)
        : [],
    };
  };

  const activeRun = () => probe.activeRun;

  const wrapAsync = (name, before, after) => {
    const original = window[name];
    if (typeof original !== "function" || original.__birdoraRampWrapped) return;

    const wrapped = async function wrappedRampFunction(...args) {
      const run = activeRun();
      before?.(run);
      try {
        const value = await original.apply(this, args);
        after?.(run, value, null);
        return value;
      } catch (error) {
        after?.(run, null, error);
        throw error;
      }
    };
    wrapped.__birdoraRampWrapped = true;
    window[name] = wrapped;
  };

  const wrapSync = (name, handler) => {
    const original = window[name];
    if (typeof original !== "function" || original.__birdoraRampWrapped) return;

    const wrapped = function wrappedRampFunction(...args) {
      handler?.(activeRun(), args);
      return original.apply(this, args);
    };
    wrapped.__birdoraRampWrapped = true;
    window[name] = wrapped;
  };

  wrapSync("setPendingResult", (run, args) => {
    if (!run) return;
    run.events.push({
      type: "pending",
      t: performance.now(),
      text: String(args[0] || ""),
    });
  });

  wrapSync("setCandidateResult", (run, args) => {
    if (!run) return;
    run.terminal = {
      status: "success",
      t: performance.now(),
      result: summarizeResult(args[0]),
    };
  });

  wrapSync("setUnknownResult", (run, args) => {
    if (!run) return;
    run.terminal = {
      status: "unknown",
      t: performance.now(),
      message: String(args[0] || ""),
      candidates: Array.isArray(args[1]) ? args[1].map(summarizeCandidate) : [],
    };
  });

  wrapAsync(
    "classifyImageElement",
    (run) => {
      if (!run) return;
      run.classifyStart = performance.now();
    },
    (run, result, error) => {
      if (!run) return;
      run.classifyEnd = performance.now();
      if (error) {
        run.classifyError = error.message || String(error);
      } else {
        run.classifyResult = summarizeResult(result);
      }
    }
  );

  wrapAsync(
    "getClassifier",
    (run) => {
      if (!run) return;
      run.classifierStart = performance.now();
    },
    (run, value, error) => {
      if (!run) return;
      run.classifierEnd = performance.now();
      if (error) run.classifierError = error.message || String(error);
    }
  );

  wrapAsync(
    "getBirdInfo",
    (run) => {
      if (!run) return;
      run.labelStart = performance.now();
    },
    (run, value, error) => {
      if (!run) return;
      run.labelEnd = performance.now();
      if (error) run.labelError = error.message || String(error);
    }
  );

  window.addEventListener("error", (event) => {
    probe.pageErrors.push(event.message || "window error");
  });
  window.addEventListener("unhandledrejection", (event) => {
    probe.pageErrors.push(event.reason?.message || String(event.reason || "unhandled rejection"));
  });

  return true;
}

function runRecognitionInPage(sampleImageUrl, label, timeoutMs) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const probe = window.__birdoraRecognitionRampProbe;
  if (!probe?.installed) {
    throw new Error("recognition probe is not installed");
  }

  const input = document.querySelector("#birdUpload");
  if (!input) {
    throw new Error("bird upload input was not found");
  }

  const summarizeDom = () => {
    const candidateRows = Array.from(document.querySelectorAll("#candidateList li"));
    return {
      resultName: document.querySelector("#resultName")?.textContent.trim() || "",
      resultMeta: document.querySelector("#resultMeta")?.textContent.trim() || "",
      modelDetail: document.querySelector("#modelDetail")?.textContent.trim() || "",
      candidateText: candidateRows.map((row) => row.textContent.trim()).slice(0, 5),
      saveDisabled: Boolean(document.querySelector("#saveObservation")?.disabled),
      previewLoaded: Boolean(document.querySelector("#previewImage")?.getAttribute("src")),
    };
  };

  const resourceSummary = () => {
    const wanted = ["bird_model.onnx", "bird_info.json", "ort-wasm-simd-threaded.wasm"];
    return performance
      .getEntriesByType("resource")
      .filter((entry) => wanted.some((part) => entry.name.includes(part)))
      .map((entry) => ({
        name: wanted.find((part) => entry.name.includes(part)) || entry.name,
        duration: Math.round(entry.duration),
        startTime: Math.round(entry.startTime),
        responseEnd: Math.round(entry.responseEnd),
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
      }));
  };

  return (async () => {
    const imageUrl = new URL(sampleImageUrl, window.location.href).href;
    const response = await fetch(imageUrl, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`sample image fetch failed: HTTP ${response.status}`);
    }
    const blob = await response.blob();
    const file = new File([blob], `birdora-${label}.jpg`, {
      type: blob.type || "image/jpeg",
    });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    const run = {
      label,
      start: performance.now(),
      events: [],
      terminal: null,
    };
    probe.runs.push(run);
    probe.activeRun = run;

    input.value = "";
    input.files = dataTransfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const deadline = run.start + timeoutMs;
    let terminal = null;
    while (performance.now() < deadline) {
      if (run.terminal) {
        terminal = run.terminal;
        break;
      }

      const dom = summarizeDom();
      if (dom.resultName === "识别失败") {
        terminal = {
          status: "failed",
          t: performance.now(),
          message: dom.modelDetail || dom.resultMeta,
        };
        run.terminal = terminal;
        break;
      }

      await sleep(100);
    }

    if (!terminal) {
      terminal = {
        status: "timeout",
        t: performance.now(),
        message: "recognition timed out",
      };
      run.terminal = terminal;
    }

    probe.activeRun = null;
    const end = terminal.t || performance.now();
    const dom = summarizeDom();
    return {
      label,
      status: terminal.status,
      totalMs: Math.round(end - run.start),
      classifyMs:
        run.classifyStart && run.classifyEnd
          ? Math.round(run.classifyEnd - run.classifyStart)
          : null,
      classifierMs:
        run.classifierStart && run.classifierEnd
          ? Math.round(run.classifierEnd - run.classifierStart)
          : null,
      labelMs:
        run.labelStart && run.labelEnd
          ? Math.round(run.labelEnd - run.labelStart)
          : null,
      terminal,
      classifyResult: run.classifyResult || null,
      classifyError: run.classifyError || "",
      dom,
      events: run.events.map((event) => ({
        type: event.type,
        offsetMs: Math.round(event.t - run.start),
        text: event.text || "",
      })),
      resources: resourceSummary(),
      pageErrors: probe.pageErrors.slice(),
    };
  })();
}

function inspectPageHealth() {
  return {
    ok: true,
    readyState: document.readyState,
    title: document.title,
    bodyTextLength: document.body?.innerText?.length || 0,
    lastRunStatus:
      window.__birdoraRecognitionRampProbe?.runs?.slice(-1)[0]?.terminal?.status || "",
  };
}

async function runClientRecognition(client, phase) {
  try {
    return await evaluate(
      client.cdp,
      pageScript(runRecognitionInPage, SAMPLE_IMAGE_URL, `${client.label}-${phase}`, RECOGNITION_TIMEOUT_MS),
      `${client.label} ${phase} recognition`,
      RECOGNITION_TIMEOUT_MS + 15000
    );
  } catch (error) {
    return {
      label: `${client.label}-${phase}`,
      status: "failed",
      error: error.message,
      totalMs: null,
      classifyMs: null,
    };
  }
}

async function inspectClientHealth(client) {
  try {
    return await evaluate(
      client.cdp,
      pageScript(inspectPageHealth),
      `${client.label} page health`,
      5000
    );
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function getClientPerformanceMetrics(client) {
  try {
    const result = await client.cdp.send("Performance.getMetrics");
    const metrics = new Map((result.metrics || []).map((metric) => [metric.name, metric.value]));
    return {
      jsHeapUsedSize: Math.round(metrics.get("JSHeapUsedSize") || 0),
      nodes: Math.round(metrics.get("Nodes") || 0),
      documents: Math.round(metrics.get("Documents") || 0),
    };
  } catch {
    return {};
  }
}

async function launchChrome(chromePath, scenarioId) {
  const debugPort = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `birdora-${scenarioId}-chrome-`));
  const chromeArgs = [
    HEADLESS ? "--headless=new" : "",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ].filter(Boolean);

  const chrome = spawn(chromePath, chromeArgs, {
    stdio: "ignore",
    windowsHide: true,
  });

  await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, CHROME_TIMEOUT_MS);
  return { chrome, debugPort, profileDir };
}

async function cleanupChrome(chromeSession) {
  if (!chromeSession) return;
  await stopProcess(chromeSession.chrome);
  try {
    fs.rmSync(chromeSession.profileDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
  }
}

function printScenarioSummary(summary) {
  const first = summary.firstSummary;
  const second = summary.secondSummary;
  const diag = summary.diagnosticsSummary;
  console.log(
    `${summary.viewport.name} ramp ${summary.ramp}: ` +
      `first ${first.completed}/${first.total} p50=${first.p50Ms ?? "n/a"}ms ` +
      `p95=${first.p95Ms ?? "n/a"}ms max=${first.maxMs ?? "n/a"}ms; ` +
      `second ${second.completed}/${second.total} p50=${second.p50Ms ?? "n/a"}ms ` +
      `p95=${second.p95Ms ?? "n/a"}ms max=${second.maxMs ?? "n/a"}ms; ` +
      `errors=${diag.consoleErrors}, crashes=${diag.crashes}, stuck=${diag.unhealthyPages}`
  );
}

async function runScenario({ chromePath, webBaseUrl, apiBaseUrl, viewport, ramp }) {
  const scenarioId = `${viewport.name}-ramp-${ramp}-${Date.now()}`;
  let chromeSession = null;
  const clients = [];

  try {
    chromeSession = await launchChrome(chromePath, scenarioId);
    for (let index = 0; index < ramp; index += 1) {
      clients.push(
        await setupClient({
          browserPort: chromeSession.debugPort,
          webBaseUrl,
          apiBaseUrl,
          viewport,
          scenarioId,
          index,
        })
      );
    }

    const firstResults = await Promise.all(clients.map((client) => runClientRecognition(client, "first")));
    const firstHealth = await Promise.all(clients.map(inspectClientHealth));
    const secondResults = await Promise.all(clients.map((client) => runClientRecognition(client, "second")));
    const secondHealth = await Promise.all(clients.map(inspectClientHealth));
    const metrics = await Promise.all(clients.map(getClientPerformanceMetrics));

    const diagnostics = clients.map((client, index) => ({
      label: client.label,
      ...client.diagnostics,
      firstHealth: firstHealth[index],
      secondHealth: secondHealth[index],
      performance: metrics[index],
    }));

    const summary = {
      scenarioId,
      ramp,
      viewport,
      sampleImageUrl: SAMPLE_IMAGE_URL,
      firstResults,
      secondResults,
      firstSummary: summarizeDurations(firstResults),
      secondSummary: summarizeDurations(secondResults),
      diagnostics,
      diagnosticsSummary: {
        consoleErrors: diagnostics.reduce((sum, item) => sum + item.consoleErrors.length, 0),
        consoleWarnings: diagnostics.reduce((sum, item) => sum + item.consoleWarnings.length, 0),
        exceptions: diagnostics.reduce((sum, item) => sum + item.exceptions.length, 0),
        networkFailures: diagnostics.reduce((sum, item) => sum + item.networkFailures.length, 0),
        crashes: diagnostics.filter((item) => item.crashed).length,
        unhealthyPages: diagnostics.filter((item) => !item.secondHealth?.ok).length,
      },
    };
    printScenarioSummary(summary);
    return summary;
  } finally {
    for (const client of clients) {
      try {
        client.cdp.close();
      } catch {
        // Best effort.
      }
    }
    await cleanupChrome(chromeSession);
  }
}

async function main() {
  assertLocalUrl(WEB_BASE_URL_ENV, "WEB_BASE_URL");
  assertLocalUrl(API_BASE_URL_ENV, "E2E_API_BASE_URL");

  if (!DESKTOP_RAMPS.length && !MOBILE_RAMPS.length) {
    throw new Error("No recognition ramp sizes were configured.");
  }

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run recognition ramp.");
  }
  if (typeof WebSocket !== "function") {
    throw new Error("Current Node.js runtime does not provide WebSocket.");
  }

  let webServer = null;
  let apiServer = null;
  let webBaseUrl = WEB_BASE_URL_ENV;
  let apiBaseUrl = API_BASE_URL_ENV;

  try {
    if (!webBaseUrl) {
      webServer = await startWebServer();
      webBaseUrl = webServer.webBaseUrl;
    }
    if (!apiBaseUrl) {
      apiServer = await startApiServer(webBaseUrl);
      apiBaseUrl = apiServer.apiBaseUrl;
    }

    console.log(`Recognition ramp web: ${webBaseUrl}`);
    console.log(`Recognition ramp api: ${apiBaseUrl}`);
    console.log(`Recognition ramp sample: ${SAMPLE_IMAGE_URL}`);
    console.log(`Recognition ramp timeout: ${RECOGNITION_TIMEOUT_MS}ms`);

    const scenarios = [];
    for (const ramp of DESKTOP_RAMPS) {
      scenarios.push({ viewport: DESKTOP_VIEWPORT, ramp });
    }
    for (const ramp of MOBILE_RAMPS) {
      scenarios.push({ viewport: MOBILE_VIEWPORT, ramp });
    }

    const results = [];
    for (const scenario of scenarios) {
      results.push(await runScenario({ chromePath, webBaseUrl, apiBaseUrl, ...scenario }));
    }

    const report = {
      runId: `browser-recognition-ramp-${Date.now()}`,
      startedAt: new Date().toISOString(),
      webBaseUrl,
      apiBaseUrl,
      headless: HEADLESS,
      desktopRamps: DESKTOP_RAMPS,
      mobileRamps: MOBILE_RAMPS,
      recognitionTimeoutMs: RECOGNITION_TIMEOUT_MS,
      results,
    };

    if (REPORT_JSON_PATH) {
      const reportPath = path.resolve(PROJECT_ROOT, REPORT_JSON_PATH);
      fs.mkdirSync(path.dirname(reportPath), { recursive: true });
      fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Recognition ramp JSON written to ${reportPath}`);
    }

    const failedScenarios = results.filter((result) => result.firstSummary.failed || result.secondSummary.failed);
    const crashedScenarios = results.filter((result) => result.diagnosticsSummary.crashes);
    if (failedScenarios.length || crashedScenarios.length) {
      process.exitCode = 1;
    }
  } finally {
    await stopProcess(apiServer?.api);
    await stopProcess(webServer?.web);
    if (apiServer?.tempDir) {
      try {
        fs.rmSync(apiServer.tempDir, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Could not remove temporary API data: ${error.message}`);
      }
    }
  }
}

main().catch((error) => {
  console.error("\nBrowser recognition ramp failed.");
  console.error(error.message);
  process.exitCode = 1;
});
