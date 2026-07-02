const fs = require("fs");
const path = require("path");

const { getDatabase } = require("../app/db/database");

const DEFAULT_DATABASE_FILE = path.join(__dirname, "..", "app", "data", "birdora.sqlite");
const SAFE_PATH_PATTERN = /(?:load[-_]?test|staging|(?:^|[\\\/_.-])test(?:[\\\/_.-]|$))/i;
const PRODUCTION_PATH_PATTERN = /(?:^|[\\\/])var[\\\/]lib[\\\/]birdora(?:[\\\/]|$)/i;

function parseArgs(argv) {
  const args = {
    prefix: "",
    yes: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (item === "--yes") {
      args.yes = true;
    } else if (item === "--runId" || item === "--prefix") {
      args.prefix = argv[index + 1] || "";
      index += 1;
    } else if (item.startsWith("--runId=")) {
      args.prefix = item.slice("--runId=".length);
    } else if (item.startsWith("--prefix=")) {
      args.prefix = item.slice("--prefix=".length);
    }
  }

  return args;
}

function normalizePrefix(value) {
  const clean = String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]/g, "-");
  if (!clean) return "";
  return clean.startsWith("loadtest-d-") ? clean : `loadtest-d-${clean}`;
}

function isSafeTestPath(value) {
  if (!value) return false;
  const resolved = path.resolve(value);
  if (PRODUCTION_PATH_PATTERN.test(resolved) && !SAFE_PATH_PATTERN.test(resolved)) {
    return false;
  }
  return SAFE_PATH_PATTERN.test(resolved);
}

function resolveDatabaseFile() {
  return path.resolve(process.env.DATABASE_FILE || DEFAULT_DATABASE_FILE);
}

function resolveUploadDir(envName, fallbackLeaf) {
  if (process.env[envName]) {
    return path.resolve(process.env[envName]);
  }

  return path.join(path.dirname(resolveDatabaseFile()), "uploads", fallbackLeaf);
}

function assertCleanupSafety(prefix, databaseFile, communityUploadDir, observationUploadDir) {
  if (!prefix || !prefix.startsWith("loadtest-d-")) {
    throw new Error("Refusing cleanup without a loadtest-d-* runId or prefix.");
  }

  if (!process.env.DATABASE_FILE) {
    throw new Error("DATABASE_FILE must be set so cleanup cannot accidentally target the default local database.");
  }

  const checks = [
    ["DATABASE_FILE", databaseFile],
    ["COMMUNITY_UPLOAD_DIR", communityUploadDir],
    ["OBSERVATION_UPLOAD_DIR", observationUploadDir],
  ];

  for (const [name, value] of checks) {
    if (!isSafeTestPath(value)) {
      throw new Error(`${name} must include load-test, staging, or test before cleanup can run: ${value}`);
    }
  }
}

function countValue(row) {
  return Number(Object.values(row || {})[0] || 0);
}

function collectSummary(db, prefix) {
  const userPattern = `${prefix}-%@example.test`;
  const legacyUserPattern = `${prefix}-%@example.com`;
  const textPattern = `[${prefix}]%`;

  const userWhere = "email LIKE ? OR email LIKE ?";
  const postWhere = `
    user_id IN (SELECT id FROM users WHERE ${userWhere})
    OR title LIKE ?
    OR body LIKE ?
  `;
  const observationWhere = `
    user_id IN (SELECT id FROM users WHERE ${userWhere})
    OR source = ?
    OR notes LIKE ?
  `;

  const users = countValue(
    db.prepare(`SELECT COUNT(*) FROM users WHERE ${userWhere}`).get(userPattern, legacyUserPattern)
  );
  const posts = countValue(
    db.prepare(`SELECT COUNT(*) FROM community_posts WHERE ${postWhere}`).get(
      userPattern,
      legacyUserPattern,
      textPattern,
      textPattern
    )
  );
  const comments = countValue(
    db.prepare(`
      SELECT COUNT(*)
      FROM community_post_comments
      WHERE
        user_id IN (SELECT id FROM users WHERE ${userWhere})
        OR post_id IN (SELECT id FROM community_posts WHERE ${postWhere})
        OR body LIKE ?
    `).get(
      userPattern,
      legacyUserPattern,
      userPattern,
      legacyUserPattern,
      textPattern,
      textPattern,
      textPattern
    )
  );
  const questions = countValue(
    db.prepare(`
      SELECT COUNT(*)
      FROM community_post_questions
      WHERE
        user_id IN (SELECT id FROM users WHERE ${userWhere})
        OR post_id IN (SELECT id FROM community_posts WHERE ${postWhere})
        OR body LIKE ?
    `).get(
      userPattern,
      legacyUserPattern,
      userPattern,
      legacyUserPattern,
      textPattern,
      textPattern,
      textPattern
    )
  );
  const reactions = countValue(
    db.prepare(`
      SELECT COUNT(*)
      FROM community_post_reactions
      WHERE
        user_id IN (SELECT id FROM users WHERE ${userWhere})
        OR post_id IN (SELECT id FROM community_posts WHERE ${postWhere})
    `).get(
      userPattern,
      legacyUserPattern,
      userPattern,
      legacyUserPattern,
      textPattern,
      textPattern
    )
  );
  const observations = countValue(
    db.prepare(`SELECT COUNT(*) FROM observations WHERE ${observationWhere}`).get(
      userPattern,
      legacyUserPattern,
      prefix,
      textPattern
    )
  );
  const communityImages = db.prepare(`
    SELECT storage_path
    FROM community_post_images
    WHERE post_id IN (SELECT id FROM community_posts WHERE ${postWhere})
  `).all(userPattern, legacyUserPattern, textPattern, textPattern);
  const observationImages = db.prepare(`
    SELECT image_url
    FROM observations
    WHERE (${observationWhere}) AND image_url <> ''
  `).all(userPattern, legacyUserPattern, prefix, textPattern);

  return {
    users,
    posts,
    comments,
    questions,
    reactions,
    observations,
    communityImages: communityImages.length,
    observationImages: observationImages.length,
    communityImageRows: communityImages,
    observationImageRows: observationImages,
  };
}

function removeFiles(rows, uploadDir, fieldName, dryRun) {
  const resolvedUploadDir = path.resolve(uploadDir);
  let removed = 0;
  let skipped = 0;

  for (const row of rows) {
    const storageFile = row[fieldName] || "";
    if (!storageFile) continue;

    const filePath = path.resolve(resolvedUploadDir, storageFile);
    if (!filePath.startsWith(`${resolvedUploadDir}${path.sep}`)) {
      skipped += 1;
      continue;
    }

    if (!fs.existsSync(filePath)) {
      skipped += 1;
      continue;
    }

    if (!dryRun) {
      fs.rmSync(filePath, { force: true });
    }
    removed += 1;
  }

  return { removed, skipped };
}

function deleteRows(db, prefix) {
  const userPattern = `${prefix}-%@example.test`;
  const legacyUserPattern = `${prefix}-%@example.com`;
  const textPattern = `[${prefix}]%`;

  db.exec("BEGIN");
  try {
    db.prepare(`
      DELETE FROM community_posts
      WHERE
        user_id IN (SELECT id FROM users WHERE email LIKE ? OR email LIKE ?)
        OR title LIKE ?
        OR body LIKE ?
    `).run(userPattern, legacyUserPattern, textPattern, textPattern);

    db.prepare(`
      DELETE FROM observations
      WHERE
        user_id IN (SELECT id FROM users WHERE email LIKE ? OR email LIKE ?)
        OR source = ?
        OR notes LIKE ?
    `).run(userPattern, legacyUserPattern, prefix, textPattern);

    db.prepare("DELETE FROM users WHERE email LIKE ? OR email LIKE ?").run(userPattern, legacyUserPattern);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function printSummary(label, summary) {
  console.log(`\n${label}`);
  console.log(`users: ${summary.users}`);
  console.log(`posts: ${summary.posts}`);
  console.log(`comments: ${summary.comments}`);
  console.log(`questions: ${summary.questions}`);
  console.log(`reactions: ${summary.reactions}`);
  console.log(`observations: ${summary.observations}`);
  console.log(`community images: ${summary.communityImages}`);
  console.log(`observation images: ${summary.observationImages}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const prefix = normalizePrefix(args.prefix);
  const dryRun = !args.yes;
  const databaseFile = resolveDatabaseFile();
  const communityUploadDir = resolveUploadDir("COMMUNITY_UPLOAD_DIR", "community");
  const observationUploadDir = resolveUploadDir("OBSERVATION_UPLOAD_DIR", "observations");

  assertCleanupSafety(prefix, databaseFile, communityUploadDir, observationUploadDir);

  const db = getDatabase();
  db.exec("PRAGMA foreign_keys = ON");

  console.log(`Cleanup prefix: ${prefix}`);
  console.log(`Mode: ${dryRun ? "dry-run" : "apply"}`);
  console.log(`DATABASE_FILE: ${databaseFile}`);
  console.log(`COMMUNITY_UPLOAD_DIR: ${communityUploadDir}`);
  console.log(`OBSERVATION_UPLOAD_DIR: ${observationUploadDir}`);

  const before = collectSummary(db, prefix);
  printSummary("Before cleanup", before);

  if (dryRun) {
    console.log("\nDry run only. Re-run with --yes to delete the rows and files listed above.");
    return;
  }

  deleteRows(db, prefix);
  const communityFiles = removeFiles(before.communityImageRows, communityUploadDir, "storage_path", false);
  const observationFiles = removeFiles(before.observationImageRows, observationUploadDir, "image_url", false);
  const after = collectSummary(db, prefix);

  printSummary("After cleanup", after);
  console.log(`\nDeleted community image files: ${communityFiles.removed}, skipped: ${communityFiles.skipped}`);
  console.log(`Deleted observation image files: ${observationFiles.removed}, skipped: ${observationFiles.skipped}`);
}

try {
  main();
} catch (error) {
  console.error(`Cleanup refused: ${error.message}`);
  process.exitCode = 1;
}
