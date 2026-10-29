# Basement Ready

Film your basement on your phone and find out whether it can legally become a second home (an additional residential unit) in Waterloo Region: Waterloo, Kitchener or Cambridge. You walk away with a decision, a plan with rough costs, the grants that fit, a floor plan with a suggested layout, and a 3D view and photos of what it could look like.

**Built this week.** Everything in this repo was built during the Meta hackathon. The first commit is Oct 28, 2026, and nothing in it existed before the event.

- Live: https://web-production-0c550.up.railway.app
- "See an example" on the home page runs a recorded scan from start to finish, with no account and no keys.

## Run it

You need Node 22+, pnpm 10 and ffmpeg (with ffprobe) on your PATH.

```bash
pnpm install
cp .env.example .env        # add MODEL_API_KEY from https://dev.meta.ai/api-keys/
pnpm dev                    # web on http://localhost:5173, API on :8787, local database (PGlite)
```

Open http://localhost:5173. The example works without a key. Filming your own basement needs the key.

- **Film from your phone:** `pnpm dev:phone` serves the app over HTTPS on your network. Phones only allow the camera and compass on HTTPS.
- **Measured 3D (optional):** this runs MapAnything locally. It needs Python 3.12 and [uv](https://docs.astral.sh/uv/), an Apple Silicon Mac or a CUDA GPU, and about 5 GB for the model weights.
  ```bash
  cd services/scan3d
  uv venv --python 3.12 .venv
  uv pip install --python .venv/bin/python torch==2.14.1 torchvision==0.29.1 -r requirements.txt
  cd ../.. && pnpm dev:scan3d
  ```
  Without it, a scan still gives the decision, plan, grants and photos. The floor plan, the 3D view and the 3D staging need it. The example includes all of them.
- **Region-locked key:** if your Meta key only answers from some regions, [`services/meta-relay`](services/meta-relay) is a small Cloudflare Worker that forwards calls from Canada.

Tests: `pnpm test` runs 104 unit tests. `services/scan3d` has its own 13 tests, which need no model weights. The latest runs are saved in [`docs/evidence/`](docs/evidence).

## Meta models it calls

| Model | What it does here | Code |
|---|---|---|
| **SAM 3.1** (`sam-3.1`, Meta Model API) | Finds and tracks windows, doors, stairs, the furnace, ducts and beams through the video. It also checks that the staged photos kept every window and the stairs where they really are. | `server/meta.ts`, `server/pipeline.ts`, `server/concepts.ts` |
| **Muse Spark 1.3** (`muse-spark-1.3`) | Reads the city's rules, what SAM found and what the homeowner said. It writes the decision, the fixes and the few plain-language questions. | `server/assess.ts` |
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Turns what the homeowner says while filming ("this could be Mom's bedroom") into text. | `server/meta.ts` |
| **Muse Image** (`muse-image-1.0`) | Finishes the homeowner's own frames into "what it could look like" photos, labelled *virtually staged*. | `server/concepts.ts` |
| **MapAnything** (`facebook/map-anything-apache`, open weights, Apache-2.0) | Measured 3D from the video frames: room size, ceiling height and the floor plan. It runs self-hosted. | `services/scan3d` |
| **DINOv2** (Meta, open weights) | MapAnything's image encoder, at a pinned commit. | `services/scan3d` |

No other AI model is called while the app runs.

## What isn't a model call

- **Browser and phone features:** the camera, the compass and tilt (DeviceOrientation), audio playback (Web Audio), the 3D views (WebGL with three.js), and the browser's own speech voice as a fallback (`speechSynthesis`).
- **The filming guide's voice:** the app plays 21 short MP3 clips from `public/voice`. They were recorded once, before shipping, on a Mac with open-source text-to-speech: [Chatterbox](https://github.com/resemble-ai/chatterbox) (MIT), using a reference voice made with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) (Apache-2.0). The scripts are in `tools/voice`. The app never calls a voice model.
- **Rules, costs and grants:** written rules packs for each city (`data/rules`, sources in `data/rules/SOURCES*.md`), checked in code (`server/triage.ts`).
- **The suggested layout and 3D staging:** worked out in code from the measured room (`server/layout.ts`, `src/three/StagedBasement.tsx`).
- **Brand concept boards:** the images in `brand/explorations` were made with an image model while designing the look. The app doesn't use them.

## Open source and public data it builds on

- **Libraries:** React, TanStack Router, Vite, three.js, React Three Fiber, drei, postprocessing (N8AO), Hono, Drizzle ORM, PGlite and ffmpeg.
- **MapAnything code:** Meta, Apache-2.0, pinned in `services/scan3d`.
- **Furniture and finishes for the 3D staging:** CC0 models and textures from [Poly Haven](https://polyhaven.com). The list is in `public/staging/CREDITS.txt`.
- **Public data:**
  - Region of Waterloo address points, building footprints and 2026 aerial imagery.
  - Zoning layers from the City of Waterloo, the City of Kitchener and the City of Cambridge.
  - Kitchener's parcel and zoning data isn't open data. We've asked the city for permission, and `PROPERTY_KITCHENER=0` turns it off.
  - The app shows credit lines wherever this data appears.

## What we built on top

- **Guided filming in the browser:** a voice guide, one task at a time, a small room view that fills in wall by wall, a direction arrow to the part not filmed yet, live SAM finds, new rooms detected automatically at doorways, and idea chips for saying what each room should become.
- **The scan pipeline:** SAM tracks and MapAnything combined into one room model, a scale set from door heights (no tape measure), and per-room plans.
- **Rules checking:** Waterloo, Kitchener and Cambridge second-unit rules sorted into what the video settles, what public records settle, what to ask the homeowner (a few plain questions, each with "Not sure") and what a designer confirms.
- **The answer:** a decision, a numbered plan with who to call, time and rough cost, and only the grants that are open and fit.
- **What it could look like:** a suggested layout that respects the rules, an explorable 3D staging of the real room, and staged photos checked by SAM.
- **A one-page plan for a designer**, to print or save as a PDF.

## Repo map

| Path | What it is |
|---|---|
| `src/` | Web app: capture, wait, result, one-page plan, 3D |
| `server/` | API, job queue, scan pipeline, rules triage, layout, Meta calls |
| `services/scan3d/` | MapAnything 3D service, which runs locally or on Modal |
| `services/meta-relay/` | Cloudflare Worker that forwards Meta API calls from Canada |
| `data/rules/` | Rules packs for each city, with sources |
| `tests/`, `docs/evidence/` | Unit tests and saved test runs |
| `scripts/`, `tools/` | Sample building, end-to-end journey test, voice and staging asset tools |

## Limits

- It isn't an approval. The City decides, and a registered designer confirms the details.
- Sizes from a phone video are estimates. The app says when to trust them.
- The hosted app has no GPU yet, so new scans there skip the measured 3D. The example shows the full result, and the 3D runs locally as described above.
