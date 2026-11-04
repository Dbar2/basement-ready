# Prints the edit's scene and line start times from src/data/voice.json, mirroring src/timeline.ts,
# so the music's lift can be placed on the answer. Usage (from video/): python3 tools/timeline.py
import json
import re

FPS = 30
src = open("src/timeline.ts").read()
voice = json.load(open("src/data/voice.json"))
f = lambda s: round(s * FPS)
scenes = re.findall(r'\{ id: "(\w+)", lines: \[([^\]]*)\], lead: ([\d.]+), gap: ([\d.]+), tail: ([\d.]+)(?:, hold: \{([^}]*)\})? \}', src)
cursor = 0
for sid, lines, lead, gap, tail, hold in scenes:
    ids = re.findall(r'"([LN]\d\d\w?)"', lines)
    holds = {k: float(v) for k, v in re.findall(r'([LN]\d\d\w?): ([\d.]+)', hold or "")}
    t = f(float(lead))
    starts = []
    for i, lid in enumerate(ids):
        d = f(voice[lid]["seconds"])
        starts.append(f"{lid}@{(cursor + t) / FPS:.1f}")
        t += d + (f(float(gap) + holds.get(lid, 0)) if i < len(ids) - 1 else 0)
    t += f(float(tail) + holds.get(ids[-1], 0))
    print(f"{sid:9s} {cursor / FPS:6.1f}s  {' '.join(starts)}")
    cursor += t
print(f"total {cursor / FPS:.1f}s")
