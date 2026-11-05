# Edits the demo's music bed: "The Sapphire City" by Leonell Cassio (Pixabay Content License, no Content ID).
# 144 bpm. The original: calm intro (12 bars from 0.056 s), build (12 bars from 20.056 s), drop at 40.054 s,
# and a filtered outro from 222.366 s (a downbeat 24 bars after the second drop) that resolves and decays.
# --drop-at moves the drop later by repeating the calm intro's second phrase, so the drop lands on the
# verdict; the drop then runs whole 8-bar phrases and jumps on a downbeat to the outro, near --total.
# Writes OUT/music-full.wav (-14 LUFS), OUT/music.wav (bed for under the voice: mids scooped, dynamics
# evened, -24 LUFS) and OUT/music-cues.json. 48 kHz stereo, all cuts on downbeats.
# Usage: python3 tools/voice/edit_music.py SOURCE.mp3 OUT_DIR [--drop-at 68.0] [--total 175]
import argparse
import json
import math
import subprocess

p = argparse.ArgumentParser()
p.add_argument("src")
p.add_argument("out")
p.add_argument("--drop-at", type=float, default=40.054)
p.add_argument("--total", type=float, default=175.0)
a = p.parse_args()

BAR = 4 * 60 / 144
CALM0, BUILD, DROP, OUTRO, END = 0.056, 20.056, 40.054, 222.366, 262.27
PHRASE2 = CALM0 + 4 * BAR  # the calm intro's second phrase (8 bars), repeated to lengthen the intro

segs = [(0.0, BUILD)]
extra = max(0, math.floor((a.drop_at - DROP) / BAR + 1e-6))
left = extra
while left > 0:
    n = min(8, left)
    segs.append((PHRASE2, PHRASE2 + n * BAR))
    left -= n
segs.append((BUILD, DROP))
drop_at = DROP + extra * BAR
# The resolve: the filtered outro, 12 bars (20 s) with a fade, or the whole outro and its natural decay
# when there is room. The drop runs whole 4-bar phrases in between.
outro_len = END - OUTRO if a.total - drop_at > 56 * BAR + (END - OUTRO) else 12 * BAR
drop_bars = max(16, 4 * round((a.total - drop_at - outro_len) / BAR / 4))
segs.append((DROP, DROP + drop_bars * BAR))
segs.append((OUTRO, OUTRO + outro_len))

resolve_at = sum(e - s for s, e in segs[:-1])
total = resolve_at + outro_len
F = 0.004
parts, labels = [], []
for i, (s, e) in enumerate(segs):
    parts.append(f"[0:a]atrim={s}:{e},asetpts=N/SR/TB,afade=t=in:d={F},afade=t=out:st={e - s - F}:d={F}[s{i}]")
    labels.append(f"[s{i}]")
fade_st = total - 3.5
graph = ";".join(parts) + ";" + "".join(labels) + f"concat=n={len(segs)}:v=0:a=1,afade=t=out:st={fade_st}:d=3.5,aresample=48000[o]"


def run(args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args, check=True)


def loudnorm(inp, dst, target, pre=""):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", inp, "-af",
                        (pre + "," if pre else "") + f"loudnorm=I={target}:TP=-1.0:LRA=20:print_format=json",
                        "-f", "null", "-"], capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
    ln = (f"loudnorm=I={target}:TP=-1.0:LRA=20:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    run(["-i", inp, "-af", (pre + "," if pre else "") + ln, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s24le", dst])


edit = f"{a.out}/work/music-edit.wav"
run(["-i", a.src, "-filter_complex", graph, "-map", "[o]", "-c:a", "pcm_f32le", edit])
loudnorm(edit, f"{a.out}/music-full.wav", -14)
bed = ("equalizer=f=2200:width_type=o:width=1.6:g=-3.5,equalizer=f=900:width_type=o:width=1.2:g=-1.5,"
       "acompressor=threshold=-26dB:ratio=2.5:attack=80:release=600:makeup=1")
loudnorm(edit, f"{a.out}/music.wav", -24, bed)

build_at = drop_at - 12 * BAR
cues = {
    "track": "The Sapphire City - Leonell Cassio (Pixabay)",
    "duration": round(total, 3),
    "bpm": 144,
    "bar": round(BAR, 5),
    "downbeat": round(drop_at, 3),
    "drop": round(drop_at, 3),
    "lift": round(drop_at, 3),
    "sections": [
        {"name": "intro (calm, under the hook)", "start": 0.0},
        {"name": "build", "start": round(build_at, 3)},
        {"name": "pre-drop gap (near silence: the riser goes here and ends on the drop)", "start": round(drop_at - 2.25, 3)},
        {"name": "drop (the answer reveal)", "start": round(drop_at, 3)},
        {"name": "steady (middle)", "start": round(drop_at + 8 * BAR, 3)},
        {"name": "resolve (filtered outro)", "start": round(resolve_at, 3)},
        {"name": "fade to end", "start": round(fade_st, 3)},
    ],
    "note": "Times are in music.wav / music-full.wav. Bars every 'bar' seconds from 'downbeat'. "
            "Set the editor's media.lift to 'lift'.",
}
json.dump(cues, open(f"{a.out}/music-cues.json", "w"), indent=1)
print(f"music: {total:.2f}s, drop at {drop_at:.3f}s ({extra} calm bars added), resolve at {resolve_at:.2f}s")
