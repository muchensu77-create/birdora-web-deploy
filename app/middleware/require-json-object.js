function isPlainObject(value) {
  if (!value || Object.prototype.toString.call(value) !== "[object Object]") {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireJsonObject(req, res, next) {
  if (!req.is("application/json")) {
    res.status(415).json({
      message: "Content-Type must be application/json",
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
    return;
  }

  if (!isPlainObject(req.body)) {
    res.status(400).json({
      message: "Request body must be a JSON object",
      code: "INVALID_REQUEST_BODY",
    });
    return;
  }

  next();
}

module.exports = {
  isPlainObject,
  requireJsonObject,
};
