const productionEnv = {
  NODE_ENV: "production",
  PORT: process.env.PORT || "3003",
  CORS_ORIGIN: process.env.CORS_ORIGIN || "https://birdora.birdai-glasses.com",
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || "7d",
  JWT_COOKIE_NAME: process.env.JWT_COOKIE_NAME || "birdora_token",
  AUTH_RATE_LIMIT: process.env.AUTH_RATE_LIMIT || "30",
  DATABASE_FILE: process.env.DATABASE_FILE || "/var/lib/birdora/birdora.sqlite",
  TRUST_PROXY: process.env.TRUST_PROXY || "1",
};

if (process.env.JWT_SECRET) {
  productionEnv.JWT_SECRET = process.env.JWT_SECRET;
}

module.exports = {
  apps: [
    {
      name: "birdora-web-auth",
      cwd: __dirname,
      script: "server.js",
      interpreter: process.env.NODE_INTERPRETER || "node",
      instances: 1,
      exec_mode: "fork",
      env: productionEnv,
    },
  ],
};
