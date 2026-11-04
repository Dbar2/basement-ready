#!/usr/bin/env bash
# Master a raw MusicGen track into the video's music bed.
#   master.sh <raw.wav> <out.wav> [length_s=195] [fade_s=6] [target_lufs=-18]
# Chain: trim -> 48 kHz (swr, long filter) -> high-pass 35 Hz -> -2 dB broad dip at ~2.8 kHz
# (room for the narration) -> 6 s fade at the end -> static gain to the target
# integrated loudness (two-pass, measured with ebur128) -> 16-bit WAV.
set -euo pipefail
IN="$1"; OUT="$2"; LEN="${3:-195}"; FADE="${4:-6}"; TARGET="${5:--18}"
FADE_ST=$(python3 -c "print($LEN - $FADE)")

CHAIN="atrim=0:${LEN},asetpts=N/SR/TB,aresample=48000:filter_size=64:cutoff=0.97,\
highpass=f=35:poles=2,equalizer=f=2800:t=q:w=0.8:g=-2,\
afade=t=in:st=0:d=0.05,afade=t=out:st=${FADE_ST}:d=${FADE}:curve=exp"

# pass 1: measure integrated loudness after the chain
MEAS=$(ffmpeg -hide_banner -nostats -i "$IN" -af "${CHAIN},ebur128=peak=true" -f null - 2>&1)
I=$(echo "$MEAS" | awk '/Integrated loudness:/{f=1} f&&/ I:/{print $2; exit}')
GAIN=$(python3 -c "print(round($TARGET - ($I), 2))")
echo "measured ${I} LUFS -> gain ${GAIN} dB"

# pass 2: apply the gain (true-peak safety limiter at -1 dBTP; idle at -18 LUFS for a soft bed)
ffmpeg -hide_banner -loglevel error -y -i "$IN" \
  -af "${CHAIN},volume=${GAIN}dB,alimiter=limit=0.89:level=false:attack=5:release=50,aresample=48000:osf=s16:dither_method=triangular" \
  -ar 48000 -ac 2 -c:a pcm_s16le "$OUT"

ffmpeg -hide_banner -nostats -i "$OUT" -af ebur128=peak=true -f null - 2>&1 | \
  awk '/Summary:/{f=1} f' | grep -E "I:|LRA:|Peak:" | sed 's/^ *//'
