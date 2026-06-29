const DEFAULT_PORT = process.env.PORT || "4000";
const BASE_URL = process.env.AUTH_BASE_URL || `http://127.0.0.1:${DEFAULT_PORT}`;
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
  password: "123456",
};

let issuedToken = null;

function cleanupTestData() {
  if (!generatedTestEmail) return;

  try {
    const db = getDatabase();
    const payload = issuedToken ? jwt.decode(issuedToken) : null;
    if (payload && payload.jti) {
      db.prepare("DELETE FROM revoked_tokens WHERE jti = ?").run(payload.jti);
    }

    db.prepare("DELETE FROM users WHERE email = ?").run(testAccount.email);
    console.log(`Cleaned generated test account: ${testAccount.email}`);
  } catch (error) {
    console.warn(`Could not clean generated test account: ${error.message}`);
  }
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
  };
}

function maskToken(token) {
  if (!token || typeof token !== "string") return "none";
  if (token.length <= 16) return `${token.slice(0, 4)}...`;
  return `${token.slice(0, 10)}...${token.slice(-6)}`;
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
  } = options;

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

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
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

  printStep("1. Register test account");
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
  console.log(`JWT preview: ${maskToken(loginResult.body.token)}`);
  issuedToken = loginResult.body.token;
  summary.push({ step: "login", ok: true, status: loginResult.status });

  printStep("4. Save login cookie");
  const cookieSaved = loginCookieJar.count() > 0;
  printResult("Cookie saved", cookieSaved);
  console.log(`Cookie count: ${loginCookieJar.count()}`);
  if (!cookieSaved) {
    summary.push({ step: "cookie", ok: false, detail: "No Set-Cookie header captured." });
    throw new Error("Login cookie was not saved.");
  }
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
