# Demo video credits

Everything in the video is either real footage of the live app, the example basement's own data, or drawn in code. No AI-generated imagery is used anywhere, apart from the app's own "Virtually staged" before/after pictures (Muse Image restyling the example's real frame), which appear inside the app footage with their label.

| What | Source | Licence |
|---|---|---|
| Footage | Screen recordings of https://www.basementready.com walking the public example basement, made with Playwright (`tools/record/record.mjs`) | Ours |
| Example basement | `public/samples` in this repo: the example video, SAM 3.1's tracks, the measured plan (MapAnything) | Ours |
| Motion graphics | Drawn in React/SVG with Remotion (`src/`), in the Drawing Set style (`brand/ui.md`, `brand/tokens.css`) | Ours |
| Fonts | Hanken Grotesk and Geist Mono, via Google Fonts (`@remotion/google-fonts`) | SIL Open Font License 1.1 |
| Voice | Chatterbox TTS by Resemble AI (`ResembleAI/chatterbox`), run on this Mac (`tools/voice/make_vo.py`), speaking in the app guide's own voice: a reference made with Kokoro-82M (`hexgrad/Kokoro-82M`, `../tools/voice/reference.py`) | Chatterbox: MIT. Kokoro-82M: Apache-2.0 |
| Music | See below | See below |
| Video framework | Remotion | Remotion licence (free for individuals and small teams) |

## Music

`public/music.wav` is the one music file, so it can be swapped for another track without touching the edit. The mix ducks it under the voice (`src/Root.tsx`) and `tools/finish.sh` masters the whole mix to -14 LUFS.

- Generated with Meta's MusicGen (`facebook/musicgen-stereo-medium`, via Hugging Face `transformers`) by `tools/music/generate.py`, mastered by `tools/music/master.sh`. MusicGen's weights are CC-BY-NC 4.0; the generated audio is used here non-commercially for the hackathon demo.
