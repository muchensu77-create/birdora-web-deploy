#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/birdora-web"
DATA_DIR="/var/lib/birdora"
SITE_NAME="birdora.birdai-glasses.com"
PM2_APP="birdora-web-auth"
NGINX_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"

cd "$APP_DIR"

require_pm2_app() {
  local app_name="$1"
  if ! pm2 describe "$app_name" >/dev/null 2>&1; then
    echo "ERROR: required existing PM2 service is not visible in this PM2 user: $app_name" >&2
    pm2 status || true
    exit 1
  fi
}

wait_for_health() {
  local url="$1"
  local attempts="${2:-30}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null; then
      curl -fsS "$url"
      echo
      return 0
    fi

    sleep 1
  done

  echo "ERROR: health check did not pass after ${attempts}s: $url" >&2
  pm2 logs "$PM2_APP" --lines 80 --nostream || true
  exit 1
}

install_nginx_site() {
  local source_config="$1"
  local backup_config=""
  local created_link=0

  if [[ -f "$NGINX_AVAILABLE" ]]; then
    backup_config="${NGINX_AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
    cp -a "$NGINX_AVAILABLE" "$backup_config"
  fi

  cp "$source_config" "$NGINX_AVAILABLE"
  if [[ ! -e "$NGINX_ENABLED" ]]; then
    ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
    created_link=1
  fi

  if ! nginx -t; then
    echo "ERROR: nginx config test failed; restoring previous Birdora site config." >&2
    if [[ -n "$backup_config" ]]; then
      cp -a "$backup_config" "$NGINX_AVAILABLE"
    else
      rm -f "$NGINX_AVAILABLE"
    fi

    if (( created_link )); then
      rm -f "$NGINX_ENABLED"
    fi

    nginx -t || true
    exit 1
  fi

  systemctl reload nginx
}

echo "== Refuse unsafe environment =="
if [[ ! -f .env ]]; then
  cp deploy/env/birdora-web-auth.env.example .env
  chmod 600 .env
  echo "ERROR: created .env from template. Edit JWT_SECRET, then rerun this script." >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source .env
set +a

if [[ -z "${JWT_SECRET:-}" || "${#JWT_SECRET}" -lt 32 || "$JWT_SECRET" == replace-with-* ]]; then
  echo "ERROR: .env JWT_SECRET is missing, too short, or still a placeholder." >&2
  exit 1
fi

NODE_BIN="${NODE_INTERPRETER:-$(command -v node)}"
if [[ ! -x "$NODE_BIN" ]]; then
  echo "ERROR: Node interpreter not found or not executable: $NODE_BIN" >&2
  exit 1
fi

NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[1]')"
if (( NODE_MAJOR < 24 || (NODE_MAJOR == 24 && NODE_MINOR < 14) )); then
  echo "ERROR: Birdora web auth requires Node >=24.14.0. Got $("$NODE_BIN" -v) from $NODE_BIN" >&2
  exit 1
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"

port_is_owned_by_pm2_app() {
  local app_pid
  app_pid="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  [[ "$app_pid" =~ ^[0-9]+$ ]] || return 1
  ss -lntp | grep -qE ":3003\\b.*pid=$app_pid,"
}

echo "== Check port ownership =="
if ss -lntp | grep -qE ':3003\b'; then
  if port_is_owned_by_pm2_app; then
    echo "Port 3003 is already in use by existing $PM2_APP; continuing with restart."
  else
    echo "ERROR: port 3003 is already in use by another service." >&2
    exit 1
  fi
fi

echo "== Install dependencies =="
pnpm install --frozen-lockfile
pnpm test:atlas
pnpm sync:public

echo "== Permissions =="
mkdir -p "$DATA_DIR"
chown -R root:root "$DATA_DIR"
chmod 700 "$DATA_DIR"
chown -R root:www-data "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} \;
find "$APP_DIR" -type f ! -name ".env" -exec chmod 644 {} \;
chmod 600 "$APP_DIR/.env"

echo "== Start PM2 service on port 3003 =="
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 restart ecosystem.config.cjs --update-env
else
  pm2 start ecosystem.config.cjs --update-env
fi

echo "== Wait for local auth health =="
wait_for_health "http://127.0.0.1:3003/api/health" 30

echo "== Verify PM2 inventory before save =="
require_pm2_app "birdora-api"
require_pm2_app "zhubao-api"
require_pm2_app "$PM2_APP"
pm2 save

echo "== Install HTTP-only Nginx site =="
install_nginx_site "deploy/nginx/birdora-pre-cert.conf"

echo "== Local health check =="
wait_for_health "http://127.0.0.1:3003/api/health" 10
echo "HTTP install finished. Apply DNS before requesting HTTPS certificate."
