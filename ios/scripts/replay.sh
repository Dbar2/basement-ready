#!/bin/sh
# Plays a recorded take in the simulator as if it were ARKit (Debug builds). Usage:
#   scripts/replay.sh <take folder> [speed] [more launch arguments]
# The folder holds a video (.mp4 or .mov) and capture.json, plus sensors.jsonl for a real app take.
# A Blender test basement uses ios/Fixtures/<its id>/geometry.json for its walls.
# Server: SERVER=http://localhost:5173 (the default) or SERVER=live; LOG=<file> keeps the app's
# once-a-second BRPERF lines (frame rate, lag, memory).
set -e
here="$(cd "$(dirname "$0")/.." && pwd)"
take="$(cd "$1" && pwd)"; shift
speed="${1:-1}"; [ $# -gt 0 ] && shift
sim="${SIM:-iPhone 17}"
geometry="$here/Fixtures/$(basename "$take")/geometry.json"
[ -f "$take/geometry.json" ] && geometry="$take/geometry.json"
server="${SERVER:-http://localhost:5173}"
[ "$server" = "live" ] && server="https://web-production-0c550.up.railway.app"

xcrun simctl boot "$sim" 2>/dev/null || true
xcrun simctl terminate "$sim" com.davidbarry.basementready 2>/dev/null || true
xcrun simctl install "$sim" "$here/build/Build/Products/Debug-iphonesimulator/BasementReady.app"
if [ -n "$LOG" ]; then
  xcrun simctl spawn "$sim" log stream --style compact --predicate 'subsystem == "com.davidbarry.basementready"' > "$LOG" &
  trap 'kill $! 2>/dev/null' EXIT
fi
xcrun simctl launch --terminate-running-process "$sim" com.davidbarry.basementready \
  -BRSkipIntro -BRFilmNow -BRReplay "$take" -BRReplayGeometry "$geometry" -BRReplaySpeed "$speed" -serverURL "$server" "$@"
if [ -n "$LOG" ]; then
  echo "Logging to $LOG; press Ctrl-C to stop."
  wait
fi
