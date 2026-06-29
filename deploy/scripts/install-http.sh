#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/birdora-web"
DATA_DIR="/var/lib/birdora"
SITE_NAME="birdora.birdai-glasses.com"
NGINX_AVAILABLE="/etc/nginx/sites-available/$SITE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$SITE_NAME"

cd "$APP_DIR"

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

echo "== Install dependencies =="
pnpm install --frozen-lockfile
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
if ss -lntp | grep -qE ':3003\b'; then
  echo "ERROR: port 3003 is already in use." >&2
  exit 1
fi

pm2 start ecosystem.config.cjs --update-env
pm2 save

echo "== Install HTTP-only Nginx site =="
cp deploy/nginx/birdora-pre-cert.conf "$NGINX_AVAILABLE"
if [[ ! -e "$NGINX_ENABLED" ]]; then
  ln -s "$NGINX_AVAILABLE" "$NGINX_ENABLED"
fi
nginx -t
systemctl reload nginx

echo "== Local health check =="
curl -fsS http://127.0.0.1:3003/api/health
echo
echo "HTTP install finished. Apply DNS before requesting HTTPS certificate."
