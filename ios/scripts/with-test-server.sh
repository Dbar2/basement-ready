#!/bin/sh
# Runs a command with the free local test server up (scripts/test-server.sh): starts it if it isn't
# already running, waits for it, and stops it afterwards if it started it.
here="$(cd "$(dirname "$0")" && pwd)"
# The server runs in its own process group, so stopping it stops everything under it (pnpm, tsx, node).
set -m
url="http://localhost:${TEST_WEB_PORT:-5183}/api/health"
started=""
if ! curl -sf -m 3 "$url" > /dev/null; then
  mkdir -p "$here/../../tmp"
  "$here/test-server.sh" > "$here/../../tmp/ios-test-server.log" 2>&1 &
  started=$!
  i=0
  until curl -sf -m 3 "$url" > /dev/null; do
    i=$((i + 1))
    if [ $i -gt 60 ]; then echo "The test server didn't start; see tmp/ios-test-server.log" >&2; kill $started; exit 1; fi
    sleep 1
  done
fi
"$@"
status=$?
if [ -n "$started" ]; then kill -TERM -- -"$started" 2>/dev/null; fi
exit $status
