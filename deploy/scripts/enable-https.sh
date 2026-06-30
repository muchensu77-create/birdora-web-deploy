#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/birdora-web"
DOMAIN="birdora.birdai-glasses.com"
EXPECTED_IP="39.106.221.224"
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"
NGINX_ENABLED="/etc/nginx/sites-enabled/$DOMAIN"

cd "$APP_DIR"

wait_for_url() {
  local url="$1"
  local attempts="${2:-30}"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsSI "$url" >/dev/null; then
      return 0
    fi

    sleep 1
  done

  echo "ERROR: URL did not become healthy after ${attempts}s: $url" >&2
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

RESOLVED_IP="$(dig +short "$DOMAIN" | tail -n 1 || true)"
if [[ "$RESOLVED_IP" != "$EXPECTED_IP" ]]; then
  echo "ERROR: DNS is not ready. $DOMAIN resolves to ${RESOLVED_IP:-unresolved}, expected $EXPECTED_IP." >&2
  exit 1
fi

wait_for_url "http://$DOMAIN/" 20

certbot certonly --webroot -w "$APP_DIR/public" -d "$DOMAIN" --keep-until-expiring

install_nginx_site "deploy/nginx/birdora-https.conf"

wait_for_url "https://$DOMAIN/" 30
curl -fsS "https://$DOMAIN/api/health" >/dev/null
curl -fsSI https://jewelry-api.birdai-glasses.com >/dev/null

echo "HTTPS enabled and existing jewelry API still responds."
