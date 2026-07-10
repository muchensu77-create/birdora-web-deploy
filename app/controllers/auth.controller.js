const crypto = require("crypto");
const { performance } = require("perf_hooks");

const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");
const passwordService = require("../services/password.service");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const PROFILE_BIO_MAX_LENGTH = 280;
const PROFILE_NICKNAME_MAX_LENGTH = 40;
const PROFILE_AVATAR_MAX_BYTES = 600 * 1024;
const PROFILE_GENDERS = new Set(["", "female", "male", "nonbinary", "prefer_not_to_say"]);

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

function normalizeProfile(req) {
  const nickname = String(req.body.nickname || "").trim().slice(0, PROFILE_NICKNAME_MAX_LENGTH);
  const bio = String(req.body.bio || "").trim().slice(0, PROFILE_BIO_MAX_LENGTH);
  const gender = String(req.body.gender || "").trim();
  const rawAge = req.body.age;
  const age = rawAge === "" || rawAge === null || rawAge === undefined ? null : Number(rawAge);
  const avatarUrl = String(req.body.avatarUrl || "").trim();
  if (!nickname || !PROFILE_GENDERS.has(gender) || (age !== null && (!Number.isInteger(age) || age < 13 || age > 100))) {
    return null;
  }
  if (avatarUrl) {
    const match = avatarUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!match || Buffer.from(match[1], "base64").length > PROFILE_AVATAR_MAX_BYTES) return null;
  }
  return {
    nickname,
    bio,
    gender,
    age,
    avatarUrl,
    emailNotifications: req.body.emailNotifications !== false,
    publicProfile: req.body.publicProfile !== false,
  };
}

async function updateProfile(req, res) {
  const profile = normalizeProfile(req);
  if (!profile) {
    res.status(400).json({ message: "profile fields are invalid" });
    return;
  }
  const user = await userService.updateProfile(req.user.id, profile);
  res.json({ user: userService.sanitizeUser(user) });
}

async function removeAccount(req, res) {
  const password = String(req.body.password || "");
  const confirmation = String(req.body.confirmation || "").trim();
  if (confirmation !== "注销我的账号" || !password) {
    res.status(400).json({ message: "account deletion confirmation is invalid" });
    return;
  }
  const passwordMatches = await passwordService.verifyPassword(password, req.user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ message: "current password is incorrect" });
    return;
  }
  if (req.authSession?.payload?.jti) {
    await tokenService.revokeToken({ jti: req.authSession.payload.jti, expiresAt: getTokenExpiryDate(req.authSession.payload) });
  }
  await userService.deleteUser(req.user.id);
  clearAuthCookie(res);
  res.status(204).end();
}

module.exports = {
  login,
  logout,
  me,
  register,
  updateProfile,
  removeAccount,
  status,
};
