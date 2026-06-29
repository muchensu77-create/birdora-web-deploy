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
  "script.js",
];

function copyFile(relativePath) {
  fs.copyFileSync(path.join(rootDir, relativePath), path.join(publicDir, relativePath));
}

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
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
