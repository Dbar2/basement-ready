#!/bin/sh
# A local Basement Ready server for the app's UI test and replays, that can't spend anything: every
# Meta and 3D call is answered from saved recordings or fails (META_CACHE=replay, as the web's
# end-to-end tests run, tests/e2e/support/run.ts), and the network guard blocks anything else.
# Its own ports, so a `pnpm dev` that's already running is left alone. Ctrl-C stops both.
#   scripts/test-server.sh            web on http://localhost:5183, API on 8797
set -e
cd "$(dirname "$0")/../.."
API=${TEST_API_PORT:-8797}
WEB=${TEST_WEB_PORT:-5183}
run="tmp/ios-test-server"
mkdir -p "$run"
export API_PORT=$API NODE_ENV=development PGLITE_DIR="$run/pglite" LOCAL_STORAGE_DIR="$run/storage" STORAGE=local DATABASE_URL=
export META_CACHE=replay SCAN3D_CACHE=replay PUBLIC_CACHE=replay REPLAY_PACE=0 REPLAY_LOG="$run/replay.log" REPLAY_MISS_LOG="$run/misses.log"
export SCANS_PER_IP_PER_HOUR=1000 SCANS_PER_DAY=1000 DAILY_COST_CAP_USD=1000
# A stand-in key so uploads are accepted; replay answers (or fails) before any request is made.
export MODEL_API_KEY=replay-only RELAY_TOKEN= META_API_BASE=http://meta.replay.invalid/v1 SCAN3D_URL=http://scan3d.replay.invalid SCAN3D_TOKEN=replay
export CLERK_SECRET_KEY= CLERK_PUBLISHABLE_KEY=
# A server this checkout left on our ports earlier is stopped first. Only one whose working folder is
# this checkout: other sessions run their own servers from their own worktrees.
for port in "$API" "$WEB"; do
  for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    [ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" = "$PWD" ] && kill "$pid"
  done
done
# The API in its own process group, so stopping this script stops all of it (pnpm, tsx and node).
set -m
pnpm exec tsx --import ./tests/e2e/support/net-guard.ts server/index.ts &
api=$!
set +m
trap 'kill -TERM -- -"$api" 2>/dev/null' EXIT INT TERM
pnpm exec vite --port "$WEB" --strictPort
