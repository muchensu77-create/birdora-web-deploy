const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const defaultPublicDir = path.join(rootDir, "public");
const releaseRoot = path.join(rootDir, ".public-releases");
const configuredOutputDirectory = process.env.PUBLIC_OUTPUT_DIR
  ? path.resolve(process.env.PUBLIC_OUTPUT_DIR)
  : null;
const publicDir = configuredOutputDirectory || defaultPublicDir;

if (configuredOutputDirectory) {
  const relativeOutput = path.relative(releaseRoot, configuredOutputDirectory);
  if (
    !relativeOutput
    || relativeOutput.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeOutput)
  ) {
    throw new Error(`PUBLIC_OUTPUT_DIR must be a unique child of ${releaseRoot}`);
  }
  if (fs.existsSync(releaseRoot) && fs.lstatSync(releaseRoot).isSymbolicLink()) {
    throw new Error(`Refusing a symlinked public release root: ${releaseRoot}`);
  }
  if (fs.existsSync(configuredOutputDirectory)) {
    throw new Error(`Refusing to overwrite an existing public release: ${configuredOutputDirectory}`);
  }
}
const publicFiles = [
  "index.html",
  "login.html",
  "register.html",
  "community.html",
  "explore.html",
  "upload.html",
  "profile.html",
  "publish.html",
  "device.html",
  "privacy.html",
  "terms.html",
  "styles.css",
  "roadmap.css",
  "design-system.css",
  "community-api.js",
  "observation-api.js",
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
  const sourcePath = path.join(rootDir, relativePath);
  const sourceStats = fs.lstatSync(sourcePath);
  if (!sourceStats.isFile() || sourceStats.isSymbolicLink()) {
    throw new Error(`Refusing a non-regular public source file: ${sourcePath}`);
  }
  fs.copyFileSync(sourcePath, path.join(publicDir, relativePath));
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
  const sourceStats = fs.lstatSync(source);
  if (!sourceStats.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error(`Refusing a non-directory public asset source: ${source}`);
  }
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
      continue;
    }

    throw new Error(`Refusing a non-regular public asset source: ${sourcePath}`);
  }
}

if (fs.existsSync(publicDir) && fs.lstatSync(publicDir).isSymbolicLink()) {
  throw new Error(`Refusing a symlinked public output directory: ${publicDir}`);
}
fs.mkdirSync(publicDir, { recursive: true });

for (const file of publicFiles) {
  copyFile(file);
}

copyDirectory(path.join(rootDir, "assets"), path.join(publicDir, "assets"));
copyDirectory(path.join(rootDir, "Pictures"), path.join(publicDir, "Pictures"));

console.log(`Synced public assets to ${publicDir}`);
if (skippedAssetCount > 0) {
  console.log(`Skipped ${skippedAssetCount} blocked asset file(s) or folder(s).`);
}
