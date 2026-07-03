const crypto = require("crypto");
const { performance } = require("perf_hooks");

const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");
const passwordService = require("../services/password.service");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getTokenExpiryDate(payload) {
  if (!payload || !payload.exp) return null;
  return new Date(payload.exp * 1000).toISOString();
}

function issueAuthToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      email: user.email,
      nickname: user.nickname,
      jti,
    },
    authConfig.jwtSecret,
    {
      subject: user.id,
      expiresIn: authConfig.jwtExpiresIn,
    }
  );

  const payload = jwt.decode(token);

  return {
    token,
    expiresIn: authConfig.jwtExpiresIn,
    expiresAt: getTokenExpiryDate(payload),
    jti,
  };
}

function getAuthCookieMaxAge(expiresAt) {
  if (!expiresAt) return DEFAULT_AUTH_COOKIE_MAX_AGE_MS;

  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return DEFAULT_AUTH_COOKIE_MAX_AGE_MS;

  return Math.max(0, expiresAtMs - Date.now());
}

function setAuthCookie(res, token, expiresAt) {
  const cookieOptions = {
    ...authConfig.getCookieOptions(),
    maxAge: getAuthCookieMaxAge(expiresAt),
  };

  res.cookie(authConfig.jwtCookieName, token, cookieOptions);
}

function clearAuthCookie(res) {
  res.clearCookie(authConfig.jwtCookieName, authConfig.getCookieOptions());
}

async function measureTiming(timings, name, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings.push({ name, ms: performance.now() - start });
  }
}

function measureTimingSync(timings, name, fn) {
  const start = performance.now();
  try {
    return fn();
  } finally {
    timings.push({ name, ms: performance.now() - start });
  }
}

function setAuthTimingHeader(res, timings, totalStart) {
  if (!authConfig.authTimingHeadersEnabled || res.headersSent) return;

  const allTimings = [
    ...timings,
    {
      name: "auth_total",
      ms: performance.now() - totalStart,
    },
  ];
  res.setHeader(
    "Server-Timing",
    allTimings.map((timing) => `${timing.name};dur=${timing.ms.toFixed(1)}`).join(", ")
  );
}

async function register(req, res) {
  const totalStart = performance.now();
  const timings = [];
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();
  const nickname = String(req.body.nickname || "").trim();

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  if (!isValidEmail(email)) {
    res.status(400).json({ message: "email format is invalid" });
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    res.status(400).json({ message: `password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    return;
  }

  const existingUser = await measureTiming(timings, "auth_db_lookup", () =>
    userService.findByEmail(email)
  );
  if (existingUser) {
    setAuthTimingHeader(res, timings, totalStart);
    res.status(409).json({ message: "email is already registered" });
    return;
  }

  const passwordHash = await measureTiming(timings, "password_hash", () =>
    passwordService.hashPassword(password)
  );
  const user = await measureTiming(timings, "auth_db_insert", () =>
    userService.createUser({
      email,
      passwordHash,
      nickname,
    })
  );

  const authToken = measureTimingSync(timings, "auth_jwt", () => issueAuthToken(user));
  setAuthCookie(res, authToken.token, authToken.expiresAt);
  setAuthTimingHeader(res, timings, totalStart);

  res.status(201).json({
    message: "registered successfully",
    user: userService.sanitizeUser(user),
  });
}

async function login(req, res) {
  const totalStart = performance.now();
  const timings = [];
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  const user = await measureTiming(timings, "auth_db_lookup", () =>
    userService.findByEmail(email)
  );
  if (!user) {
    setAuthTimingHeader(res, timings, totalStart);
    res.status(401).json({ message: "email or password is incorrect" });
    return;
  }

  const passwordMatches = await measureTiming(timings, "password_compare", () =>
    passwordService.verifyPassword(password, user.passwordHash)
  );
  if (!passwordMatches) {
    setAuthTimingHeader(res, timings, totalStart);
    res.status(401).json({ message: "email or password is incorrect" });
    return;
  }

  const authToken = measureTimingSync(timings, "auth_jwt", () => issueAuthToken(user));
  setAuthCookie(res, authToken.token, authToken.expiresAt);
  setAuthTimingHeader(res, timings, totalStart);

  res.json({
    message: "login successful",
    user: userService.sanitizeUser(user),
  });
}

async function logout(req, res) {
  const session = req.authSession;
  if (session && session.authenticated && session.payload?.jti) {
    await tokenService.revokeToken({
      jti: session.payload.jti,
      expiresAt: getTokenExpiryDate(session.payload),
    });
  }

  clearAuthCookie(res);
  res.json({ message: "logout successful" });
}

async function me(req, res) {
  res.json({
    authenticated: true,
    user: userService.sanitizeUser(req.user),
  });
}

async function status(req, res) {
  const session = req.authSession;
  if (!session || !session.authenticated || !req.user) {
    res.json({
      authenticated: false,
      user: null,
    });
    return;
  }

  res.json({
    authenticated: true,
    user: userService.sanitizeUser(req.user),
  });
}

module.exports = {
  login,
  logout,
  me,
  register,
  status,
};
