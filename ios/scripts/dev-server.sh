#!/bin/sh
# Writes the Mac's Wi-Fi address into Debug builds as the default "Mac (dev)" server, the same
# https://<ip>:5173 that `pnpm dev:phone` serves. Release builds get no file and default to the live site.
OUT="$TARGET_BUILD_DIR/$UNLOCALIZED_RESOURCES_FOLDER_PATH/dev-server.json"
if [ "$CONFIGURATION" != "Debug" ]; then
  rm -f "$OUT"
  exit 0
fi
IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)
[ -n "$IP" ] || IP=localhost
printf '{"url":"https://%s:5173"}\n' "$IP" > "$OUT"
