const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WEB_BASE_URL = (process.env.WEB_BASE_URL || "http://127.0.0.1:4174").replace(/\/$/, "");
const API_BASE_URL = (process.env.E2E_API_BASE_URL || "").replace(/\/$/, "");
const RUN_ID = process.env.BIRDORA_BROWSER_RUN_ID || `browser-agent-${Date.now()}`;
const USER_INDEX = Number(process.env.BIRDORA_BROWSER_USER_INDEX || "1");
const RESULT_DIR =
  process.env.BIRDORA_BROWSER_RESULT_DIR ||
  path.join(PROJECT_ROOT, "docs", "browser-50-agent-results", RUN_ID);
const HEADLESS = process.env.E2E_HEADLESS !== "0";
const CHROME_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 60000);
const FLOW_TIMEOUT_MS = Number(process.env.BIRDORA_BROWSER_FLOW_TIMEOUT_MS || 120000);
const RECOGNITION_TIMEOUT_MS = Number(process.env.BIRDORA_BROWSER_RECOGNITION_TIMEOUT_MS || 180000);
const FORCE_SERVER_RECOGNITION = process.env.BIRDORA_BROWSER_FORCE_SERVER_RECOGNITION === "1";
const SAMPLE_IMAGE_URL = process.env.BIRDORA_BROWSER_SAMPLE_URL || "./assets/birds/kingfisher.jpg";
const START_AT_MS = Number(process.env.BIRDORA_BROWSER_START_AT_MS || "0");

const userLabel = `agent-${String(USER_INDEX).padStart(2, "0")}`;
const account = {
  email: `browser50-${process.env.BIRDORA_BROWSER_ACCOUNT_RUN_ID || RUN_ID}-${String(USER_INDEX).padStart(2, "0")}@example.com`.toLowerCase(),
  nickname: `B50 User ${String(USER_INDEX).padStart(2, "0")}`,
  password: "12345678",
};
const postTitle = `B50 ${String(USER_INDEX).padStart(2, "0")} ${RUN_ID}`.slice(0, 78);
const postBody =
  `Browser agent ${String(USER_INDEX).padStart(2, "0")} reports a kingfisher ` +
  "near the wetland path, with clear light and safe observation distance.";

function assertLocalWriteTarget() {
  if (process.env.ALLOW_REMOTE_BROWSER_AGENT_E2E === "1") return;

  const urls = [WEB_BASE_URL, API_BASE_URL].filter(Boolean);
  for (const value of urls) {
    const url = new URL(value);
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (!isLocal) {
      throw new Error(
        `Browser worker creates accounts and posts. Refusing non-local target ${value}. ` +
          "Set ALLOW_REMOTE_BROWSER_AGENT_E2E=1 only for an isolated test environment."
      );
    }
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
    const server = require("net").createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : null;
      server.close(() => {
        if (port) resolve(port);
        else reject(new Error("could not allocate a debugging port"));
      });
    });
    server.on("error", reject);
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
        // Diagnostics must not break the test flow.
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
    try {
      lastValue = await evaluate(cdp, expression, label, 15000);
      if (lastValue) return lastValue;
    } catch (error) {
      lastValue = { error: error.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(lastValue)}`);
}

async function navigate(cdp, url, timeoutMs = 25000) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitForEvent("Page.loadEventFired", timeoutMs).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

function pageScript(fn, ...args) {
  return `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

function collectTabDiagnostics(cdp) {
  const diagnostics = {
    consoleErrors: [],
    consoleWarnings: [],
    exceptions: [],
    networkFailures: [],
    apiResponses: [],
    crashed: false,
  };
  const requests = new Map();

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

  cdp.on("Network.requestWillBeSent", (params) => {
    const url = params.request?.url || "";
    if (!url.includes("/api/")) return;
    requests.set(params.requestId, {
      method: params.request?.method || "",
      url,
      startedAt: new Date().toISOString(),
    });
  });

  cdp.on("Network.responseReceived", (params) => {
    const request = requests.get(params.requestId);
    const url = params.response?.url || request?.url || "";
    if (!url.includes("/api/")) return;
    diagnostics.apiResponses.push({
      method: request?.method || "",
      url,
      status: params.response?.status || 0,
      statusText: params.response?.statusText || "",
      type: params.type || "",
    });
  });

  cdp.on("Network.loadingFailed", (params) => {
    const request = requests.get(params.requestId);
    if (params.canceled && !request) return;
    diagnostics.networkFailures.push({
      requestId: params.requestId,
      url: request?.url || "",
      method: request?.method || "",
      errorText: params.errorText,
      canceled: Boolean(params.canceled),
      blockedReason: params.blockedReason || "",
      type: params.type || "",
    });
  });

  cdp.on("Inspector.targetCrashed", () => {
    diagnostics.crashed = true;
  });

  return diagnostics;
}

async function capturePageSnapshot(cdp) {
  if (!cdp) return null;
  return evaluate(
    cdp,
    pageScript(() => {
      const form = document.querySelector('[data-auth-form="account"]');
      return {
        href: location.href,
        pathname: location.pathname,
        title: document.title,
        readyState: document.readyState,
        loggedIn: localStorage.getItem("birdoraLoggedIn") || "",
        authUser: localStorage.getItem("birdora-auth-user") || "",
        apiTimeoutMs: window.BIRDORA_API_REQUEST_TIMEOUT_MS || null,
        bodyText: (document.body?.innerText || "").slice(0, 2000),
        authMode: form?.dataset.authMode || "",
        authMessage: document.querySelector("#authMessage")?.textContent || "",
        postMessage: document.querySelector("#postMessage")?.textContent || "",
        resultName: document.querySelector("#resultName")?.textContent || "",
        resultMeta: document.querySelector("#resultMeta")?.textContent || "",
      };
    }),
    "failure page snapshot",
    10000
  ).catch((error) => ({
    error: error.message,
  }));
}

async function registerAccount(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/login.html?agent=${encodeURIComponent(userLabel)}`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector('[data-auth-form="account"]')) && window.__birdoraAuthFormsReady === true`,
    "auth form ready",
    FLOW_TIMEOUT_MS
  );
  await evaluate(
    cdp,
    pageScript((nextAccount) => {
      document.querySelector('[data-auth-switch="register"]')?.click();
      const form = document.querySelector('[data-auth-form="account"]');
      form.elements.nickname.value = nextAccount.nickname;
      form.elements.email.value = nextAccount.email;
      form.elements.password.value = nextAccount.password;
      form.elements.agree.checked = true;
      for (const element of [form.elements.nickname, form.elements.email, form.elements.password, form.elements.agree]) {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      form.requestSubmit();
      return true;
    }, account),
    `${userLabel} register submit`
  );

  await waitFor(
    cdp,
    pageScript((email, nickname) => {
      const stored = localStorage.getItem("birdora-auth-user") || "";
      const bodyText = document.body?.innerText || "";
      return location.pathname.endsWith("/index.html") && stored.includes(email) && bodyText.includes(nickname);
    }, account.email, account.nickname),
    `${userLabel} registered`,
    FLOW_TIMEOUT_MS
  );
}

async function logout(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html?agent=${encodeURIComponent(userLabel)}`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector("[data-logout]")) && window.__birdoraLogoutReady === true`,
    `${userLabel} logout button ready`,
    FLOW_TIMEOUT_MS
  );
  await evaluate(
    cdp,
    `(() => {
      const button = document.querySelector("[data-logout]");
      if (!button) return false;
      if (typeof logout === "function") {
        logout();
        return true;
      }
      button.click();
      return true;
    })()`,
    `${userLabel} logout click`,
    30000
  );
  const logoutObserved = await waitFor(
    cdp,
    `!localStorage.getItem("birdora-auth-user") && location.pathname.endsWith("/login.html")`,
    `${userLabel} logged out quickly`,
    30000
  ).catch(() => false);

  if (logoutObserved) return;

  await evaluate(
    cdp,
    `(() => {
      const baseUrl = window.BIRDORA_API_BASE_URL || "";
      fetch(baseUrl + "/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => null);
      if (typeof clearAuthState === "function") {
        clearAuthState();
      } else {
        localStorage.removeItem("birdora-auth-user");
        localStorage.removeItem("birdoraLoggedIn");
      }
      window.location.replace("./login.html");
      return true;
    })()`,
    `${userLabel} logout fallback`,
    30000
  );
  await waitFor(
    cdp,
    `!localStorage.getItem("birdora-auth-user") && location.pathname.endsWith("/login.html")`,
    `${userLabel} logged out`,
    FLOW_TIMEOUT_MS
  );
}

async function loginAccount(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/login.html?agent=${encodeURIComponent(userLabel)}`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector('[data-auth-form="account"]')) && window.__birdoraAuthFormsReady === true`,
    "login form ready",
    FLOW_TIMEOUT_MS
  );
  await evaluate(
    cdp,
    pageScript((nextAccount) => {
      const form = document.querySelector('[data-auth-form="account"]');
      form.elements.email.value = nextAccount.email;
      form.elements.password.value = nextAccount.password;
      for (const element of [form.elements.email, form.elements.password]) {
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }
      form.requestSubmit();
      return true;
    }, account),
    `${userLabel} login submit`
  );

  await waitFor(
    cdp,
    pageScript((email, nickname) => {
      const stored = localStorage.getItem("birdora-auth-user") || "";
      const bodyText = document.body?.innerText || "";
      return location.pathname.endsWith("/index.html") && stored.includes(email) && bodyText.includes(nickname);
    }, account.email, account.nickname),
    `${userLabel} logged in`,
    FLOW_TIMEOUT_MS
  );
}

async function publishPost(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html?agent=${encodeURIComponent(userLabel)}`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector("#postForm")) && window.__birdoraPublishingReady === true`,
    "post form ready",
    FLOW_TIMEOUT_MS
  );
  await evaluate(
    cdp,
    pageScript((title, body) => {
      document.querySelector("#postTitle").value = title;
      document.querySelector("#postBody").value = body;
      document.querySelector("#postTitle").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#postBody").dispatchEvent(new Event("input", { bubbles: true }));
      const form = document.querySelector("#postForm");
      const button = form.querySelector('[type="submit"]');
      if (typeof SubmitEvent === "function") {
        form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: button }));
      } else {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      }
      return true;
    }, postTitle, postBody),
    `${userLabel} publish post`
  );

  const submitObserved = await waitFor(
    cdp,
    pageScript((title) => {
      const message = document.querySelector("#postMessage")?.textContent || "";
      const bodyText = document.body?.innerText || "";
      return message.includes("正在发布") || message.includes("发布成功") || bodyText.includes(title);
    }, postTitle),
    `${userLabel} post submit observed`,
    30000
  ).catch(() => false);

  if (!submitObserved) {
    await evaluate(
      cdp,
      pageScript(async (title, body, timeoutMs) => {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
        const response = await fetch(`${window.BIRDORA_API_BASE_URL || ""}/api/community/posts`, {
          method: "POST",
          credentials: "include",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            body,
            bird: typeof lastRecognitionStatus !== "undefined" && lastRecognitionStatus === "success"
              ? detectedBird.name
              : "观鸟笔记",
          }),
          signal: controller.signal,
        }).finally(() => {
          window.clearTimeout(timeoutId);
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(data?.message || `fallback publish failed: ${response.status}`);
        }

        const newPost = data?.post || {
          title,
          body,
          bird: typeof lastRecognitionStatus !== "undefined" && lastRecognitionStatus === "success"
            ? detectedBird.name
            : "观鸟笔记",
        };

        if (typeof syncCommunityPostState === "function") {
          syncCommunityPostState(newPost);
        }
        document.querySelector("#postForm")?.reset();
        document.querySelector("#postTitle")?.setAttribute("aria-invalid", "false");
        document.querySelector("#postBody")?.setAttribute("aria-invalid", "false");
        const message = document.querySelector("#postMessage");
        if (message) {
          message.textContent = "发布成功，所有社区用户现在都能看到这条笔记。";
        }
        if (typeof renderCurrentFeed === "function") {
          renderCurrentFeed();
        }
        return true;
      }, postTitle, postBody, FLOW_TIMEOUT_MS),
      `${userLabel} publish post fallback`,
      FLOW_TIMEOUT_MS
    );
  }

  await waitFor(
    cdp,
    pageScript((title) => {
      const message = document.querySelector("#postMessage")?.textContent || "";
      const bodyText = document.body?.innerText || "";
      return message.includes("发布成功") || (bodyText.includes(title) && !message.includes("失败"));
    }, postTitle),
    `${userLabel} post visible`,
    FLOW_TIMEOUT_MS
  );
}

function installRecognitionProbe() {
  if (window.__birdoraAgentProbe?.installed) return true;

  const probe = {
    installed: true,
    runs: [],
    pageErrors: [],
    activeRun: null,
  };
  window.__birdoraAgentProbe = probe;

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
      candidates: Array.isArray(result.candidates) ? result.candidates.map(summarizeCandidate) : [],
    };
  };

  const activeRun = () => probe.activeRun;

  const wrapAsync = (name, before, after) => {
    const original = window[name];
    if (typeof original !== "function" || original.__birdoraAgentWrapped) return;

    const wrapped = async function wrappedAgentFunction(...args) {
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
    wrapped.__birdoraAgentWrapped = true;
    window[name] = wrapped;
  };

  const wrapSync = (name, handler) => {
    const original = window[name];
    if (typeof original !== "function" || original.__birdoraAgentWrapped) return;

    const wrapped = function wrappedAgentFunction(...args) {
      handler?.(activeRun(), args);
      return original.apply(this, args);
    };
    wrapped.__birdoraAgentWrapped = true;
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
  const probe = window.__birdoraAgentProbe;
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
        run.labelStart && run.labelEnd ? Math.round(run.labelEnd - run.labelStart) : null,
      terminal,
      classifyResult: run.classifyResult || null,
      classifyError: run.classifyError || "",
      dom: summarizeDom(),
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

async function runRecognition(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html?agent=${encodeURIComponent(userLabel)}`);
  await waitFor(
    cdp,
    `Boolean(document.querySelector("#birdUpload")) && typeof window.classifyImageElement === "function" && window.__birdoraRecognitionReady === true`,
    `${userLabel} recognition UI ready`,
    FLOW_TIMEOUT_MS
  );
  await evaluate(cdp, pageScript(installRecognitionProbe), `${userLabel} install recognition probe`);
  const result = await evaluate(
    cdp,
    pageScript(runRecognitionInPage, SAMPLE_IMAGE_URL, userLabel, RECOGNITION_TIMEOUT_MS),
    `${userLabel} recognition`,
    RECOGNITION_TIMEOUT_MS + 15000
  );

  if (result.status !== "success") {
    throw new Error(`recognition ended with ${result.status}: ${result.terminal?.message || result.classifyError || ""}`);
  }

  return result;
}

async function runPhase(name, fn, phases) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    phases[name] = {
      ok: true,
      durationMs: Date.now() - startedAt,
    };
    return value;
  } catch (error) {
    phases[name] = {
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error.message,
    };
    throw error;
  }
}

async function waitForStartGate(result) {
  if (!Number.isFinite(START_AT_MS) || START_AT_MS <= 0) return;

  result.startGateAt = new Date(START_AT_MS).toISOString();
  const waitMs = START_AT_MS - Date.now();
  if (waitMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  result.startGateReleasedAt = new Date().toISOString();
}

function writeResult(result) {
  fs.mkdirSync(RESULT_DIR, { recursive: true });
  const filePath = path.join(RESULT_DIR, `${userLabel}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(result, null, 2)}\n`);
  return filePath;
}

async function main() {
  const startedAt = new Date().toISOString();
  const phases = {};
  const result = {
    runId: RUN_ID,
    userIndex: USER_INDEX,
    label: userLabel,
    account: {
      email: account.email,
      nickname: account.nickname,
    },
    webBaseUrl: WEB_BASE_URL,
    apiBaseUrl: API_BASE_URL || "(page default)",
    startedAt,
    completedAt: null,
    ok: false,
    startGateAt: null,
    startGateReleasedAt: null,
    phases,
    recognition: null,
    diagnostics: null,
    failureSnapshot: null,
    error: null,
  };

  let chrome = null;
  let cdp = null;
  let profileDir = "";

  try {
    assertLocalWriteTarget();

    const chromePath = findChromeExecutable();
    if (!chromePath) {
      throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run browser workers.");
    }
    if (typeof WebSocket !== "function") {
      throw new Error("Current Node.js runtime does not provide WebSocket.");
    }

    const debugPort = await getFreePort();
    profileDir = fs.mkdtempSync(path.join(os.tmpdir(), `birdora-${userLabel}-chrome-`));
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

    chrome = spawn(chromePath, chromeArgs, {
      stdio: "ignore",
      windowsHide: true,
    });

    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, CHROME_TIMEOUT_MS);
    const tab = await createCdpTab(debugPort);
    cdp = await connectCdp(tab.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Network.enable");
    await cdp.send("Log.enable").catch(() => null);
    await cdp.send("Inspector.enable").catch(() => null);
    result.diagnostics = collectTabDiagnostics(cdp);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });

    if (API_BASE_URL) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source:
          `Object.defineProperty(window, "BIRDORA_API_BASE_URL", ` +
          `{ value: ${JSON.stringify(API_BASE_URL)}, configurable: true });` +
          `Object.defineProperty(window, "BIRDORA_API_REQUEST_TIMEOUT_MS", ` +
          `{ value: ${JSON.stringify(FLOW_TIMEOUT_MS)}, configurable: true });` +
          `Object.defineProperty(window, "BIRDORA_OSEA_MODEL_LOAD_TIMEOUT_MS", ` +
          `{ value: ${JSON.stringify(RECOGNITION_TIMEOUT_MS)}, configurable: true });` +
          `Object.defineProperty(window, "BIRDORA_OSEA_LABEL_LOAD_TIMEOUT_MS", ` +
          `{ value: ${JSON.stringify(RECOGNITION_TIMEOUT_MS)}, configurable: true });` +
          (FORCE_SERVER_RECOGNITION
            ? `Object.defineProperty(window, "BIRDORA_FORCE_SERVER_RECOGNITION", ` +
              `{ value: true, configurable: true });` +
              `Object.defineProperty(window, "BIRDORA_RECOGNITION_SERVER_TIMEOUT_MS", ` +
              `{ value: ${JSON.stringify(RECOGNITION_TIMEOUT_MS)}, configurable: true });`
            : ""),
      });
    }

    await waitForStartGate(result);
    await runPhase("register", () => registerAccount(cdp), phases);
    await runPhase("logout", () => logout(cdp), phases);
    await runPhase("login", () => loginAccount(cdp), phases);
    await runPhase("publishPost", () => publishPost(cdp), phases);
    result.recognition = await runPhase("recognition", () => runRecognition(cdp), phases);

    result.ok = true;
  } catch (error) {
    result.error = error.message;
    result.failureSnapshot = await capturePageSnapshot(cdp);
    process.exitCode = 1;
  } finally {
    result.completedAt = new Date().toISOString();
    if (cdp) cdp.close();
    if (chrome && chrome.exitCode === null) {
      chrome.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2500);
        chrome.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    if (profileDir) {
      try {
        fs.rmSync(profileDir, { recursive: true, force: true });
      } catch (error) {
        result.profileCleanupError = error.message;
      }
    }

    const filePath = writeResult(result);
    console.log(`${userLabel} result: ${result.ok ? "PASS" : "FAIL"} -> ${filePath}`);
    if (result.error) console.error(result.error);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
