# Demo video credits

Everything in the video is either real footage of the live app, the example basement's own data, or drawn in code. No AI-generated imagery is used anywhere, apart from the app's own "Virtually staged" before/after pictures (Muse Image restyling the example's real frame), which appear inside the app footage with their label.

| What | Source | Licence |
|---|---|---|
| Footage | Screen recordings of https://www.basementready.com walking the public example basement, made with Playwright (`tools/record/record.mjs`) | Ours |
| Live Meta call log and its answer | Railway server log lines from a live run on basementready.com (Nov 4, 2026, 5:27 PM ET: the public example video uploaded as a new scan), shown exactly as logged (`src/data/logs.json`), and a screenshot of that run's answer (`public/live-run-answer.jpg`, git-ignored). Both relayed by the director session | Ours |
| Example basement | `public/samples` in this repo: the example video, SAM 3.1's tracks, the measured plan (MapAnything) | Ours |
| Motion graphics | Drawn in React/SVG with Remotion (`src/`), in the Drawing Set style (`brand/ui.md`, `brand/tokens.css`) | Ours |
| Fonts | Hanken Grotesk and Geist Mono, via Google Fonts (`@remotion/google-fonts`) | SIL Open Font License 1.1 |
| Voice | Chatterbox TTS by Resemble AI (`ResembleAI/chatterbox`), run on this Mac (`tools/voice/make_vo.py`), speaking in the app guide's own voice: a reference made with Kokoro-82M (`hexgrad/Kokoro-82M`, `../tools/voice/reference.py`) | Chatterbox: MIT. Kokoro-82M: Apache-2.0 |
| Music | "New Day" by Lee Rosevere (Free Music Archive), see below | CC BY 4.0 |
| Video framework | Remotion | Remotion licence (free for individuals and small teams) |

## Music

"New Day" by Lee Rosevere, from the album "Music for Podcasts – Beats".

- Source page: https://freemusicarchive.org/music/lee-rosevere/music-for-podcasts-beats/new-day-1/
- File: https://files.freemusicarchive.org/storage-freemusicarchive-org/tracks/RGx0OybysBm4Jk03k3XREGUjrKSaJ7BXvx0fbnT3.mp3 (fetched by `tools/music/fetch.sh`)
- Licence: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ , as stated on the track's page. Attribution: "New Day" by Lee Rosevere (freemusicarchive.org/music/lee-rosevere), licensed under CC BY 4.0. The credit is in the video's end card.
- It is the one music file, `public/music.wav` (git-ignored), so it can be swapped for another track without touching the edit. The edit starts it so its lift (53.8 s in, `src/data/media.json` `lift`) lands as the verdict appears; set `lift` for a new track. The mix ducks it under the voice (`src/Root.tsx`), and `tools/finish.sh` masters the whole mix to -14 LUFS.
- Fallback, not used: `tools/music/generate.py` makes a bed with Meta's MusicGen (`facebook/musicgen-stereo-medium`; its weights are CC-BY-NC 4.0).
