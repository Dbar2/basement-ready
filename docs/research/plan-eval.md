# Floor plan eval

Internal. These error figures stay out of the README and the app.

Oct 30, 2026. The plan used to be one box per room. It is now read from the whole basement's 3D at once (`services/scan3d/scan3d/layout.py`) and scored by one command.

## Run it

1. Cache the takes. The rendered basements are measured with their true camera path on Modal (about $0.03 an area) or the Mac runner. A real take is copied from its saved 3D files, with no GPU work.

   ```bash
   SCAN3D_URL=… SCAN3D_TOKEN=… tsx scripts/eval/plan-takes.ts --take b1,b2,b3
   tsx scripts/eval/plan-takes.ts --scan <scan id> --name david-app-1
   ```

2. Score. This takes seconds per take and writes `tmp/eval/plan/results.json`, plus an overlay per take in `tmp/eval/plan/overlays/`: the plan on the truth, and the plan on the points from above.

   ```bash
   cd services/scan3d && .venv/bin/python plan_eval.py --method old,new+check
   ```

- **Truth for b1–b7:** `scripts/eval/generate.py` BASEMENTS (room rectangles, doors, stairs, ducts, beams and bulkheads), turned into the phone's world (x, z = −y).
- **Truth for David's takes:** his sketch, `scripts/eval/sketches/david.json` (rooms by what they are, and which rooms each door joins). Add his tape numbers there when he has them.
- **To open a cached app take in the studio:** `scripts/eval/plan-scan.ts`. It runs the same Node path as a new scan. `--dry` prints the plan and Spark's review without writing anything.

## What's scored

| Score | How |
|---|---|
| Wall error | Every true wall face is sampled every 5 cm. Each sample is scored by its distance to the nearest predicted room edge running the same way, capped at 1 m. Reported as the median, the 90th percentile, and the share within 25 cm. |
| Rooms | Count, matched to the true rooms by overlap, area error per room, and the footprint's IoU |
| Adjacency | Which rooms share a wall |
| Doors | A true door is found when a predicted door joins the same two rooms within 0.8 m of it |
| Stairs, overheads, ceilings | Stairs by centre distance. Overheads count as found when one lies on a true duct, beam or bulkhead. Ceilings are per room. |
| Self-check | Each wall's error, split between the walls the self-check trusts and the ones it doubts |

## Results: app takes, b1–b3, the true camera path

"Before" is the old box per room (`floorplan.py`). "After" is the new plan with its self-check. Same cached 3D for both.

| | b1 (1 room) | b2 (2 rooms) | b3 (3 rooms) |
|---|---|---|---|
| Rooms found | 1 → 1 | 4 → **2** | 3 → 3 |
| Footprint IoU | 0.91 → 0.89 | 0.83 → **0.86** | 0.83 → 0.81 |
| Wall error, median | 17 → 18 cm | 22 → **16 cm** | 21 → **20 cm** |
| Wall error, 90th pct | 23 → 37 cm | 47 → **34 cm** | 41 → **39 cm** |
| Wall length within 25 cm | 100% → 85% | 59% → **85%** | 58% → **62%** |
| Area per room | +3% → −4% | family −25% → **−5%**, utility −8% → **−2%** | workshop +8% → −9%, rec −10% → −15%, furnace −20% → −22% |
| Shared walls found | – | 0/1 → **1/1** | 2/3 → 2/3 |
| Doors joining the right rooms | – | 0/1 → **1/1** | 0/2 → **2/2** |
| Stairs, centre error | none → **5 cm** | none → **8 cm** | none → **6 cm** |
| Overheads found (height error) | 0/2 → 0/2 | 0/2 → **1/2 (4 cm)** | 0/2 → **1/2 (4.5 cm)** |
| Self-check: trusted / doubted walls' error | 19 cm / none doubted | **7 cm / 61 cm** | **13 cm / 74 cm** |

- **The new plan wins where a plan matters.** It gets the rooms, the walls between them, the doors and the stairs right, where the boxes had none of them. b2's family room went from 25% short to 5%.
- **b1 and b3's footprint is about level.** b1 lost a little (its stair-side wall is pushed 15–20 cm out). b3's rec and furnace rooms read short, as they did before.
- **The self-check sorts the walls.** The walls it trusts are 7–19 cm off. The ones it doubts are 61–74 cm off, and those are the walls the plan screen asks about.
- **Spark reviewed b2 and b3:** one round each, no corrections. It agreed with the plan and named the same walls the self-check doubted. b2's note: "Plan matches points and green frames but W4 is red in its view."

### Why the rendered basements read short

On these bare, evenly lit renders, the 3D puts walls 20–60 cm too close to the camera, even with the true camera path. Each area's run disagrees with the next by up to a metre. The floor lands right; the walls don't.

Measured three ways:

- Each true wall's points sit inside it, 20–60 cm on most walls of b1–b3.
- The true windows, lifted from their boxes, land 0.3–0.7 m inside their walls.
- Each frame's own floor sits 8–30 cm high.

So the plan:

- pushes each edge out to the furthest wall line within a metre (as the boxes did)
- moves an inner copy of a wall out onto its outer copy
- splits a ghost strip between two rooms down its middle (one wall seen from both sides lands twice)
- moves a wall out to where the floor stops in the pictures, cast onto the floor plane, since the floor is right

Tried and dropped: rescaling each frame's depth by its own floor (the per-frame floor is too noisy; b2 fell to 0.38 IoU). Real footage has texture, so this may matter less there. David's app take will tell.

## Results: David's 0.5× web take (566dc57b), against his sketch

| | Old boxes | New plan |
|---|---|---|
| Rooms (sketch: 4 + stairs) | 11 overlapping boxes | 3 |
| Rooms named as in the sketch | main | main |
| Doors joining the right rooms | 0/4 | 0/4 |

A web take has no shared world. Its four areas were measured on the model's own rough scale and placed by a rough pass up to metres apart, so the fused points don't agree. Read on its own, each area gives a sensible plan, but placing them together needs better area alignment. That's a follow-up.

**In the app, web takes keep the per-area boxes. The whole plan runs for app takes only.**

David's sketch, for the app take:

- stairs down
- a small low room just to the left (you duck in)
- toilet plumbing straight ahead
- a utility room beside and partly under the stairs, with two doors (panel, water heater, furnace)
- a closet reached only from the main basement

## The floor (anchoring)

- **Each area is lifted so its own floor sits at the basement's 0.** The offset comes from where its solid surface has its floor: the strongest vertex layer within 40 cm (`server/basement.ts` `meshFloor`). The merged mesh, the surface points and the camera views all use that offset (`RoomPlacement.y`). The design and the furniture are drawn at 0.
- **On b2 the merged mesh's floor moved from +1.5 cm to 0** (within the 1 cm bin). Before that, the offset came from the plan's own floor fit, which differs from the mesh by about 2 cm.
- **Studio check** (b2, `plan-scan.ts`): from above and at eye level, the scan's walls stand on the design's floor with no gap or step.

## Not done

- **David's app take:** not filmed yet when this was written. Run `plan-takes.ts --scan` on it, then `plan_eval.py --take david`.
- **Web takes:** align the areas (2D registration of their wall points), then read one plan.
- **Ceilings** read 5–24 cm high on b2–b3, the same depth bias. b3's joist ceiling in the furnace room isn't read at all.
