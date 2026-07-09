const DEFAULT_PORT = process.env.PORT || "4000";
const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
const TEST_ORIGIN = process.env.TEST_ORIGIN || "http://127.0.0.1:4174";
const BAD_TEST_ORIGIN = process.env.BAD_TEST_ORIGIN || "https://evil.example";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const { getDatabase } = require("../app/db/database");

const routes = {
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  status: "/api/auth/status",
};

const generatedTestEmail = !process.env.AUTH_TEST_EMAIL;
const testAccount = {
  email: process.env.AUTH_TEST_EMAIL || `auth-test-${Date.now()}@example.com`,
  nickname: "testuser",
  password: "12345678",
};
const legacyAccount = {
  email: `auth-legacy-${Date.now()}@example.com`,
  nickname: "legacyuser",
  password: "123456",
};

let issuedCookieToken = null;

function cleanupTestData() {
  try {
    const db = getDatabase();
    const payload = issuedCookieToken ? jwt.decode(issuedCookieToken) : null;
    if (payload && payload.jti) {
      db.prepare("DELETE FROM revoked_tokens WHERE jti = ?").run(payload.jti);
    }

    if (generatedTestEmail) {
      db.prepare("DELETE FROM users WHERE email = ?").run(testAccount.email);
    }
    db.prepare("DELETE FROM users WHERE email = ?").run(legacyAccount.email);
    console.log(`Cleaned generated test account: ${testAccount.email}`);
  } catch (error) {
    console.warn(`Could not clean generated test account: ${error.message}`);
  }
}

async function createLegacyShortPasswordAccount() {
  const db = getDatabase();
  const now = new Date().toISOString();
  const passwordHash = await bcrypt.hash(legacyAccount.password, 10);
  db.prepare(`
    INSERT INTO users (
      id,
      email,
      nickname,
      password_hash,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    legacyAccount.email,
    legacyAccount.nickname,
    passwordHash,
    now,
    now
  );
}

function createCookieJar() {
  const cookies = new Map();

  return {
    storeFromHeaders(headers) {
      const rawCookies = typeof headers.getSetCookie === "function"
        ? headers.getSetCookie()
        : headers.get("set-cookie")
          ? [headers.get("set-cookie")]
          : [];

      rawCookies.forEach((rawCookie) => {
        const [cookiePair] = rawCookie.split(";");
        const separatorIndex = cookiePair.indexOf("=");
        if (separatorIndex <= 0) return;

        const name = cookiePair.slice(0, separatorIndex).trim();
        const value = cookiePair.slice(separatorIndex + 1).trim();
        if (!name) return;

        cookies.set(name, value);
      });
    },
    toHeader() {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
    count() {
      return cookies.size;
    },
    firstValue() {
      return cookies.values().next().value || null;
    },
  };
}

function maskToken(token) {
  if (!token || typeof token !== "string") return "none";
  if (token.length <= 16) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
}

function responseOmitsAuthFields(body) {
  if (!body || typeof body !== "object") return true;

  const leakedFields = ["token", "expiresIn", "expiresAt", "jti"];
  return leakedFields.every((field) => !Object.prototype.hasOwnProperty.call(body, field));
}

function hasSourceHeader(headers) {
  return Object.keys(headers).some((name) => ["origin", "referer"].includes(name.toLowerCase()));
}

async function request(path, options = {}) {
  if (typeof fetch !== "function") {
    throw new Error("Current Node.js runtime does not support global fetch.");
  }

  const {
    method = "GET",
    json,
    cookieJar,
    headers = {},
    skipOrigin = false,
  } = options;
  const methodName = String(method).toUpperCase();

  const finalHeaders = {
    Accept: "application/json",
    ...headers,
  };

  if (json) {
    finalHeaders["Content-Type"] = "application/json";
  }

  if (cookieJar && cookieJar.count() > 0) {
    finalHeaders.Cookie = cookieJar.toHeader();
  }

  if (!SAFE_METHODS.has(methodName) && !skipOrigin && !hasSourceHeader(finalHeaders)) {
    finalHeaders.Origin = TEST_ORIGIN;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
    method: methodName,
    headers: finalHeaders,
    body: json ? JSON.stringify(json) : undefined,
  });

  if (cookieJar) {
    cookieJar.storeFromHeaders(response.headers);
  }

  const rawBody = await response.text();
  let body = rawBody;

  try {
    body = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    body = rawBody;
  }

  return {
    ok: response.ok,
    status: response.status,
    body,
    requestId: response.headers.get("x-request-id") || "",
  };
}

function printStep(title) {
  console.log(`\n=== ${title} ===`);
}

function printResult(label, result) {
  console.log(`${label}: ${result ? "PASS" : "FAIL"}`);
}

async function main() {
  const loginCookieJar = createCookieJar();
  const summary = [];

  console.log(`Auth API base URL: ${BASE_URL}`);
  console.log(`Testing routes: ${JSON.stringify(routes)}`);

  printStep("0. Request id header");
  const expectedRequestId = "thread-a1-test-id";
  const statusWithRequestId = await request(routes.status, {
    method: "GET",
    headers: {
      "X-Request-Id": expectedRequestId,
    },
  });
  const requestIdPassed = statusWithRequestId.requestId === expectedRequestId;
  printResult("Response echoes safe X-Request-Id", requestIdPassed);
  if (!requestIdPassed) {
    summary.push({ step: "request-id", ok: false, detail: statusWithRequestId.requestId });
    throw new Error("Response should include the request id header.");
  }
  summary.push({ step: "request-id", ok: true });

  const healthWithBadOrigin = await request("/api/health", {
    method: "GET",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
  });
  const healthPassed = healthWithBadOrigin.status === 200 && healthWithBadOrigin.body?.ok === true;
  printResult("/api/health is not origin-guarded", healthPassed);
  if (!healthPassed) {
    summary.push({ step: "health-origin", ok: false, detail: healthWithBadOrigin.body });
    throw new Error("/api/health should not be blocked by Origin guard.");
  }
  summary.push({ step: "health-origin", ok: true });

  const optionsLogin = await request(routes.login, {
    method: "OPTIONS",
    headers: {
      Origin: TEST_ORIGIN,
      "Access-Control-Request-Method": "POST",
    },
  });
  const optionsPassed = optionsLogin.status === 204 || optionsLogin.status === 200;
  printResult("OPTIONS preflight is not origin-guarded", optionsPassed);
  if (!optionsPassed) {
    summary.push({ step: "options-origin", ok: false, detail: optionsLogin.status });
    throw new Error("OPTIONS preflight should not be blocked by Origin guard.");
  }
  summary.push({ step: "options-origin", ok: true, status: optionsLogin.status });

  printStep("0b. Origin guard");
  const badOriginLogin = await request(routes.login, {
    method: "POST",
    headers: {
      Origin: BAD_TEST_ORIGIN,
    },
    json: {
      email: testAccount.email,
      password: testAccount.password,
    },
  });
  const badOriginBlocked =
    badOriginLogin.status === 403 && badOriginLogin.body?.message === "Forbidden" && Boolean(badOriginLogin.requestId);
  printResult("Non-allowlisted Origin login blocked", badOriginBlocked);
  if (!badOriginBlocked) {
    summary.push({ step: "bad-origin-login", ok: false, detail: badOriginLogin.body });
    throw new Error("Login should reject non-allowlisted Origin.");
  }
  summary.push({ step: "bad-origin-login", ok: true, status: badOriginLogin.status });

  const missingOriginLogin = await request(routes.login, {
    method: "POST",
    skipOrigin: true,
    json: {
      email: testAccount.email,
      password: testAccount.password,
    },
  });
  const missingOriginBlocked =
    missingOriginLogin.status === 403 &&
    missingOriginLogin.body?.message === "Forbidden" &&
    Boolean(missingOriginLogin.requestId);
  printResult("Missing Origin/Referer login blocked", missingOriginBlocked);
  if (!missingOriginBlocked) {
    summary.push({ step: "missing-origin-login", ok: false, detail: missingOriginLogin.body });
    throw new Error("Login should reject writes without Origin or Referer.");
  }
  summary.push({ step: "missing-origin-login", ok: true, status: missingOriginLogin.status });

  const refererFallbackRegister = await request(routes.register, {
    method: "POST",
    skipOrigin: true,
    headers: {
      Referer: `${TEST_ORIGIN}/login.html`,
    },
    json: {
      email: `referer-fallback-${Date.now()}@example.com`,
      password: "1234567",
      nickname: "refererfallback",
    },
  });
  const refererFallbackPassed = refererFallbackRegister.status === 400;
  printResult("Allowed Referer fallback reaches auth validation", refererFallbackPassed);
  if (!refererFallbackPassed) {
    summary.push({ step: "referer-fallback", ok: false, detail: refererFallbackRegister.body });
    throw new Error("Allowed Referer should pass Origin guard and reach auth validation.");
  }
  summary.push({ step: "referer-fallback", ok: true, status: refererFallbackRegister.status });

  printStep("1. Register test account");
  const weakRegisterResult = await request(routes.register, {
    method: "POST",
    json: {
      email: `weak-password-${Date.now()}@example.com`,
      password: "1234567",
      nickname: "weakpassword",
    },
  });
  const weakPasswordRejected = weakRegisterResult.status === 400;
  printResult("Password shorter than 8 characters rejected", weakPasswordRejected);
  if (!weakPasswordRejected) {
    summary.push({ step: "weak-password", ok: false, detail: weakRegisterResult.body });
    throw new Error("Register should reject passwords shorter than 8 characters.");
  }
  summary.push({ step: "weak-password", ok: true, status: weakRegisterResult.status });

  const registerResult = await request(routes.register, {
    method: "POST",
    json: {
      email: testAccount.email,
      password: testAccount.password,
      nickname: testAccount.nickname,
    },
  });

  const registerPassed = registerResult.status === 201 || registerResult.status === 409;
  printResult("Register request accepted", registerPassed);
  console.log(`HTTP ${registerResult.status}`);
  if (registerResult.status === 201) {
    console.log("Account created for test flow.");
    const registerTokenHidden = responseOmitsAuthFields(registerResult.body);
    printResult("Register JWT omitted from JSON response", registerTokenHidden);
    if (!registerTokenHidden) {
      console.log(registerResult.body);
      summary.push({ step: "register-token-hidden", ok: false, detail: registerResult.body });
      throw new Error("Register response should not expose JWT in JSON.");
    }
    summary.push({ step: "register-token-hidden", ok: true });
  } else if (registerResult.status === 409) {
    console.log("Account already exists, continuing with login test.");
  } else {
    console.log(registerResult.body);
    summary.push({ step: "register", ok: false, detail: registerResult.body });
    throw new Error("Register step failed.");
  }
  summary.push({ step: "register", ok: true, status: registerResult.status });

  printStep("2. Reject invalid password");
  const invalidLoginResult = await request(routes.login, {
    method: "POST",
    json: {
      email: testAccount.email,
      password: "wrong-password",
    },
  });

  const invalidLoginPassed = invalidLoginResult.status === 401;
  printResult("Invalid login rejected", invalidLoginPassed);
  console.log(`HTTP ${invalidLoginResult.status}`);
  if (!invalidLoginPassed) {
    console.log(invalidLoginResult.body);
    summary.push({ step: "invalid-login", ok: false, detail: invalidLoginResult.body });
    throw new Error("Invalid login should be rejected.");
  }
  summary.push({ step: "invalid-login", ok: true, status: invalidLoginResult.status });

  printStep("2b. Existing short-password account can still login");
  await createLegacyShortPasswordAccount();
  const legacyJar = createCookieJar();
  const legacyLoginResult = await request(routes.login, {
    method: "POST",
    cookieJar: legacyJar,
    json: {
      email: legacyAccount.email,
      password: legacyAccount.password,
    },
  });
  const legacyLoginPassed = legacyLoginResult.status === 200 && legacyJar.count() > 0;
  printResult("Legacy short-password login successful", legacyLoginPassed);
  if (!legacyLoginPassed) {
    console.log(legacyLoginResult.body);
    summary.push({ step: "legacy-login", ok: false, detail: legacyLoginResult.body });
    throw new Error("Existing users with short passwords should still be able to login.");
  }
  summary.push({ step: "legacy-login", ok: true, status: legacyLoginResult.status });

  printStep("3. Login test account");
  const loginResult = await request(routes.login, {
    method: "POST",
    cookieJar: loginCookieJar,
    json: {
      email: testAccount.email,
      password: testAccount.password,
    },
  });

  const loginPassed = loginResult.status === 200 && loginResult.body && loginResult.body.user;
  printResult("Login successful", Boolean(loginPassed));
  console.log(`HTTP ${loginResult.status}`);
  if (!loginPassed) {
    console.log(loginResult.body);
    summary.push({ step: "login", ok: false, detail: loginResult.body });
    throw new Error("Login step failed.");
  }

  console.log(`User: ${loginResult.body.user.email}`);
  const tokenHidden = responseOmitsAuthFields(loginResult.body);
  printResult("JWT omitted from JSON response", tokenHidden);
  if (!tokenHidden) {
    console.log(loginResult.body);
    summary.push({ step: "login-token-hidden", ok: false, detail: loginResult.body });
    throw new Error("Login response should not expose JWT in JSON.");
  }
  summary.push({ step: "login-token-hidden", ok: true });
  summary.push({ step: "login", ok: true, status: loginResult.status });

  printStep("4. Save login cookie");
  const cookieSaved = loginCookieJar.count() > 0;
  printResult("Cookie saved", cookieSaved);
  console.log(`Cookie count: ${loginCookieJar.count()}`);
  if (!cookieSaved) {
    summary.push({ step: "cookie", ok: false, detail: "No Set-Cookie header captured." });
    throw new Error("Login cookie was not saved.");
  }
  issuedCookieToken = loginCookieJar.firstValue();
  console.log(`Cookie token preview: ${maskToken(issuedCookieToken)}`);
  summary.push({ step: "cookie", ok: true, count: loginCookieJar.count() });

  printStep("5. Request /api/auth/me with cookie");
  const meResult = await request(routes.me, {
    method: "GET",
    cookieJar: loginCookieJar,
  });
  const mePassed = meResult.status === 200 && meResult.body?.authenticated === true;
  printResult("/me returns current user", mePassed);
  console.log(`HTTP ${meResult.status}`);
  if (!mePassed) {
    console.log(meResult.body);
    summary.push({ step: "me", ok: false, detail: meResult.body });
    throw new Error("/me check failed.");
  }
  console.log(`Current user: ${meResult.body.user.email}`);
  summary.push({ step: "me", ok: true, status: meResult.status });

  printStep("6. Request /api/auth/status with cookie");
  const statusResult = await request(routes.status, {
    method: "GET",
    cookieJar: loginCookieJar,
  });
  const statusPassed = statusResult.status === 200 && statusResult.body?.authenticated === true;
  printResult("/status reports logged in", statusPassed);
  console.log(`HTTP ${statusResult.status}`);
  if (!statusPassed) {
    console.log(statusResult.body);
    summary.push({ step: "status", ok: false, detail: statusResult.body });
    throw new Error("/status check failed.");
  }
  summary.push({ step: "status", ok: true, status: statusResult.status });

  printStep("7. Request /api/auth/logout with cookie");
  const logoutResult = await request(routes.logout, {
    method: "POST",
    cookieJar: loginCookieJar,
  });
  const logoutPassed = logoutResult.status === 200;
  printResult("Logout successful", logoutPassed);
  console.log(`HTTP ${logoutResult.status}`);
  if (!logoutPassed) {
    console.log(logoutResult.body);
    summary.push({ step: "logout", ok: false, detail: logoutResult.body });
    throw new Error("Logout step failed.");
  }
  summary.push({ step: "logout", ok: true, status: logoutResult.status });

  printStep("8. Request /api/auth/me after logout");
  const meAfterLogoutResult = await request(routes.me, {
    method: "GET",
    cookieJar: loginCookieJar,
  });
  const meAfterLogoutPassed = meAfterLogoutResult.status === 401;
  printResult("/me blocked after logout", meAfterLogoutPassed);
  console.log(`HTTP ${meAfterLogoutResult.status}`);
  if (!meAfterLogoutPassed) {
    console.log(meAfterLogoutResult.body);
    summary.push({ step: "me-after-logout", ok: false, detail: meAfterLogoutResult.body });
    throw new Error("/me should be unauthorized after logout.");
  }
  summary.push({ step: "me-after-logout", ok: true, status: meAfterLogoutResult.status });

  printStep("9. Request /api/auth/status after logout");
  const statusAfterLogoutResult = await request(routes.status, {
    method: "GET",
    cookieJar: loginCookieJar,
  });
  const statusAfterLogoutPassed =
    statusAfterLogoutResult.status === 200 && statusAfterLogoutResult.body?.authenticated === false;
  printResult("/status reports logged out", statusAfterLogoutPassed);
  console.log(`HTTP ${statusAfterLogoutResult.status}`);
  if (!statusAfterLogoutPassed) {
    console.log(statusAfterLogoutResult.body);
    summary.push({
      step: "status-after-logout",
      ok: false,
      detail: statusAfterLogoutResult.body,
    });
    throw new Error("/status should be false after logout.");
  }
  summary.push({ step: "status-after-logout", ok: true, status: statusAfterLogoutResult.status });

  printStep("Summary");
  summary.forEach((item) => {
    console.log(`${item.step}: ${item.ok ? "PASS" : "FAIL"}`);
  });
}

main()
  .then(() => {
    cleanupTestData();
  })
  .catch((error) => {
    cleanupTestData();
    console.error("\nTest run failed.");
    console.error(error.message);
    process.exitCode = 1;
  });
