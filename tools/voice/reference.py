# A female reference voice for Chatterbox to speak in, made with Kokoro-82M (Apache-2.0), so the
# voice is ours to use. Usage: reference.py out.wav [kokoro_voice]
import sys

import numpy as np
import soundfile as sf
from kokoro import KPipeline

out = sys.argv[1]
voice = sys.argv[2] if len(sys.argv) > 2 else "af_heart"
text = (
    "Hi there. I'm going to walk you through your basement, one room at a time. "
    "Take it slow, keep the lights on, and tell me what you'd love this space to become. "
    "We'll figure out the rest together."
)
pipe = KPipeline(lang_code="a", repo_id="hexgrad/Kokoro-82M")
audio = np.concatenate([chunk for _, _, chunk in pipe(text, voice=voice, speed=0.95)])
sf.write(out, audio, 24000)
print(f"reference: {len(audio) / 24000:.1f} s")
