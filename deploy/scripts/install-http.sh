#!/usr/bin/env bash
set -Eeuo pipefail
shopt -s inherit_errexit
shopt -u varredir_close
umask 0027

APP_ROOT="/var/www/birdora-web"
RELEASE_ROOT="$APP_ROOT/releases"
RUNTIME_LINK="$APP_ROOT/current"
DATA_DIR="/var/lib/birdora"
PROTECTED_DATA_DIR="/var/lib/birdora-protected"
ROLLBACK_BUNDLE_ROOT="$PROTECTED_DATA_DIR/rollback-bundles"
SITE_NAME="birdora.birdai-glasses.com"
PM2_APP="birdora-web-auth"
PM2_HOME="/var/lib/birdora/pm2"
ENV_FILE="/etc/birdora/birdora-web-auth.env"
RELEASE_PUBLIC_KEY="/etc/birdora/release-signing-public.pem"
DATABASE_LIFECYCLE_LOCK="/var/lock/birdora-db-maintenance.lock"
NGINX_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"
MAINTENANCE_DIR="/var/lib/birdora-maintenance"
MAINTENANCE_FLAG="$MAINTENANCE_DIR/maintenance.flag"
ACTIVATION_CONTROL_DIR="/var/lib/birdora-control"
ACTIVATION_PENDING_FILE="$ACTIVATION_CONTROL_DIR/activation-pending.json"
CURRENT_RELEASE_FILE="$ACTIVATION_CONTROL_DIR/current-release.json"
DEPLOY_LOCK_FILE="/var/lock/birdora-web.deploy.lock"
CONTROLLER_DIR="$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")"
EXPECTED_CONTROLLER_DIR="/usr/local/libexec/birdora"
CONTROLLER_PROTOCOL_VERSION="1"
if [[ "$CONTROLLER_DIR" != "$EXPECTED_CONTROLLER_DIR" ]]; then
  echo "ERROR: production deployment controller must be installed outside every release at $EXPECTED_CONTROLLER_DIR." >&2
  exit 1
fi
if (( $# != 1 )); then
  echo "ERROR: usage: $0 /var/www/birdora-web/releases/<immutable-release-id>" >&2
  exit 1
fi
if [[ "${BIRDORA_ENV_SANITIZED:-false}" != "true" \
  || "${BIRDORA_DEPLOY_LOCK_HELD:-false}" != "true" \
  || "${BIRDORA_CONTROLLER_PROTOCOL_VERSION:-}" != "$CONTROLLER_PROTOCOL_VERSION" ]]; then
  echo "ERROR: invoke the trusted launcher directly with env -i; it supplies both the strict environment and deployment lock." >&2
  exit 1
fi

CANDIDATE_INPUT="$1"
if [[ -L "$CANDIDATE_INPUT" || ! -d "$CANDIDATE_INPUT" ]]; then
  echo "ERROR: candidate release must be one real directory, not a symlink: $CANDIDATE_INPUT" >&2
  exit 1
fi
APP_DIR="$(readlink -f "$CANDIDATE_INPUT")"
if [[ ! -d "$APP_ROOT" || -L "$APP_ROOT" || ! -d "$RELEASE_ROOT" || -L "$RELEASE_ROOT" ]]; then
  echo "ERROR: immutable application and release roots must be pre-created real directories." >&2
  exit 1
fi
for trusted_release_root in "$APP_ROOT" "$RELEASE_ROOT"; do
  if [[ "$(readlink -f "$trusted_release_root")" != "$trusted_release_root" \
    || "$(stat -c '%u' "$trusted_release_root")" != "0" \
    || $(( 8#$(stat -c '%a' "$trusted_release_root") & 8#022 )) -ne 0 ]]; then
    echo "ERROR: immutable release root must be a physical root-owned directory without group/other write access: $trusted_release_root" >&2
    exit 1
  fi
done
if [[ "$(readlink -f "$RELEASE_ROOT")" != "$RELEASE_ROOT" || "$(dirname "$APP_DIR")" != "$RELEASE_ROOT" ]]; then
  echo "ERROR: candidate must be a direct physical child of $RELEASE_ROOT: $APP_DIR" >&2
  exit 1
fi
new_service_started=0
old_service_stopped=0
runtime_switched=0
DATABASE_LOCK_FD=""
NEW_APP_PID=""
NGINX_STATE_CAPTURED=0
NGINX_ORIGINAL_AVAILABLE_PRESENT=0
NGINX_ORIGINAL_ENABLED_STATE="absent"
NGINX_ORIGINAL_ENABLED_TARGET=""
PREVIOUS_NGINX_CONFIG=""
PUBLIC_RELEASE_ROOT="$APP_ROOT/.public-releases"
ACTIVE_PUBLIC_LINK="$APP_ROOT/.active-public"
PREVIOUS_PUBLIC_TARGET=""
PREVIOUS_RUNTIME_TARGET=""
PREVIOUS_MARKER_SHA256=""
public_switched=0
readonly APP_ROOT RELEASE_ROOT RUNTIME_LINK APP_DIR DATA_DIR PROTECTED_DATA_DIR ROLLBACK_BUNDLE_ROOT SITE_NAME PM2_APP PM2_HOME ENV_FILE RELEASE_PUBLIC_KEY DATABASE_LIFECYCLE_LOCK
readonly NGINX_AVAILABLE NGINX_ENABLED MAINTENANCE_DIR MAINTENANCE_FLAG ACTIVATION_CONTROL_DIR ACTIVATION_PENDING_FILE CURRENT_RELEASE_FILE DEPLOY_LOCK_FILE PUBLIC_RELEASE_ROOT ACTIVE_PUBLIC_LINK CONTROLLER_PROTOCOL_VERSION

if [[ -L "$APP_DIR" || -L "$DATA_DIR" || -L "$MAINTENANCE_DIR" ]]; then
  echo "ERROR: application, data, and maintenance roots must be real directories, not symbolic links." >&2
  exit 1
fi

if ! command -v flock >/dev/null 2>&1; then
  echo "ERROR: util-linux flock is required for a serialized production update." >&2
  exit 1
fi
DEPLOY_LOCK_FILE_RESOLVED="$(readlink -f "$DEPLOY_LOCK_FILE" 2>/dev/null || true)"
LOCK_PARENT_EXECUTABLE="$(readlink -f "/proc/$PPID/exe" 2>/dev/null || true)"
LOCK_PARENT_HOLDS_FILE=0
for lock_parent_fd in "/proc/$PPID/fd/"*; do
  if [[ "$(readlink -f "$lock_parent_fd" 2>/dev/null || true)" == "$DEPLOY_LOCK_FILE_RESOLVED" ]]; then
    LOCK_PARENT_HOLDS_FILE=1
    break
  fi
done
if [[ "$(basename "$LOCK_PARENT_EXECUTABLE")" != "flock" || "$LOCK_PARENT_HOLDS_FILE" != "1" ]]; then
  echo "ERROR: BIRDORA_DEPLOY_LOCK_HELD was not issued by the parent flock process; refusing a lock bypass." >&2
  exit 1
fi
LOCK_LAUNCHER_PID="$(awk '/^PPid:/ { print $2 }' "/proc/$PPID/status" 2>/dev/null || true)"
LOCK_LAUNCHER_EXECUTABLE="$(readlink -f "/proc/$LOCK_LAUNCHER_PID/exe" 2>/dev/null || true)"
LOCK_LAUNCHER_CMDLINE="$(tr '\0' ' ' < "/proc/$LOCK_LAUNCHER_PID/cmdline" 2>/dev/null || true)"
if [[ -z "$LOCK_LAUNCHER_PID" \
  || "$LOCK_LAUNCHER_PID" != "${BIRDORA_ENV_SANITIZED_BY_PID:-}" \
  || "$LOCK_LAUNCHER_EXECUTABLE" != "/opt/node-v24/bin/node" \
  || "$LOCK_LAUNCHER_CMDLINE" != *"$EXPECTED_CONTROLLER_DIR/run-with-production-env.js"* \
  || "$LOCK_LAUNCHER_CMDLINE" != *"$APP_DIR"* ]]; then
  echo "ERROR: deployment lock parent is not the trusted strict environment launcher." >&2
  exit 1
fi
export DEPLOY_LOCK_FILE
export DEPLOY_LOCK_OWNER_PID="$PPID"

export PM2_HOME
cd "$APP_DIR"

require_pm2_app() {
  local app_name="$1"
  if ! pm2 describe "$app_name" >/dev/null 2>&1; then
    echo "ERROR: required existing PM2 service is not visible in this PM2 user: $app_name" >&2
    pm2 status || true
    exit 1
  fi
}

persist_empty_pm2_inventory() {
  local dump_file="$PM2_HOME/dump.pm2"
  pm2 save --force
  # PM2 rotates the previous main dump into dump.pm2.bak. Save the already
  # empty inventory a second time so both resurrection candidates become empty.
  pm2 save --force
  PM2_DUMP_FILE="$dump_file" PM2_HOME="$PM2_HOME" "$NODE_BIN" -e '
    const fs = require("fs");
    for (const file of [process.env.PM2_DUMP_FILE, `${process.env.PM2_DUMP_FILE}.bak`]) {
      const descriptor = fs.openSync(file, fs.constants.O_RDWR | (fs.constants.O_NOFOLLOW || 0));
      try {
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 16 * 1024 * 1024) {
          throw new Error(`PM2 dump must be one bounded regular file: ${file}`);
        }
        if (process.platform === "linux" && (stats.uid !== 0 || (stats.mode & 0o022) !== 0)) {
          throw new Error(`PM2 dump must be root-owned and not group/other writable: ${file}`);
        }
        const dump = JSON.parse(fs.readFileSync(descriptor, "utf8"));
        if (!Array.isArray(dump) || dump.length !== 0) {
          throw new Error(`PM2 persisted inventory is not empty after forced save: ${file}`);
        }
        fs.fsyncSync(descriptor);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    const directoryDescriptor = fs.openSync(process.env.PM2_HOME, fs.constants.O_RDONLY);
    try { fs.fsyncSync(directoryDescriptor); } finally { fs.closeSync(directoryDescriptor); }
  '
}

wait_for_health() {
  local url="$1"
  local attempts="${2:-30}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS --noproxy '*' --connect-timeout 2 --max-time 5 "$url" >/dev/null; then
      curl -fsS --noproxy '*' --connect-timeout 2 --max-time 5 "$url"
      echo
      return 0
    fi

    sleep 1
  done

  echo "ERROR: health check did not pass after ${attempts}s: $url" >&2
  pm2 logs "$PM2_APP" --lines 80 --nostream || true
  exit 1
}

atomic_replace_file() {
  local source_file="$1"
  local destination_file="$2"
  local file_mode="${3:-0644}"
  local temporary_file="${destination_file}.next.$$"
  rm -f "$temporary_file" || return 1
  install -o root -g root -m "$file_mode" "$source_file" "$temporary_file" || return 1
  sync -f "$temporary_file" || return 1
  mv -Tf "$temporary_file" "$destination_file" || return 1
  sync -f "$(dirname "$destination_file")" || return 1
}

capture_pre_update_nginx() {
  if (( NGINX_STATE_CAPTURED )); then
    return
  fi

  if [[ -L "$NGINX_AVAILABLE" ]]; then
    echo "ERROR: $NGINX_AVAILABLE must be a regular file, not a symbolic link." >&2
    exit 1
  fi
  if [[ -f "$NGINX_AVAILABLE" ]]; then
    NGINX_ORIGINAL_AVAILABLE_PRESENT=1
    PREVIOUS_NGINX_CONFIG="${NGINX_AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
    atomic_replace_file "$NGINX_AVAILABLE" "$PREVIOUS_NGINX_CONFIG"
  fi

  if [[ -L "$NGINX_ENABLED" ]]; then
    NGINX_ORIGINAL_ENABLED_STATE="symlink"
    NGINX_ORIGINAL_ENABLED_TARGET="$(readlink "$NGINX_ENABLED")"
    if [[ "$(readlink -f "$NGINX_ENABLED")" != "$(readlink -f "$NGINX_AVAILABLE")" ]]; then
      echo "ERROR: the enabled Birdora Nginx symlink does not target $NGINX_AVAILABLE." >&2
      exit 1
    fi
  elif [[ -e "$NGINX_ENABLED" ]]; then
    echo "ERROR: $NGINX_ENABLED is not a symlink; use a separately reviewed Nginx deployment." >&2
    exit 1
  fi

  NGINX_STATE_CAPTURED=1
}

restore_pre_update_nginx() {
  local restore_ok=1
  set +e
  if (( NGINX_ORIGINAL_AVAILABLE_PRESENT )); then
    atomic_replace_file "$PREVIOUS_NGINX_CONFIG" "$NGINX_AVAILABLE" || restore_ok=0
  else
    rm -f "$NGINX_AVAILABLE" || restore_ok=0
    sync -f "$(dirname "$NGINX_AVAILABLE")" || restore_ok=0
  fi

  rm -f "$NGINX_ENABLED" || restore_ok=0
  if [[ "$NGINX_ORIGINAL_ENABLED_STATE" == "symlink" ]]; then
    ln -s "$NGINX_ORIGINAL_ENABLED_TARGET" "$NGINX_ENABLED" || restore_ok=0
  fi

  if (( restore_ok )) && nginx -t && systemctl reload nginx; then
    echo "Restored the pre-update Nginx configuration." >&2
    return 0
  else
    echo "CRITICAL: failed to restore the pre-update Nginx configuration; stop and repair Nginx manually." >&2
    return 1
  fi
}

install_nginx_site() {
  local source_config="$1"
  local restore_on_failure="${2:-false}"
  local nginx_master_pid=""
  local old_worker_pids=""
  local old_workers_alive=""

  capture_pre_update_nginx
  atomic_replace_file "$source_config" "$NGINX_AVAILABLE"
  if [[ ! -L "$NGINX_ENABLED" ]]; then
    ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
  fi

  if ! nginx -t; then
    echo "ERROR: nginx config test failed." >&2
    if [[ "$restore_on_failure" == "true" ]]; then
      restore_pre_update_nginx
    fi
    exit 1
  fi

  if [[ ! -r /run/nginx.pid ]]; then
    echo "ERROR: cannot prove the active Nginx master from /run/nginx.pid." >&2
    if [[ "$restore_on_failure" == "true" ]]; then
      restore_pre_update_nginx
    fi
    exit 1
  fi
  nginx_master_pid="$(< /run/nginx.pid)"
  if [[ ! "$nginx_master_pid" =~ ^[0-9]+$ ]] || ! kill -0 "$nginx_master_pid" 2>/dev/null; then
    echo "ERROR: the Nginx master PID is invalid or not running: $nginx_master_pid" >&2
    if [[ "$restore_on_failure" == "true" ]]; then
      restore_pre_update_nginx
    fi
    exit 1
  fi
  old_worker_pids="$(ps -eo pid=,ppid=,args= \
    | awk -v master="$nginx_master_pid" '$2 == master && $0 ~ /nginx: worker process/ {print $1}')"
  if [[ -z "$old_worker_pids" ]]; then
    echo "ERROR: no active Nginx workers could be enumerated before reload." >&2
    if [[ "$restore_on_failure" == "true" ]]; then
      restore_pre_update_nginx
    fi
    exit 1
  fi

  if ! systemctl reload nginx; then
    echo "ERROR: nginx reload failed." >&2
    if [[ "$restore_on_failure" == "true" ]]; then
      restore_pre_update_nginx
    fi
    exit 1
  fi

  for ((worker_attempt = 1; worker_attempt <= 60; worker_attempt += 1)); do
    old_workers_alive=""
    for worker_pid in $old_worker_pids; do
      if kill -0 "$worker_pid" 2>/dev/null; then
        old_workers_alive+=" $worker_pid"
      fi
    done
    if [[ -z "$old_workers_alive" ]]; then
      return 0
    fi
    sleep 1
  done

  echo "ERROR: pre-reload Nginx worker(s) did not drain:$old_workers_alive" >&2
  if [[ "$restore_on_failure" == "true" ]]; then
    restore_pre_update_nginx
  fi
  exit 1
}

echo "== Refuse unsafe environment =="
if [[ -e "$APP_DIR/.env" || -L "$APP_DIR/.env" ]]; then
  echo "ERROR: immutable releases must not contain a production .env file." >&2
  exit 1
fi
if [[ -L "$ENV_FILE" || ! -f "$ENV_FILE" || "$(stat -c '%h' "$ENV_FILE")" != "1" ]]; then
  echo "ERROR: external production environment must be one regular, single-link file: $ENV_FILE" >&2
  exit 1
fi
if [[ "$(stat -c '%u' "$ENV_FILE")" != "0" || "$(stat -c '%a' "$ENV_FILE")" != "600" ]]; then
  echo "ERROR: $ENV_FILE must be root-owned with mode 0600." >&2
  exit 1
fi
# The trusted Node wrapper parsed a strict KEY=VALUE grammar and launched this
# controller with a clean allowlisted environment. This shell never sources it.
new_service_started=0
old_service_stopped=0
runtime_switched=0
DATABASE_LOCK_FD=""
NEW_APP_PID=""
NGINX_STATE_CAPTURED=0
NGINX_ORIGINAL_AVAILABLE_PRESENT=0
NGINX_ORIGINAL_ENABLED_STATE="absent"
NGINX_ORIGINAL_ENABLED_TARGET=""
PREVIOUS_NGINX_CONFIG=""
PREVIOUS_PUBLIC_TARGET=""
PREVIOUS_RUNTIME_TARGET=""
public_switched=0

if [[ -z "${JWT_SECRET:-}" || "${#JWT_SECRET}" -lt 32 || "$JWT_SECRET" == replace-with-* ]]; then
  echo "ERROR: external JWT_SECRET is missing, too short, or still a placeholder." >&2
  exit 1
fi

if [[ "${HOST:-}" != "127.0.0.1" || "${PORT:-}" != "3003" ]]; then
  echo "ERROR: production updates require HOST=127.0.0.1 and PORT=3003; got HOST=${HOST:-unset} PORT=${PORT:-unset}." >&2
  exit 1
fi
if [[ "${DATABASE_AUTO_MIGRATE:-}" != "false" \
  || "${DATABASE_BACKUP_ENABLED:-}" != "true" \
  || "${LEGACY_JSON_IMPORT_MODE:-}" != "disabled" ]]; then
  echo "ERROR: production requires DATABASE_AUTO_MIGRATE=false, DATABASE_BACKUP_ENABLED=true, and LEGACY_JSON_IMPORT_MODE=disabled." >&2
  exit 1
fi
if [[ -z "${COMMUNITY_UPLOAD_DIR:-}" \
  || -z "${OBSERVATION_UPLOAD_DIR:-}" \
  || "$COMMUNITY_UPLOAD_DIR" != /* \
  || "$OBSERVATION_UPLOAD_DIR" != /* ]]; then
  echo "ERROR: production requires explicit absolute COMMUNITY_UPLOAD_DIR and OBSERVATION_UPLOAD_DIR values." >&2
  exit 1
fi
for disabled_feature_flag in \
  ACCOUNT_DELETION_ENABLED \
  COMMUNITY_DEMO_ENABLED \
  COMMUNITY_LEGACY_LIKE_ENABLED \
  COMMUNITY_POST_EDIT_ENABLED \
  COMMUNITY_PUBLISH_ENABLED; do
  disabled_feature_value="false"
  if [[ -v "$disabled_feature_flag" ]]; then
    disabled_feature_value="${!disabled_feature_flag}"
  fi
  if [[ "$disabled_feature_value" != "false" ]]; then
    echo "ERROR: $disabled_feature_flag must remain false until its production data-safety gate is separately approved." >&2
    exit 1
  fi
done

for required_command in awk curl dirname env find getcap getfacl grep id install mktemp mv nginx pm2 pnpm ps readlink realpath rm runuser sort ss stat sync systemctl tr; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    echo "ERROR: required deployment command is missing: $required_command" >&2
    exit 1
  fi
done

NODE_BIN="$NODE_INTERPRETER"
if [[ ! -x "$NODE_BIN" || "$(readlink -f "$NODE_BIN")" != "$NODE_BIN" ]]; then
  echo "ERROR: Node interpreter must be one physical executable: $NODE_BIN" >&2
  exit 1
fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 24 || (NODE_MAJOR == 24 && NODE_MINOR < 14) )); then
  echo "ERROR: Birdora web auth requires Node >=24.14.0. Got $("$NODE_BIN" -v) from $NODE_BIN" >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
if [[ -L "$RELEASE_PUBLIC_KEY" || ! -f "$RELEASE_PUBLIC_KEY" \
  || "$(stat -c '%h' "$RELEASE_PUBLIC_KEY")" != "1" \
  || "$(stat -c '%u' "$RELEASE_PUBLIC_KEY")" != "0" \
  || $(( 8#$(stat -c '%a' "$RELEASE_PUBLIC_KEY") & 8#022 )) -ne 0 ]]; then
  echo "ERROR: release verification key must be a root-owned, non-writable regular single-link file: $RELEASE_PUBLIC_KEY" >&2
  exit 1
fi

verify_candidate_tree() {
  local verification_output=""
  local verified_revision=""
  local verified_manifest_sha256=""
  local verified_controller_protocol=""
  local release_capabilities=""
  local release_extended_acls=""
  if ! release_capabilities="$(getcap -r "$APP_DIR")"; then
    echo "ERROR: Linux capability scan failed; release trust cannot be proven." >&2
    exit 1
  fi
  if [[ -n "$release_capabilities" ]]; then
    echo "ERROR: immutable release contains Linux file capabilities." >&2
    exit 1
  fi
  if ! release_extended_acls="$(getfacl --absolute-names --skip-base -R "$APP_DIR")"; then
    echo "ERROR: extended ACL scan failed; release trust cannot be proven." >&2
    exit 1
  fi
  if [[ -n "$release_extended_acls" ]]; then
    echo "ERROR: immutable release contains extended ACL entries." >&2
    exit 1
  fi
  verification_output="$(env -i \
    HOME=/root \
    PATH="$PATH" \
    RELEASE_DIR="$APP_DIR" \
    RELEASE_PUBLIC_KEY="$RELEASE_PUBLIC_KEY" \
    RELEASE_REQUIRE_ROOT_OWNERSHIP=true \
    RELEASE_REQUIRE_IMMUTABLE_PERMISSIONS=true \
    "$NODE_BIN" "$CONTROLLER_DIR/verify-release-manifest.js")"
  verified_revision="$(ARTIFACT_JSON="$verification_output" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ARTIFACT_JSON); if (!value.ok || !value.revision) process.exit(1); process.stdout.write(value.revision)')"
  verified_manifest_sha256="$(ARTIFACT_JSON="$verification_output" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ARTIFACT_JSON); if (!value.manifestSha256) process.exit(1); process.stdout.write(value.manifestSha256)')"
  verified_controller_protocol="$(ARTIFACT_JSON="$verification_output" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ARTIFACT_JSON); process.stdout.write(String(value.controllerProtocolVersion ?? ""))')"
  if [[ "$verified_controller_protocol" != "$CONTROLLER_PROTOCOL_VERSION" ]]; then
    echo "ERROR: signed candidate deployment-controller protocol is incompatible with the installed controller." >&2
    exit 1
  fi
  if [[ -n "${CURRENT_REVISION:-}" && "$verified_revision" != "$CURRENT_REVISION" ]]; then
    echo "ERROR: signed candidate revision changed after deployment verification began." >&2
    exit 1
  fi
  if [[ -n "${ARTIFACT_MANIFEST_SHA256:-}" && "$verified_manifest_sha256" != "$ARTIFACT_MANIFEST_SHA256" ]]; then
    echo "ERROR: signed candidate manifest changed after deployment verification began." >&2
    exit 1
  fi
  CURRENT_REVISION="$verified_revision"
  ARTIFACT_MANIFEST_SHA256="$verified_manifest_sha256"
}

prove_birdora_runtime_data_access() {
  local require_activation_journal="$1"
  /usr/sbin/runuser --user birdora -- env -i \
    HOME="$DATA_DIR" \
    LANG=C.UTF-8 \
    PATH="$(dirname "$NODE_BIN"):/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
    DATA_DIRECTORY="$DATA_DIR" \
    DATABASE_FILE="$DATABASE_FILE" \
    BIRDORA_RELEASE_DIR="$APP_DIR" \
    ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
    REQUIRE_ACTIVATION_JOURNAL="$require_activation_journal" \
    "$NODE_BIN" "$APP_DIR/scripts/assert-runtime-data-access.js"
}

CURRENT_REVISION=""
ARTIFACT_MANIFEST_SHA256=""
verify_candidate_tree
EXPECTED_RELEASE_DIRECTORY="$RELEASE_ROOT/${CURRENT_REVISION}-${ARTIFACT_MANIFEST_SHA256:0:16}"
if [[ "$APP_DIR" != "$EXPECTED_RELEASE_DIRECTORY" ]]; then
  echo "ERROR: immutable release directory must bind revision and signed manifest: $EXPECTED_RELEASE_DIRECTORY" >&2
  exit 1
fi

if [[ -L "$ACTIVATION_PENDING_FILE" || -e "$ACTIVATION_PENDING_FILE" ]]; then
  install -d -o root -g root -m 0755 "$MAINTENANCE_DIR"
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  echo "ERROR: unresolved activation journal exists at $ACTIVATION_PENDING_FILE." >&2
  echo "Maintenance was restored; reconcile the database, PM2/runtime pointer, public pointer, and release marker manually." >&2
  exit 1
fi

port_is_owned_by_pm2_app() {
  local listeners="$1"
  local app_pid
  app_pid="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  [[ "$app_pid" =~ ^[0-9]+$ ]] || return 1
  grep -E ":3003\\b.*pid=$app_pid," <<<"$listeners" >/dev/null
}

has_non_loopback_port_3003_listener() {
  local listeners="$1"
  local listener_line=""
  while IFS= read -r listener_line; do
    [[ -z "$listener_line" ]] && continue
    if [[ "$listener_line" =~ [[:space:]]127\.0\.0\.1:3003[[:space:]] \
      || "$listener_line" =~ [[:space:]]\[::1\]:3003[[:space:]] \
      || "$listener_line" =~ [[:space:]]::1:3003[[:space:]] ]]; then
      continue
    fi
    return 0
  done <<<"$listeners"
  return 1
}

verify_candidate_process_identity_now() {
  local checkpoint="$1"
  local current_pid=""
  local current_starttime=""
  local listeners=""
  local process_cmdline=""
  local health_json=""

  if [[ ! "${NEW_APP_PID:-}" =~ ^[0-9]+$ || -z "${NEW_APP_STARTTIME:-}" \
    || -z "${PM2_RUNTIME_IDENTITY:-}" || -z "${POST_MIGRATION_PREFLIGHT_OUTPUT:-}" ]]; then
    echo "ERROR: candidate identity baseline is incomplete at $checkpoint." >&2
    return 1
  fi
  current_pid="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  current_starttime="$(awk '{print $22}' "/proc/$NEW_APP_PID/stat" 2>/dev/null || true)"
  if [[ "$current_pid" != "$NEW_APP_PID" || "$current_starttime" != "$NEW_APP_STARTTIME" \
    || ! -d "/proc/$NEW_APP_PID" ]]; then
    echo "ERROR: candidate PID/start time changed at $checkpoint." >&2
    return 1
  fi
  if [[ "$(readlink -f "/proc/$NEW_APP_PID/cwd" 2>/dev/null || true)" != "$APP_DIR" \
    || "$(readlink -f "/proc/$NEW_APP_PID/exe" 2>/dev/null || true)" != "$NODE_BIN" \
    || "$(stat -c '%u:%g' "/proc/$NEW_APP_PID" 2>/dev/null || true)" != "$(id -u birdora):$(id -g birdora)" ]]; then
    echo "ERROR: candidate executable/cwd/uid identity changed at $checkpoint." >&2
    return 1
  fi
  process_cmdline="$(tr '\0' ' ' < "/proc/$NEW_APP_PID/cmdline" 2>/dev/null || true)"
  if [[ "$process_cmdline" != *"$APP_DIR/server.js"* ]]; then
    echo "ERROR: candidate command line changed at $checkpoint." >&2
    return 1
  fi
  listeners="$(ss -Hlnpt '( sport = :3003 )')"
  if [[ "$(wc -l <<<"$listeners")" != "1" \
    || ! "$listeners" =~ 127\.0\.0\.1:3003 \
    || ! "$listeners" =~ pid=$NEW_APP_PID, ]] \
    || has_non_loopback_port_3003_listener "$listeners"; then
    echo "ERROR: candidate listener identity changed at $checkpoint." >&2
    return 1
  fi
  if ! pm2 jlist | PM2_APP="$PM2_APP" APP_DIR="$APP_DIR" NEW_APP_PID="$NEW_APP_PID" \
    INITIAL_PM2_RUNTIME_IDENTITY="$PM2_RUNTIME_IDENTITY" "$NODE_BIN" -e '
      let input="";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { input += chunk; });
      process.stdin.on("end", () => {
        const apps=JSON.parse(input).filter((app) => app.name === process.env.PM2_APP);
        const baseline=JSON.parse(process.env.INITIAL_PM2_RUNTIME_IDENTITY);
        if (apps.length !== 1) process.exit(1);
        const app=apps[0];
        if (
          app.pid !== Number(process.env.NEW_APP_PID)
          || app.pm2_env?.status !== "online"
          || app.pm2_env?.pm_cwd !== process.env.APP_DIR
          || app.pm2_env?.pm_exec_path !== "/usr/bin/flock"
          || app.pm2_env?.exec_mode !== "fork_mode"
          || app.pm2_env?.restart_time !== baseline.restartCount
        ) process.exit(1);
      });
    '; then
    echo "ERROR: PM2 candidate identity/restart count changed at $checkpoint." >&2
    return 1
  fi
  health_json="$(wait_for_health "http://127.0.0.1:3003/api/health/ready" 5)"
  if ! HEALTH_JSON="$health_json" CURRENT_REVISION="$CURRENT_REVISION" \
    ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
    POST_MIGRATION_PREFLIGHT_OUTPUT="$POST_MIGRATION_PREFLIGHT_OUTPUT" \
    "$NODE_BIN" -e '
      const health=JSON.parse(process.env.HEALTH_JSON);
      const database=JSON.parse(process.env.POST_MIGRATION_PREFLIGHT_OUTPUT);
      if (
        health.ok !== true
        || health.release?.revision !== process.env.CURRENT_REVISION
        || health.release?.manifestSha256 !== process.env.ARTIFACT_MANIFEST_SHA256
        || health.activation?.activationPending !== true
        || health.activation?.writesEnabled !== false
        || health.schemaVersion !== database.currentVersion
      ) process.exit(1);
    '; then
    echo "ERROR: candidate readiness identity changed at $checkpoint." >&2
    return 1
  fi
}

echo "== Check port ownership =="
LISTENER_SNAPSHOT="$(ss -Hlnpt '( sport = :3003 )')"
if [[ -n "$LISTENER_SNAPSHOT" ]]; then
  if port_is_owned_by_pm2_app "$LISTENER_SNAPSHOT"; then
    echo "Port 3003 is already in use by existing $PM2_APP; continuing with restart."
  else
    echo "ERROR: port 3003 is already in use by another service." >&2
    exit 1
  fi
fi
if has_non_loopback_port_3003_listener "$LISTENER_SNAPSHOT" \
  && [[ "${DIRECT_PORT_3003_FIREWALL_CONFIRMED:-false}" != "true" ]]; then
  echo "ERROR: the legacy API listens beyond loopback, so Nginx maintenance can be bypassed." >&2
  echo "Block external ingress to TCP 3003, set DIRECT_PORT_3003_FIREWALL_CONFIRMED=true for this supervised upgrade, then rerun." >&2
  exit 1
fi

if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  EARLY_PM2_APP_PID="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  if [[ ! "$EARLY_PM2_APP_PID" =~ ^[0-9]+$ ]] || (( EARLY_PM2_APP_PID <= 0 )); then
    echo "ERROR: existing PM2 inventory has no live writer PID; reconcile it before deployment." >&2
    exit 1
  fi
  EARLY_PM2_CWD="$(readlink -f "/proc/$EARLY_PM2_APP_PID/cwd" 2>/dev/null || true)"
  if [[ -z "$EARLY_PM2_CWD" ]]; then
    echo "ERROR: cannot prove the live PM2 working directory; refusing dependency installation." >&2
    exit 1
  fi
  if [[ "$EARLY_PM2_CWD" == "$(readlink -f "$APP_DIR")" ]]; then
    echo "ERROR: in-place hot update is prohibited because the live PM2 process uses the candidate APP_DIR." >&2
    echo "Stage and test a separate immutable release directory, then use a reviewed atomic runtime switch." >&2
    exit 1
  fi
fi

echo "== Verify a prebuilt candidate and run tests without production data or secrets =="
if [[ ! -d "$APP_DIR/node_modules" ]]; then
  echo "ERROR: node_modules is absent; build the immutable release artifact outside the production host workflow." >&2
  exit 1
fi
pnpm list --prod --depth 0 >/dev/null
# Tests and dependency audit ran before sealing. Their signed evidence is part
# of the verified manifest; production never executes a mutable test/build step.
verify_candidate_tree

echo "== Verify pre-provisioned service ownership without recursively mutating live data or releases =="
if [[ ! -d "$DATA_DIR" || -L "$DATA_DIR" \
  || "$(stat -c '%U:%G' "$DATA_DIR")" != "birdora:birdora" \
  || "$(stat -c '%a' "$DATA_DIR")" != "700" ]]; then
  echo "ERROR: $DATA_DIR must be a pre-provisioned birdora:birdora mode-0700 data directory." >&2
  exit 1
fi
if [[ ! -d "$PROTECTED_DATA_DIR" || -L "$PROTECTED_DATA_DIR" \
  || "$(stat -c '%U:%G' "$PROTECTED_DATA_DIR")" != "root:root" \
  || "$(stat -c '%a' "$PROTECTED_DATA_DIR")" != "700" ]]; then
  echo "ERROR: $PROTECTED_DATA_DIR must be a pre-provisioned root:root mode-0700 recovery directory." >&2
  exit 1
fi
for protected_child in "$DATABASE_BACKUP_DIR" "$ROLLBACK_BUNDLE_ROOT"; do
  if [[ ! -d "$protected_child" || -L "$protected_child" \
    || "$(realpath "$protected_child")" != "$protected_child" \
    || "$(dirname "$protected_child")" != "$PROTECTED_DATA_DIR" \
    || "$(stat -c '%U:%G' "$protected_child")" != "root:root" \
    || "$(stat -c '%a' "$protected_child")" != "700" ]]; then
    echo "ERROR: protected recovery child must be a pre-provisioned root:root mode-0700 direct directory: $protected_child" >&2
    exit 1
  fi
done
if [[ ! -d "$ACTIVATION_CONTROL_DIR" || -L "$ACTIVATION_CONTROL_DIR" \
  || "$(stat -c '%U:%G' "$ACTIVATION_CONTROL_DIR")" != "root:birdora" \
  || "$(stat -c '%a' "$ACTIVATION_CONTROL_DIR")" != "2750" ]]; then
  echo "ERROR: $ACTIVATION_CONTROL_DIR must be root:birdora mode-2750 so the API can read but cannot alter activation state." >&2
  exit 1
fi
if [[ -L "$DATABASE_LIFECYCLE_LOCK" || ! -f "$DATABASE_LIFECYCLE_LOCK" \
  || "$(stat -c '%h' "$DATABASE_LIFECYCLE_LOCK")" != "1" \
  || "$(stat -c '%U:%G' "$DATABASE_LIFECYCLE_LOCK")" != "root:birdora" \
  || "$(stat -c '%a' "$DATABASE_LIFECYCLE_LOCK")" != "660" ]]; then
  echo "ERROR: $DATABASE_LIFECYCLE_LOCK must be a pre-created root:birdora mode-0660 single-link file." >&2
  exit 1
fi
if [[ ! -d "$PM2_HOME" || -L "$PM2_HOME" \
  || "$(stat -c '%U:%G' "$PM2_HOME")" != "root:root" \
  || "$(stat -c '%a' "$PM2_HOME")" != "700" ]]; then
  echo "ERROR: Birdora requires its own pre-provisioned root-owned PM2_HOME at $PM2_HOME." >&2
  exit 1
fi

echo "== Prepare an atomic public-release pointer =="
if [[ ! -d "$PUBLIC_RELEASE_ROOT" || -L "$PUBLIC_RELEASE_ROOT" \
  || "$(stat -c '%U:%G' "$PUBLIC_RELEASE_ROOT")" != "root:www-data" \
  || "$(stat -c '%a' "$PUBLIC_RELEASE_ROOT")" != "755" ]]; then
  echo "ERROR: public release root must be pre-created root:www-data mode-0755: $PUBLIC_RELEASE_ROOT" >&2
  exit 1
fi
if [[ ! -L "$ACTIVE_PUBLIC_LINK" ]]; then
  echo "ERROR: active public pointer must be bootstrapped before release activation: $ACTIVE_PUBLIC_LINK" >&2
  exit 1
fi
PREVIOUS_PUBLIC_TARGET="$(readlink -f "$ACTIVE_PUBLIC_LINK")"
if [[ ! -d "$PREVIOUS_PUBLIC_TARGET" ]]; then
  echo "ERROR: active public target is missing or not a directory: $PREVIOUS_PUBLIC_TARGET" >&2
  exit 1
fi
case "$PREVIOUS_PUBLIC_TARGET" in
  "$APP_ROOT/public"|"$PUBLIC_RELEASE_ROOT"/*) ;;
  *)
    echo "ERROR: active public target escapes the controlled public roots: $PREVIOUS_PUBLIC_TARGET" >&2
    exit 1
    ;;
esac
PUBLIC_RELEASE_ID="${CURRENT_REVISION}-${ARTIFACT_MANIFEST_SHA256:0:16}"
PUBLIC_RELEASE_DIR="$PUBLIC_RELEASE_ROOT/$PUBLIC_RELEASE_ID"
if [[ -e "$PUBLIC_RELEASE_DIR" || -L "$PUBLIC_RELEASE_DIR" ]]; then
  echo "ERROR: candidate public release already exists; immutable builds require a unique clean target: $PUBLIC_RELEASE_DIR" >&2
  exit 1
fi

if [[ -e "$RUNTIME_LINK" || -L "$RUNTIME_LINK" ]]; then
  if [[ ! -L "$RUNTIME_LINK" ]]; then
    echo "ERROR: runtime control path is not a symbolic link: $RUNTIME_LINK" >&2
    exit 1
  fi
  PREVIOUS_RUNTIME_TARGET="$(readlink -f "$RUNTIME_LINK")"
  if [[ ! -d "$PREVIOUS_RUNTIME_TARGET" || "$(dirname "$PREVIOUS_RUNTIME_TARGET")" != "$RELEASE_ROOT" ]]; then
    echo "ERROR: runtime pointer target is not one immutable release: $PREVIOUS_RUNTIME_TARGET" >&2
    exit 1
  fi
  if [[ "$PREVIOUS_RUNTIME_TARGET" == "$APP_DIR" ]]; then
    echo "ERROR: candidate release is already the active runtime target." >&2
    exit 1
  fi
fi
if [[ -z "$PREVIOUS_RUNTIME_TARGET" || "$(dirname "$PREVIOUS_PUBLIC_TARGET")" != "$PUBLIC_RELEASE_ROOT" ]]; then
  echo "ERROR: this updater requires an already bootstrapped immutable runtime and public release." >&2
  echo "Use the separately reviewed legacy-adoption procedure before any database migration." >&2
  exit 1
fi

echo "== Read-only database preflight while the current service is still available =="
PREFLIGHT_OUTPUT="$("$NODE_BIN" scripts/database-preflight.js)"
echo "$PREFLIGHT_OUTPUT"

PM2_APP_EXISTED=0
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  PM2_APP_EXISTED=1
fi

if [[ -f "$CURRENT_RELEASE_FILE" && "$PM2_APP_EXISTED" != "1" ]]; then
  echo "ERROR: current-release.json exists but $PM2_APP is absent for this PM2 user; refusing a wrong-user or wrong-host update." >&2
  exit 1
fi

echo "== Verify required PM2 inventory before maintenance =="
PM2_FOREIGN_APP_COUNT="$(pm2 jlist | PM2_APP="$PM2_APP" "$NODE_BIN" -e '
  let input="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const apps=JSON.parse(input);
    process.stdout.write(String(apps.filter((app) => app.name !== process.env.PM2_APP).length));
  });
')"
if [[ "$PM2_FOREIGN_APP_COUNT" != "0" ]]; then
  echo "ERROR: dedicated PM2_HOME contains unrelated applications; refusing a global PM2 save." >&2
  exit 1
fi
if (( PM2_APP_EXISTED )); then
  require_pm2_app "$PM2_APP"
  if [[ -z "$PREVIOUS_RUNTIME_TARGET" || ! -f "$CURRENT_RELEASE_FILE" ]]; then
    echo "ERROR: existing production writers require both a runtime pointer and verified release marker; run the separately reviewed legacy bootstrap first." >&2
    exit 1
  fi
  PREVIOUS_ARTIFACT_JSON="$(env -i \
    HOME=/root \
    PATH="$PATH" \
    RELEASE_DIR="$PREVIOUS_RUNTIME_TARGET" \
    RELEASE_PUBLIC_KEY="$RELEASE_PUBLIC_KEY" \
    RELEASE_REQUIRE_ROOT_OWNERSHIP=true \
    RELEASE_REQUIRE_IMMUTABLE_PERMISSIONS=true \
    "$NODE_BIN" "$CONTROLLER_DIR/verify-release-manifest.js")"
  PREVIOUS_ARTIFACT_REVISION="$(ARTIFACT_JSON="$PREVIOUS_ARTIFACT_JSON" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ARTIFACT_JSON); process.stdout.write(value.revision || "")')"
  PREVIOUS_ARTIFACT_MANIFEST_SHA256="$(ARTIFACT_JSON="$PREVIOUS_ARTIFACT_JSON" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ARTIFACT_JSON); process.stdout.write(value.manifestSha256 || "")')"
  PREVIOUS_MARKER_SHA256="$(sha256sum "$CURRENT_RELEASE_FILE" | awk '{print $1}')"
  CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" \
  PREVIOUS_RUNTIME_TARGET="$PREVIOUS_RUNTIME_TARGET" \
  PREVIOUS_PUBLIC_TARGET="$PREVIOUS_PUBLIC_TARGET" \
  RUNTIME_LINK="$RUNTIME_LINK" \
  PREVIOUS_ARTIFACT_REVISION="$PREVIOUS_ARTIFACT_REVISION" \
  PREVIOUS_ARTIFACT_MANIFEST_SHA256="$PREVIOUS_ARTIFACT_MANIFEST_SHA256" \
  "$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const markerPath = process.env.CURRENT_RELEASE_FILE;
const descriptor = fs.openSync(markerPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
const stats = fs.fstatSync(descriptor);
if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 256 * 1024) {
  fs.closeSync(descriptor);
  throw new Error("current release marker must be a regular single-link file");
}
if (process.platform === "linux" && (stats.uid !== 0 || (stats.mode & 0o777) !== 0o640)) {
  fs.closeSync(descriptor);
  throw new Error("current release marker must be root-owned with exact mode 0640");
}
const marker = JSON.parse(fs.readFileSync(descriptor, "utf8"));
fs.closeSync(descriptor);
if (
  marker.formatVersion !== 2
  || marker.activationVerified !== true
  || !/^[A-Za-z0-9][A-Za-z0-9._-]{15,127}$/u.test(marker.activationAttemptId || "")
  || path.resolve(marker.runtimeReleaseDirectory || "") !== path.resolve(process.env.PREVIOUS_RUNTIME_TARGET)
  || path.resolve(marker.runtimePointer || "") !== path.resolve(process.env.RUNTIME_LINK)
  || path.resolve(marker.publicReleaseDirectory || "") !== path.resolve(process.env.PREVIOUS_PUBLIC_TARGET)
  || !/^[0-9a-f]{40}$/u.test(marker.revision || "")
  || !/^[0-9a-f]{64}$/u.test(marker.artifactManifestSha256 || "")
  || marker.revision !== process.env.PREVIOUS_ARTIFACT_REVISION
  || marker.artifactManifestSha256 !== process.env.PREVIOUS_ARTIFACT_MANIFEST_SHA256
) {
  throw new Error("current release marker does not bind the live immutable runtime");
}
NODE
fi

LIVE_SOURCE_IDENTITY="null"
if (( PM2_APP_EXISTED )); then
  PM2_APP_PID="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  if [[ ! "$PM2_APP_PID" =~ ^[0-9]+$ ]] || (( PM2_APP_PID <= 0 )); then
    echo "ERROR: cannot resolve the live PM2 writer PID before source-identity verification." >&2
    exit 1
  fi
  LIVE_SOURCE_IDENTITY="$(PREFLIGHT_OUTPUT="$PREFLIGHT_OUTPUT" \
    PM2_APP_PID="$PM2_APP_PID" \
    "$NODE_BIN" scripts/verify-live-source-identity.js)"
  PM2_PROCESS_CWD="$(readlink -f "/proc/$PM2_APP_PID/cwd" 2>/dev/null || true)"
  if [[ "$PM2_PROCESS_CWD" != "$PREVIOUS_RUNTIME_TARGET" ]]; then
    echo "ERROR: live PM2 cwd, runtime pointer, and verified marker are inconsistent." >&2
    exit 1
  fi
  echo "$LIVE_SOURCE_IDENTITY"
fi

PREFLIGHT_OUTPUT="$PREFLIGHT_OUTPUT" \
PM2_APP_EXISTED="$PM2_APP_EXISTED" \
ALLOW_EMPTY_DATABASE_INITIALIZATION="${ALLOW_EMPTY_DATABASE_INITIALIZATION:-false}" \
DATA_DIR="$DATA_DIR" \
CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const status = JSON.parse(process.env.PREFLIGHT_OUTPUT);
if (!status.ok || !status.safeToApply) {
  throw new Error("database preflight did not declare the source safe to apply");
}
const existingRelease = process.env.PM2_APP_EXISTED === "1"
  || fs.existsSync(process.env.CURRENT_RELEASE_FILE);
const releaseMarkerPath = process.env.CURRENT_RELEASE_FILE;
if (fs.existsSync(releaseMarkerPath)) {
  const release = JSON.parse(fs.readFileSync(releaseMarkerPath, "utf8"));
  if (release.databasePath && path.resolve(release.databasePath) !== path.resolve(status.databasePath)) {
    throw new Error(`DATABASE_FILE changed from ${release.databasePath} to ${status.databasePath}; refusing implicit data-source replacement`);
  }
  if (release.databaseIdentity && status.databaseExists) {
    const stats = fs.statSync(status.databasePath, { bigint: true });
    if (
      stats.dev.toString() !== String(release.databaseIdentity.device)
      || stats.ino.toString() !== String(release.databaseIdentity.inode)
    ) {
      throw new Error("database device/inode differs from the last verified activation marker");
    }
  }
  const databaseDirectory = path.dirname(path.resolve(status.databasePath));
  const candidateMediaRoots = {
    community: path.resolve(process.env.COMMUNITY_UPLOAD_DIR || path.join(databaseDirectory, "uploads", "community")),
    observations: path.resolve(process.env.OBSERVATION_UPLOAD_DIR || path.join(databaseDirectory, "uploads", "observations")),
  };
  if (
    release.mediaRoots
    && (
      path.resolve(release.mediaRoots.community) !== candidateMediaRoots.community
      || path.resolve(release.mediaRoots.observations) !== candidateMediaRoots.observations
    )
  ) {
    throw new Error("media roots differ from the last verified activation marker");
  }
  const previousUsers = Number(release.databaseTableCounts?.users);
  const currentUsers = Number(status.userTableCounts?.users);
  if (Number.isFinite(previousUsers) && Number.isFinite(currentUsers) && currentUsers < previousUsers) {
    throw new Error(`users row count regressed from ${previousUsers} to ${currentUsers}`);
  }
}
const allowEmptyFirstInstall = process.env.ALLOW_EMPTY_DATABASE_INITIALIZATION === "true"
  && !existingRelease;
if ((!status.databaseExists || status.databaseEmpty) && !allowEmptyFirstInstall) {
  throw new Error(
    "production database is missing/empty; refusing to create an empty replacement. "
    + "Only a first install with no PM2/data release marker may set ALLOW_EMPTY_DATABASE_INITIALIZATION=true"
  );
}
NODE

echo "== Prove the birdora runtime can traverse the release and read/write existing database files =="
prove_birdora_runtime_data_access false

migration_window_open=1
report_stopped_service_on_exit() {
  local original_status=$?
  local failure_listeners=""
  local maintenance_restored=0
  local maintenance_probe_status=""
  trap - EXIT
  set +e
  if (( original_status != 0 && migration_window_open )); then
    if install -d -o root -g root -m 0755 "$MAINTENANCE_DIR" \
      && atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644 \
      && [[ -f "$MAINTENANCE_FLAG" && ! -L "$MAINTENANCE_FLAG" ]]; then
      maintenance_restored=1
    fi
    echo "ERROR: controlled update did not complete." >&2
    echo "Preserve the rollback bundle and migration output; do not resume writes until reviewed." >&2
  fi
  if (( original_status != 0 && new_service_started )); then
    echo "ERROR: stopping the candidate PM2 service after a failed activation." >&2
    pm2 stop "$PM2_APP" >/dev/null 2>&1 || true
    pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
    for ((stop_attempt = 1; stop_attempt <= 10; stop_attempt += 1)); do
      failure_listeners="$(ss -Hlnpt '( sport = :3003 )' 2>/dev/null || true)"
      if [[ -z "$failure_listeners" ]]; then
        break
      fi
      sleep 1
    done
    failure_listeners="$(ss -Hlnpt '( sport = :3003 )' 2>/dev/null || true)"
    if [[ -n "$failure_listeners" ]]; then
      echo "CRITICAL: port 3003 is still listening after candidate shutdown; keep firewall and maintenance active." >&2
    fi
    persist_empty_pm2_inventory >/dev/null 2>&1 \
      || echo "CRITICAL: failed to prove an empty persisted PM2 inventory; keep maintenance and TCP 3003 blocking active." >&2
  elif (( original_status != 0 && old_service_stopped )); then
    pm2 delete "$PM2_APP" >/dev/null 2>&1 || true
    persist_empty_pm2_inventory >/dev/null 2>&1 \
      || echo "CRITICAL: failed to prove an empty persisted PM2 inventory; keep maintenance and TCP 3003 blocking active." >&2
  fi
  if (( maintenance_restored )) && declare -p MAINTENANCE_CURL >/dev/null 2>&1 \
    && [[ -n "${MAINTENANCE_URL:-}" ]]; then
    maintenance_probe_status="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' "$MAINTENANCE_URL" 2>/dev/null || true)"
    if [[ "$maintenance_probe_status" != "503" ]]; then
      maintenance_restored=0
    fi
  fi
  if (( migration_window_open && !maintenance_restored && (old_service_stopped || new_service_started) )); then
    echo "CRITICAL: maintenance could not be proven, but all known Birdora PM2 writers were stopped; keep TCP 3003 blocked and repair Nginx before any restart." >&2
  elif (( maintenance_restored )); then
    echo "Nginx maintenance was restored and locally verified where the active config was available." >&2
  fi
  ACTIVE_PUBLIC_AFTER_FAILURE="$(readlink -f "$ACTIVE_PUBLIC_LINK" 2>/dev/null || true)"
  if (( original_status != 0 )) && [[ "$ACTIVE_PUBLIC_AFTER_FAILURE" == "${PUBLIC_RELEASE_DIR:-}" ]]; then
    echo "ERROR: atomically restoring the pre-update public asset pointer." >&2
    POINTER_PATH="$ACTIVE_PUBLIC_LINK" \
    TARGET_ROOT="$PUBLIC_RELEASE_ROOT" \
    EXPECTED_OLD_TARGET="$PUBLIC_RELEASE_DIR" \
    NEW_TARGET="$PREVIOUS_PUBLIC_TARGET" \
    DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
    DEPLOY_LOCK_OWNER_PID="$PPID" \
    "$NODE_BIN" "$CONTROLLER_DIR/switch-release-pointer.js" >/dev/null 2>&1 \
      || echo "CRITICAL: failed to restore the previous public pointer; keep maintenance active." >&2
  fi
  ACTIVE_RUNTIME_AFTER_FAILURE="$(readlink -f "$RUNTIME_LINK" 2>/dev/null || true)"
  if (( original_status != 0 )) && [[ "$ACTIVE_RUNTIME_AFTER_FAILURE" == "$APP_DIR" ]]; then
    echo "NOTICE: runtime pointer remains on the stopped forward-fix candidate because database migration may have started; old code will not be restarted." >&2
  fi
  exit "$original_status"
}
trap report_stopped_service_on_exit EXIT

echo "== Activate Nginx maintenance before draining the old API =="
install -d -o root -g root -m 0755 "$MAINTENANCE_DIR"
atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644

NGINX_SOURCE="deploy/nginx/birdora-pre-cert.conf"
MAINTENANCE_URL="http://$SITE_NAME/api/health"
MAINTENANCE_STATIC_URL="http://$SITE_NAME/"
MAINTENANCE_CURL=(curl -sS --noproxy '*' --connect-timeout 5 --max-time 10 --resolve "$SITE_NAME:80:127.0.0.1")
CURRENT_SITE_USES_HTTPS=0
if [[ -f "$NGINX_AVAILABLE" ]] \
  && grep -E '^[[:space:]]*listen[[:space:]].*443([[:space:];]|$)' "$NGINX_AVAILABLE" >/dev/null; then
  CURRENT_SITE_USES_HTTPS=1
fi
CERTIFICATE_PRESENT=0
PRIVATE_KEY_PRESENT=0
if [[ -f "/etc/letsencrypt/live/$SITE_NAME/fullchain.pem" ]]; then
  CERTIFICATE_PRESENT=1
fi
if [[ -f "/etc/letsencrypt/live/$SITE_NAME/privkey.pem" ]]; then
  PRIVATE_KEY_PRESENT=1
fi
if (( CURRENT_SITE_USES_HTTPS && (!CERTIFICATE_PRESENT || !PRIVATE_KEY_PRESENT) )); then
  echo "ERROR: the active Birdora site uses HTTPS but the candidate's fixed certificate paths are unavailable; refusing an HTTP downgrade." >&2
  exit 1
fi
if (( CERTIFICATE_PRESENT != PRIVATE_KEY_PRESENT )); then
  echo "ERROR: only one candidate TLS certificate file is present; refusing an ambiguous Nginx replacement." >&2
  exit 1
fi
if (( CERTIFICATE_PRESENT && PRIVATE_KEY_PRESENT )); then
  NGINX_SOURCE="deploy/nginx/birdora-https.conf"
  MAINTENANCE_URL="https://$SITE_NAME/api/health"
  MAINTENANCE_STATIC_URL="https://$SITE_NAME/"
  MAINTENANCE_CURL=(curl -sS --noproxy '*' --connect-timeout 5 --max-time 10 --resolve "$SITE_NAME:443:127.0.0.1")
fi
install_nginx_site "$NGINX_SOURCE" true
if ! MAINTENANCE_STATUS="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' "$MAINTENANCE_URL")"; then
  echo "ERROR: local Nginx maintenance transport/TLS probe failed; restoring the pre-update config." >&2
  restore_pre_update_nginx
  exit 1
fi
if [[ "$MAINTENANCE_STATUS" != "503" ]]; then
  echo "ERROR: Nginx maintenance gate returned HTTP $MAINTENANCE_STATUS instead of 503." >&2
  restore_pre_update_nginx
  exit 1
fi
if ! MAINTENANCE_STATIC_STATUS="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' "$MAINTENANCE_STATIC_URL")" \
  || [[ "$MAINTENANCE_STATIC_STATUS" != "503" ]]; then
  echo "ERROR: static-site maintenance gate was not proven locally; restoring the pre-update config." >&2
  restore_pre_update_nginx
  exit 1
fi

echo "== Drain established API connections before stopping the old process =="
ACTIVE_CONNECTIONS=0
for ((attempt = 1; attempt <= 60; attempt += 1)); do
  ACTIVE_CONNECTIONS="$(ss -Htn state established '( sport = :3003 )' | wc -l)"
  if (( ACTIVE_CONNECTIONS == 0 )); then
    break
  fi
  sleep 1
done
if (( ACTIVE_CONNECTIONS != 0 )); then
  echo "ERROR: $ACTIVE_CONNECTIONS established API connection(s) did not drain; refusing to stop or migrate." >&2
  exit 1
fi

if (( PM2_APP_EXISTED )); then
  echo "== Stop the old API before any database migration =="
  old_service_stopped=1
  pm2 stop "$PM2_APP"
  pm2 save
fi

LISTENER_SNAPSHOT="$(ss -Hlnpt '( sport = :3003 )')"
if [[ -n "$LISTENER_SNAPSHOT" ]]; then
  echo "ERROR: port 3003 is still accepting connections after stopping $PM2_APP." >&2
  exit 1
fi
if (( PM2_APP_EXISTED )); then
  pm2 delete "$PM2_APP"
  persist_empty_pm2_inventory
fi

echo "== Acquire one continuous exclusive database/media writer fence =="
exec {DATABASE_LOCK_FD}<>"$DATABASE_LIFECYCLE_LOCK"
if ! flock --exclusive --wait 10 "$DATABASE_LOCK_FD"; then
  echo "ERROR: a cooperating database/media writer still holds the shared lifecycle lock." >&2
  exit 1
fi
export BIRDORA_DATABASE_LOCK_FD="$DATABASE_LOCK_FD"
"$NODE_BIN" -e 'require("./app/runtime/database-lifecycle-lock").assertExclusiveDatabaseLifecycleLock()'

echo "== Repeat read-only preflight with writes stopped =="
STOPPED_PREFLIGHT_OUTPUT="$("$NODE_BIN" scripts/database-preflight.js)"
echo "$STOPPED_PREFLIGHT_OUTPUT"
STOPPED_PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" \
INITIAL_PREFLIGHT_OUTPUT="$PREFLIGHT_OUTPUT" \
LIVE_SOURCE_IDENTITY="$LIVE_SOURCE_IDENTITY" \
ALLOW_EMPTY_DATABASE_INITIALIZATION="${ALLOW_EMPTY_DATABASE_INITIALIZATION:-false}" \
PM2_APP_EXISTED="$PM2_APP_EXISTED" \
  "$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const status = JSON.parse(process.env.STOPPED_PREFLIGHT_OUTPUT);
const initial = JSON.parse(process.env.INITIAL_PREFLIGHT_OUTPUT);
const liveIdentity = JSON.parse(process.env.LIVE_SOURCE_IDENTITY || "null");
const allowEmptyFirstInstall = process.env.ALLOW_EMPTY_DATABASE_INITIALIZATION === "true"
  && process.env.PM2_APP_EXISTED !== "1";
if (!status.ok || !status.safeToApply) throw new Error("stopped database preflight failed");
if ((!status.databaseExists || status.databaseEmpty) && !allowEmptyFirstInstall) {
  throw new Error("database disappeared or became empty during the maintenance transition");
}
if (liveIdentity) {
  const stats = fs.statSync(status.databasePath, { bigint: true });
  if (
    fs.realpathSync(status.databasePath) !== liveIdentity.database.realPath
    || stats.dev.toString() !== liveIdentity.database.device
    || stats.ino.toString() !== liveIdentity.database.inode
  ) {
    throw new Error("database identity changed while transitioning to stopped maintenance");
  }
}
for (const [tableName, initialCount] of Object.entries(initial.userTableCounts || {})) {
  if (Number(status.userTableCounts?.[tableName]) !== Number(initialCount)) {
    throw new Error(`row count changed while draining writes for ${tableName}`);
  }
}
NODE

verify_candidate_tree
PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" "$NODE_BIN" scripts/assert-database-exclusive.js

echo "== Snapshot media, previous release metadata, and configuration =="
ROLLBACK_OUTPUT="$(CANDIDATE_RELEASE_DIR="$APP_DIR" \
  PREVIOUS_RUNTIME_DIRECTORY="$PREVIOUS_RUNTIME_TARGET" \
  CURRENT_REVISION="$CURRENT_REVISION" \
  ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
  NODE_BIN="$NODE_BIN" \
  PREVIOUS_NGINX_CONFIG="$PREVIOUS_NGINX_CONFIG" \
  LIVE_SOURCE_IDENTITY="$LIVE_SOURCE_IDENTITY" \
  bash "$CONTROLLER_DIR/create-rollback-bundle.sh")"
echo "$ROLLBACK_OUTPUT"
ROLLBACK_BUNDLE_DIR="$(ROLLBACK_OUTPUT="$ROLLBACK_OUTPUT" "$NODE_BIN" -e 'const value=JSON.parse(process.env.ROLLBACK_OUTPUT); if (!value.bundleDirectory) process.exit(1); process.stdout.write(value.bundleDirectory)')"

echo "== Create and pin a validated database snapshot before migration can start =="
PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" "$NODE_BIN" scripts/assert-database-exclusive.js
SNAPSHOT_LOG="$ROLLBACK_BUNDLE_DIR/database-snapshot.log"
SNAPSHOT_OUTPUT="$("$NODE_BIN" scripts/backup-database.js | tee "$SNAPSHOT_LOG")"
echo "$SNAPSHOT_OUTPUT"
chmod 600 "$SNAPSHOT_LOG"
SNAPSHOT_JSON="$(printf '%s\n' "$SNAPSHOT_OUTPUT" | tail -n 1)"

ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
SNAPSHOT_JSON="$SNAPSHOT_JSON" \
STOPPED_PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const snapshot = JSON.parse(process.env.SNAPSHOT_JSON);
const preflight = JSON.parse(process.env.STOPPED_PREFLIGHT_OUTPUT);
const sourceNeedsSnapshot = preflight.databaseExists && !preflight.databaseEmpty;
const hasSnapshot = Boolean(snapshot.backupPath && snapshot.manifestPath && snapshot.backupSha256);
if (sourceNeedsSnapshot && !hasSnapshot) {
  throw new Error("the existing database must have a validated snapshot before migration starts");
}
if (hasSnapshot && (!fs.existsSync(snapshot.backupPath) || !fs.existsSync(snapshot.manifestPath))) {
  throw new Error("database rollback snapshot or manifest is missing");
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function pinFile(source, destination) {
  // A rollback snapshot must be an independent inode. A hard link would allow
  // retention cleanup or later corruption of the backup to alter the bundle.
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  const sourceStats = fs.statSync(source, { bigint: true });
  const destinationStats = fs.statSync(destination, { bigint: true });
  if (sourceStats.dev === destinationStats.dev && sourceStats.ino === destinationStats.ino) {
    throw new Error("pinned database snapshot unexpectedly shares the source inode");
  }
  fs.chmodSync(destination, 0o600);
  const descriptor = fs.openSync(destination, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

let pinnedBackupPath = null;
let pinnedManifestPath = null;
if (hasSnapshot) {
  pinnedBackupPath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-before-update.sqlite");
  pinnedManifestPath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-before-update.manifest.json");
  pinFile(snapshot.backupPath, pinnedBackupPath);
  fs.copyFileSync(snapshot.manifestPath, pinnedManifestPath, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(pinnedManifestPath, 0o600);
  const manifest = JSON.parse(fs.readFileSync(pinnedManifestPath, "utf8"));
  if (
    path.resolve(manifest.backupPath) !== path.resolve(snapshot.backupPath)
    || path.resolve(manifest.sourceDatabasePath) !== path.resolve(preflight.databasePath)
    || manifest.preMigrationSchemaVersion !== preflight.currentVersion
    || manifest.sha256 !== snapshot.backupSha256
    || hashFile(pinnedBackupPath) !== snapshot.backupSha256
  ) {
    throw new Error("pinned database rollback snapshot checksum mismatch");
  }
}

fs.writeFileSync(
  path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-snapshot.json"),
  `${JSON.stringify(snapshot, null, 2)}\n`,
  { mode: 0o600 }
);
fs.writeFileSync(
  path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-preflight-stopped.json"),
  `${JSON.stringify(preflight, null, 2)}\n`,
  { mode: 0o600 }
);
const bundlePath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "bundle.json");
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
bundle.database = {
  status: hasSnapshot ? "snapshot-pinned-migration-not-started" : "empty-first-install-migration-not-started",
  rollbackPolicy: "forward-fix-only-do-not-start-legacy-code",
  snapshotResultPath: path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-snapshot.json"),
  backupPath: pinnedBackupPath,
  backupManifestPath: pinnedManifestPath,
  backupSha256: hasSnapshot ? snapshot.backupSha256 : null,
};
const temporaryBundlePath = `${bundlePath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryBundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const temporaryDescriptor = fs.openSync(temporaryBundlePath, "r+");
try {
  fs.fsyncSync(temporaryDescriptor);
} finally {
  fs.closeSync(temporaryDescriptor);
}
fs.renameSync(temporaryBundlePath, bundlePath);
for (const durableFile of [
  pinnedManifestPath,
  path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-snapshot.json"),
  path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-preflight-stopped.json"),
  bundlePath,
].filter(Boolean)) {
  const descriptor = fs.openSync(durableFile, "r+");
  try {
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}
const directoryDescriptor = fs.openSync(process.env.ROLLBACK_BUNDLE_DIR, "r");
try {
  fs.fsyncSync(directoryDescriptor);
} finally {
  fs.closeSync(directoryDescriptor);
}
NODE
sync

echo "== Persist deployment journal before migration can begin =="
JOURNAL_ATTEMPT_ID="$(date -u +%Y%m%dT%H%M%SZ)-$("$NODE_BIN" -e 'process.stdout.write(require("crypto").randomBytes(16).toString("hex"))')"
JOURNAL_CONTEXT_JSON="$(PREVIOUS_RUNTIME_TARGET="$PREVIOUS_RUNTIME_TARGET" \
  APP_DIR="$APP_DIR" \
  RUNTIME_LINK="$RUNTIME_LINK" \
  PREVIOUS_PUBLIC_TARGET="$PREVIOUS_PUBLIC_TARGET" \
  PUBLIC_RELEASE_DIR="$PUBLIC_RELEASE_DIR" \
  ACTIVE_PUBLIC_LINK="$ACTIVE_PUBLIC_LINK" \
  ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
  "$NODE_BIN" -e 'process.stdout.write(JSON.stringify({previousRuntimeDirectory:process.env.PREVIOUS_RUNTIME_TARGET||null,candidateRuntimeDirectory:process.env.APP_DIR,runtimePointer:process.env.RUNTIME_LINK,previousPublicDirectory:process.env.PREVIOUS_PUBLIC_TARGET||null,candidatePublicDirectory:process.env.PUBLIC_RELEASE_DIR,activePublicPointer:process.env.ACTIVE_PUBLIC_LINK,candidateArtifactManifestSha256:process.env.ARTIFACT_MANIFEST_SHA256}))')"
export BIRDORA_ACTIVATION_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID"
export BIRDORA_RELEASE_DIR="$APP_DIR"
export BIRDORA_RELEASE_REVISION="$CURRENT_REVISION"
export BIRDORA_RELEASE_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_CONTEXT_JSON="$JOURNAL_CONTEXT_JSON" \
JOURNAL_CREATE=true \
JOURNAL_STATUS="migration-about-to-start" \
JOURNAL_DETAILS_JSON="$SNAPSHOT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Apply pending migrations explicitly after the rollback snapshot is durable =="
PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" "$NODE_BIN" scripts/assert-database-exclusive.js
verify_candidate_tree
MIGRATION_LOG="$ROLLBACK_BUNDLE_DIR/database-migration.log"
MIGRATION_OUTPUT="$("$NODE_BIN" scripts/migrate-database.js | tee "$MIGRATION_LOG")"
echo "$MIGRATION_OUTPUT"
chmod 600 "$MIGRATION_LOG"
MIGRATION_JSON="$(printf '%s\n' "$MIGRATION_OUTPUT" | tail -n 1)"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="migration-command-complete-awaiting-postflight" \
JOURNAL_DETAILS_JSON="$MIGRATION_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" MIGRATION_JSON="$MIGRATION_JSON" "$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const migration = JSON.parse(process.env.MIGRATION_JSON);
const resultPath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-migration.json");
fs.writeFileSync(resultPath, `${JSON.stringify(migration, null, 2)}\n`, { flag: "wx", mode: 0o600 });
let descriptor = fs.openSync(resultPath, "r+");
try {
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
const bundlePath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "bundle.json");
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
bundle.database.status = "snapshot-pinned-migration-complete-awaiting-postflight";
bundle.database.migrationResultPath = resultPath;
const temporaryBundlePath = `${bundlePath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryBundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx", mode: 0o600 });
descriptor = fs.openSync(temporaryBundlePath, "r+");
try {
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
fs.renameSync(temporaryBundlePath, bundlePath);
const directoryDescriptor = fs.openSync(process.env.ROLLBACK_BUNDLE_DIR, "r");
try {
  fs.fsyncSync(directoryDescriptor);
} finally {
  fs.closeSync(directoryDescriptor);
}
NODE
sync

echo "== Verify the migrated database before starting application code =="
POST_MIGRATION_PREFLIGHT_OUTPUT="$("$NODE_BIN" scripts/database-preflight.js)"
echo "$POST_MIGRATION_PREFLIGHT_OUTPUT"
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
STOPPED_PREFLIGHT_OUTPUT="$STOPPED_PREFLIGHT_OUTPUT" \
POST_MIGRATION_PREFLIGHT_OUTPUT="$POST_MIGRATION_PREFLIGHT_OUTPUT" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const beforeMigration = JSON.parse(process.env.STOPPED_PREFLIGHT_OUTPUT);
const status = JSON.parse(process.env.POST_MIGRATION_PREFLIGHT_OUTPUT);
if (
  !status.ok
  || !status.databaseExists
  || status.databaseEmpty
  || status.pendingVersions.length !== 0
  || status.currentVersion !== status.targetVersion
) {
  throw new Error("post-migration database verification failed");
}
if (!beforeMigration.databaseEmpty) {
  const allowedNewControlTables = new Set(["data_migrations", "schema_migrations"]);
  for (const [tableName, beforeCount] of Object.entries(beforeMigration.userTableCounts || {})) {
    if (allowedNewControlTables.has(tableName)) continue;
    if (Number(status.userTableCounts?.[tableName]) !== Number(beforeCount)) {
      throw new Error(
        `migration row-count invariant failed for ${tableName}: before=${beforeCount} after=${status.userTableCounts?.[tableName]}`
      );
    }
  }
  for (const tableName of Object.keys(status.userTableCounts || {})) {
    if (
      !Object.hasOwn(beforeMigration.userTableCounts || {}, tableName)
      && !allowedNewControlTables.has(tableName)
    ) {
      throw new Error(`migration introduced an unapproved data table: ${tableName}`);
    }
  }
}
const outputPath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "database-preflight-after.json");
fs.writeFileSync(outputPath, `${JSON.stringify(status, null, 2)}\n`, { mode: 0o600 });
const descriptor = fs.openSync(outputPath, "r+");
try {
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
const bundlePath = path.join(process.env.ROLLBACK_BUNDLE_DIR, "bundle.json");
const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
bundle.database.status = "snapshot-pinned-migration-postflight-verified";
bundle.database.postMigrationPreflightPath = outputPath;
const temporaryBundlePath = `${bundlePath}.tmp-${process.pid}`;
fs.writeFileSync(temporaryBundlePath, `${JSON.stringify(bundle, null, 2)}\n`, { flag: "wx", mode: 0o600 });
const temporaryDescriptor = fs.openSync(temporaryBundlePath, "r+");
try {
  fs.fsyncSync(temporaryDescriptor);
} finally {
  fs.closeSync(temporaryDescriptor);
}
fs.renameSync(temporaryBundlePath, bundlePath);
const directoryDescriptor = fs.openSync(process.env.ROLLBACK_BUNDLE_DIR, "r");
try {
  fs.fsyncSync(directoryDescriptor);
} finally {
  fs.closeSync(directoryDescriptor);
}
NODE
sync

echo "== Advance deployment journal after database postflight =="
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="database-migrated-candidate-not-yet-verified" \
JOURNAL_DETAILS_JSON="$POST_MIGRATION_PREFLIGHT_OUTPUT" \
"$NODE_BIN" scripts/update-activation-journal.js
verify_candidate_tree
prove_birdora_runtime_data_access true

echo "== Journal and atomically switch the runtime control pointer =="
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="runtime-switch-about-to-start" \
JOURNAL_DETAILS_JSON="$JOURNAL_CONTEXT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js
verify_candidate_tree
runtime_switch_attempted=1
POINTER_PATH="$RUNTIME_LINK" \
TARGET_ROOT="$RELEASE_ROOT" \
EXPECTED_OLD_TARGET="${PREVIOUS_RUNTIME_TARGET:-__ABSENT__}" \
NEW_TARGET="$APP_DIR" \
DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
DEPLOY_LOCK_OWNER_PID="$PPID" \
"$NODE_BIN" "$CONTROLLER_DIR/switch-release-pointer.js"
if [[ "$(readlink -f "$RUNTIME_LINK")" != "$APP_DIR" ]]; then
  echo "ERROR: runtime pointer did not resolve to the signed candidate release." >&2
  exit 1
fi
runtime_switched=1
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="runtime-pointer-switched" \
JOURNAL_DETAILS_JSON="$JOURNAL_CONTEXT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="candidate-start-about-to-begin" \
JOURNAL_DETAILS_JSON="$JOURNAL_CONTEXT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Release the exclusive writer fence and start a fresh PM2 definition from the physical candidate =="
flock --unlock "$DATABASE_LOCK_FD"
exec {DATABASE_LOCK_FD}>&-
unset BIRDORA_DATABASE_LOCK_FD
verify_candidate_tree
new_service_started=1
pm2 start "$APP_DIR/ecosystem.config.cjs" --only "$PM2_APP"

echo "== Wait for local API readiness before switching website assets =="
HEALTH_JSON="$(wait_for_health "http://127.0.0.1:3003/api/health/ready" 30)"

NEW_APP_PID="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
NEW_APP_STARTTIME="$(awk '{print $22}' "/proc/$NEW_APP_PID/stat" 2>/dev/null || true)"
LISTENER_SNAPSHOT="$(ss -Hlnpt '( sport = :3003 )')"
if [[ ! "$NEW_APP_PID" =~ ^[0-9]+$ ]] \
  || "$(wc -l <<<"$LISTENER_SNAPSHOT")" != "1" \
  || ! grep -E "127\.0\.0\.1:3003\b.*pid=$NEW_APP_PID," <<<"$LISTENER_SNAPSHOT" >/dev/null; then
  echo "ERROR: the new API is not bound exclusively to the expected loopback endpoint." >&2
  grep -E ':3003\b' <<<"$LISTENER_SNAPSHOT" >&2 || true
  exit 1
fi
if has_non_loopback_port_3003_listener "$LISTENER_SNAPSHOT"; then
  echo "ERROR: port 3003 is exposed beyond loopback; maintenance could be bypassed." >&2
  exit 1
fi
if [[ "$(readlink -f "/proc/$NEW_APP_PID/cwd" 2>/dev/null || true)" != "$APP_DIR" \
  || "$(readlink -f "/proc/$NEW_APP_PID/exe" 2>/dev/null || true)" != "$NODE_BIN" ]]; then
  echo "ERROR: candidate PID is not bound to the expected physical release and Node executable." >&2
  exit 1
fi
if [[ "$(stat -c '%u:%g' "/proc/$NEW_APP_PID")" != "$(id -u birdora):$(id -g birdora)" ]]; then
  echo "ERROR: candidate process is not running as the dedicated birdora uid/gid." >&2
  exit 1
fi
NEW_PROCESS_CMDLINE="$(tr '\0' ' ' < "/proc/$NEW_APP_PID/cmdline" 2>/dev/null || true)"
if [[ "$NEW_PROCESS_CMDLINE" != *"$APP_DIR/server.js"* ]]; then
  echo "ERROR: candidate process command line is not bound to the physical release entrypoint." >&2
  exit 1
fi
PM2_RUNTIME_IDENTITY="$(pm2 jlist | PM2_APP="$PM2_APP" APP_DIR="$APP_DIR" NEW_APP_PID="$NEW_APP_PID" "$NODE_BIN" -e '
  let input="";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => {
    const apps=JSON.parse(input).filter((app) => app.name === process.env.PM2_APP);
    if (apps.length !== 1) throw new Error("PM2 must contain exactly one Birdora application");
    const app=apps[0];
    if (
      app.pid !== Number(process.env.NEW_APP_PID)
      || app.pm2_env?.status !== "online"
      || app.pm2_env?.pm_cwd !== process.env.APP_DIR
      || app.pm2_env?.pm_exec_path !== "/usr/bin/flock"
      || app.pm2_env?.exec_mode !== "fork_mode"
    ) throw new Error("PM2 runtime identity differs from the physical candidate");
    process.stdout.write(JSON.stringify({pid:app.pid,status:app.pm2_env.status,cwd:app.pm2_env.pm_cwd,script:app.pm2_env.pm_exec_path,restartCount:app.pm2_env.restart_time}));
  });
')"
if [[ "$(pm2 pid "$PM2_APP" 2>/dev/null || true)" != "$NEW_APP_PID" \
  || "$(awk '{print $22}' "/proc/$NEW_APP_PID/stat" 2>/dev/null || true)" != "$NEW_APP_STARTTIME" ]]; then
  echo "ERROR: candidate PID restarted while its runtime identity was being verified." >&2
  exit 1
fi
HEALTH_JSON="$HEALTH_JSON" \
CURRENT_REVISION="$CURRENT_REVISION" \
ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
POST_MIGRATION_PREFLIGHT_OUTPUT="$POST_MIGRATION_PREFLIGHT_OUTPUT" \
"$NODE_BIN" <<'NODE'
const health = JSON.parse(process.env.HEALTH_JSON);
const database = JSON.parse(process.env.POST_MIGRATION_PREFLIGHT_OUTPUT);
if (
  health.ok !== true
  || health.release?.revision !== process.env.CURRENT_REVISION
  || health.release?.manifestSha256 !== process.env.ARTIFACT_MANIFEST_SHA256
  || health.activation?.activationPending !== true
  || health.activation?.writesEnabled !== false
  || health.schemaVersion !== database.currentVersion
) {
  throw new Error("candidate readiness identity does not match release, activation, or database state");
}
NODE
verify_candidate_tree
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="candidate-ready" \
JOURNAL_DETAILS_JSON="$(NEW_APP_PID="$NEW_APP_PID" HEALTH_JSON="$HEALTH_JSON" PM2_RUNTIME_IDENTITY="$PM2_RUNTIME_IDENTITY" "$NODE_BIN" -e 'process.stdout.write(JSON.stringify({pid:Number(process.env.NEW_APP_PID),health:JSON.parse(process.env.HEALTH_JSON),pm2:JSON.parse(process.env.PM2_RUNTIME_IDENTITY)}))')" \
"$NODE_BIN" scripts/update-activation-journal.js
require_pm2_app "$PM2_APP"
pm2 save

echo "== Build and atomically switch a complete public release after API readiness =="
PUBLIC_STAGING_DIR="${PUBLIC_RELEASE_DIR}.staging-$$"
if [[ -e "$PUBLIC_STAGING_DIR" || -L "$PUBLIC_STAGING_DIR" ]]; then
  echo "ERROR: public staging path already exists: $PUBLIC_STAGING_DIR" >&2
  exit 1
fi
env -i \
  HOME=/root \
  PATH="$PATH" \
  NODE_ENV=production \
  PUBLIC_OUTPUT_DIR="$PUBLIC_STAGING_DIR" \
  pnpm sync:public
PUBLIC_RELEASE_DIR="$PUBLIC_STAGING_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
"$NODE_BIN" <<'NODE'
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const root = process.env.PUBLIC_RELEASE_DIR;
const requiredFiles = ["index.html", "script.js", "styles.css", "assets/favicon.svg"];
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`public release contains a symbolic link: ${relativePath}`);
    if (stats.isDirectory()) {
      walk(absolutePath);
    } else if (stats.isFile()) {
      files.push({
        path: relativePath,
        bytes: stats.size,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(absolutePath)).digest("hex"),
      });
    } else {
      throw new Error(`public release contains an unsupported entry: ${relativePath}`);
    }
  }
}

walk(root);
for (const requiredFile of requiredFiles) {
  if (!files.some((file) => file.path === requiredFile)) {
    throw new Error(`public release is missing ${requiredFile}`);
  }
}
const manifestPath = path.join(root, ".release-manifest.json");
fs.writeFileSync(
  manifestPath,
  `${JSON.stringify({
    revision: process.env.CURRENT_REVISION,
    sourceArtifactManifestSha256: process.env.ARTIFACT_MANIFEST_SHA256,
    createdAt: new Date().toISOString(),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    files,
  }, null, 2)}\n`,
  { flag: "wx", mode: 0o644 }
);
const descriptor = fs.openSync(manifestPath, "r+");
try {
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
NODE
find "$PUBLIC_STAGING_DIR" -type d -exec chmod 755 {} \;
find "$PUBLIC_STAGING_DIR" -type f -exec chmod 644 {} \;
chown -R root:www-data "$PUBLIC_STAGING_DIR"
sync
mv -T "$PUBLIC_STAGING_DIR" "$PUBLIC_RELEASE_DIR"
sync -f "$PUBLIC_RELEASE_ROOT"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="public-switch-about-to-start" \
JOURNAL_DETAILS_JSON="$JOURNAL_CONTEXT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js
POINTER_PATH="$ACTIVE_PUBLIC_LINK" \
TARGET_ROOT="$PUBLIC_RELEASE_ROOT" \
EXPECTED_OLD_TARGET="$PREVIOUS_PUBLIC_TARGET" \
NEW_TARGET="$PUBLIC_RELEASE_DIR" \
DEPLOY_LOCK_FILE="$DEPLOY_LOCK_FILE" \
DEPLOY_LOCK_OWNER_PID="$PPID" \
"$NODE_BIN" "$CONTROLLER_DIR/switch-release-pointer.js"
public_switched=1
if [[ "$(readlink -f "$ACTIVE_PUBLIC_LINK")" != "$PUBLIC_RELEASE_DIR" ]]; then
  echo "ERROR: active public pointer did not resolve to the validated release." >&2
  exit 1
fi
sync
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="public-pointer-switched" \
JOURNAL_DETAILS_JSON="$JOURNAL_CONTEXT_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Validate the active HTTP/HTTPS Nginx configuration while maintenance remains on =="
install_nginx_site "$NGINX_SOURCE" false

echo "== Final loopback readiness check while external maintenance is still active =="
FINAL_HEALTH_JSON="$(wait_for_health "http://127.0.0.1:3003/api/health/ready" 10)"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="nginx-loopback-verified" \
JOURNAL_DETAILS_JSON="$FINAL_HEALTH_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Release maintenance only after API, database, media bundle, static assets, and Nginx are ready =="
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="maintenance-release-about-to-start" \
JOURNAL_DETAILS_JSON="$FINAL_HEALTH_JSON" \
"$NODE_BIN" scripts/update-activation-journal.js
rm -f "$MAINTENANCE_FLAG"
sync
if ! PUBLIC_STATUS="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' "$MAINTENANCE_URL")"; then
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  sync
  echo "ERROR: public API transport check failed; maintenance was restored." >&2
  exit 1
fi
if [[ "$PUBLIC_STATUS" != "200" ]]; then
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  sync
  echo "ERROR: public API returned HTTP $PUBLIC_STATUS after maintenance release; maintenance was restored." >&2
  exit 1
fi
if ! PUBLIC_STATIC_STATUS="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' "$MAINTENANCE_STATIC_URL")"; then
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  sync
  echo "ERROR: public static-site transport check failed; maintenance was restored." >&2
  exit 1
fi
if [[ "$PUBLIC_STATIC_STATUS" != "200" ]]; then
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  sync
  echo "ERROR: public static site returned HTTP $PUBLIC_STATIC_STATUS; maintenance was restored." >&2
  exit 1
fi
PUBLIC_WRITE_PROBE_URL="${MAINTENANCE_URL%/api/health}/api/auth/login"
if ! PUBLIC_WRITE_STATUS="$("${MAINTENANCE_CURL[@]}" -o /dev/null -w '%{http_code}' \
  -X POST -H 'Content-Type: application/json' --data '{}' "$PUBLIC_WRITE_PROBE_URL")" \
  || [[ "$PUBLIC_WRITE_STATUS" != "503" ]]; then
  atomic_replace_file /dev/null "$MAINTENANCE_FLAG" 0644
  sync
  echo "ERROR: public write gate returned HTTP ${PUBLIC_WRITE_STATUS:-transport-error}; maintenance was restored." >&2
  exit 1
fi
PUBLIC_READONLY_DETAILS="$(PUBLIC_STATUS="$PUBLIC_STATUS" \
  PUBLIC_STATIC_STATUS="$PUBLIC_STATIC_STATUS" \
  PUBLIC_WRITE_STATUS="$PUBLIC_WRITE_STATUS" \
  "$NODE_BIN" -e 'process.stdout.write(JSON.stringify({apiStatus:Number(process.env.PUBLIC_STATUS),staticStatus:Number(process.env.PUBLIC_STATIC_STATUS),writeStatus:Number(process.env.PUBLIC_WRITE_STATUS)}))')"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="public-readonly-verified" \
JOURNAL_DETAILS_JSON="$PUBLIC_READONLY_DETAILS" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Atomically commit the verified release marker last =="
verify_candidate_tree
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="marker-commit-about-to-start" \
JOURNAL_DETAILS_JSON="$PUBLIC_READONLY_DETAILS" \
"$NODE_BIN" scripts/update-activation-journal.js
verify_candidate_process_identity_now "immediately before marker commit"
CURRENT_REVISION="$CURRENT_REVISION" \
ARTIFACT_MANIFEST_SHA256="$ARTIFACT_MANIFEST_SHA256" \
APP_DIR="$APP_DIR" \
RUNTIME_LINK="$RUNTIME_LINK" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
NEW_APP_PID="$NEW_APP_PID" \
PUBLIC_RELEASE_DIR="$PUBLIC_RELEASE_DIR" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
PREVIOUS_MARKER_SHA256="$PREVIOUS_MARKER_SHA256" \
POST_MIGRATION_PREFLIGHT_OUTPUT="$POST_MIGRATION_PREFLIGHT_OUTPUT" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const database = JSON.parse(process.env.POST_MIGRATION_PREFLIGHT_OUTPUT);
const releasePath = process.env.CURRENT_RELEASE_FILE;
const temporaryPath = `${releasePath}.tmp-${process.pid}`;
const databaseStats = fs.statSync(database.databasePath, { bigint: true });
const databaseDirectory = path.dirname(path.resolve(database.databasePath));
const existingDescriptor = fs.openSync(releasePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
const existingStats = fs.fstatSync(existingDescriptor, { bigint: true });
if (!existingStats.isFile() || existingStats.nlink !== 1n || existingStats.size <= 0n || existingStats.size > 4n * 1024n * 1024n) {
  fs.closeSync(existingDescriptor);
  throw new Error("current release marker identity or size is unsafe");
}
if (process.platform === "linux" && (existingStats.uid !== 0n || (existingStats.mode & 0o777n) !== 0o640n)) {
  fs.closeSync(existingDescriptor);
  throw new Error("current release marker must be root-owned with exact mode 0640");
}
const existingMarker = fs.readFileSync(existingDescriptor);
fs.closeSync(existingDescriptor);
const existingMarkerSha256 = crypto.createHash("sha256").update(existingMarker).digest("hex");
if (existingMarkerSha256 !== process.env.PREVIOUS_MARKER_SHA256) {
  throw new Error("current release marker changed during the controlled activation");
}
fs.writeFileSync(
  temporaryPath,
  `${JSON.stringify({
    formatVersion: 2,
    revision: process.env.CURRENT_REVISION,
    artifactManifestSha256: process.env.ARTIFACT_MANIFEST_SHA256,
    runtimeReleaseDirectory: process.env.APP_DIR,
    runtimePointer: process.env.RUNTIME_LINK,
    activationAttemptId: process.env.JOURNAL_ATTEMPT_ID,
    pm2Pid: Number(process.env.NEW_APP_PID),
    activatedAt: new Date().toISOString(),
    activationVerified: true,
    rollbackPolicy: "forward-fix-only-do-not-start-legacy-code",
    rollbackBundleDirectory: process.env.ROLLBACK_BUNDLE_DIR,
    publicReleaseDirectory: process.env.PUBLIC_RELEASE_DIR,
    databasePath: database.databasePath,
    databaseIdentity: {
      device: databaseStats.dev.toString(),
      inode: databaseStats.ino.toString(),
    },
    mediaRoots: {
      community: path.resolve(process.env.COMMUNITY_UPLOAD_DIR || path.join(databaseDirectory, "uploads", "community")),
      observations: path.resolve(process.env.OBSERVATION_UPLOAD_DIR || path.join(databaseDirectory, "uploads", "observations")),
    },
    schemaVersion: database.currentVersion,
    databaseTableCounts: database.userTableCounts,
  }, null, 2)}\n`,
  { flag: "wx", mode: 0o640 }
);
let descriptor = fs.openSync(temporaryPath, "r+");
try {
  fs.fchmodSync(descriptor, 0o640);
  if (process.platform === "linux") {
    const controlStats = fs.statSync(process.env.ACTIVATION_CONTROL_DIR);
    fs.fchownSync(descriptor, 0, controlStats.gid);
  }
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
const recheckDescriptor = fs.openSync(releasePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
const recheckStats = fs.fstatSync(recheckDescriptor, { bigint: true });
const recheckBytes = fs.readFileSync(recheckDescriptor);
fs.closeSync(recheckDescriptor);
if (
  recheckStats.dev !== existingStats.dev
  || recheckStats.ino !== existingStats.ino
  || crypto.createHash("sha256").update(recheckBytes).digest("hex") !== existingMarkerSha256
) {
  throw new Error("current release marker changed before atomic replacement");
}
fs.renameSync(temporaryPath, releasePath);
descriptor = fs.openSync(process.env.ACTIVATION_CONTROL_DIR, "r");
try {
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
NODE

ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
CURRENT_REVISION="$CURRENT_REVISION" \
ROLLBACK_BUNDLE_DIR="$ROLLBACK_BUNDLE_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
JOURNAL_STATUS="marker-committed" \
JOURNAL_DETAILS_JSON="$(CURRENT_RELEASE_FILE="$CURRENT_RELEASE_FILE" "$NODE_BIN" -e 'process.stdout.write(JSON.stringify({currentReleaseFile:process.env.CURRENT_RELEASE_FILE}))')" \
"$NODE_BIN" scripts/update-activation-journal.js

echo "== Clear activation journal only after the verified release marker is durable =="
verify_candidate_tree
verify_candidate_process_identity_now "immediately before activation journal cleanup"
ACTIVATION_PENDING_FILE="$ACTIVATION_PENDING_FILE" \
ACTIVATION_CONTROL_DIR="$ACTIVATION_CONTROL_DIR" \
JOURNAL_ATTEMPT_ID="$JOURNAL_ATTEMPT_ID" \
CURRENT_REVISION="$CURRENT_REVISION" \
"$NODE_BIN" <<'NODE'
const fs = require("fs");
const descriptor = fs.openSync(
  process.env.ACTIVATION_PENDING_FILE,
  fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
);
const stats = fs.fstatSync(descriptor);
if (!stats.isFile() || stats.nlink !== 1 || stats.size <= 0 || stats.size > 256 * 1024) {
  fs.closeSync(descriptor);
  throw new Error("activation journal identity is unsafe before cleanup");
}
if (process.platform === "linux" && (stats.uid !== 0 || (stats.mode & 0o777) !== 0o640)) {
  fs.closeSync(descriptor);
  throw new Error("activation journal permissions are unsafe before cleanup");
}
const journal = JSON.parse(fs.readFileSync(descriptor, "utf8"));
fs.closeSync(descriptor);
if (
  journal.formatVersion !== 2
  || journal.status !== "marker-committed"
  || journal.attemptId !== process.env.JOURNAL_ATTEMPT_ID
  || journal.revision !== process.env.CURRENT_REVISION
) throw new Error("activation journal is not the committed attempt being finalized");
fs.unlinkSync(process.env.ACTIVATION_PENDING_FILE);
const directoryDescriptor = fs.openSync(process.env.ACTIVATION_CONTROL_DIR, "r");
try {
  fs.fsyncSync(directoryDescriptor);
} finally {
  fs.closeSync(directoryDescriptor);
}
NODE
migration_window_open=0
trap - EXIT
if [[ "$NGINX_SOURCE" == *"birdora-https.conf" ]]; then
  echo "HTTPS update finished with the rollback bundle pinned at $ROLLBACK_BUNDLE_DIR"
else
  echo "HTTP install finished. Apply DNS before requesting HTTPS certificate. Rollback bundle: $ROLLBACK_BUNDLE_DIR"
fi
