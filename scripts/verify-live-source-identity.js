const fs = require("fs");
const path = require("path");

function fail(message) {
  throw new Error(message);
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function resolveConfiguredPath(value, fallback, cwd) {
  return path.resolve(cwd, value || fallback);
}

function readInitialEnvironment(pid) {
  const raw = fs.readFileSync(`/proc/${pid}/environ`);
  return new Map(
    raw.toString("utf8")
      .split("\0")
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return separator >= 0
          ? [entry.slice(0, separator), entry.slice(separator + 1)]
          : [entry, ""];
      })
  );
}

function main() {
  const pid = Number(process.env.PM2_APP_PID);
  if (!Number.isSafeInteger(pid) || pid <= 0) fail("PM2_APP_PID must be a live positive integer");

  const preflight = JSON.parse(process.env.PREFLIGHT_OUTPUT || "null");
  if (!preflight?.databaseExists || preflight.databaseEmpty) {
    fail("an existing PM2 writer must have a non-empty preflight database");
  }

  const procDirectory = `/proc/${pid}`;
  const cwd = fs.realpathSync(path.join(procDirectory, "cwd"));
  const initialEnvironment = readInitialEnvironment(pid);
  const candidateConfiguredDatabasePath = path.resolve(preflight.databasePath);
  const candidateDatabasePath = fs.realpathSync(candidateConfiguredDatabasePath);
  const candidateDatabaseStats = fs.statSync(candidateDatabasePath, { bigint: true });

  const oldConfiguredDatabasePath = resolveConfiguredPath(
    initialEnvironment.get("DATABASE_FILE"),
    path.join(cwd, "app", "data", "birdora.sqlite"),
    cwd
  );
  if (!fs.existsSync(oldConfiguredDatabasePath)) {
    fail(`the running PM2 process points to a missing database: ${oldConfiguredDatabasePath}`);
  }
  const oldDatabaseRealPath = fs.realpathSync(oldConfiguredDatabasePath);
  const oldDatabaseStats = fs.statSync(oldDatabaseRealPath, { bigint: true });
  if (!sameFile(candidateDatabaseStats, oldDatabaseStats)) {
    fail("candidate DATABASE_FILE is not the same device/inode used by the running PM2 process");
  }

  const openDatabaseDescriptor = fs.readdirSync(path.join(procDirectory, "fd"))
    .map((descriptor) => path.join(procDirectory, "fd", descriptor))
    .some((descriptorPath) => {
      try {
        return sameFile(candidateDatabaseStats, fs.statSync(descriptorPath, { bigint: true }));
      } catch {
        return false;
      }
    });
  if (!openDatabaseDescriptor) {
    fail("the running PM2 process has no open file descriptor for the preflight database inode");
  }

  const oldDatabaseDirectory = path.dirname(oldConfiguredDatabasePath);
  const candidateDatabaseDirectory = path.dirname(candidateConfiguredDatabasePath);
  const oldCommunityRoot = resolveConfiguredPath(
    initialEnvironment.get("COMMUNITY_UPLOAD_DIR"),
    path.join(oldDatabaseDirectory, "uploads", "community"),
    cwd
  );
  const oldObservationRoot = resolveConfiguredPath(
    initialEnvironment.get("OBSERVATION_UPLOAD_DIR"),
    path.join(oldDatabaseDirectory, "uploads", "observations"),
    cwd
  );
  const candidateCommunityRoot = path.resolve(
    process.env.COMMUNITY_UPLOAD_DIR || path.join(candidateDatabaseDirectory, "uploads", "community")
  );
  const candidateObservationRoot = path.resolve(
    process.env.OBSERVATION_UPLOAD_DIR || path.join(candidateDatabaseDirectory, "uploads", "observations")
  );
  if (oldCommunityRoot !== candidateCommunityRoot || oldObservationRoot !== candidateObservationRoot) {
    fail("candidate media roots differ from the roots used by the running PM2 process");
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    pid,
    processCwd: cwd,
    database: {
      configuredPath: oldConfiguredDatabasePath,
      realPath: candidateDatabasePath,
      device: candidateDatabaseStats.dev.toString(),
      inode: candidateDatabaseStats.ino.toString(),
    },
    mediaRoots: {
      community: candidateCommunityRoot,
      observations: candidateObservationRoot,
    },
  })}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: "LIVE_SOURCE_IDENTITY_MISMATCH",
    message: error.message,
  })}\n`);
  process.exitCode = 1;
}
