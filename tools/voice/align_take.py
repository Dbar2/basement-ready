# Masters one continuous narration take and lines a music track up under it so the music's drop lands
# on a chosen moment of the voice (e.g. "And the answer comes first"). Keeps the take's own timing (no
# trimming), so word times from Whisper stay valid. Writes into OUT/:
#   voice-<name>.wav       48 kHz mono, de-essed, lightly compressed, -16 LUFS
#   music-bed-<name>.wav   48 kHz stereo bed for under the voice (mids scooped, evened), -24 LUFS
#   music-full-<name>.wav  same edit at -14 LUFS
#   preview-<name>.wav     voice over the bed, ducked, with a riser into the drop and a soft impact on it
#   cues-<name>.json
# Usage: python3 tools/voice/align_take.py VOICE MUSIC OUT NAME --voice-at 47.08 --drop 50.14 [--sfx DIR]
import argparse
import json
import os
import subprocess

p = argparse.ArgumentParser()
p.add_argument("voice")
p.add_argument("music")
p.add_argument("out")
p.add_argument("name")
p.add_argument("--voice-at", type=float, required=True, help="seconds in the take where the drop should land")
p.add_argument("--drop", type=float, required=True, help="seconds in the music track where its drop is")
p.add_argument("--sfx", default="")
a = p.parse_args()
os.makedirs(a.out, exist_ok=True)


def run(args):
    subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"] + args, check=True)


def dur(f):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f],
                                capture_output=True, text=True).stdout)


def loudnorm(inp, dst, target, pre, ch, tp=-1.0, lra=20):
    r = subprocess.run(["ffmpeg", "-hide_banner", "-nostats", "-i", inp, "-af",
                        f"{pre},loudnorm=I={target}:TP={tp}:LRA={lra}:print_format=json", "-f", "null", "-"],
                       capture_output=True, text=True)
    m = json.loads(r.stderr[r.stderr.rfind("{"):r.stderr.rfind("}") + 1])
    ln = (f"loudnorm=I={target}:TP={tp}:LRA={lra}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    run(["-i", inp, "-af", f"{pre},{ln}", "-ar", "48000", "-ac", str(ch), "-c:a", "pcm_s24le", dst])


vo = f"{a.out}/voice-{a.name}.wav"
loudnorm(a.voice, vo, -16, "highpass=f=75,deesser=i=0.3:m=0.5:f=0.5,"
         "acompressor=threshold=-22dB:ratio=2:attack=10:release=160:makeup=1.5", 1, tp=-1.5, lra=11)

shift = a.drop - a.voice_at  # >0: cut the music's head; <0: start the music later
vdur = dur(vo)
head = f"atrim=start={shift},asetpts=N/SR/TB,afade=t=in:d=1.2" if shift > 0 else f"adelay={int(-shift * 1000)}:all=1"
edit = f"{a.out}/music-edit-{a.name}.wav"
run(["-i", a.music, "-af", f"{head},aresample=48000", "-c:a", "pcm_f32le", edit])
loudnorm(edit, f"{a.out}/music-full-{a.name}.wav", -14, "anull", 2)
bed = f"{a.out}/music-bed-{a.name}.wav"
loudnorm(edit, bed, -24, "equalizer=f=2200:width_type=o:width=1.6:g=-3.5,equalizer=f=900:width_type=o:width=1.2:g=-1.5,"
         "acompressor=threshold=-26dB:ratio=2.5:attack=80:release=600:makeup=1", 2)

inputs = ["-i", vo, "-i", bed]
flt = ["[0:a]aformat=channel_layouts=stereo,asplit[vo][vsc]",
       "[1:a][vsc]sidechaincompress=threshold=0.03:ratio=3:attack=30:release=450:makeup=1[duck]"]
mix = ["[duck]", "[vo]"]
if a.sfx:
    inputs += ["-i", os.path.join(a.sfx, "riser.wav"), "-i", os.path.join(a.sfx, "impact.wav")]
    riser = dur(os.path.join(a.sfx, "riser.wav"))
    flt += [f"[2:a]volume=-8dB,adelay={int((a.voice_at - riser) * 1000)}:all=1[r]",
            f"[3:a]volume=-10dB,adelay={int(a.voice_at * 1000)}:all=1[i]"]
    mix += ["[r]", "[i]"]
flt.append("".join(mix) + f"amix=inputs={len(mix)}:normalize=0,atrim=0:{vdur + 6},afade=t=out:st={vdur + 3}:d=3,"
           "loudnorm=I=-14:TP=-1.0:LRA=11[out]")
run(inputs + ["-filter_complex", ";".join(flt), "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le",
              f"{a.out}/preview-{a.name}.wav"])
os.remove(edit)
json.dump({"voice": os.path.basename(vo), "voice_seconds": round(vdur, 3), "drop_in_voice_time": a.voice_at,
           "music_head_trim": round(shift, 3), "music_drop_in_bed": round(a.voice_at, 3),
           "note": "Start the bed and the voice at the same frame; the drop then lands at drop_in_voice_time."},
          open(f"{a.out}/cues-{a.name}.json", "w"), indent=1)
print(f"{a.name}: voice {vdur:.1f}s, music head trimmed {shift:.2f}s, drop at {a.voice_at:.2f}s")
