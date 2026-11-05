# A more natural narrator for the demo video with Chatterbox (Resemble AI, MIT licence), on this Mac.
# Each sentence is generated on its own (fewer artifacts, natural resets), then joined with a short
# breath of room tone. Low exaggeration and a lower cfg keep it conversational, not announcer-y.
# Usage (repo root): tools/voice/.venv-cb/bin/python tools/voice/make_natural.py LINES.json OUT_DIR \
#        [--only L01,L02] [--ref reference.wav|none] [--exag 0.35] [--cfg 0.4] [--temp 0.7] [--seed 7]
# LINES.json is {"L01": "text", ...}; writes OUT_DIR/<id>.raw.wav (24 kHz, untrimmed, unmastered).
import argparse
import json
import os
import re

import numpy as np
import torch
import torchaudio
from chatterbox.tts import ChatterboxTTS

p = argparse.ArgumentParser()
p.add_argument("lines")
p.add_argument("out")
p.add_argument("--only", default="")
p.add_argument("--ref", default="none")
p.add_argument("--exag", type=float, default=0.35)
p.add_argument("--cfg", type=float, default=0.4)
p.add_argument("--temp", type=float, default=0.7)
p.add_argument("--seed", type=int, default=7)
p.add_argument("--gap", type=float, default=0.30, help="seconds of breath between sentences")
a = p.parse_args()

device = os.environ.get("VOICE_DEVICE") or ("mps" if torch.backends.mps.is_available() else "cpu")
model = ChatterboxTTS.from_pretrained(device=device)
sr = model.sr
ref = None if a.ref == "none" else a.ref
if ref:
    model.prepare_conditionals(ref, exaggeration=a.exag)

lines = json.load(open(a.lines))
only = set(a.only.split(",")) if a.only else None
os.makedirs(a.out, exist_ok=True)


def sentences(text):
    # Split on sentence ends; keep very short fragments with their neighbour.
    parts = [s.strip() for s in re.split(r"(?<=[.?!])\s+", text) if s.strip()]
    out = []
    for s in parts:
        if out and len(s.split()) < 4:
            out[-1] += " " + s
        else:
            out.append(s)
    return out


def trim(w, thresh=0.012):
    # Trim leading/trailing near-silence, keeping a few ms of tail so word ends aren't clipped.
    env = np.abs(w)
    idx = np.where(env > thresh)[0]
    if len(idx) == 0:
        return w
    s = max(0, idx[0] - int(0.02 * sr))
    e = min(len(w), idx[-1] + int(0.06 * sr))
    return w[s:e]


rng = np.random.default_rng(a.seed)
for line_id, text in lines.items():
    if only and line_id not in only:
        continue
    chunks = []
    for i, s in enumerate(sentences(text)):
        torch.manual_seed(a.seed * 100 + i)
        wav = model.generate(s, audio_prompt_path=None, exaggeration=a.exag, cfg_weight=a.cfg, temperature=a.temp)
        w = trim(wav.squeeze(0).cpu().numpy())
        if chunks:
            # A breath: very quiet room tone, length varied a little so it doesn't feel metronomic.
            g = a.gap * (0.85 + 0.3 * rng.random())
            chunks.append(rng.normal(0, 0.0004, int(g * sr)).astype(np.float32))
        chunks.append(w.astype(np.float32))
    out = np.concatenate(chunks)
    torchaudio.save(os.path.join(a.out, f"{line_id}.raw.wav"), torch.from_numpy(out).unsqueeze(0), sr)
    print(f"{line_id}: {len(out) / sr:.2f}s", flush=True)
