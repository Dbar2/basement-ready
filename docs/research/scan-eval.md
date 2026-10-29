# Scan accuracy eval: status

Paused on Oct 28, 2026 at David's request: 3 of 7 basements rendered, 1 scanned. How it works is in [`scripts/eval/README.md`](../../scripts/eval/README.md).

## What's built

- `scripts/eval/generate.py` (Blender, headless) builds 7 synthetic basements from exact plans. They have 1–4 rooms, ceilings from 1.85 m to 2.60 m, open joists, ducts, beams and bulkheads, windows with escape-size and too-small openings, 2.03 m doors, stairs, a furnace, clutter, and dim lighting metered room by room the way a phone would. For each basement it renders a 1080×1920 30 fps handheld walkthrough in the filming guide's order and writes `truth.json`.
- `scripts/eval/run.ts` (`pnpm eval`) uploads each video to the local API and scores the result against the truth. It covers ceiling height, room size, rooms found (by replaying `src/capture/rooms.ts`), windows found (SAM boxes against the true window boxes, frame by frame), the rule calls, and the verdict, including whether the verdict was right for the right reasons. It writes `tmp/eval/report.md`.
- `pnpm eval --3d-only` sends each true room straight to the local 3D service, with no Meta calls. It runs each room three ways: as filmed, without the stairs, and with a tape measurement. Written but not run yet.

## What's rendered

Everything is in this worktree's `media/eval/` (git-ignored).

| Basement | State | Scanned |
|---|---|---|
| `b1-unfinished-open` | done, 60 s | yes, scan `45d6efb3-a5c2-43f4-9765-bb8d077f4635` ($0.45) |
| `b2-finished-family` | done, 64 s | no |
| `b3-three-rooms-bulkhead` | done, 72 s | no |
| `b4-four-rooms-mixed` | stopped at frame 1,724 of 2,520; the partial frames are kept in `media/eval/b4-four-rooms-mixed/frames` (541 MB) | no |
| `b5-tall-bright`, `b6-dim-joists-ducts`, `b7-old-low` | not rendered | no |

## b1 result (one basement, so treat it as a first look)

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

Run these from this worktree (`.claude/worktrees/festive-zhukovsky-64a9dd`). The API (`pnpm dev` or `pnpm dev:phone`) and the 3D service (`pnpm dev:scan3d`) can run from the main checkout. Run one GPU job at a time: don't scan while Blender renders.

1. Refresh the truth for b1–b3. This adds `stairsEndS`, which `--3d-only` needs, and keeps each video's exposure. It renders nothing and takes a few seconds.

   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/eval/generate.py -- --only b1,b2,b3 --truth-only
   ```

2. Render b4–b7. That's about 8,300 frames at about 0.75 s each, so roughly 1¾ hours. b4 starts over and clears its partial frames.

   ```bash
   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/eval/generate.py -- --only b4,b5,b6,b7
   ```

3. Scan b2–b7. b1 is scored from its saved scan (`tmp/eval/scans.json`), not paid for again. This is about 6 × $0.45–0.70, so roughly $3–4. The API allows 6 scans an hour from one address; `run.ts` waits it out.

   ```bash
   pnpm eval
   ```

4. Run the free 3D-only check. It writes `tmp/eval/3d-only.md`.

   ```bash
   pnpm eval --3d-only
   ```

5. Write the findings from `tmp/eval/report.md` and `tmp/eval/3d-only.md` into this file.

If `tmp/eval/scans.json` is gone, b1's scan id is above. Re-scoring it is free: put it back in that file under the key `b1-unfinished-open:truth`.

## Choices made along the way

- **Scans get the true room starts** (`--rooms truth`). That way the 3D is scored room by room, and room finding is scored separately by replaying the phone's detector. `--rooms detector` and `--rooms none` are there for comparison.
- **Open joists count as a fix.** So does a furnace with no door. The assessment agent is told to flag both on sight. b2 and b5 were made fully finished so that "yes" is the right answer for them.
- **Render settings: EEVEE with raytracing off.** Raytracing left a speckle fixed to the screen that a 3D model could take for texture. At 8 samples a frame takes about 0.75 s at full size on the M3 Pro.
