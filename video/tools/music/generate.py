"""Generate a long instrumental music bed with Meta's MusicGen by continuation.

MusicGen makes ~30 s per pass. This script builds a longer track section by
section: the first pass is generated from text alone; every later pass feeds the
last PROMPT_S seconds of the track back as an audio prompt together with that
section's text, and the new audio is stitched on with a short crossfade inside
the overlap (where old and new audio are the same music, sample-aligned).

Each pass is saved (per-pass WAV + the cumulative track), so one bad section can
be regenerated with another seed without redoing the earlier ones:

    python generate.py --out runs/a                  # whole track
    python generate.py --out runs/a --from 4 --seed 7  # redo pass 4 onwards

Model weights live in the Hugging Face cache (~/.cache/huggingface), never in the repo.
Output is raw 32 kHz audio; post-process with master.sh.
"""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf
import torch
from transformers import AutoProcessor, MusicgenForConditionalGeneration

SR = 32000  # MusicGen / EnCodec sample rate
FRAME_RATE = 50  # tokens per second
PROMPT_S = 10.0  # seconds of audio fed back as the prompt
XFADE_S = 0.5  # crossfade length inside the overlap

BASE = (
    "warm modern instrumental for a calm product video, soft felt piano and warm "
    "electric piano, gentle airy pads, light plucks, 95 bpm, major key, "
    "clean soft mix, no vocals"
)

TEXT = {
    "intro": BASE + ", sparse and gentle intro, spacious, soft felt piano chords over airy pads, "
    "very light soft percussion, calm and hopeful",
    "intro_cont": BASE + ", gentle and steady, continuous flowing soft felt piano chords over airy "
    "pads, light soft percussion, calm and hopeful",
    "build":BASE + ", gradual build, rising pads, soft kick and shaker starting to come in, "
    "filtered drums swelling, anticipation, getting fuller",
    "full": BASE + ", full warm groove, soft punchy modern beat, warm round bass, lush pads, "
    "light plucks, uplifting and confident, steady",
    "breathe": BASE + ", steady groove that breathes, lighter drums, warm pads and electric "
    "piano, relaxed and confident",
    "outro": BASE + ", gentle ending, drums drop out, soft felt piano and warm pads resolving "
    "to the home chord, calm, fading",
}

# (section text key, seconds of NEW audio). Pass 0 is text-only (30 s).
PLAN = [
    ("intro", 30),  # 0-30
    ("intro_cont", 20),  # 30-50
    ("build", 10),  # 50-60
    ("full", 20),  # 60-80   <- lift lands at 60 s
    ("full", 20),  # 80-100
    ("full", 15),  # 100-115
    ("breathe", 20),  # 115-135 (around 2:00)
    ("full", 20),  # 135-155
    ("full", 15),  # 155-170
    ("outro", 20),  # 170-190
    ("outro", 12),  # 190-202
]


def make_plan(lift: float, total: float):
    """Sections so the build ends and the full groove starts at `lift` seconds, ending past `total`."""
    plan, t = [("intro", 30)], 30.0
    while t < lift - 10 - 0.5:
        n = min(20, round(lift - 10 - t))
        if n < 6:  # fold a short remainder into the build
            break
        plan.append(("intro_cont", n)); t += n
    plan.append(("build", round(lift - t))); t = lift
    breathe_at = lift + 50
    while t < total - 25:
        if abs(t - breathe_at) <= 10 and not any(k == "breathe" for k, _ in plan):
            plan.append(("breathe", 20)); t += 20
        else:
            n = min(20, round(total - 25 - t)) or 10
            plan.append(("full", max(10, n))); t += max(10, n)
    plan += [("outro", 20), ("outro", 12)]
    return plan


def load_model(name: str, device: str, dtype: torch.dtype):
    processor = AutoProcessor.from_pretrained(name)
    model = MusicgenForConditionalGeneration.from_pretrained(name, torch_dtype=dtype)
    model.to(device).eval()
    return processor, model


def to_chan_first(audio: np.ndarray) -> np.ndarray:
    """(channels, samples) float32."""
    if audio.ndim == 1:
        audio = audio[None, :]
    return audio.astype(np.float32)


@torch.no_grad()
def generate_pass(processor, model, device, text, new_s, prompt_audio, seed, n_cand=1, guidance=3.0):
    """Return list of (channels, samples) arrays. With a prompt, each array starts with
    the (re-decoded) prompt audio followed by the new audio."""
    torch.manual_seed(seed)
    channels = model.config.decoder.audio_channels  # 2 for the stereo checkpoints
    inputs = dict(processor.tokenizer([text] * n_cand, padding=True, return_tensors="pt"))
    if prompt_audio is not None:
        pa = prompt_audio
        if pa.shape[0] != channels:
            pa = np.repeat(pa[:1], channels, axis=0)
        audio_in = [pa if channels > 1 else pa[0]] * n_cand
        # call the feature extractor directly: the combined processor in transformers 5
        # mangles stereo (2, N) arrays
        feats = processor.feature_extractor(audio_in, sampling_rate=SR, return_tensors="pt")
        inputs["input_values"] = feats["input_values"]
        if "padding_mask" in feats:
            inputs["padding_mask"] = feats["padding_mask"]
    inputs = {k: v.to(device) for k, v in inputs.items()}
    max_new = int(round(new_s * FRAME_RATE))
    out = model.generate(
        **inputs, do_sample=True, guidance_scale=guidance, max_new_tokens=max_new, top_k=250
    )
    out = out.float().cpu().numpy()  # (n, channels, samples)
    return [to_chan_first(o) for o in out]


# Target loudness shape per section (raw-output RMS dBFS at the start/end of the pass),
# used to choose between batched candidates: no dropouts, a lift right at the start of
# the first "full" pass, a gentle ramp for the build and the outro.
TARGET_DB = {
    "intro": (-19.5, -19.5),
    "intro_cont": (-19.5, -19.0),
    "build": (-19.0, -16.5),
    "full": (-14.5, -14.5),
    "breathe": (-16.5, -16.5),
    "outro": (-16.0, -23.0),
}


def chroma_mean(x: np.ndarray) -> np.ndarray:
    import librosa

    c = librosa.feature.chroma_stft(y=x, sr=SR, n_fft=4096, hop_length=2048).mean(axis=1)
    return c / (np.linalg.norm(c) + 1e-9)


def score(piece: np.ndarray, prompt_len: int, key: str, lift: bool) -> dict:
    """Lower is better. Level deviation from the section's target shape, a heavy penalty
    for dropouts (>8 dB under target), and a penalty if the harmony drifts from the prompt."""
    mono = piece.mean(axis=0)
    new = mono[prompt_len:] if prompt_len else mono
    secs = max(1, len(new) // SR)
    rms = np.array([20 * np.log10(np.sqrt(np.mean(new[s * SR : (s + 1) * SR] ** 2)) + 1e-9) for s in range(secs)])
    a, b = TARGET_DB[key]
    tgt = np.linspace(a, b, secs)
    w = np.ones(secs)
    if lift:
        w[:4] = 3.0  # the lift should land at the start of the pass, not a few seconds in
    dev = float(np.sum(np.abs(rms - tgt) * w) / np.sum(w))
    drop = float(np.sum(np.maximum(0, tgt - 8 - rms)))
    harm = 0.0
    if prompt_len:
        sim = float(np.dot(chroma_mean(mono[prompt_len - 5 * SR : prompt_len]), chroma_mean(new[: 8 * SR])))
        harm = max(0.0, 0.9 - sim) * 20
    total = dev + 2 * drop + harm
    return {"total": round(total, 2), "dev": round(dev, 2), "drop": round(drop, 2), "harm": round(harm, 2),
            "rms": [round(float(r), 1) for r in rms]}


def stitch(track: np.ndarray, piece: np.ndarray, prompt_len: int) -> np.ndarray:
    """piece[:, :prompt_len] re-renders track[:, -prompt_len:]. Crossfade from track to
    piece inside that overlap, ending XFADE_S before the end of the prompt."""
    xf = int(XFADE_S * SR)
    end = prompt_len - int(1.0 * SR)  # keep the original track until 1 s before the seam
    start = end - xf
    t_off = track.shape[1] - prompt_len
    if piece.shape[0] != track.shape[0]:
        piece = np.repeat(piece[:1], track.shape[0], axis=0)
    # equal-gain fade: the two signals are the same music, so gains sum to 1
    ramp = np.linspace(0.0, 1.0, xf, dtype=np.float32)[None, :]
    head = track[:, : t_off + start]
    mix = track[:, t_off + start : t_off + end] * (1 - ramp) + piece[:, start:end] * ramp
    tail = piece[:, end:]
    return np.concatenate([head, mix, tail], axis=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="facebook/musicgen-stereo-medium")
    ap.add_argument("--device", default="mps" if torch.backends.mps.is_available() else "cpu")
    ap.add_argument("--fp16", action="store_true")
    ap.add_argument("--out", required=True, help="run directory (outside the repo)")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--from", dest="start", type=int, default=0, help="first pass to (re)generate")
    ap.add_argument("--to", dest="stop", type=int, default=len(PLAN) - 1, help="last pass")
    ap.add_argument("--cands", type=int, default=1, help="candidates per pass (batched)")
    ap.add_argument("--speedtest", type=float, default=0, help="only time N seconds of generation")
    ap.add_argument("--lift", type=float, default=0, help="seconds where the lift (full groove) lands; 0 keeps PLAN")
    ap.add_argument("--length", type=float, default=195, help="track length to cover, seconds")
    args = ap.parse_args()
    global PLAN
    if args.lift:
        PLAN = make_plan(args.lift, args.length)
        if args.stop == len(make_plan(60, 195)) - 1 or args.stop >= len(PLAN):
            args.stop = len(PLAN) - 1
    print("plan:", PLAN, flush=True)

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dtype = torch.float16 if args.fp16 else torch.float32
    t0 = time.time()
    processor, model = load_model(args.model, args.device, dtype)
    print(f"loaded {args.model} on {args.device} in {time.time() - t0:.1f}s", flush=True)

    if args.speedtest:
        t0 = time.time()
        pieces = generate_pass(processor, model, args.device, TEXT["intro"], args.speedtest, None, args.seed, args.cands)
        dt = time.time() - t0
        print(f"speedtest: {args.speedtest}s audio x{args.cands} in {dt:.1f}s "
              f"({args.speedtest * FRAME_RATE / dt:.1f} steps/s)", flush=True)
        for i, p in enumerate(pieces):
            sf.write(out / f"speedtest_{i}.wav", p.T, SR)
        return

    log_path = out / "log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {}
    log.update({"model": args.model, "base": BASE, "texts": TEXT, "plan": PLAN})

    if args.start == 0:
        track = None
    else:
        track = to_chan_first(sf.read(out / f"track_{args.start - 1:02d}.wav", dtype="float32")[0].T)

    prompt_len = int(PROMPT_S * SR)
    for i in range(args.start, args.stop + 1):
        key, new_s = PLAN[i]
        seed = args.seed * 1000 + i
        t0 = time.time()
        prompt = None if track is None else track[:, -prompt_len:]
        pieces = generate_pass(processor, model, args.device, TEXT[key], new_s, prompt, seed, args.cands)
        dt = time.time() - t0
        lift = key == "full" and i > 0 and PLAN[i - 1][0] == "build"
        plen = 0 if track is None else prompt_len
        scores = []
        for c, p in enumerate(pieces):
            sf.write(out / f"pass_{i:02d}_c{c}.wav", p.T, SR, subtype="FLOAT")
            scores.append(score(p, plen, key, lift))
        best = int(np.argmin([s["total"] for s in scores]))
        piece = pieces[best]
        if track is None:
            track = piece
        else:
            track = stitch(track, piece, prompt_len)
        sf.write(out / f"track_{i:02d}.wav", track.T, SR, subtype="FLOAT")
        log.setdefault("passes", {})[str(i)] = {"text": key, "new_s": new_s, "seed": seed, "secs": round(dt, 1),
                                                "picked": best, "scores": scores,
                                                "track_len_s": round(track.shape[1] / SR, 2)}
        log_path.write_text(json.dumps(log, indent=2))
        print(f"pass {i} [{key}] +{new_s}s seed={seed} in {dt:.0f}s picked c{best} "
              f"{[s['total'] for s in scores]} -> track {track.shape[1] / SR:.1f}s", flush=True)


if __name__ == "__main__":
    main()
