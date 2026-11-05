# A preview of the demo's sound: the voice lines placed on the video editor's own timeline (the scene
# lead, gap, hold and tail from video/src/timeline.ts), the music re-edited so its drop lands as the
# verdict stamp lands, ducked under the voice, with a few SFX. Writes AUDIO/preview-mix.wav,
# AUDIO/timeline.json and AUDIO/voice/voice.json in the editor's format (seconds, text).
# Usage (repo root): python3 tools/voice/preview_mix.py media/video-audio MUSIC_SOURCE.mp3 LINES.json
import json
import os
import subprocess
import sys

audio, music_src, lines_file = sys.argv[1], sys.argv[2], sys.argv[3]
FPS = 30
f = lambda s: round(s * FPS)  # noqa: E731
SCENES = [
    ("question", ["L00", "L01", "N02"], 0.5, 0.45, 0.5, {}),
    ("film", ["N03"], 0.4, 0.4, 0.8, {}),
    ("models", ["N06b", "N04", "N05", "L09"], 0.3, 0.4, 0.5, {"N06b": 0.3, "N04": 0.5, "N05": 1.8, "L09": 0.6}),
    ("answer", ["N07b", "N08", "L13"], 0.4, 0.4, 0.5, {"N07b": 1.2, "N08": 0.6, "L13": 1.2}),
    ("design", ["N09", "N10"], 0.4, 0.4, 0.5, {"N09": 1.2, "N10": 1.6}),
    ("build", ["N11", "N12"], 0.4, 0.4, 0.5, {"N11": 1.2, "N12": 1.0}),
    ("close", ["N13", "N14"], 0.4, 0.6, 5.0, {}),
]
vj_path = os.path.join(audio, "voice", "voice.json")
vj = json.load(open(vj_path))
text = json.load(open(lines_file))
for k, v in vj.items():  # the editor's voice.json shape
    v["seconds"] = v["duration"]
    v["text"] = text.get(k, v.get("text", ""))
    v["take"] = f"{k}.wav"
json.dump(vj, open(vj_path, "w"), indent=1, ensure_ascii=False)

cursor, scenes, placed = 0, [], []
for sid, ids, lead, gap, tail, hold in SCENES:
    start, t = cursor, f(lead)
    for i, lid in enumerate(ids):
        placed.append((lid, (start + t) / FPS))
        t += f(vj[lid]["duration"]) + (f(gap + hold.get(lid, 0)) if i < len(ids) - 1 else 0)
    t += f(tail + hold.get(ids[-1], 0))
    scenes.append({"id": sid, "from": start / FPS})
    cursor += t
total = cursor / FPS
answer = next(s for s in scenes if s["id"] == "answer")["from"]
verdict = (f(answer) + round(0.75 * FPS)) / FPS

here = os.path.dirname(os.path.abspath(__file__))
subprocess.run(["python3", os.path.join(here, "edit_music.py"), music_src, audio, "--drop-at", f"{verdict}",
                "--total", f"{total + 0.5}"], check=True)
cues = json.load(open(os.path.join(audio, "music-cues.json")))
music_at = max(0.0, (f(answer) + round(0.75 * FPS) - f(cues["lift"])) / FPS)
drop = music_at + cues["drop"]

inputs = ["-i", os.path.join(audio, "music.wav")]
flt, vlabels = [], []
for n, (lid, t) in enumerate(placed, start=1):
    inputs += ["-i", os.path.join(audio, "voice", f"{lid}.wav")]
    flt.append(f"[{n}:a]adelay={int(t * 1000)}:all=1,aformat=channel_layouts=stereo[v{n}]")
    vlabels.append(f"[v{n}]")
k = len(placed) + 1
sfx = [("riser.wav", drop - 1.773, -6), ("impact.wav", drop, -8)]
for i, s in enumerate(scenes[1:]):
    sfx.append(([ "whoosh-1.wav", "whoosh-3.wav", "whoosh-2.wav"][i % 3], max(0, s["from"] - 0.45), -14))
slabels = []
for name, t, gain in sfx:
    inputs += ["-i", os.path.join(audio, "sfx", name)]
    flt.append(f"[{k}:a]volume={gain}dB,adelay={int(t * 1000)}:all=1[x{k}]")
    slabels.append(f"[x{k}]")
    k += 1
flt.append("".join(vlabels) + f"amix=inputs={len(vlabels)}:normalize=0,asplit[vo][vsc]")
flt.append(f"[0:a]adelay={int(music_at * 1000)}:all=1[mus]")
flt.append("[mus][vsc]sidechaincompress=threshold=0.03:ratio=3:attack=30:release=450:makeup=1[duck]")
flt.append("".join(slabels) + f"amix=inputs={len(slabels)}:normalize=0[fx]")
flt.append(f"[duck][vo][fx]amix=inputs=3:normalize=0,atrim=0:{total + 1},loudnorm=I=-14:TP=-1.0:LRA=11[out]")
out = os.path.join(audio, "preview-mix.wav")
subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + inputs +
               ["-filter_complex", ";".join(flt), "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le", out], check=True)
json.dump({"total": round(total, 3), "verdict": round(verdict, 3), "music_starts_at": round(music_at, 3),
           "drop_in_video": round(drop, 3), "scenes": scenes,
           "lines": [{"id": lid, "start": round(t, 3), "seconds": vj[lid]["duration"]} for lid, t in placed]},
          open(os.path.join(audio, "timeline.json"), "w"), indent=1)
print(f"preview: {total:.1f}s, verdict at {verdict:.2f}s, music starts {music_at:.2f}s, drop at {drop:.2f}s")
