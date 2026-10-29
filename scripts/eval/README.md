# Scan accuracy eval

Synthetic basements with known answers, so we can measure the scan instead of guessing. Real phone footage has no ground truth; these do.

| File | What it does |
|---|---|
| `generate.py` | Blender script. Builds 7 basements from exact plans, walks a phone camera through each the way the filming guide asks, renders a portrait 1080×1920 30 fps video, and writes `truth.json` |
| `run.ts` | Uploads each video to the local API, waits for the result, scores it against the truth, and writes `tmp/eval/report.md` |

## The basements

| Id | Rooms | Ceiling | What it tests |
|---|---|---|---|
| `b1-unfinished-open` | 1 | joists at 2.035 m | duct at 1.785 m and steel beam at 1.835 m; only small hopper windows |
| `b2-finished-family` | 2 | drywall 2.35 m throughout | a passing basement: escape window 0.90 × 0.65 m, bulkhead at 2.10 m |
| `b3-three-rooms-bulkhead` | 3 | drywall 2.07 m | a 1.85 m bulkhead (fails by 1.6 cm once finished); block walls |
| `b4-four-rooms-mixed` | 4 | joists 2.215 m, den drywall 2.20 m | every window just short of escape size (0.75 × 0.45 m = 0.3375 m²) |
| `b5-tall-bright` | 2 | drywall 2.60 m throughout | a passing basement: tall, bright, two 1.2 × 0.9 m escape windows |
| `b6-dim-joists-ducts` | 3 | joists at 2.095 m | dim; a wood beam 6 mm under the clearance limit |
| `b7-old-low` | 2 | joists at 1.86 m | old and low: ducts at 1.66 m, tiny windows, no full-height door to scale from |

Every basement has stairs (filmed first, on the way down) and a furnace. Walls are poured concrete, concrete block, stone or drywall. Lighting is bare bulbs, tubes, flush or pot lights, plus daylight through the windows, metered room by room the way a phone's auto exposure would.

`truth.json` holds:

- each room's start time in the video, interior size, ceiling height (the joists' underside, or the drywall) and lowest duct, beam or bulkhead
- each window's clear opening, whether it meets the 0.35 m² / 380 mm escape rule, and its box on every 5 fps analysis frame where it's in view (occlusion checked by ray casts)
- the expected rule results and verdict. Open joists and a furnace with no door count as expected fire fixes, because the assessment agent is told to flag them on sight (`server/assess.ts`); so b2 and b5 are the only basements where "yes" is the right answer

## Run it

Render (about 0.8 s a frame on an M3 Pro, so about 3 hours for all 7; one GPU job at a time):

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/eval/generate.py
```

Options after `--`: `--only b1,b4`, `--preview 8` (8 half-size stills, seconds), `--at 0,12.5` (stills at those seconds), `--truth-only`, `--samples N`, `--out DIR`. Output goes to `media/eval/<id>/` (git-ignored): `walkthrough.mp4`, `truth.json`, and `scene.blend` to open in Blender.

Score (needs `pnpm dev` and `pnpm dev:scan3d`; b1 cost $0.45 of Meta credit, longer videos a little more):

```bash
pnpm eval
```

- `--only b1,b4`
- `--rooms truth` (default) sends the true room starts, so the 3D is scored room by room on its own; `--rooms detector` sends what the phone's room detector finds by itself; `--rooms none` sends no marks (one 3D scan of everything)
- a basement already scanned (saved in `tmp/eval/scans.json`) is scored from that scan, not paid for again; `--reuse` only scores saved scans and never uploads, `--fresh` uploads again anyway
- `--3d-only` skips SAM and Spark and sends each true room's frames straight to the local 3D service (free): as filmed, without the stairs, and with a tape measurement of the ceiling. Writes `tmp/eval/3d-only.md`

Room finding is always scored by replaying `src/capture/rooms.ts` on the analysis video, once with SAM's door boxes and once on colour change alone.
