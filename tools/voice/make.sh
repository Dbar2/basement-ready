#!/bin/sh
# Makes the guide's voice clips on this Mac with Chatterbox (Resemble AI, MIT licence): natural,
# expressive speech, free and offline after the first run (which downloads the model, about 2 GB).
# Clips land in public/voice/. The voice is copied from tools/voice/reference.wav (a woman's voice made
# with Kokoro-82M, Apache-2.0, by tools/voice/reference.py); VOICE_REFERENCE picks another recording.
# Usage: pnpm voice [only,these,lines]
set -e
cd "$(dirname "$0")/../.."
if [ ! -x tools/voice/.venv-cb/bin/python ]; then
  uv venv --python 3.11 tools/voice/.venv-cb -q
  uv pip install --python tools/voice/.venv-cb/bin/python -q chatterbox-tts "setuptools<81"
fi
mkdir -p tmp
pnpm -s tsx -e 'import { LINES } from "./src/capture/script.ts"; process.stdout.write(JSON.stringify(LINES))' > tmp/voice-lines.json
VOICE_REFERENCE="${VOICE_REFERENCE:-tools/voice/reference.wav}" tools/voice/.venv-cb/bin/python tools/voice/make_cb.py tmp/voice-lines.json public/voice "${1:-}" 2>&1 | grep -E "^[a-z_]+:|Error" || true
