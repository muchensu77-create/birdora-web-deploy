#!/usr/bin/env bash
set -euo pipefail

cat >&2 <<'EOF'
ERROR: deploy/scripts/preflight.sh is retired and intentionally performs no action.

This script checked the legacy mutable checkout, shared PM2 inventory, and port
layout. Those observations cannot authorize the current signed immutable-release
workflow and do not prove ownership of the deployment lock, activation journal,
or database lifecycle lock. Use only the reviewed external deployment controller
and its version-matched, fail-closed diagnostics.

No network request was sent and no PM2, Nginx, application, database, or
filesystem state was inspected or changed by this invocation.
EOF

# EX_CONFIG: never let legacy automation treat this obsolete diagnostic as a
# successful release preflight.
exit 78
