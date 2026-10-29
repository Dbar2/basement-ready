# The guide's voice with Chatterbox (Resemble AI, MIT licence): natural, expressive speech, made on
# this Mac once. The lines come from src/capture/script.ts. Clips go to public/voice/<line>.mp3.
# Usage (from the repo root): pnpm voice [only,these,lines]
import json
import os
import subprocess
import sys

import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

lines_file, out_dir = sys.argv[1], sys.argv[2]
only = sys.argv[3].split(",") if len(sys.argv) > 3 and sys.argv[3] else None
# A reference recording sets the voice; without one, Chatterbox's own default voice.
reference = os.environ.get("VOICE_REFERENCE")

device = "mps" if torch.backends.mps.is_available() else "cpu"
model = ChatterboxTTS.from_pretrained(device=device)
lines = json.load(open(lines_file))
os.makedirs(out_dir, exist_ok=True)

for line_id, text in lines.items():
    if only and line_id not in only:
        continue
    # A little warmth (exaggeration) and an unhurried pace (lower cfg) read as a person, not a machine.
    wav = model.generate(text, audio_prompt_path=reference, exaggeration=0.55, cfg_weight=0.4, temperature=0.75)
    tmp = os.path.join(out_dir, f"{line_id}.wav")
    torchaudio.save(tmp, wav, model.sr)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp, "-af", "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse",
         "-ac", "1", "-b:a", "64k", os.path.join(out_dir, f"{line_id}.mp3")],
        check=True,
    )
    os.remove(tmp)
    print(f"{line_id}: {text}", flush=True)
