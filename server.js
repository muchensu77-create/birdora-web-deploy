require("dotenv").config({ quiet: true });

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");

const authRoutes = require("./app/routes/auth.routes");

const app = express();
const port = Number(process.env.PORT) || 4000;
const isProduction = process.env.NODE_ENV === "production";
const defaultAllowedOrigins = [
  "http://localhost:4174",
  "http://127.0.0.1:4174",
];

function parseTrustProxy(value) {
  if (!value || value === "false") return false;
  if (value === "true") return true;

  const numericValue = Number(value);
  return Number.isNaN(numericValue) ? value : numericValue;
}

if (isProduction && !process.env.CORS_ORIGIN) {
  throw new Error("CORS_ORIGIN must be set in production.");
}

const allowedOrigins = (process.env.CORS_ORIGIN || defaultAllowedOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY || (isProduction ? "1" : ""));

app.disable("x-powered-by");

if (trustProxy !== false) {
  app.set("trust proxy", trustProxy);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error(`CORS blocked origin: ${origin}`);
      error.statusCode = 403;
      callback(error);
    },
    credentials: true,
  })
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));
app.use(cookieParser());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "birdora-auth-api",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api/auth", authRoutes);

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;
  const message =
    isProduction && statusCode >= 500
      ? "Internal server error"
      : err.message || "Internal server error";

  res.status(statusCode).json({
    message,
  });
});

app.listen(port, () => {
  console.log(`Birdora auth API listening on http://localhost:${port}`);
});
