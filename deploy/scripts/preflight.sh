#!/usr/bin/env bash
set -euo pipefail

DOMAIN="birdora.birdai-glasses.com"
EXPECTED_IP="39.106.221.224"
PM2_APP="birdora-web-auth"

echo "== Host =="
hostnamectl || true

echo
echo "== Existing PM2 services =="
pm2 list
pm2 status birdora-api >/dev/null
pm2 status zhubao-api >/dev/null

echo
echo "== Listening ports =="
ss -lntp | grep -E ':(80|443|3000|3002|3003|5432)\b' || true

port_is_owned_by_pm2_app() {
  local app_pid
  app_pid="$(pm2 pid "$PM2_APP" 2>/dev/null || true)"
  [[ "$app_pid" =~ ^[0-9]+$ ]] || return 1
  ss -lntp | grep -qE ":3003\\b.*pid=$app_pid,"
}

if ss -lntp | grep -qE ':3003\b'; then
  if port_is_owned_by_pm2_app; then
    echo "port 3003 is already owned by $PM2_APP: ok"
  else
    echo "ERROR: port 3003 is already in use by another service. Pick a different Birdora web auth port before continuing." >&2
    exit 1
  fi
else
  echo "port 3003 is free: ok"
fi

echo
echo "== Existing service health =="
curl -fsSI https://jewelry-api.birdai-glasses.com >/dev/null
echo "jewelry-api health: ok"

echo
echo "== DNS =="
RESOLVED_IP="$(dig +short "$DOMAIN" | tail -n 1 || true)"
echo "$DOMAIN -> ${RESOLVED_IP:-unresolved}"
if [[ "$RESOLVED_IP" != "$EXPECTED_IP" ]]; then
  echo "WARN: DNS is not ready for HTTPS. Expected $EXPECTED_IP."
fi

echo
echo "== Nginx Birdora references =="
nginx -T 2>/dev/null | grep -E 'server_name|3000|3002|3003|zhubao|birdora' || true

echo
echo "Preflight finished."
