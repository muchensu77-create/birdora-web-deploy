const fs = require("fs");
const path = require("path");

const isProduction = process.env.NODE_ENV === "production";
const expectedReleaseRoot = "/var/www/birdora-web/releases";
const nodeInterpreter = process.env.NODE_INTERPRETER || "node";
let releaseDirectory = __dirname;

if (isProduction) {
  if (!process.env.BIRDORA_RELEASE_DIR) {
    throw new Error("BIRDORA_RELEASE_DIR is required for an immutable production runtime");
  }
  releaseDirectory = path.resolve(process.env.BIRDORA_RELEASE_DIR);
  if (path.dirname(releaseDirectory) !== expectedReleaseRoot) {
    throw new Error(`BIRDORA_RELEASE_DIR must be a direct child of ${expectedReleaseRoot}`);
  }
  const releaseStats = fs.lstatSync(releaseDirectory);
  if (!releaseStats.isDirectory() || releaseStats.isSymbolicLink() || fs.realpathSync(releaseDirectory) !== releaseDirectory) {
    throw new Error("BIRDORA_RELEASE_DIR must be a real physical directory");
  }
  if (!/^[0-9a-f]{40}$/u.test(process.env.BIRDORA_RELEASE_REVISION || "")) {
    throw new Error("BIRDORA_RELEASE_REVISION must be an exact lowercase Git commit");
  }
  if (!/^[0-9a-f]{64}$/u.test(process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || "")) {
    throw new Error("BIRDORA_RELEASE_MANIFEST_SHA256 must be a lowercase SHA-256 digest");
  }
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required in production");
}

const productionEnv = {
  NODE_ENV: "production",
  HOST: process.env.HOST || "127.0.0.1",
  PORT: process.env.PORT || "3003",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "https://birdora.birdai-glasses.com",
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "https://birdora.birdai-glasses.com",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  JWT_COOKIE_NAME: process.env.JWT_COOKIE_NAME || "birdora_token",
  COOKIE_SECURE: process.env.COOKIE_SECURE || "true",
  AUTH_RATE_LIMIT: process.env.AUTH_RATE_LIMIT || "30",
  COMMUNITY_WRITE_RATE_LIMIT: process.env.COMMUNITY_WRITE_RATE_LIMIT || "240",
  OBSERVATION_WRITE_RATE_LIMIT: process.env.OBSERVATION_WRITE_RATE_LIMIT || "240",
  RECOGNITION_RATE_LIMIT: process.env.RECOGNITION_RATE_LIMIT || "120",
  DATABASE_FILE: process.env.DATABASE_FILE || "/var/lib/birdora/birdora.sqlite",
  DATA_DIRECTORY: process.env.DATA_DIRECTORY || "/var/lib/birdora",
  DATABASE_AUTO_MIGRATE: process.env.DATABASE_AUTO_MIGRATE || "false",
  DATABASE_BACKUP_ENABLED: process.env.DATABASE_BACKUP_ENABLED || "true",
  DATABASE_BACKUP_DIR: process.env.DATABASE_BACKUP_DIR || "/var/lib/birdora-protected/backups",
  DATABASE_BACKUP_RETENTION: process.env.DATABASE_BACKUP_RETENTION || "20",
  LEGACY_JSON_IMPORT_MODE: process.env.LEGACY_JSON_IMPORT_MODE || "disabled",
  COMMUNITY_UPLOAD_DIR: process.env.COMMUNITY_UPLOAD_DIR || "/var/lib/birdora/uploads/community",
  OBSERVATION_UPLOAD_DIR: process.env.OBSERVATION_UPLOAD_DIR || "/var/lib/birdora/uploads/observations",
  COMMUNITY_PUBLISH_ENABLED: process.env.COMMUNITY_PUBLISH_ENABLED || "false",
  COMMUNITY_POST_EDIT_ENABLED: process.env.COMMUNITY_POST_EDIT_ENABLED || "false",
  COMMUNITY_LEGACY_LIKE_ENABLED: process.env.COMMUNITY_LEGACY_LIKE_ENABLED || "false",
  ACCOUNT_DELETION_ENABLED: process.env.ACCOUNT_DELETION_ENABLED || "false",
  COMMUNITY_DEMO_ENABLED: process.env.COMMUNITY_DEMO_ENABLED || "false",
  TRUST_PROXY: process.env.TRUST_PROXY || "1",
  ACTIVATION_PENDING_FILE: process.env.ACTIVATION_PENDING_FILE || "/var/lib/birdora-control/activation-pending.json",
  CURRENT_RELEASE_FILE: process.env.CURRENT_RELEASE_FILE || "/var/lib/birdora-control/current-release.json",
  BIRDORA_RELEASE_DIR: releaseDirectory,
  BIRDORA_RELEASE_REVISION: process.env.BIRDORA_RELEASE_REVISION || "",
  BIRDORA_RELEASE_MANIFEST_SHA256: process.env.BIRDORA_RELEASE_MANIFEST_SHA256 || "",
};

if (process.env.JWT_SECRET) {
  productionEnv.JWT_SECRET = process.env.JWT_SECRET;
}
if (process.env.BIRDORA_ACTIVATION_ATTEMPT_ID) {
  productionEnv.BIRDORA_ACTIVATION_ATTEMPT_ID = process.env.BIRDORA_ACTIVATION_ATTEMPT_ID;
}

const productionWriterLockArgs = [
  "--shared",
  "--no-fork",
  "/var/lock/birdora-db-maintenance.lock",
  nodeInterpreter,
  path.join(releaseDirectory, "server.js"),
];

module.exports = {
  apps: [
    {
      name: "birdora-web-auth",
      cwd: releaseDirectory,
      script: isProduction ? "/usr/bin/flock" : "server.js",
      args: isProduction ? productionWriterLockArgs : [],
      interpreter: isProduction ? "none" : nodeInterpreter,
      instances: 1,
      exec_mode: "fork",
      uid: isProduction ? "birdora" : undefined,
      gid: isProduction ? "birdora" : undefined,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 12000,
      min_uptime: 10000,
      max_restarts: 3,
      restart_delay: 1000,
      autorestart: true,
      watch: false,
      vizion: false,
      filter_env: [
        "BIRDORA_DEPLOY_",
        "JOURNAL_",
        "PREVIOUS_",
        "RELEASE_",
        "ROLLBACK_",
      ],
      env: productionEnv,
    },
  ],
};
