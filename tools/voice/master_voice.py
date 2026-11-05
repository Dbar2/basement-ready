# Masters voice line files for the demo video: trim, high-pass, gentle de-ess and compression,
# then two-pass loudness normalisation to -16 LUFS, 48 kHz mono. Writes OUT/<id>.wav and OUT/voice.json
# ({"L00": {"duration": 6.21, "file": "voice/L00.wav"}, ...}).
# Usage: python3 tools/voice/master_voice.py IN_DIR OUT_DIR [--suffix .raw.wav] [--denoise]
import argparse
import glob
import json
import os
import subprocess

p = argparse.ArgumentParser()
p.add_argument("inp")
p.add_argument("out")
p.add_argument("--suffix", default=".raw.wav")
p.add_argument("--denoise", action="store_true", help="for a real microphone recording")
p.add_argument("--tempo", type=float, default=1.0, help="e.g. 0.93 to slow a hurried TTS voice a little")
a = p.parse_args()
os.makedirs(a.out, exist_ok=True)

trim = ("silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03,areverse,"
        "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.08,areverse")
chain = [trim, "highpass=f=75"]
if a.tempo != 1.0:
    chain += [f"aresample=48000,atempo={a.tempo}"]
if a.denoise:
    chain += ["afftdn=nr=10:nf=-45", "highpass=f=90"]
chain += ["deesser=i=0.35:m=0.5:f=0.5",
          "acompressor=threshold=-21dB:ratio=2.2:attack=10:release=150:makeup=1.5",
          "adelay=60", "apad=pad_dur=0.12"]
pre = ",".join(chain)


def measure(path, flt):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", path, "-af",
                        flt + ",loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    j = r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1]
    return json.loads(j)


meta = {}
for src in sorted(glob.glob(os.path.join(a.inp, "*" + a.suffix))):
    lid = os.path.basename(src)[: -len(a.suffix)]
    m = measure(src, pre)
    ln = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    dst = os.path.join(a.out, f"{lid}.wav")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-af", pre + "," + ln,
                    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s24le", dst], check=True)
    d = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", dst],
                             capture_output=True, text=True).stdout)
    meta[lid] = {"duration": round(d, 3), "file": f"voice/{lid}.wav"}
    print(f"{lid}: {d:.2f}s", flush=True)

vj = os.path.join(a.out, "voice.json")
old = json.load(open(vj)) if os.path.exists(vj) else {}
old.update(meta)
json.dump(old, open(vj, "w"), indent=1)
