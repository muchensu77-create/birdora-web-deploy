const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const WEB_BASE_URL = (process.env.WEB_BASE_URL || "http://127.0.0.1:4174").replace(/\/$/, "");
const API_BASE_URL = (process.env.E2E_API_BASE_URL || "").replace(/\/$/, "");
const HEADLESS = process.env.E2E_HEADLESS !== "0";
const CHROME_TIMEOUT_MS = Number(process.env.E2E_TIMEOUT_MS || 45000);
const runId = Date.now();
const author = {
  email: `browser-author-${runId}@example.com`,
  nickname: "Browser Author",
  password: "12345678",
};
const reader = {
  email: `browser-reader-${runId}@example.com`,
  nickname: "Browser Reader",
  password: "12345678",
};
const postTitle = `Browser E2E kingfisher note ${runId}`;
const postBody =
  "A kingfisher was perched near the wetland trail before diving into the river. Weather was clear and the observer kept distance.";

function assertLocalWriteTarget() {
  if (process.env.ALLOW_REMOTE_BROWSER_E2E === "1") return;

  const urls = [WEB_BASE_URL, API_BASE_URL].filter(Boolean);
  for (const value of urls) {
    const url = new URL(value);
    const isLocal =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1";
    if (!isLocal) {
      throw new Error(
        `Browser E2E creates accounts and posts. Refusing non-local target ${value}. ` +
          "Set ALLOW_REMOTE_BROWSER_E2E=1 only for an isolated test environment."
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
    const server = net.createServer();
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

  function emitEvent(message) {
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
        close() {
          socket.close();
        },
      });
    });
    socket.addEventListener("error", reject);
  });
}

async function evaluate(cdp, expression, label = "evaluation") {
  const result = await cdp.send("Runtime.evaluate", {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });

  if (result.exceptionDetails) {
    throw new Error(`${label} failed: ${result.exceptionDetails.text || "runtime exception"}`);
  }

  return result.result?.value;
}

async function waitFor(cdp, expression, label, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let lastValue = null;
  while (Date.now() < deadline) {
    lastValue = await evaluate(cdp, expression, label);
    if (lastValue) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out; last value: ${JSON.stringify(lastValue)}`);
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await cdp.waitForEvent("Page.loadEventFired", 15000).catch(() => null);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

function pageScript(fn, ...args) {
  return `(${fn})(${args.map((arg) => JSON.stringify(arg)).join(",")})`;
}

async function registerAccount(cdp, account) {
  await navigate(cdp, `${WEB_BASE_URL}/login.html`);
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
    `register ${account.email}`
  );

  await waitFor(
    cdp,
    pageScript((nickname) => location.pathname.endsWith("/index.html") && document.body.innerText.includes(nickname), account.nickname),
    `registered ${account.email}`
  );
}

async function assertCachedUserDoesNotAuthenticate(cdp) {
  const cachedNickname = `Cached User ${runId}`;
  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await evaluate(
    cdp,
    pageScript((nickname) => {
      localStorage.setItem("birdoraLoggedIn", "true");
      localStorage.setItem(
        "birdora-auth-user",
        JSON.stringify({
          id: "cached-user",
          email: "cached-user@example.com",
          nickname,
        })
      );
      return true;
    }, cachedNickname),
    "seed cached auth user"
  );
  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await waitFor(
    cdp,
    pageScript((nickname) => {
      const logoutButton = document.querySelector("[data-logout]");
      const bodyText = document.body.innerText || "";
      return logoutButton?.textContent.trim() === "登录" && !bodyText.includes(nickname);
    }, cachedNickname),
    "cached auth user is not treated as logged in"
  );
}

async function loginAccount(cdp, account) {
  await navigate(cdp, `${WEB_BASE_URL}/login.html`);
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
    `login ${account.email}`
  );

  await waitFor(
    cdp,
    pageScript((nickname) => location.pathname.endsWith("/index.html") && document.body.innerText.includes(nickname), account.nickname),
    `logged in ${account.email}`
  );
}

async function logout(cdp) {
  await evaluate(
    cdp,
    `(() => {
      const button = Array.from(document.querySelectorAll("button")).find((next) => next.textContent.trim() === "退出登录");
      if (button) button.click();
      return Boolean(button);
    })()`,
    "logout"
  );
  await new Promise((resolve) => setTimeout(resolve, 800));
}

async function publishPost(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await evaluate(
    cdp,
    pageScript((title, body) => {
      document.querySelector("#postTitle").value = title;
      document.querySelector("#postBody").value = body;
      document.querySelector("#postTitle").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#postBody").dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector("#postForm").requestSubmit();
      return true;
    }, postTitle, postBody),
    "publish post"
  );

  await waitFor(
    cdp,
    pageScript((title) => document.body.innerText.includes(title) && document.querySelector("#postMessage")?.textContent.includes("发布成功"), postTitle),
    "post appears on home feed"
  );
}

async function saveObservationFromInjectedRecognition(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await evaluate(
    cdp,
    pageScript(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 16;
      canvas.height = 16;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#2f6f4d";
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = "#f5f1e8";
      ctx.fillRect(4, 4, 8, 8);

      const topCandidates = [
        {
          index: 3334,
          cn: "翠鸟",
          en: "Common Kingfisher",
          latin: "Alcedo atthis",
          probability: 0.91,
          isMapped: true,
          atlasBird: null,
        },
        {
          index: 3048,
          cn: "白鹭",
          en: "Little Egret",
          latin: "Egretta garzetta",
          probability: 0.04,
          isMapped: true,
          atlasBird: null,
        },
      ];

      currentRecognitionImagePayload = {
        imageDataUrl: canvas.toDataURL("image/jpeg", 0.82),
        imageName: "browser-observation.jpg",
      };
      const top = topCandidates[0];
      setResult(
        createCandidateBird(top),
        displayConfidence(top.probability),
        "Browser E2E injected Top 5 result.",
        topCandidates
      );
      return !document.querySelector("#saveObservation").disabled;
    }),
    "inject recognition result"
  );

  await evaluate(
    cdp,
    `document.querySelector("#saveObservation").click(); true`,
    "save observation"
  );

  const observationId = await waitFor(
    cdp,
    pageScript(() => {
      const message = document.querySelector("#observationMessage")?.textContent || "";
      const card = document.querySelector("[data-observation-id]");
      return message.includes("已保存") && card ? card.getAttribute("data-observation-id") : "";
    }),
    "observation saved"
  );

  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await waitFor(
    cdp,
    pageScript((id) =>
      Array.from(document.querySelectorAll("[data-observation-id]")).some(
        (card) => card.getAttribute("data-observation-id") === id
      ),
    observationId),
    "observation visible after refresh"
  );

  console.log(`observation save/refresh: PASS (${observationId})`);
  return observationId;
}

async function publishObservationFromList(cdp, observationId) {
  await navigate(cdp, `${WEB_BASE_URL}/index.html`);
  await waitFor(
    cdp,
    pageScript((id) => {
      const card = Array.from(document.querySelectorAll("[data-observation-id]")).find(
        (nextCard) => nextCard.getAttribute("data-observation-id") === id
      );
      return Boolean(card?.querySelector("[data-observation-share]"));
    }, observationId),
    "observation share button visible"
  );

  await evaluate(
    cdp,
    pageScript((id) => {
      const card = Array.from(document.querySelectorAll("[data-observation-id]")).find(
        (nextCard) => nextCard.getAttribute("data-observation-id") === id
      );
      card.querySelector("[data-observation-share]").click();
      return true;
    }, observationId),
    "publish observation"
  );

  await waitFor(
    cdp,
    pageScript(() => document.querySelector("#observationMessage")?.textContent.includes("已从观测记录发布到社区")),
    "observation publish success"
  );

  await navigate(cdp, `${WEB_BASE_URL}/community.html`);
  await waitFor(
    cdp,
    pageScript((id) => {
      const apiBase = String(window.BIRDORA_API_BASE_URL || "").replace(/\/$/, "");
      return fetch(`${apiBase}/api/community/posts`, { credentials: "include" })
        .then((response) => response.json())
        .then((data) => (data.posts || []).some((post) => post.observationId === id))
        .catch(() => false);
    }, observationId),
    "community post keeps observation id"
  );

  console.log("observation publish: PASS");
}

async function getPostId(cdp) {
  await navigate(cdp, `${WEB_BASE_URL}/community.html`);
  return waitFor(
    cdp,
    pageScript((title) => {
      const card = Array.from(document.querySelectorAll("[data-post-id]")).find((next) => next.innerText.includes(title));
      return card ? card.getAttribute("data-post-id") : "";
    }, postTitle),
    "post appears in community"
  );
}

async function readerInteract(cdp, postId) {
  await navigate(cdp, `${WEB_BASE_URL}/community.html`);
  await waitFor(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      return Boolean(card && !card.querySelector("[data-post-edit], [data-post-delete]"));
    }, postId),
    "reader sees post without management buttons"
  );

  await evaluate(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      card.querySelector(`[data-post-reaction="${id}"][data-reaction-type="helpful"]`).click();
      return true;
    }, postId),
    "reader reacts"
  );
  await waitFor(cdp, pageScript((id) => document.querySelector(`[data-post-id="${id}"]`)?.innerText.includes("有帮助 1"), postId), "reaction count updates");

  await evaluate(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      card.querySelector(`[data-post-detail="${id}"]`).click();
      return true;
    }, postId),
    "reader opens post detail"
  );
  await waitFor(
    cdp,
    pageScript((title) => document.querySelector(".post-detail-dialog")?.innerText.includes(title), postTitle),
    "post detail opens"
  );

  const deletedCommentText = "Browser reader comment to delete: detail view works.";
  await evaluate(
    cdp,
    pageScript((id, text) => {
      const input = document.querySelector(`[data-detail-comment-input="${id}"]`);
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(`[data-detail-comment-submit="${id}"]`).click();
      return true;
    }, postId, deletedCommentText),
    "reader comments in detail"
  );
  await waitFor(cdp, pageScript((text) => document.querySelector(".post-detail-dialog")?.innerText.includes(text), deletedCommentText), "detail comment appears");

  const deleteDialogPromise = cdp.waitForEvent("Page.javascriptDialogOpening", 3000).catch(() => null);
  const deleteCommentClick = evaluate(
    cdp,
    pageScript((text) => {
      const comment = Array.from(document.querySelectorAll(".post-detail-dialog .comment-bubble")).find((bubble) =>
        bubble.innerText.includes(text)
      );
      comment.querySelector("[data-comment-delete]").click();
      return true;
    }, deletedCommentText),
    "reader clicks comment delete"
  );
  const deleteDialog = await deleteDialogPromise;
  if (!deleteDialog) throw new Error("comment delete confirmation dialog did not open");
  await cdp.send("Page.handleJavaScriptDialog", { accept: true });
  await deleteCommentClick;
  await waitFor(
    cdp,
    pageScript((text) =>
      !Array.from(document.querySelectorAll(".post-detail-dialog .comment-bubble")).some((bubble) =>
        bubble.innerText.includes(text)
      ),
    deletedCommentText),
    "deleted detail comment disappears"
  );

  const retainedCommentText = "Browser reader comment: clear location and behavior details.";
  await evaluate(
    cdp,
    pageScript((id, text) => {
      const input = document.querySelector(`[data-detail-comment-input="${id}"]`);
      input.value = text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(`[data-detail-comment-submit="${id}"]`).click();
      return true;
    }, postId, retainedCommentText),
    "reader adds retained comment"
  );
  await waitFor(cdp, pageScript((text) => document.querySelector(".post-detail-dialog")?.innerText.includes(text), retainedCommentText), "retained comment appears");
  await evaluate(cdp, `document.querySelector("[data-post-detail-close]")?.click(); true`, "close post detail");

  await evaluate(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      const input = card.querySelector(`[data-question-input="${id}"]`);
      input.value = "Browser reader question: how high above the water was it perched?";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      card.querySelector(`[data-question-submit="${id}"]`).click();
      return true;
    }, postId),
    "reader asks question"
  );
  await waitFor(cdp, pageScript((id) => document.querySelector(`[data-post-id="${id}"]`)?.innerText.includes("Browser reader question"), postId), "question appears");
}

async function authorEditAndDelete(cdp, postId) {
  await loginAccount(cdp, author);
  await navigate(cdp, `${WEB_BASE_URL}/community.html`);
  await waitFor(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      return Boolean(card && card.querySelector("[data-post-edit]") && card.innerText.includes("Browser reader comment"));
    }, postId),
    "author sees interactions and management buttons"
  );

  const editedTitle = `${postTitle} edited`;
  await evaluate(
    cdp,
    pageScript((id, title) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      card.querySelector(`[data-post-edit="${id}"]`).click();
      const form = document.querySelector(`[data-post-edit-form="${id}"]`);
      form.elements.title.value = title;
      form.elements.body.value = "Author edited this post during the browser E2E flow.";
      form.elements.title.dispatchEvent(new Event("input", { bubbles: true }));
      form.elements.body.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      return true;
    }, postId, editedTitle),
    "author edits post"
  );
  await waitFor(cdp, pageScript((title) => document.body.innerText.includes(title), editedTitle), "edited post title appears");

  const dialogPromise = cdp.waitForEvent("Page.javascriptDialogOpening", 3000).catch(() => null);
  const clickPromise = evaluate(
    cdp,
    pageScript((id) => {
      const card = document.querySelector(`[data-post-id="${id}"]`);
      card.querySelector(`[data-post-delete="${id}"]`).click();
      return true;
    }, postId),
    "author clicks delete"
  );
  const dialog = await dialogPromise;
  if (!dialog) throw new Error("delete confirmation dialog did not open");
  await cdp.send("Page.handleJavaScriptDialog", { accept: true });
  await clickPromise;
  await waitFor(cdp, pageScript((id) => !document.querySelector(`[data-post-id="${id}"]`), postId), "post removed after delete");
}

async function main() {
  assertLocalWriteTarget();

  const chromePath = findChromeExecutable();
  if (!chromePath) {
    throw new Error("Chrome or Edge was not found. Set CHROME_PATH to run browser E2E.");
  }

  if (typeof WebSocket !== "function") {
    throw new Error("Current Node.js runtime does not provide WebSocket.");
  }

  const debugPort = await getFreePort();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "birdora-e2e-chrome-"));
  const chromeArgs = [
    HEADLESS ? "--headless=new" : "",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDir}`,
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ].filter(Boolean);

  const chrome = spawn(chromePath, chromeArgs, {
    stdio: "ignore",
    windowsHide: true,
  });

  let cdp = null;
  try {
    await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, CHROME_TIMEOUT_MS);
    const tab = await createCdpTab(debugPort);
    cdp = await connectCdp(tab.webSocketDebuggerUrl);
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    if (API_BASE_URL) {
      await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `Object.defineProperty(window, "BIRDORA_API_BASE_URL", { value: ${JSON.stringify(API_BASE_URL)}, configurable: true });`,
      });
    }

    console.log(`Browser E2E web: ${WEB_BASE_URL}`);
    console.log(`Browser E2E api: ${API_BASE_URL || "(page default)"}`);
    await assertCachedUserDoesNotAuthenticate(cdp);
    console.log("cached localStorage auth state ignored: PASS");
    await registerAccount(cdp, author);
    console.log(`author register/login: PASS (${author.email})`);
    const observationId = await saveObservationFromInjectedRecognition(cdp);
    await publishObservationFromList(cdp, observationId);
    await publishPost(cdp);
    console.log("author publish: PASS");
    const postId = await getPostId(cdp);
    console.log(`community visibility: PASS (${postId})`);
    await logout(cdp);
    await registerAccount(cdp, reader);
    console.log(`reader register/login: PASS (${reader.email})`);
    await readerInteract(cdp, postId);
    console.log("reader reaction/comment/question: PASS");
    await logout(cdp);
    await authorEditAndDelete(cdp, postId);
    console.log("author edit/delete: PASS");
    console.log("Browser E2E result: PASS");
  } finally {
    if (cdp) cdp.close();
    if (chrome.exitCode === null) {
      chrome.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2000);
        chrome.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    try {
      fs.rmSync(profileDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove temporary Chrome profile: ${error.message}`);
    }
  }
}

main().catch((error) => {
  console.error("\nBrowser E2E failed.");
  console.error(error.message);
  process.exitCode = 1;
});
