#!/usr/bin/env bash
# Fetches the video's music bed into public/music.wav (git-ignored): "New Day" by Lee Rosevere,
# from Free Music Archive, licensed CC BY 4.0 (credited in the end card and CREDITS.md).
# public/music.wav is the one music file: drop another track there to swap it (then set LIFT in
# src/data/media.json to where the new track lifts, in seconds, so it lands on the answer).
# Usage (from video/): tools/music/fetch.sh
set -euo pipefail
URL="https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/RGx0OybysBm4Jk03k3XREGUjrKSaJ7BXvx0fbnT3.mp3"
TMP=$(mktemp -d)
curl -sSL "$URL" -o "$TMP/new-day.mp3"
ffmpeg -hide_banner -loglevel error -y -i "$TMP/new-day.mp3" -map 0:a -ar 48000 -ac 2 -c:a pcm_s16le public/music.wav
rm -rf "$TMP"
ffprobe -v error -show_entries format=duration -of csv=p=0 public/music.wav
