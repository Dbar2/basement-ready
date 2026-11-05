# The demo video's narrator with ElevenLabs. Reads ELEVENLABS_API_KEY from the repo's .env (never
# printed). One request per line; each take is saved as OUT/<id>.raw.mp3 for master_voice.py.
# Usage (repo root): python3 tools/voice/make_eleven.py SAY.json OUT_DIR [--only N02,N05] [--voice Chris]
#        [--model eleven_v3] [--stability 0.5] [--take 2]
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("lines")
p.add_argument("out")
p.add_argument("--only", default="")
p.add_argument("--voice", default="Chris")
p.add_argument("--model", default="eleven_v3")
p.add_argument("--stability", type=float, default=0.5)
p.add_argument("--take", type=int, default=1, help="seed offset for a fresh take")
a = p.parse_args()

key = os.environ.get("ELEVENLABS_API_KEY")
if not key:
    for line in open(os.path.join(os.path.dirname(__file__), "..", "..", ".env")):
        if line.startswith("ELEVENLABS_API_KEY="):
            key = line.split("=", 1)[1].strip().strip('"').strip("'")
if not key:
    sys.exit("no ELEVENLABS_API_KEY in .env")

API = "https://api.elevenlabs.io"


def call(path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None,
                                 headers={"xi-api-key": key, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


voices = json.loads(call("/v1/voices"))["voices"]
match = [v for v in voices if v["name"].lower().startswith(a.voice.lower())]
if not match:
    sys.exit("voice not found; have: " + ", ".join(v["name"] for v in voices))
voice = match[0]
print(f"voice: {voice['name']} ({voice['voice_id']}), model {a.model}", flush=True)

lines = json.load(open(a.lines))
only = set(a.only.split(",")) if a.only else None
os.makedirs(a.out, exist_ok=True)
ids = list(lines)
for i, lid in enumerate(ids):
    if only and lid not in only:
        continue
    if a.model == "eleven_v3":
        # v3 takes stability as 0 (creative), 0.5 (natural) or 1 (robust).
        settings = {"stability": a.stability}
    else:
        settings = {"stability": a.stability, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True}
    body = {"text": lines[lid], "model_id": a.model, "voice_settings": settings, "seed": 1000 * a.take + i}
    if a.model != "eleven_v3":
        # Continuity: the neighbouring lines shape the intonation, so lines flow as one story.
        body["previous_text"] = lines[ids[i - 1]] if i > 0 else None
        body["next_text"] = lines[ids[i + 1]] if i + 1 < len(ids) else None
    for fmt in ("mp3_44100_192", "mp3_44100_128"):
        try:
            audio = call(f"/v1/text-to-speech/{voice['voice_id']}?output_format={fmt}", body)
            break
        except urllib.error.HTTPError as e:
            err = e.read().decode()[:300]
            if fmt == "mp3_44100_128":
                sys.exit(f"{lid}: HTTP {e.code} {err}")
    open(os.path.join(a.out, f"{lid}.raw.mp3"), "wb").write(audio)
    print(f"{lid}: {len(audio) // 1024} KB", flush=True)
    time.sleep(0.3)
