"use strict";

const crypto = require("crypto");

const authConfig = require("../config/auth.config");

const CURSOR_VERSION = 1;
const MAX_CURSOR_LENGTH = 1024;

function cursorError() {
  const error = new Error("cursor is invalid or does not belong to this query");
  error.statusCode = 400;
  error.code = "INVALID_CURSOR";
  return error;
}

function sign(encodedPayload) {
  return crypto.createHmac("sha256", authConfig.jwtSecret).update(encodedPayload).digest("base64url");
}

function encodeCursor(scope, { sortTime, id }) {
  if (
    typeof scope !== "string"
    || scope.length < 1
    || scope.length > 160
    || typeof sortTime !== "string"
    || !Number.isFinite(Date.parse(sortTime))
    || typeof id !== "string"
    || id.length < 1
    || id.length > 128
  ) throw cursorError();

  const encodedPayload = Buffer.from(JSON.stringify({
    v: CURSOR_VERSION,
    scope,
    sortTime,
    id,
  }), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function decodeCursor(cursor, expectedScope) {
  if (cursor === undefined || cursor === null || cursor === "") return null;
  if (typeof cursor !== "string" || cursor.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(cursor)) {
    throw cursorError();
  }
  const [encodedPayload, encodedSignature] = cursor.split(".");
  if (
    Buffer.from(encodedPayload, "base64url").toString("base64url") !== encodedPayload
    || Buffer.from(encodedSignature, "base64url").toString("base64url") !== encodedSignature
  ) throw cursorError();
  const expectedSignature = sign(encodedPayload);
  const actualBytes = Buffer.from(encodedSignature, "base64url");
  const expectedBytes = Buffer.from(expectedSignature, "base64url");
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) {
    throw cursorError();
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch {
    throw cursorError();
  }
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || Object.keys(payload).sort().join(",") !== "id,scope,sortTime,v"
    || payload.v !== CURSOR_VERSION
    || payload.scope !== expectedScope
    || typeof payload.sortTime !== "string"
    || !Number.isFinite(Date.parse(payload.sortTime))
    || typeof payload.id !== "string"
    || payload.id.length < 1
    || payload.id.length > 128
  ) throw cursorError();
  return { sortTime: payload.sortTime, id: payload.id };
}

module.exports = { decodeCursor, encodeCursor };
