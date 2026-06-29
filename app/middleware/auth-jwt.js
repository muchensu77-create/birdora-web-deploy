const jwt = require("jsonwebtoken");

const authConfig = require("../config/auth.config");
const tokenService = require("../services/token.service");
const userService = require("../services/user.service");

function getTokenFromRequest(req) {
  const authHeader = req.headers.authorization || "";
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  if (req.cookies && req.cookies[authConfig.jwtCookieName]) {
    return req.cookies[authConfig.jwtCookieName];
  }

  return null;
}

async function resolveAuthSession(req) {
  const token = getTokenFromRequest(req);
  if (!token) {
    return { authenticated: false, token: null, payload: null, user: null };
  }

  try {
    const payload = jwt.verify(token, authConfig.jwtSecret);
    const revoked = await tokenService.isTokenRevoked(payload.jti);
    if (revoked) {
      return { authenticated: false, token, payload: null, user: null };
    }

    const user = await userService.findById(payload.sub);
    if (!user) {
      return { authenticated: false, token, payload: null, user: null };
    }

    return { authenticated: true, token, payload, user };
  } catch {
    return { authenticated: false, token, payload: null, user: null };
  }
}

async function attachSession(req, _res, next) {
  const session = await resolveAuthSession(req);
  req.authSession = session;
  req.user = session.user;
  req.token = session.token;
  next();
}

async function requireAuth(req, res, next) {
  const session = await resolveAuthSession(req);
  if (!session.authenticated) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  req.authSession = session;
  req.user = session.user;
  req.token = session.token;
  next();
}

module.exports = {
  attachSession,
  getTokenFromRequest,
  requireAuth,
};
