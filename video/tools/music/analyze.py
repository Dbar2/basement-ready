"""Check a music bed: loudness/energy profile, seams (clicks), tempo and key per window.

    python analyze.py track.wav [--seams 30,50,60,...] [--win 10]
"""

import argparse

import librosa
import numpy as np
import soundfile as sf

KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def key_of(chroma_mean):
    best = None
    for i in range(12):
        for name, prof in (("maj", MAJOR), ("min", MINOR)):
            r = np.corrcoef(np.roll(prof, i), chroma_mean)[0, 1]
            if best is None or r > best[0]:
                best = (r, f"{KEYS[i]} {name}")
    return best[1], best[0]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--seams", default="")
    ap.add_argument("--win", type=float, default=10.0)
    args = ap.parse_args()

    y, sr = sf.read(args.wav, dtype="float32")
    mono = y.mean(axis=1) if y.ndim == 2 else y
    dur = len(mono) / sr
    print(f"{args.wav}: {dur:.2f}s @ {sr} Hz, peak {20 * np.log10(np.abs(y).max() + 1e-9):.1f} dBFS")

    # energy profile (RMS dB per second) with a crude bar chart
    hop = sr
    print("\nper 5 s: RMS dBFS | low<200Hz | mid 1-4k | percussive share | onsets/s | flatness")
    D = librosa.stft(mono, n_fft=4096, hop_length=2048)
    S = np.abs(D) ** 2
    H, P = librosa.decompose.hpss(np.abs(D))
    freqs = librosa.fft_frequencies(sr=sr, n_fft=4096)
    fps = sr / 2048
    onsets = librosa.onset.onset_detect(y=mono, sr=sr, units="time")
    flat = librosa.feature.spectral_flatness(S=np.abs(D))[0]
    for t in range(0, int(dur), 5):
        seg = mono[t * sr : (t + 5) * sr]
        rms = 20 * np.log10(np.sqrt(np.mean(seg**2)) + 1e-9)
        a, b = int(t * fps), int((t + 5) * fps)
        cols = S[:, a:b].sum(axis=1)
        tot = cols.sum() + 1e-12
        low = cols[freqs < 200].sum() / tot
        mid = cols[(freqs >= 1000) & (freqs < 4000)].sum() / tot
        perc = (P[:, a:b] ** 2).sum() / ((P[:, a:b] ** 2).sum() + (H[:, a:b] ** 2).sum() + 1e-12)
        ons = ((onsets >= t) & (onsets < t + 5)).sum() / 5
        fl = np.median(flat[a:b])
        bar = "#" * max(0, int((rms + 45) * 1.5))
        print(f"{t:4d}s {rms:6.1f} {low:5.2f} {mid:5.2f} {perc:5.2f} {ons:4.1f} {fl:.4f} {bar}")

    # tempo and key per window
    print(f"\ntempo / key per {args.win:.0f} s window")
    w = int(args.win * sr)
    for s in range(0, len(mono) - w // 2, w):
        seg = mono[s : s + w]
        tempo = librosa.feature.tempo(y=seg, sr=sr, start_bpm=95)[0]
        chroma = librosa.feature.chroma_cqt(y=seg, sr=sr).mean(axis=1)
        k, r = key_of(chroma)
        print(f"{s / sr:6.0f}s  {tempo:6.1f} bpm  {k:7s} ({r:.2f})")

    # seam click check: max |diff| near the seam vs typical in the surrounding 2 s
    if args.seams:
        print("\nseam check (ratio of max sample step near seam to the 99.9th pct around it)")
        d = np.abs(np.diff(mono))
        for t in [float(x) for x in args.seams.split(",")]:
            c = int(t * sr)
            near = d[max(0, c - int(0.6 * sr)) : c + int(0.1 * sr)]
            around = d[max(0, c - 2 * sr) : c + 2 * sr]
            ratio = near.max() / (np.percentile(around, 99.9) + 1e-9)
            print(f"  {t:6.1f}s  ratio {ratio:4.2f} {'<-- check' if ratio > 2.0 else ''}")


if __name__ == "__main__":
    main()
