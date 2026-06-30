const crypto = require("crypto");

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

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

function setAuthCookie(res, token) {
  const cookieOptions = {
    ...authConfig.getCookieOptions(),
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };

  res.cookie(authConfig.jwtCookieName, token, cookieOptions);
}

function clearAuthCookie(res) {
  res.clearCookie(authConfig.jwtCookieName, authConfig.getCookieOptions());
}

async function register(req, res) {
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

  if (password.length < 6) {
    res.status(400).json({ message: "password must be at least 6 characters" });
    return;
  }

  const existingUser = await userService.findByEmail(email);
  if (existingUser) {
    res.status(409).json({ message: "email is already registered" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await userService.createUser({
    email,
    passwordHash,
    nickname,
  });

  const authToken = issueAuthToken(user);
  setAuthCookie(res, authToken.token);

  res.status(201).json({
    message: "registered successfully",
    user: userService.sanitizeUser(user),
  });
}

async function login(req, res) {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    res.status(400).json({ message: "email and password are required" });
    return;
  }

  const user = await userService.findByEmail(email);
  if (!user) {
    res.status(401).json({ message: "email or password is incorrect" });
    return;
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    res.status(401).json({ message: "email or password is incorrect" });
    return;
  }

  const authToken = issueAuthToken(user);
  setAuthCookie(res, authToken.token);

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
