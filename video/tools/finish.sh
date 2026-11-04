#!/usr/bin/env bash
# Render the demo and master it: Remotion renders the picture and the mixed voice and music (the music
# ducked under the voice in src/Root.tsx), then ffmpeg brings the mix to -14 LUFS integrated, -1 dBTP,
# in two passes, and makes the 720p copy. Output goes to ../media/video/ (git-ignored).
# Usage (from video/): tools/finish.sh [concurrency=2]
set -euo pipefail
OUT=../media/video
RAW=$OUT/basement-ready-demo-raw.mp4
mkdir -p "$OUT"
# Remotion's own headless Chrome never finishes loading on this Mac (macOS 27); Playwright's works.
BROWSER="${REMOTION_BROWSER:-$(ls -d "$HOME"/Library/Caches/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-mac-arm64/chrome-headless-shell | tail -1)}"
npx remotion render src/index.ts Demo "$RAW" --browser-executable="$BROWSER" --concurrency="${1:-2}" --crf=16 --audio-bitrate=320k --log=error

# two-pass loudness normalisation of the mixed audio, picture copied as is
M=$(ffmpeg -hide_banner -nostats -i "$RAW" -af loudnorm=I=-14:TP=-1:LRA=11:print_format=json -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$M" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
ffmpeg -hide_banner -loglevel error -y -i "$RAW" -c:v copy \
  -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=$(get input_i):measured_TP=$(get input_tp):measured_LRA=$(get input_lra):measured_thresh=$(get input_thresh):offset=$(get target_offset):linear=true,aresample=48000" \
  -c:a aac -b:a 320k -movflags +faststart "$OUT/basement-ready-demo.mp4"
ffmpeg -hide_banner -loglevel error -y -i "$OUT/basement-ready-demo.mp4" -vf scale=1280:720:flags=lanczos -c:v libx264 -crf 20 -preset slow -c:a copy -movflags +faststart "$OUT/basement-ready-demo-720p.mp4"
ffmpeg -hide_banner -nostats -i "$OUT/basement-ready-demo.mp4" -af ebur128=peak=true -f null - 2>&1 | awk '/Summary:/{f=1} f' | grep -E " I:|Peak:"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/basement-ready-demo.mp4"
