# The demo video's narrator with Chatterbox (Resemble AI, MIT licence), made on this Mac.
# Usage (from video/): <chatterbox venv>/bin/python tools/voice/make_vo.py [L01,L02] [takes]
# Lines come from tools/voice/voice-lines.json (the ids in SCRIPT.md). Each take goes to
# public/voice/<id>_t<n>.wav (48 kHz mono, silence trimmed); pick_takes.py picks the best take.
import json
import os
import subprocess
import sys

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

only = sys.argv[1].split(",") if len(sys.argv) > 1 and sys.argv[1] else None
takes = int(sys.argv[2]) if len(sys.argv) > 2 else 2
# The app guide's own voice (a Kokoro-82M reference, Apache-2.0, see ../tools/voice/reference.py).
# Chatterbox's default voice reads too fast for a narrator, even at a low cfg.
reference = os.environ.get("VOICE_REFERENCE", "../tools/voice/reference.wav")
device = os.environ.get("VOICE_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")

model = ChatterboxTTS.from_pretrained(device=device)
lines = json.load(open("tools/voice/voice-lines.json"))
# How a line is said, where that differs from its caption (e.g. "SAM three point one" for "SAM 3.1").
say = json.load(open("tools/voice/say.json")) if os.path.exists("tools/voice/say.json") else {}
out_dir = "public/voice"
os.makedirs(out_dir, exist_ok=True)

for line_id, text in lines.items():
    if only and line_id not in only:
        continue
    first = 1 + len([f for f in os.listdir(out_dir) if f.startswith(f"{line_id}_t")])
    for t in range(first, first + takes):
        torch.manual_seed(1000 * t + int(line_id[1:]))
        # A narrator: warm but steady, unhurried.
        wav = model.generate(say.get(line_id, text), audio_prompt_path=reference, exaggeration=0.5, cfg_weight=0.3, temperature=0.75)
        raw = os.path.join(out_dir, f"{line_id}_t{t}.raw.wav")
        torchaudio.save(raw, wav, model.sr)
        trim = ("silenceremove=start_periods=1:start_threshold=-48dB,areverse,"
                "silenceremove=start_periods=1:start_threshold=-48dB,areverse,"
                "adelay=40,apad=pad_dur=0.08")
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", raw, "-af", trim, "-ar", "48000", "-ac", "1",
                        os.path.join(out_dir, f"{line_id}_t{t}.wav")], check=True)
        os.remove(raw)
        print(f"{line_id}_t{t}", flush=True)
