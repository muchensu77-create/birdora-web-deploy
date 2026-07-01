const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const publicFiles = [
  "index.html",
  "login.html",
  "community.html",
  "privacy.html",
  "terms.html",
  "styles.css",
  "community-api.js",
  "community-post-card.css",
  "community-post-card.js",
  "script.js",
];
const blockedAssetExtensions = new Set([
  ".bak",
  ".backup",
  ".db",
  ".dump",
  ".env",
  ".gz",
  ".key",
  ".log",
  ".pem",
  ".sqlite",
  ".sql",
  ".tar",
  ".tgz",
  ".zip",
]);
const blockedAssetNames = new Set([
  ".ds_store",
  ".env",
  ".env.local",
  ".env.production",
]);
let skippedAssetCount = 0;

function copyFile(relativePath) {
  fs.copyFileSync(path.join(rootDir, relativePath), path.join(publicDir, relativePath));
}

function shouldSkipAsset(entryName) {
  const normalizedName = entryName.toLowerCase();
  return (
    normalizedName.startsWith(".") ||
    blockedAssetNames.has(normalizedName) ||
    blockedAssetExtensions.has(path.extname(normalizedName))
  );
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (shouldSkipAsset(entry.name)) {
      skippedAssetCount += 1;
      continue;
    }

    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

fs.mkdirSync(publicDir, { recursive: true });

for (const file of publicFiles) {
  copyFile(file);
}

copyDirectory(path.join(rootDir, "assets"), path.join(publicDir, "assets"));

console.log(`Synced public assets to ${publicDir}`);
if (skippedAssetCount > 0) {
  console.log(`Skipped ${skippedAssetCount} blocked asset file(s) or folder(s).`);
}
