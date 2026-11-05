# Reads the demo video's SCRIPT.md table and writes the voice lines in three forms:
#   OUT/lines.json   {"L00": caption text, ...}           (what the editor shows)
#   OUT/say.json     {"L00": text as it should be spoken}  (numbers and names spelled for TTS)
#   OUT/READ-THIS.txt  a teleprompter for David: one line per paragraph with its id
# Usage: python3 tools/voice/script_lines.py path/to/SCRIPT.md OUT_DIR
import json
import os
import re
import sys

script, out = sys.argv[1], sys.argv[2]
rows = {}
for line in open(script):
    m = re.match(r"^\|\s*([A-Z]\d+[a-z]?)\s*\|\s*(.+?)\s*\|", line)
    if m:
        rows[m.group(1)] = m.group(2).strip()

SAY = [
    (r"\bSAM 3\.1\b", "SAM three point one"),
    (r"basementready\.com", "basement ready dot com"),
    (r"\bLiDAR\b", "lidar"),
    (r"\b3D\b", "three D"),
    (r"\bOctober 28\b", "October twenty-eighth"),
    (r"\$2,000–\$5,000", "two to five thousand dollars"),
]


def say(t):
    for a, b in SAY:
        t = re.sub(a, b, t)
    return t


os.makedirs(out, exist_ok=True)
json.dump(rows, open(os.path.join(out, "lines.json"), "w"), indent=1, ensure_ascii=False)
json.dump({k: say(v) for k, v in rows.items()}, open(os.path.join(out, "say.json"), "w"), indent=1, ensure_ascii=False)
with open(os.path.join(out, "READ-THIS.txt"), "w") as f:
    f.write("Basement Ready demo: voiceover to read aloud\n")
    f.write("Read each paragraph as one take, like you're telling a friend about something you built.\n")
    f.write("Leave about two seconds of silence between paragraphs (that's where it gets cut).\n")
    f.write("Say the id first if you like (\"N03\"); it helps the cut but is optional.\n\n")
    for k, v in rows.items():
        f.write(f"[{k}]\n{v}\n\n")
print(f"{len(rows)} lines: {', '.join(rows)}")
