const { featureFlags } = require("../config/capabilities.config");

function requireFeature(feature, { code = "FEATURE_DISABLED", message = "Feature is disabled", status = 503 } = {}) {
  if (!Object.prototype.hasOwnProperty.call(featureFlags, feature)) {
    throw new Error(`Unknown feature flag: ${feature}`);
  }

  return (_req, res, next) => {
    if (featureFlags[feature]) {
      next();
      return;
    }

    res.status(status).json({ message, code });
  };
}

module.exports = {
  requireFeature,
};
