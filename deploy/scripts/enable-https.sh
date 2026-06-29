#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/birdora-web"
DOMAIN="birdora.birdai-glasses.com"
EXPECTED_IP="39.106.221.224"
NGINX_AVAILABLE="/etc/nginx/sites-available/$DOMAIN"

cd "$APP_DIR"

RESOLVED_IP="$(dig +short "$DOMAIN" | tail -n 1 || true)"
if [[ "$RESOLVED_IP" != "$EXPECTED_IP" ]]; then
  echo "ERROR: DNS is not ready. $DOMAIN resolves to ${RESOLVED_IP:-unresolved}, expected $EXPECTED_IP." >&2
  exit 1
fi

curl -fsSI "http://$DOMAIN/" >/dev/null

certbot certonly --webroot -w "$APP_DIR/public" -d "$DOMAIN"

cp deploy/nginx/birdora-https.conf "$NGINX_AVAILABLE"
nginx -t
systemctl reload nginx

curl -fsSI "https://$DOMAIN/" >/dev/null
curl -fsS "https://$DOMAIN/api/health" >/dev/null
curl -fsSI https://jewelry-api.birdai-glasses.com >/dev/null

echo "HTTPS enabled and existing jewelry API still responds."
