#!/usr/bin/env bash
set -Eeuo pipefail
umask 0022

if [[ "$(uname -s 2>/dev/null || true)" != "Linux" ]]; then
  echo '{"ok":false,"code":"RELEASE_BUILD_UNAVAILABLE","message":"Linux is required to build and verify production file modes","exitCode":77}' >&2
  exit 77
fi

if (( $# != 1 )); then
  echo "ERROR: usage: $0 <existing-output-root-outside-the-repository>" >&2
  exit 64
fi

for required_command in awk basename chmod dirname find getcap getfacl git mkdir mv node pnpm realpath rm sha256sum stat sync tar uname; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "ERROR: release builder requires $required_command." >&2
    exit 69
  fi
done

REPOSITORY_ROOT="$(git rev-parse --show-toplevel)"
REPOSITORY_ROOT="$(realpath "$REPOSITORY_ROOT")"
cd "$REPOSITORY_ROOT"

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "ERROR: release artifacts must be built from a completely clean committed worktree." >&2
  exit 65
fi

REVISION="$(git rev-parse --verify HEAD)"
if [[ ! "$REVISION" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: HEAD is not an exact lowercase 40-character commit." >&2
  exit 65
fi
EXPECTED_PNPM_VERSION="$(node -p 'String(require("./package.json").packageManager || "").replace(/^pnpm@/, "")')"
if [[ ! "$EXPECTED_PNPM_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ \
  || "$(pnpm --version)" != "$EXPECTED_PNPM_VERSION" ]]; then
  echo "ERROR: release build requires the exact package.json pnpm version: $EXPECTED_PNPM_VERSION" >&2
  exit 65
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 24 || (NODE_MAJOR == 24 && NODE_MINOR < 14) )); then
  echo "ERROR: release build requires Node >=24.14.0." >&2
  exit 65
fi

OUTPUT_ROOT_INPUT="$1"
if [[ -L "$OUTPUT_ROOT_INPUT" || ! -d "$OUTPUT_ROOT_INPUT" ]]; then
  echo "ERROR: output root must be one existing real directory." >&2
  exit 73
fi
OUTPUT_ROOT="$(realpath "$OUTPUT_ROOT_INPUT")"
if [[ "$OUTPUT_ROOT" != "$OUTPUT_ROOT_INPUT" && "$OUTPUT_ROOT_INPUT" == /* ]]; then
  echo "ERROR: output root must use its canonical physical path: $OUTPUT_ROOT" >&2
  exit 73
fi
case "$OUTPUT_ROOT" in
  "$REPOSITORY_ROOT"|"$REPOSITORY_ROOT"/*|/etc|/etc/*|/usr|/usr/*|/var/lib/birdora|/var/lib/birdora/*|/var/www/birdora-web|/var/www/birdora-web/*)
    echo "ERROR: build output must remain outside the repository and all production namespaces." >&2
    exit 73
    ;;
esac

STAGING_DIRECTORY="$OUTPUT_ROOT/.birdora-release-stage-$REVISION-$$"
if [[ -e "$STAGING_DIRECTORY" || -L "$STAGING_DIRECTORY" ]]; then
  echo "ERROR: release staging path already exists: $STAGING_DIRECTORY" >&2
  exit 73
fi

cleanup() {
  if [[ -n "${STAGING_DIRECTORY:-}" \
    && "$(dirname "$STAGING_DIRECTORY")" == "$OUTPUT_ROOT" \
    && "$(basename "$STAGING_DIRECTORY")" == .birdora-release-stage-* ]]; then
    rm -rf -- "$STAGING_DIRECTORY"
  fi
}
trap cleanup EXIT HUP INT TERM

mkdir -m 0755 -- "$STAGING_DIRECTORY"
git archive --format=tar "$REVISION" | tar -xf - -C "$STAGING_DIRECTORY"

pnpm --dir "$STAGING_DIRECTORY" install \
  --prod \
  --frozen-lockfile \
  --config.node-linker=hoisted \
  --config.package-import-method=copy

# Runtime code is loaded by Node/bash rather than executed directly. A uniform
# read-only mode makes signed mode comparison deterministic across transfers.
find "$STAGING_DIRECTORY" -xdev -type d -exec chmod 0755 {} +
find "$STAGING_DIRECTORY" -xdev -type f -exec chmod 0644 {} +

assert_materialized_tree() {
  local first_symlink=""
  local first_hardlink=""
  local capabilities=""
  local extended_acls=""
  first_symlink="$(find "$STAGING_DIRECTORY" -xdev -type l -print -quit)"
  first_hardlink="$(find "$STAGING_DIRECTORY" -xdev -type f -links +1 -print -quit)"
  if [[ -n "$first_symlink" ]]; then
    echo "ERROR: materialized release still contains a symbolic link: $first_symlink" >&2
    exit 74
  fi
  if [[ -n "$first_hardlink" ]]; then
    echo "ERROR: materialized release still contains a hard-linked file: $first_hardlink" >&2
    exit 74
  fi
  if ! capabilities="$(getcap -r "$STAGING_DIRECTORY")"; then
    echo "ERROR: Linux capability scan failed; refusing an unverifiable release." >&2
    exit 74
  fi
  if ! extended_acls="$(getfacl --absolute-names --skip-base -R "$STAGING_DIRECTORY")"; then
    echo "ERROR: extended ACL scan failed; refusing an unverifiable release." >&2
    exit 74
  fi
  if [[ -n "$capabilities" ]]; then
    echo "ERROR: release contains Linux file capabilities: $capabilities" >&2
    exit 74
  fi
  if [[ -n "$extended_acls" ]]; then
    echo "ERROR: release contains extended ACL entries: $extended_acls" >&2
    exit 74
  fi
}

assert_materialized_tree
RELEASE_DIR="$STAGING_DIRECTORY" RELEASE_REVISION="$REVISION" \
  node "$STAGING_DIRECTORY/scripts/create-release-evidence.js"

# Evidence creation adds one file. Freeze all modes again, then create the
# complete manifest only after a second filesystem-security scan.
find "$STAGING_DIRECTORY" -xdev -type d -exec chmod 0755 {} +
find "$STAGING_DIRECTORY" -xdev -type f -exec chmod 0644 {} +
assert_materialized_tree
pnpm --dir "$STAGING_DIRECTORY" list --prod --depth 0 >/dev/null
RELEASE_DIR="$STAGING_DIRECTORY" RELEASE_REVISION="$REVISION" \
  node "$STAGING_DIRECTORY/scripts/create-release-manifest.js"

MANIFEST_PATH="$STAGING_DIRECTORY/.birdora-release-manifest.json"
MANIFEST_SHA256="$(sha256sum "$MANIFEST_PATH" | awk '{print $1}')"
if [[ ! "$MANIFEST_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "ERROR: release manifest digest is invalid." >&2
  exit 74
fi
FINAL_DIRECTORY="$OUTPUT_ROOT/$REVISION-${MANIFEST_SHA256:0:16}"
if [[ -e "$FINAL_DIRECTORY" || -L "$FINAL_DIRECTORY" ]]; then
  echo "ERROR: immutable release output already exists: $FINAL_DIRECTORY" >&2
  exit 73
fi

sync -f "$STAGING_DIRECTORY"
mv -T -- "$STAGING_DIRECTORY" "$FINAL_DIRECTORY"
STAGING_DIRECTORY=""
sync -f "$OUTPUT_ROOT"

FINAL_DIRECTORY="$FINAL_DIRECTORY" REVISION="$REVISION" MANIFEST_SHA256="$MANIFEST_SHA256" node -e '
  process.stdout.write(`${JSON.stringify({
    ok: true,
    status: "UNSIGNED_ARTIFACT_READY",
    releaseDirectory: process.env.FINAL_DIRECTORY,
    revision: process.env.REVISION,
    manifestSha256: process.env.MANIFEST_SHA256,
    nextRequiredAction: "Sign .birdora-release-manifest.json with the approved offline private key, write .birdora-release-manifest.sig mode 0644, then verify before transport",
  })}\n`);
'
