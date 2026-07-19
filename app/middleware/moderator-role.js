"use strict";

const moderationService = require("../services/moderation.service");

function requireModerator(req, _res, next) {
  try {
    moderationService.requireModerator(req.user?.id);
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireModerator };
