#!/usr/bin/env bash
set -euo pipefail

# This is an intentionally isolated Linux contract test. It never installs,
# starts, or reconfigures production services and it creates state only below
# a fresh /tmp directory.

platform="$(uname -s 2>/dev/null || printf 'unknown')"
if [[ "$platform" != "Linux" ]]; then
  printf '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"Linux is required for flock and /proc/locks evidence","platform":"%s","exitCode":77}\n' "$platform"
  exit 77
fi

if [[ ! -r /proc/locks ]]; then
  printf '%s\n' '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"/proc/locks is not readable","platform":"Linux","exitCode":77}'
  exit 77
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
test_program="$script_dir/test-linux-deployment-semantics.js"
if [[ ! -f "$test_program" ]]; then
  printf '%s\n' '{"schemaVersion":1,"status":"FAIL","reason":"Linux deployment semantics test program is missing","platform":"Linux"}'
  exit 1
fi

node_bin="$(type -P node || true)"
flock_bin="$(type -P flock || true)"
sleep_bin="$(type -P sleep || true)"
true_bin="$(type -P true || true)"
mktemp_bin="$(type -P mktemp || true)"
for executable in "$node_bin" "$flock_bin" "$sleep_bin" "$true_bin" "$mktemp_bin"; do
  if [[ "$executable" != /* || ! -x "$executable" ]]; then
    printf '%s\n' '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"node, flock, sleep, true, and mktemp must resolve to absolute executables","platform":"Linux","exitCode":77}'
    exit 77
  fi
done

sandbox="$("$mktemp_bin" -d /tmp/birdora-linux-deployment.XXXXXX)"
case "$sandbox" in
  /tmp/birdora-linux-deployment.*) ;;
  *)
    printf '%s\n' '{"schemaVersion":1,"status":"FAIL","reason":"mktemp returned a path outside the required /tmp namespace","platform":"Linux"}'
    exit 1
    ;;
esac

cleanup() {
  case "$sandbox" in
    /tmp/birdora-linux-deployment.*) rm -rf -- "$sandbox" ;;
  esac
}
trap cleanup EXIT HUP INT TERM
mkdir -m 700 -- "$sandbox/home"

# Deliberately start the test under an empty environment. The Node program
# also supplies a minimal environment to every child process it launches.
env -i \
  HOME="$sandbox/home" \
  LANG=C \
  LC_ALL=C \
  PATH=/usr/sbin:/usr/bin:/sbin:/bin \
  TMPDIR=/tmp \
  TZ=UTC \
  BIRDORA_LINUX_TEST_SANDBOX="$sandbox" \
  BIRDORA_LINUX_TEST_FLOCK_BIN="$flock_bin" \
  BIRDORA_LINUX_TEST_SLEEP_BIN="$sleep_bin" \
  BIRDORA_LINUX_TEST_TRUE_BIN="$true_bin" \
  "$node_bin" "$test_program"
