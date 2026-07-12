#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
ERROR: deploy/scripts/enable-https.sh is retired and intentionally performs no action.

This legacy entry point bypassed the signed immutable release, stable external
deployment controller, deployment lock, activation journal, and database
lifecycle lock. HTTPS or Nginx changes must be performed only by the reviewed
external deployment controller as part of an authorized release procedure.

No certificate, Nginx, PM2, application, database, or filesystem state was
changed by this invocation.
EOF

# EX_CONFIG: this command is no longer a valid deployment interface. A non-zero
# status also prevents old "preflight && enable-https" automation from continuing.
exit 78
