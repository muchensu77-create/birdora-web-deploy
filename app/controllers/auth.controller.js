const crypto = require("crypto");
const { performance } = require("perf_hooks");

const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");
const passwordService = require("../services/password.service");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_MAX_BYTES = 254;
const PASSWORD_MAX_BYTES = 72;
const LOGIN_PASSWORD_MAX_BYTES = 1024;
const PROFILE_BIO_MAX_LENGTH = 280;
const PROFILE_NICKNAME_MAX_LENGTH = 40;
const PROFILE_AVATAR_MAX_BYTES = 600 * 1024;
const PROFILE_GENDERS = new Set(["", "female", "male", "nonbinary", "prefer_not_to_say"]);
const DUMMY_PASSWORD_HASHES = Object.freeze({
  10: "$2a$10$F.qCPNGEsHJadT2Hs1WQyu6RrROcbd2ly6CLcj.obI3OPCBPyaokS",
  11: "$2a$11$QAfHuWVJy7njGAQQKAHokOhvtIPUEKSfxGiojvdYeVm4mc.rrnknm",
  12: "$2a$12$DtFcKMcZh9st.VKOLubBuul8YT9jPAaJ2AVL5oYVpQdxMamkgaoCa",
  13: "$2a$13$K1dHiwePI8UbQoEvDyn16e0cOSupF5jMZ/9Cb8Lxu8Tlpd1FWfdnm",
  14: "$2a$14$QB24rBgZ/Yva8eA2ca3/we6kLDqe4X1zqS6pfsH93rfEgkkEouRly",
});
const DUMMY_PASSWORD_HASH = DUMMY_PASSWORD_HASHES[authConfig.passwordHashCost] || DUMMY_PASSWORD_HASHES[10];

function isValidEmail(email) {
  return Buffer.byteLength(email, "utf8") <= EMAIL_MAX_BYTES
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getTokenExpiryDate(payload) {
  if (!payload || !payload.exp) return null;
  return new Date(payload.exp * 1000).toISOString();
}

function issueAuthToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      jti,
    },
    authConfig.jwtSecret,
    {
      algorithm: "HS256",
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
  if (
    typeof req.body.email !== "string"
    || typeof req.body.password !== "string"
    || (req.body.nickname !== undefined && req.body.nickname !== null && typeof req.body.nickname !== "string")
  ) {
    res.status(400).json({ message: "registration fields are invalid", code: "INVALID_REGISTRATION" });
    return;
  }
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

  if (Buffer.byteLength(password, "utf8") > PASSWORD_MAX_BYTES) {
    res.status(400).json({
      message: `password must not exceed ${PASSWORD_MAX_BYTES} UTF-8 bytes`,
      code: "INVALID_PASSWORD",
    });
    return;
  }

  if (nickname.length > PROFILE_NICKNAME_MAX_LENGTH) {
    res.status(400).json({
      message: `nickname must not exceed ${PROFILE_NICKNAME_MAX_LENGTH} characters`,
      code: "INVALID_NICKNAME",
    });
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
      nickname: nickname || email.split("@", 1)[0].slice(0, PROFILE_NICKNAME_MAX_LENGTH),
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
  if (typeof req.body.email !== "string" || typeof req.body.password !== "string") {
    res.status(400).json({ message: "login fields are invalid", code: "INVALID_LOGIN" });
    return;
  }
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }


  if (!isValidEmail(email) || Buffer.byteLength(password, "utf8") > LOGIN_PASSWORD_MAX_BYTES) {
    res.status(400).json({ message: "login fields are invalid", code: "INVALID_LOGIN" });
    return;
  }

  const user = await measureTiming(timings, "auth_db_lookup", () =>
    userService.findByEmail(email)
  );
  const passwordMatches = await measureTiming(timings, "password_compare", () =>
    passwordService.verifyPassword(password, user?.passwordHash || DUMMY_PASSWORD_HASH)
  );
  if (!user || !passwordMatches) {
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

function hasOwn(value, field) {
  return Object.prototype.hasOwnProperty.call(value, field);
}

function normalizeClearableText(value, maxLength) {
  if (value === null) return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length <= maxLength ? normalized : null;
}

function normalizeProfile(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;

  const profile = {};

  if (hasOwn(body, "nickname")) {
    if (typeof body.nickname !== "string") return null;
    const nickname = body.nickname.trim();
    if (!nickname || nickname.length > PROFILE_NICKNAME_MAX_LENGTH) return null;
    profile.nickname = nickname;
  }

  if (hasOwn(body, "bio")) {
    const bio = normalizeClearableText(body.bio, PROFILE_BIO_MAX_LENGTH);
    if (bio === null) return null;
    profile.bio = bio;
  }

  if (hasOwn(body, "gender")) {
    const gender = normalizeClearableText(body.gender, 40);
    if (gender === null || !PROFILE_GENDERS.has(gender)) return null;
    profile.gender = gender;
  }

  if (hasOwn(body, "age")) {
    const rawAge = body.age;
    const age = rawAge === "" || rawAge === null ? null : Number(rawAge);
    if (age !== null && (!Number.isInteger(age) || age < 13 || age > 100)) return null;
    profile.age = age;
  }

  if (hasOwn(body, "avatarUrl")) {
    const avatarUrl = normalizeClearableText(body.avatarUrl, Number.POSITIVE_INFINITY);
    if (avatarUrl === null) return null;
    if (avatarUrl) {
      const match = avatarUrl.match(/^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!match || Buffer.from(match[1], "base64").length > PROFILE_AVATAR_MAX_BYTES) return null;
    }
    profile.avatarUrl = avatarUrl;
  }

  for (const field of ["emailNotifications", "publicProfile"]) {
    if (!hasOwn(body, field)) continue;
    if (typeof body[field] !== "boolean") return null;
    profile[field] = body[field];
  }

  return profile;
}

async function updateProfile(req, res) {
  const profile = normalizeProfile(req.body);
  if (!profile) {
    res.status(400).json({ message: "profile fields are invalid", code: "INVALID_PROFILE" });
    return;
  }
  const user = await userService.updateProfile(req.user.id, profile);
  res.json({ user: userService.sanitizeUser(user) });
}

async function removeAccount(req, res) {
  if (typeof req.body.password !== "string" || typeof req.body.confirmation !== "string") {
    res.status(400).json({ message: "account deletion confirmation is invalid" });
    return;
  }
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
