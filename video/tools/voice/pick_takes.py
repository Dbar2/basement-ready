# Listens back to every voice take with Whisper and keeps the best one per line: the take whose
# words match the script (fewest missing, extra or changed words), then the one with the fewest long
# pauses inside it. Writes public/voice/<id>.wav and src/data/voice.json (durations for the edit).
# Usage (from video/): <python with openai-whisper> tools/voice/pick_takes.py
import glob
import json
import re
import shutil
import subprocess

import whisper


def words(s):
    return re.sub(r"[^a-z0-9 ]", " ", s.lower().replace("basementready.com", "basement ready dot com")).split()


def wer(ref, hyp):
    r, h = words(ref), words(hyp)
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (r[i - 1] != h[j - 1]))
            prev = cur
    return d[len(h)] / max(1, len(r))


def duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True)
    return float(out.stdout.strip())


def longest_gap(segments):
    gaps = [b["start"] - a["end"] for a, b in zip(segments, segments[1:])]
    return max(gaps, default=0.0)


lines = json.load(open("tools/voice/voice-lines.json"))
model = whisper.load_model("small.en")
picked, report = {}, []
for line_id, text in lines.items():
    takes = sorted(glob.glob(f"public/voice/{line_id}_t*.wav"))
    scored = []
    for take in takes:
        res = model.transcribe(take, language="en", fp16=False)
        dur = duration(take)
        score = (round(wer(text, res["text"]), 3), round(longest_gap(res["segments"]), 2))
        scored.append((score, take, res["text"].strip(), dur))
    if not scored:
        continue
    scored.sort()
    (err, gap), best, heard, dur = scored[0]
    shutil.copy(best, f"public/voice/{line_id}.wav")
    picked[line_id] = {"take": best.split("/")[-1], "seconds": round(dur, 3), "wer": err, "text": text}
    flag = "  <-- CHECK" if err > 0.08 or gap > 1.2 else ""
    report.append(f"{line_id} {best.split('/')[-1]} {dur:.2f}s wer={err} gap={gap}{flag}\n   heard: {heard}")

json.dump(picked, open("src/data/voice.json", "w"), indent=1)
print("\n".join(report))
print(f"total speech {sum(p['seconds'] for p in picked.values()):.1f}s")
