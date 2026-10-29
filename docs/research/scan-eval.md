# Scan accuracy eval: status

Oct 29, 2026: the 3D now gets 48 frames per room instead of 24, after measuring both on b1–b3 (below). 3 of 7 basements are rendered. How the eval works is in [`scripts/eval/README.md`](../../scripts/eval/README.md).

## Oct 29: 3D only, room by room

`services/scan3d/bench.py` runs MapAnything once per room and caches what it returns (`tmp/eval/cache`), so a change to the room fit is scored in seconds. Six rooms in b1–b3, filmed as the guide asks, scored against the true sizes:

| Room | True size | 24 frames (before) | 48 frames (now) |
|---|---|---|---|
| b1 Basement (one open room) | 7.60 × 5.40, joists 2.035 | −12% × −11%, ceiling +50 cm | −7% × −12%, ceiling +31 cm |
| b2 Family room | 6.40 × 4.60, 2.35 | +11% × −4%, ceiling 0 | +4% × −8%, ceiling +1 cm |
| b2 Utility room | 4.60 × 3.08, 2.35 | +17% × +42%, ceiling +13 cm | −7% × −3%, ceiling +8 cm |
| b3 Rec room | 5.80 × 5.40, 2.07 | −3% × −29%, ceiling +13 cm | +10% × −26%, ceiling +24 cm |
| b3 Workshop | 3.48 × 2.90, 2.07 | +134% × +78%, ceiling +23 cm | +154% × +82%, ceiling +31 cm |
| b3 Furnace room | 3.48 × 2.38, 2.085 | +24% × −16%, ceiling +17 cm | +30% × +5%, ceiling +18 cm |
| **Median error** | | **14% × 22%, ceiling 15 cm** | **9% × 10%, ceiling 21 cm** |

- **48 frames measure rooms better.** The median size error roughly halves, and the b2 rooms land within 10%. It costs about a minute a room and 10 GB of memory on an M3 Pro (24 frames took 20 s). 64 frames helped b1 (−4% × −3%) but broke b2's family room (−28%), so 48 it is.
- **The ceiling still reads high**, by 1–31 cm. No room passed the trust check (flat floor and level ceiling), so the rules still leave heights to the designer. That is the safe answer, but the scan doesn't settle heights yet.
- **Small rooms off a big one** (b3's workshop) take in the walls of the next room, seen through the doorway.
- b3's rec room lost a whole wall: its far side was never filmed between desk and duct height.

Tried, measured and dropped, because each fixed one room and broke another:

- Bounding each side by the nearest long wall instead of the outermost: b2's family room came out 35% short.
- Ignoring walls more than 2.5–3.5 m past where the person stood: 2.5 m fixed the workshop (+3% × +16%) but cut the family room by a third.
- Dropping walls that sit behind a longer wall nearer in: no change.
- Keeping only points that two or more frames agree on: better in some rooms, much worse in b1.
- Leaving the stairs frames out of the first room: the floor sat better in b1, but the sizes didn't improve.
- Telling MapAnything the lens. On portrait phone video it guesses about 85° across the long side, on David's real scans and the renders alike, when a main camera is closer to 65–70°. Given 68°, it still lands near 75°, and the sizes came out the same.
- MapAnything's confidence is about 1.0 for every pixel on this footage, so the pipeline's "drop the least confident 20%" removes almost nothing.

Next, if there's time: render b4–b7 (about 1¾ hours) so a change is judged on 20 rooms rather than 6, and look again at small rooms and the ceiling.

## What's built

- `scripts/eval/generate.py` (Blender, headless) builds 7 synthetic basements from exact plans. They have 1–4 rooms, ceilings from 1.85 m to 2.60 m, open joists, ducts, beams and bulkheads, windows with escape-size and too-small openings, 2.03 m doors, stairs, a furnace, clutter, and dim lighting metered room by room the way a phone would. For each basement it renders a 1080×1920 30 fps handheld walkthrough in the filming guide's order and writes `truth.json`.
- `scripts/eval/run.ts` (`pnpm eval`) uploads each video to the local API and scores the result against the truth. It covers ceiling height, room size, rooms found (by replaying `src/capture/rooms.ts`), windows found (SAM boxes against the true window boxes, frame by frame), the rule calls, and the verdict, including whether the verdict was right for the right reasons. It writes `tmp/eval/report.md`.
- `pnpm eval --3d-only` sends each true room straight to the local 3D service, with no Meta calls. It runs each room three ways: as filmed, without the stairs, and with a tape measurement.
- `services/scan3d/bench.py` does the same without the API and caches MapAnything's output, for trying changes to the room fit quickly (`.venv/bin/python bench.py --frames 48 --plot`).

## What's rendered

Everything is in `media/eval/` (git-ignored). The truth for b1–b3 was refreshed on Oct 29 (it now has `stairsEndS`).

| Basement | State | Scanned |
|---|---|---|
| `b1-unfinished-open` | done, 60 s | yes, scan `45d6efb3-a5c2-43f4-9765-bb8d077f4635` ($0.45) |
| `b2-finished-family` | done, 64 s | no |
| `b3-three-rooms-bulkhead` | done, 72 s | no |
| `b4-four-rooms-mixed` | stopped at frame 1,724 of 2,520; the partial frames are kept in `media/eval/b4-four-rooms-mixed/frames` (541 MB) | no |
| `b5-tall-bright`, `b6-dim-joists-ducts`, `b7-old-low` | not rendered | no |

## Oct 28: b1 through the whole app (one basement, so treat it as a first look)

b1 is one open unfinished room, 7.60 × 5.40 m, with joists at 2.035 m (subfloor 2.27 m). It has a duct trunk at 1.785 m, a steel beam at 1.835 m, and three 0.80 × 0.40 m hopper windows (0.32 m², too small to escape through).

- **Verdict: right, for the wrong reason.** The answer was "fix", as expected. But the only fix flagged was fire separation, for the open joists. The low duct, the low beam and the small windows were all left to the designer, because the 3D wasn't trusted.
- **3D size: 12–15% small.** It read 6.71 × 4.59 m against 7.60 × 5.40 m.
- **3D ceiling: 36 cm high.** It read 2.40 m against joists at 2.035 m, which is still 13 cm above the subfloor.
- **The scan knew it was off.** It marked itself untrusted:
  - the floor isn't flat (10 cm spread)
  - the ceiling is tilted 4.9°
  - walls are doubled, two copies 18 cm apart

  So the rules fell back to designer checks. That's the safe behaviour, but the scan decided nothing.
- **Doubled walls happen even here.** This room is clean and synthetic: steady light, exact camera, no motion blur. So doubling isn't only a problem of shaky phone footage. It comes from MapAnything on 24 frames picked from a 60 s walk (the Mac runner caps it at 24).
- **The stairs are in room 1's 3D.** 5 of the 24 frames were filmed on the stairs. `--3d-only` tests whether leaving them out helps.
- **SAM:**
  - windows: all 3 found, plus 1 extra track
  - stairs and the beam: found
  - duct, furnace and panel: not found. My duct and furnace models are plain boxes, so this partly reflects the models, not just SAM.
- **Clearance:** under the beam it read 1.96 m (true 1.835 m), from the untrusted scan.

## How to resume

Run these from the repo root. The API is `pnpm dev` or `pnpm dev:phone`; the 3D service is `pnpm dev:scan3d`. Run one GPU job at a time: don't scan while Blender renders. The truth for b1–b3 is already refreshed.

1. Render b4–b7. That's about 8,300 frames at about 0.75 s each, so roughly 1¾ hours. b4 starts over and clears its partial frames.

   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/eval/generate.py -- --only b4,b5,b6,b7
   ```

2. Scan b2–b7. b1 is scored from its saved scan (`tmp/eval/scans.json`), not paid for again. This is about 6 × $0.45–0.70, so roughly $3–4. The API allows 6 scans an hour from one address; `run.ts` waits it out.

   ```bash
   pnpm eval
   ```

3. Run the free 3D-only check, or `bench.py` in `services/scan3d`. It writes `tmp/eval/3d-only.md`.

   ```bash
   pnpm eval --3d-only
   ```

4. Write the findings from `tmp/eval/report.md` and `tmp/eval/3d-only.md` into this file.

If `tmp/eval/scans.json` is gone, b1's scan id is above. Re-scoring it is free: put it back in that file under the key `b1-unfinished-open:truth`.

## Choices made along the way

- **Scans get the true room starts** (`--rooms truth`). That way the 3D is scored room by room, and room finding is scored separately by replaying the phone's detector. `--rooms detector` and `--rooms none` are there for comparison.
- **Open joists count as a fix.** So does a furnace with no door. The assessment agent is told to flag both on sight. b2 and b5 were made fully finished so that "yes" is the right answer for them.
- **Render settings: EEVEE with raytracing off.** Raytracing left a speckle fixed to the screen that a 3D model could take for texture. At 8 samples a frame takes about 0.75 s at full size on the M3 Pro.
