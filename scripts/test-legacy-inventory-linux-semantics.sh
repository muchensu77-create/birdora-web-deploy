#!/usr/bin/env bash
set -euo pipefail

# Linux-only, destructive-state-free semantics test for the legacy inventory
# primitives. Every test-created path is confined to one fresh direct child of
# /tmp. This wrapper never addresses Birdora production paths, services, ports,
# databases, or network endpoints.

# Resolve every helper through a fixed system-only search path. The actual test
# still runs with env -i below.
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

platform="$(uname -s 2>/dev/null || printf 'unknown')"
if [[ "$platform" != "Linux" ]]; then
  printf '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"Linux is required for O_NOFOLLOW, ownership, link, fsync, and procfs semantics","platform":"%s","exitCode":77}\n' "$platform"
  exit 77
fi

if [[ ! -r /proc/net/tcp || ! -r /proc/net/tcp6 ]]; then
  printf '%s\n' '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"Linux procfs TCP tables are not readable","platform":"Linux","exitCode":77}'
  exit 77
fi

script_source="${BASH_SOURCE[0]}"
case "$script_source" in
  */*) script_parent="${script_source%/*}" ;;
  *) script_parent="." ;;
esac
script_dir="$(cd -- "$script_parent" && pwd -P)"
test_program="$script_dir/test-legacy-inventory-linux-semantics.js"
if [[ ! -f "$test_program" || -L "$test_program" ]]; then
  printf '%s\n' '{"schemaVersion":1,"status":"FAIL","reason":"Linux legacy inventory semantics test program is missing or is a symlink","platform":"Linux"}'
  exit 1
fi

node_bin="$(type -P node || true)"
env_bin="$(type -P env || true)"
mkdir_bin="$(type -P mkdir || true)"
mktemp_bin="$(type -P mktemp || true)"
mkfifo_bin="$(type -P mkfifo || true)"
rm_bin="$(type -P rm || true)"
for executable in "$node_bin" "$env_bin" "$mkdir_bin" "$mktemp_bin" "$mkfifo_bin" "$rm_bin"; do
  if [[ "$executable" != /* || ! -x "$executable" ]]; then
    printf '%s\n' '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"node, env, mkdir, mktemp, mkfifo, and rm must resolve to absolute executables","platform":"Linux","exitCode":77}'
    exit 77
  fi
done

umask 077
ulimit -c 0 || {
  printf '%s\n' '{"schemaVersion":1,"status":"UNAVAILABLE","reason":"core dumps could not be disabled","platform":"Linux","exitCode":77}'
  exit 77
}

sandbox="$("$mktemp_bin" -d /tmp/birdora-legacy-inventory.XXXXXX)"
case "$sandbox" in
  /tmp/birdora-legacy-inventory.*) ;;
  *)
    printf '%s\n' '{"schemaVersion":1,"status":"FAIL","reason":"mktemp returned a path outside the required /tmp namespace","platform":"Linux"}'
    exit 1
    ;;
esac

cleanup() {
  case "$sandbox" in
    /tmp/birdora-legacy-inventory.*) "$rm_bin" -rf -- "$sandbox" ;;
  esac
}
trap cleanup EXIT HUP INT TERM

"$mkdir_bin" -m 700 -- "$sandbox/home"

clean_environment=(
  "HOME=$sandbox/home"
  "LANG=C"
  "LC_ALL=C"
  "PATH=/usr/sbin:/usr/bin:/sbin:/bin"
  "TMPDIR=/tmp"
  "TZ=UTC"
  "BIRDORA_LEGACY_LINUX_TEST_SANDBOX=$sandbox"
  "BIRDORA_LEGACY_LINUX_TEST_MKFIFO_BIN=$mkfifo_bin"
)

strace_bin="$(type -P strace || true)"
if [[ "$strace_bin" == /* && -x "$strace_bin" ]]; then
  clean_environment+=("BIRDORA_LEGACY_LINUX_TEST_STRACE_BIN=$strace_bin")
fi

# Deliberately execute under an empty environment. The JavaScript test applies
# the same minimal environment to its optional strace child.
"$env_bin" -i "${clean_environment[@]}" "$node_bin" "$test_program"
