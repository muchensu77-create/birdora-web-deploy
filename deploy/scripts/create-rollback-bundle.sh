#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit

APP_ROOT="/var/www/birdora-web"
RELEASE_ROOT="$APP_ROOT/releases"
PUBLIC_RELEASE_ROOT="$APP_ROOT/.public-releases"
ACTIVE_PUBLIC_LINK="$APP_ROOT/.active-public"
DATA_DIR="/var/lib/birdora"
PROTECTED_DATA_DIR="/var/lib/birdora-protected"
CURRENT_RELEASE_FILE="/var/lib/birdora-control/current-release.json"
PM2_APP="birdora-web-auth"
CANDIDATE_RELEASE_DIR="${CANDIDATE_RELEASE_DIR:?CANDIDATE_RELEASE_DIR is required}"
PREVIOUS_RUNTIME_DIRECTORY="${PREVIOUS_RUNTIME_DIRECTORY:-}"
CURRENT_REVISION="${CURRENT_REVISION:?CURRENT_REVISION is required}"
ARTIFACT_MANIFEST_SHA256="${ARTIFACT_MANIFEST_SHA256:?ARTIFACT_MANIFEST_SHA256 is required}"
NODE_BIN="${NODE_BIN:?NODE_BIN is required}"
BUNDLE_ROOT="$PROTECTED_DATA_DIR/rollback-bundles"
PREVIOUS_NGINX_CONFIG="${PREVIOUS_NGINX_CONFIG:-}"
LIVE_SOURCE_IDENTITY="${LIVE_SOURCE_IDENTITY:-null}"
MIN_FREE_MARGIN_BYTES=$((64 * 1024 * 1024))

if [[ ! -d "$CANDIDATE_RELEASE_DIR" || ! -d "$APP_ROOT" || ! -d "$RELEASE_ROOT" || ! -d "$DATA_DIR" || ! -d "$PROTECTED_DATA_DIR" ]]; then
  echo "ERROR: candidate, application, data, and protected recovery roots must exist before creating a rollback bundle." >&2
  exit 1
fi
if [[ -L "$CANDIDATE_RELEASE_DIR" || -L "$APP_ROOT" || -L "$RELEASE_ROOT" || -L "$DATA_DIR" || -L "$PROTECTED_DATA_DIR" || -L "$BUNDLE_ROOT" ]]; then
  echo "ERROR: application, data, and rollback-bundle roots must not be symbolic links." >&2
  exit 1
fi
APP_DIR_RESOLVED="$(realpath -e "$CANDIDATE_RELEASE_DIR")"
APP_ROOT_RESOLVED="$(realpath -e "$APP_ROOT")"
RELEASE_ROOT_RESOLVED="$(realpath -e "$RELEASE_ROOT")"
DATA_DIR_RESOLVED="$(realpath -e "$DATA_DIR")"
PROTECTED_DATA_DIR_RESOLVED="$(realpath -e "$PROTECTED_DATA_DIR")"
if [[ "$APP_DIR_RESOLVED" == "/" || "$DATA_DIR_RESOLVED" == "/" ]]; then
  echo "ERROR: refusing to use the filesystem root as an application or data directory." >&2
  exit 1
fi
if [[ "$(dirname "$APP_DIR_RESOLVED")" != "$RELEASE_ROOT_RESOLVED" ]]; then
  echo "ERROR: candidate release is not a direct child of $RELEASE_ROOT_RESOLVED" >&2
  exit 1
fi
APP_DIR="$APP_DIR_RESOLVED"

if command -v pm2 >/dev/null 2>&1; then
  APP_PID="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  if [[ "$APP_PID" =~ ^[0-9]+$ ]] && (( APP_PID > 0 )); then
    echo "ERROR: $PM2_APP is still running (pid=$APP_PID). Stop writes before snapshotting media." >&2
    exit 1
  fi
fi

ACTIVE_PUBLIC_TARGET=""
ACTIVE_PUBLIC_MANIFEST_SOURCE=""
if [[ -L "$ACTIVE_PUBLIC_LINK" ]]; then
  ACTIVE_PUBLIC_TARGET="$(readlink -f "$ACTIVE_PUBLIC_LINK")"
  if [[ "$ACTIVE_PUBLIC_TARGET" != "$APP_ROOT/public" \
    && "$(dirname "$ACTIVE_PUBLIC_TARGET")" != "$PUBLIC_RELEASE_ROOT" ]]; then
    echo "ERROR: active public target escapes the controlled public roots: $ACTIVE_PUBLIC_TARGET" >&2
    exit 1
  fi
  if [[ ! -d "$ACTIVE_PUBLIC_TARGET" ]]; then
    echo "ERROR: active public target is missing: $ACTIVE_PUBLIC_TARGET" >&2
    exit 1
  fi
  if [[ -f "$ACTIVE_PUBLIC_TARGET/.release-manifest.json" ]]; then
    ACTIVE_PUBLIC_MANIFEST_SOURCE="$ACTIVE_PUBLIC_TARGET/.release-manifest.json"
  fi
fi

if [[ ! -d "$BUNDLE_ROOT" || -L "$BUNDLE_ROOT" \
  || "$(stat -c '%U:%G' "$BUNDLE_ROOT")" != "root:root" \
  || "$(stat -c '%a' "$BUNDLE_ROOT")" != "700" ]]; then
  echo "ERROR: rollback bundle root must be pre-provisioned root:root mode-0700: $BUNDLE_ROOT" >&2
  exit 1
fi
BUNDLE_ROOT_RESOLVED="$(realpath -e "$BUNDLE_ROOT")"
case "$BUNDLE_ROOT_RESOLVED" in
  "$PROTECTED_DATA_DIR_RESOLVED"/*) ;;
  *)
    echo "ERROR: rollback bundle root escapes the root-only recovery directory: $BUNDLE_ROOT_RESOLVED" >&2
    exit 1
    ;;
esac
chmod 700 "$BUNDLE_ROOT"
BUNDLE_ID="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BUNDLE_DIR="$BUNDLE_ROOT/$BUNDLE_ID"
mkdir "$BUNDLE_DIR"
chmod 700 "$BUNDLE_DIR"
BUNDLE_COMPLETE=0

cleanup_incomplete_bundle() {
  if [[ -d "$BUNDLE_DIR" && "$BUNDLE_COMPLETE" != "1" ]]; then
    mv "$BUNDLE_DIR" "${BUNDLE_DIR}.incomplete" 2>/dev/null || true
  fi
}
trap cleanup_incomplete_bundle EXIT

if [[ -n "$ACTIVE_PUBLIC_MANIFEST_SOURCE" ]]; then
  cp -a "$ACTIVE_PUBLIC_MANIFEST_SOURCE" "$BUNDLE_DIR/public-before-update.manifest.json"
fi

MEDIA_DIR="$DATA_DIR/uploads"
if [[ -L "$MEDIA_DIR" ]]; then
  echo "ERROR: $MEDIA_DIR is a symbolic link; the rollback archive could omit its target." >&2
  echo "Use a separately reviewed snapshot workflow for an external media filesystem." >&2
  exit 1
fi
COMMUNITY_MEDIA_DIR="$(realpath -m "${COMMUNITY_UPLOAD_DIR:-$MEDIA_DIR/community}")"
OBSERVATION_MEDIA_DIR="$(realpath -m "${OBSERVATION_UPLOAD_DIR:-$MEDIA_DIR/observations}")"
MEDIA_DIR_RESOLVED="$(realpath -m "$MEDIA_DIR")"
for configured_media_dir in "$COMMUNITY_MEDIA_DIR" "$OBSERVATION_MEDIA_DIR"; do
  case "$configured_media_dir" in
    "$MEDIA_DIR_RESOLVED"|"$MEDIA_DIR_RESOLVED"/*) ;;
    *)
      echo "ERROR: configured upload directory is outside $MEDIA_DIR_RESOLVED: $configured_media_dir" >&2
      echo "This installer fails closed for external media roots; use a separately reviewed deployment workflow for that layout." >&2
      exit 1
      ;;
  esac
done
MEDIA_ARCHIVE="$BUNDLE_DIR/uploads.tar"
MEDIA_FILE_MANIFEST="$BUNDLE_DIR/uploads-files.sha256"
MEDIA_ARCHIVE_HASH="$BUNDLE_DIR/uploads.tar.sha256"
MEDIA_BYTES=0

if [[ -d "$MEDIA_DIR" ]]; then
  if [[ -n "$(find "$MEDIA_DIR" -type l -print -quit)" ]]; then
    echo "ERROR: symbolic links inside $MEDIA_DIR are not allowed in the verified rollback archive." >&2
    exit 1
  fi
  if [[ -n "$(find "$MEDIA_DIR" -type f -links +1 -print -quit)" ]]; then
    echo "ERROR: hard-linked media files require a separately reviewed snapshot workflow." >&2
    exit 1
  fi

  MEDIA_BYTES="$(du -sb "$MEDIA_DIR" | awk '{print $1}')"
  SOURCE_MEDIA_FILE_COUNT="$(find "$MEDIA_DIR" -type f -printf '1\n' | wc -l)"
  SOURCE_MEDIA_FILE_BYTES="$(find "$MEDIA_DIR" -type f -printf '%s\n' | awk '{total += $1} END {print total + 0}')"
  AVAILABLE_BYTES="$(df -PB1 "$BUNDLE_ROOT" | awk 'NR == 2 {print $4}')"
  REQUIRED_BYTES=$((MEDIA_BYTES + MIN_FREE_MARGIN_BYTES))
  if (( AVAILABLE_BYTES < REQUIRED_BYTES )); then
    echo "ERROR: insufficient space for media rollback snapshot: required=$REQUIRED_BYTES available=$AVAILABLE_BYTES" >&2
    exit 1
  fi

  echo "Creating immutable media snapshot ($MEDIA_BYTES bytes)..." >&2
  find "$MEDIA_DIR" -type f -print0 \
    | sort -z \
    | xargs -0 -r sha256sum > "$MEDIA_FILE_MANIFEST"
  tar --format=pax -cf "$MEDIA_ARCHIVE" -C "$DATA_DIR" uploads
  tar -tf "$MEDIA_ARCHIVE" >/dev/null
  read -r ARCHIVE_MEDIA_FILE_COUNT ARCHIVE_MEDIA_FILE_BYTES < <(
    tar --numeric-owner -tvf "$MEDIA_ARCHIVE" \
      | awk '$1 ~ /^-/ {count += 1; bytes += $3} END {print count + 0, bytes + 0}'
  )
  if [[ "$ARCHIVE_MEDIA_FILE_COUNT" != "$SOURCE_MEDIA_FILE_COUNT" \
    || "$ARCHIVE_MEDIA_FILE_BYTES" != "$SOURCE_MEDIA_FILE_BYTES" ]]; then
    echo "ERROR: media archive verification mismatch: source_files=$SOURCE_MEDIA_FILE_COUNT archive_files=$ARCHIVE_MEDIA_FILE_COUNT source_bytes=$SOURCE_MEDIA_FILE_BYTES archive_bytes=$ARCHIVE_MEDIA_FILE_BYTES" >&2
    exit 1
  fi
  sha256sum "$MEDIA_ARCHIVE" > "$MEDIA_ARCHIVE_HASH"
else
  SOURCE_MEDIA_FILE_COUNT=0
  SOURCE_MEDIA_FILE_BYTES=0
  : > "$MEDIA_FILE_MANIFEST"
  tar --format=pax -cf "$MEDIA_ARCHIVE" --files-from /dev/null
  sha256sum "$MEDIA_ARCHIVE" > "$MEDIA_ARCHIVE_HASH"
fi

CONFIG_ARCHIVE="$BUNDLE_DIR/release-config.tar"
CONFIG_FILES=()
for candidate in ecosystem.config.cjs package.json pnpm-lock.yaml compose.yaml deploy/nginx; do
  if [[ -e "$APP_DIR/$candidate" ]]; then
    CONFIG_FILES+=("$candidate")
  fi
done
tar --format=pax -cf "$CONFIG_ARCHIVE" -C "$APP_DIR" "${CONFIG_FILES[@]}"
sha256sum "$CONFIG_ARCHIVE" > "$BUNDLE_DIR/release-config.tar.sha256"

MARKER_REVISION=""
MARKER_ACTIVATION_VERIFIED="false"
if [[ -f "$CURRENT_RELEASE_FILE" ]]; then
  cp -a "$CURRENT_RELEASE_FILE" "$BUNDLE_DIR/previous-release-marker.json"
  MARKER_REVISION="$(CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" "$NODE_BIN" -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.env.CURRENT_RELEASE_FILE,"utf8")); process.stdout.write(typeof value.revision === "string" ? value.revision : "")')"
  MARKER_ACTIVATION_VERIFIED="$(CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" "$NODE_BIN" -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.env.CURRENT_RELEASE_FILE,"utf8")); process.stdout.write(value.activationVerified === true ? "true" : "false")')"
fi

PREVIOUS_RELEASE_COMMIT=""
PREVIOUS_MANIFEST_COPY=""
PREVIOUS_SIGNATURE_COPY=""
if [[ -n "$PREVIOUS_RUNTIME_DIRECTORY" ]]; then
  PREVIOUS_RUNTIME_DIRECTORY="$(realpath -e "$PREVIOUS_RUNTIME_DIRECTORY")"
  if [[ "$(dirname "$PREVIOUS_RUNTIME_DIRECTORY")" != "$RELEASE_ROOT_RESOLVED" \
    || -L "$PREVIOUS_RUNTIME_DIRECTORY" ]]; then
    echo "ERROR: previous runtime is not one physical immutable release: $PREVIOUS_RUNTIME_DIRECTORY" >&2
    exit 1
  fi
  if [[ "$MARKER_ACTIVATION_VERIFIED" != "true" || ! "$MARKER_REVISION" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: previous runtime has no verified release marker." >&2
    exit 1
  fi
  PREVIOUS_MANIFEST_COPY="$BUNDLE_DIR/previous-runtime-manifest.json"
  PREVIOUS_SIGNATURE_COPY="$BUNDLE_DIR/previous-runtime-manifest.sig"
  cp --reflink=never --preserve=mode,timestamps "$PREVIOUS_RUNTIME_DIRECTORY/.birdora-release-manifest.json" "$PREVIOUS_MANIFEST_COPY"
  cp --reflink=never --preserve=mode,timestamps "$PREVIOUS_RUNTIME_DIRECTORY/.birdora-release-manifest.sig" "$PREVIOUS_SIGNATURE_COPY"
  PREVIOUS_RELEASE_COMMIT="$(PREVIOUS_MANIFEST_COPY="$PREVIOUS_MANIFEST_COPY" "$NODE_BIN" -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(process.env.PREVIOUS_MANIFEST_COPY,"utf8")); process.stdout.write(value.revision || "")')"
  if [[ "$PREVIOUS_RELEASE_COMMIT" != "$MARKER_REVISION" ]]; then
    echo "ERROR: previous runtime manifest revision differs from the verified marker." >&2
    exit 1
  fi
  sha256sum "$PREVIOUS_MANIFEST_COPY" > "$BUNDLE_DIR/previous-runtime-manifest.json.sha256"
  sha256sum "$PREVIOUS_SIGNATURE_COPY" > "$BUNDLE_DIR/previous-runtime-manifest.sig.sha256"
fi

PREVIOUS_RELEASE_COMMIT="$PREVIOUS_RELEASE_COMMIT" \
MARKER_ACTIVATION_VERIFIED="$MARKER_ACTIVATION_VERIFIED" \
PREVIOUS_RUNTIME_DIRECTORY="$PREVIOUS_RUNTIME_DIRECTORY" \
PREVIOUS_MANIFEST_COPY="$PREVIOUS_MANIFEST_COPY" \
PREVIOUS_SIGNATURE_COPY="$PREVIOUS_SIGNATURE_COPY" \
BUNDLE_DIR="$BUNDLE_DIR" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
fs.writeFileSync(
  path.join(process.env.BUNDLE_DIR, "previous-release.json"),
  `${JSON.stringify({
    resolvedCommit: process.env.PREVIOUS_RELEASE_COMMIT || null,
    runtimeDirectory: process.env.PREVIOUS_RUNTIME_DIRECTORY || null,
    signedManifestEvidence: process.env.PREVIOUS_MANIFEST_COPY || null,
    signatureEvidence: process.env.PREVIOUS_SIGNATURE_COPY || null,
    selectedFromVerifiedMarker: process.env.MARKER_ACTIVATION_VERIFIED === "true",
    executableRollbackAllowed: false,
    rollbackPolicy: "forward-fix-only",
    warning: "Do not start legacy code against a restored database; the pre-v1.7 baseline contains destructive startup DDL.",
  }, null, 2)}\n`,
  { mode: 0o600 }
);
NODE

if [[ -n "$PREVIOUS_NGINX_CONFIG" ]]; then
  if [[ ! -f "$PREVIOUS_NGINX_CONFIG" ]]; then
    echo "ERROR: captured pre-update Nginx config is missing: $PREVIOUS_NGINX_CONFIG" >&2
    exit 1
  fi
  cp -a "$PREVIOUS_NGINX_CONFIG" "$BUNDLE_DIR/nginx-before-update.conf"
  sha256sum "$BUNDLE_DIR/nginx-before-update.conf" > "$BUNDLE_DIR/nginx-before-update.conf.sha256"
fi

if command -v pm2 >/dev/null 2>&1; then
  # Never persist pm2_env wholesale: it can contain JWT_SECRET, cookies, tokens,
  # preload controls, and unrelated application credentials.
  pm2 jlist | "$NODE_BIN" -e '
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { input += chunk; });
    process.stdin.on("end", () => {
      const apps = JSON.parse(input);
      if (!Array.isArray(apps)) throw new Error("PM2 inventory is not an array");
      const safe = apps.map((app) => ({
        name: app.name || null,
        pid: Number.isInteger(app.pid) ? app.pid : null,
        status: app.pm2_env?.status || null,
        cwd: app.pm2_env?.pm_cwd || null,
        script: app.pm2_env?.pm_exec_path || null,
        interpreter: app.pm2_env?.exec_interpreter || null,
        executionMode: app.pm2_env?.exec_mode || null,
        uid: app.pm2_env?.uid ?? null,
        gid: app.pm2_env?.gid ?? null,
        restartCount: app.pm2_env?.restart_time ?? null,
        unstableRestarts: app.pm2_env?.unstable_restarts ?? null,
        createdAt: app.pm2_env?.created_at ?? null,
        nodeVersion: app.pm2_env?.node_version || null,
      }));
      process.stdout.write(`${JSON.stringify(safe, null, 2)}\n`);
    });
  ' > "$BUNDLE_DIR/pm2-before-update.json"
  BUNDLE_DIR="$BUNDLE_DIR" "$NODE_BIN" -e 'const fs=require("fs"); const path=require("path"); const value=JSON.parse(fs.readFileSync(path.join(process.env.BUNDLE_DIR,"pm2-before-update.json"),"utf8")); if (!Array.isArray(value)) throw new Error("PM2 inventory is not an array"); if (JSON.stringify(value).toLowerCase().includes("jwt_secret")) throw new Error("PM2 evidence contains a forbidden secret key")'
fi

BUNDLE_DIR="$BUNDLE_DIR" "$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
fs.writeFileSync(
  path.join(process.env.BUNDLE_DIR, "ROLLBACK-SAFETY.txt"),
  [
    "FORWARD-FIX ONLY. DO NOT START THE LEGACY BIRDORA COMMIT AGAINST A RESTORED DATABASE.",
    "The pre-v1.7 startup path contains destructive DDL for user_point_events. Keep Nginx maintenance active,",
    "preserve this evidence bundle, and rehearse any database restore plus replacement runtime offline first.",
    "",
  ].join("\n"),
  { mode: 0o600 }
);
NODE

CANDIDATE_MANIFEST_COPY="$BUNDLE_DIR/candidate-runtime-manifest.json"
CANDIDATE_SIGNATURE_COPY="$BUNDLE_DIR/candidate-runtime-manifest.sig"
cp --reflink=never --preserve=mode,timestamps "$APP_DIR/.birdora-release-manifest.json" "$CANDIDATE_MANIFEST_COPY"
cp --reflink=never --preserve=mode,timestamps "$APP_DIR/.birdora-release-manifest.sig" "$CANDIDATE_SIGNATURE_COPY"
if [[ "$(sha256sum "$CANDIDATE_MANIFEST_COPY" | awk '{print $1}')" != "$ARTIFACT_MANIFEST_SHA256" ]]; then
  echo "ERROR: candidate manifest evidence digest differs from the verified artifact." >&2
  exit 1
fi
sha256sum "$CANDIDATE_MANIFEST_COPY" > "$BUNDLE_DIR/candidate-runtime-manifest.json.sha256"
sha256sum "$CANDIDATE_SIGNATURE_COPY" > "$BUNDLE_DIR/candidate-runtime-manifest.sig.sha256"

BUNDLE_DIR="$BUNDLE_DIR" \
APP_DIR="$APP_DIR" \
DATA_DIR="$DATA_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
PREVIOUS_RELEASE_COMMIT="$PREVIOUS_RELEASE_COMMIT" \
PREVIOUS_RUNTIME_DIRECTORY="$PREVIOUS_RUNTIME_DIRECTORY" \
PREVIOUS_MANIFEST_COPY="$PREVIOUS_MANIFEST_COPY" \
PREVIOUS_SIGNATURE_COPY="$PREVIOUS_SIGNATURE_COPY" \
ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
CANDIDATE_MANIFEST_COPY="$CANDIDATE_MANIFEST_COPY" \
CANDIDATE_SIGNATURE_COPY="$CANDIDATE_SIGNATURE_COPY" \
PREVIOUS_NGINX_CONFIG="$PREVIOUS_NGINX_CONFIG" \
ACTIVE_PUBLIC_TARGET="$ACTIVE_PUBLIC_TARGET" \
LIVE_SOURCE_IDENTITY="$LIVE_SOURCE_IDENTITY" \
MEDIA_BYTES="$MEDIA_BYTES" \
SOURCE_MEDIA_FILE_COUNT="$SOURCE_MEDIA_FILE_COUNT" \
SOURCE_MEDIA_FILE_BYTES="$SOURCE_MEDIA_FILE_BYTES" \
MEDIA_ARCHIVE="$MEDIA_ARCHIVE" \
MEDIA_FILE_MANIFEST="$MEDIA_FILE_MANIFEST" \
CONFIG_ARCHIVE="$CONFIG_ARCHIVE" \
COMMUNITY_MEDIA_DIR="$COMMUNITY_MEDIA_DIR" \
OBSERVATION_MEDIA_DIR="$OBSERVATION_MEDIA_DIR" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const manifest = {
  formatVersion: 1,
  createdAt: new Date().toISOString(),
  appDirectory: process.env.APP_DIR,
  dataDirectory: process.env.DATA_DIR,
  candidateRevision: process.env.CURRENT_REVISION,
  candidateArtifact: {
    runtimeDirectory: process.env.APP_DIR,
    manifestPath: process.env.CANDIDATE_MANIFEST_COPY,
    manifestSha256: process.env.ARTIFACT_MANIFEST_SHA256,
    signaturePath: process.env.CANDIDATE_SIGNATURE_COPY,
  },
  liveSourceIdentityBeforeStop: JSON.parse(process.env.LIVE_SOURCE_IDENTITY || "null"),
  previousReleaseManifest: path.join(process.env.BUNDLE_DIR, "previous-release.json"),
  rollbackPolicy: "forward-fix-only-do-not-start-legacy-code",
  previousRuntimeEvidence: {
    commit: process.env.PREVIOUS_RELEASE_COMMIT || null,
    runtimeDirectory: process.env.PREVIOUS_RUNTIME_DIRECTORY || null,
    manifestPath: process.env.PREVIOUS_MANIFEST_COPY || null,
    manifestSha256: process.env.PREVIOUS_MANIFEST_COPY
      ? sha256(process.env.PREVIOUS_MANIFEST_COPY)
      : null,
    signaturePath: process.env.PREVIOUS_SIGNATURE_COPY || null,
    signatureSha256: process.env.PREVIOUS_SIGNATURE_COPY
      ? sha256(process.env.PREVIOUS_SIGNATURE_COPY)
      : null,
    auditOnly: true,
    executableRollbackAllowed: false,
  },
  media: {
    sourceDirectory: path.join(process.env.DATA_DIR, "uploads"),
    communitySourceDirectory: process.env.COMMUNITY_MEDIA_DIR,
    observationSourceDirectory: process.env.OBSERVATION_MEDIA_DIR,
    sourceBytes: process.env.MEDIA_BYTES,
    sourceFileCount: process.env.SOURCE_MEDIA_FILE_COUNT,
    sourceFileBytes: process.env.SOURCE_MEDIA_FILE_BYTES,
    archivePath: process.env.MEDIA_ARCHIVE,
    archiveSha256: sha256(process.env.MEDIA_ARCHIVE),
    fileManifestPath: process.env.MEDIA_FILE_MANIFEST,
  },
  configuration: {
    archivePath: process.env.CONFIG_ARCHIVE,
    archiveSha256: sha256(process.env.CONFIG_ARCHIVE),
    secretMaterialCaptured: false,
    preUpdateNginxConfigPath: process.env.PREVIOUS_NGINX_CONFIG
      ? path.join(process.env.BUNDLE_DIR, "nginx-before-update.conf")
      : null,
    pm2InventoryPath: fs.existsSync(path.join(process.env.BUNDLE_DIR, "pm2-before-update.json"))
      ? path.join(process.env.BUNDLE_DIR, "pm2-before-update.json")
      : null,
  },
  publicAssets: {
    activeTargetBeforeUpdate: process.env.ACTIVE_PUBLIC_TARGET || null,
    manifestPath: fs.existsSync(path.join(process.env.BUNDLE_DIR, "public-before-update.manifest.json"))
      ? path.join(process.env.BUNDLE_DIR, "public-before-update.manifest.json")
      : null,
    rollbackUsesAtomicPointer: true,
  },
  database: {
    status: "pending-independent-database-snapshot",
    note: "The installer must pin an independent db:backup snapshot before db:migrate can start.",
  },
};
fs.writeFileSync(
  path.join(process.env.BUNDLE_DIR, "bundle.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  { flag: "wx", mode: 0o600 }
);
NODE

find "$BUNDLE_DIR" -type d -exec chmod 700 {} \;
find "$BUNDLE_DIR" -type f -exec chmod 600 {} \;
sync
BUNDLE_COMPLETE=1
trap - EXIT

BUNDLE_DIR="$BUNDLE_DIR" "$NODE_BIN" <<'NODE'
const path = require("path");
process.stdout.write(`${JSON.stringify({
  ok: true,
  bundleDirectory: process.env.BUNDLE_DIR,
  manifestPath: path.join(process.env.BUNDLE_DIR, "bundle.json"),
})}\n`);
NODE
