# scan3d: measured 3D scan from basement frames

A Python service that runs Meta's **MapAnything** (`facebook/map-anything-apache`, Apache-2.0 weights) on the frames of a basement video. It returns:

- camera poses
- a point cloud for the scan reveal
- a per-frame depth lookup, so SAM boxes can be lifted into 3D
- a fitted room: floor, ceiling, walls, width × depth × height, and how far to trust the scale

It runs on Modal (one L40S, scales to zero) or locally on a Mac for development. Built during the Meta hackathon (Oct 27 – Nov 4, 2026). Background and sources: [`docs/research/mapanything.md`](../../docs/research/mapanything.md).

```
Node worker ──POST /scan (frames + options)──▶ scan3d ──▶ multipart reply: scan.json + points.ply + depth.bin
```

| File | What it is |
|---|---|
| `app.py` | Modal app: image, weights Volume, L40S class, HTTPS endpoint |
| `run_local.py` | Mac runner: `scan` (folder or video → files), `serve` (same API on localhost), `post` (call any server) |
| `scan3d/frames.py` | decode, sharpness, frame selection, frame → model-pixel mapping |
| `scan3d/pipeline.py` | inference, points, scale, outputs |
| `scan3d/room.py` | RANSAC floor/ceiling, wall lines, room box, quality checks (pure numpy) |
| `scan3d/export.py` | PLY and depth writers, reference `lift_box` |
| `scan3d/api.py` | the HTTP contract below |
| `scan3d/preview.py` | plan + side view PNG for checking a scan by eye |
| `scan3d/layout.py` | the whole basement's floor plan: floor, wall faces, rooms, doors, fixtures, typed corrections |
| `scan3d/views.py`, `selfcheck.py`, `plandraw.py`, `planapi.py` | where the floor meets the walls in each frame, each wall checked against the depth, the pictures Spark reads, `/floorplan` |
| `plan_eval.py` | scores a plan against the truth or a homeowner's sketch |

Pinned: model revision `00f9c245bbcb60522d1ed7f9e9d88462c6e3f38a`, MapAnything code `v1.1.3` (commit `9d1db2d`), torch 2.14.1, DINOv2 hub code `7764ea0` (baked into the Modal image).

---

## Contract

### Auth

Every request needs `Authorization: Bearer <SCAN3D_TOKEN>`. Without it, or with the wrong token, the service answers `401`.

### `POST /scan`

Two ways to send frames. Send them **in capture order**.

**A. Uploads (recommended).** `multipart/form-data` with:

| Part | Type | Notes |
|---|---|---|
| `frames` | file, repeated | JPEG or PNG. 1–600 per request. 40–60 sharp frames is the target. You can send every 5 fps frame from `frames/NNNN.jpg`; the service keeps the sharpest in each slice |
| `options` | text (JSON), optional | `{"maxFrames": 48, "known": {"floorToJoistsM": 2.10}}` |

**B. URLs.** `application/json`:

```json
{ "frameUrls": ["https://…/0000.jpg", "https://…/0001.jpg"], "maxFrames": 48, "known": { "floorToJoistsM": 2.10 } }
```

URLs must be `http(s)` and reachable from Modal. Each frame is capped at 10 MB.

**Options**

| Field | Default | Meaning |
|---|---|---|
| `maxFrames` | 48 | Frames to reconstruct. Clamped to 2–150 on Modal and 2–48 locally. When more frames are sent, the capture is cut into `maxFrames` equal slices and the sharpest frame (variance of the Laplacian) is kept from each |
| `known.floorToJoistsM` | none | One tape measurement, floor to the underside of the joists or ceiling, in metres (1.0–4.0). Sets the scale; see [Scale](#scale) |
| `maxFaces` | 300000 | Triangles in the solid surface (`mesh`), 20k–300k; `0` for none (the whole-walk rough pass skips it) |

**Response `200`:** `multipart/form-data` with these parts (`surfels` and `mesh` only when depth was asked for):

| Part | Filename | Content |
|---|---|---|
| `scan` | `scan.json` | everything below |
| `points` | `points.ply` | binary little-endian PLY, ≤300k points: `x y z` float32 (m, room frame), `red green blue` uint8, `frame` uint16 (index into `scan.frames`, for a capture-order fly-in). Sorted by `frame` |
| `depth` | `depth.bin` | float16 little-endian, shape `[frames, H, W]` (in `files.depth.shape`), metres after scaling, `0` = no depth. The pixel-to-3D lookup |
| `surfels` | `surfels.bin` | `BRS1`: dense surface points for the photo-like view (`export.surfel_bytes`) |
| `mesh` | `mesh.bin` | `BRM1`: the solid surface fused from every depth map (`mesh.py`): uint32 counts, faces uint32 ×3, positions int16 ×3 in mm (room frame), colours uint8 ×3 (`export.mesh_bytes`). Pixels on depth edges and voxels only one frame saw are left out, so smears don't become fins |

```ts
const res = await fetch(`${SCAN3D_URL}/scan`, { method: "POST", body: form, headers: { Authorization: `Bearer ${SCAN3D_TOKEN}` } });
if (!res.ok) throw new Error((await res.json()).error);
const parts = await res.formData(); // Node's fetch parses multipart responses
const scan = JSON.parse(await (parts.get("scan") as File).text());
const ply = await (parts.get("points") as File).arrayBuffer();
const depth = await (parts.get("depth") as File).arrayBuffer();
```

**Errors:** a JSON body `{"error": "…"}`, with status:
- `400`: bad input (unreadable image, bad options, measurement out of range, no usable depth)
- `401`: missing or wrong token
- `413`: more than 600 frames
- `415`: wrong content type
- `500`: anything else

**Timeouts.** Modal cuts an HTTP request at 150 s and answers `303` to a result URL that waits for the job. `fetch` follows that by default (up to 20 redirects), so the Node code doesn't change. The service's own limit is 600 s. A warm scan takes well under 150 s; a cold one can cross it.

### `POST /floorplan`

The whole basement's plan, read from areas already scanned (`scan3d/planapi.py`, `scan3d/layout.py`). It needs no GPU: `run_local.py serve --no-model` serves it alone. The Node side is `server/scan3d.ts` `runFloorPlan` and `server/floorplan.ts`.

| Part | Type | What |
|---|---|---|
| `areas` | text (JSON) | One per area. Either `{world: {rotation, origin}, factor}` (from its `scan.json`; world = rotationᵀ·(room / factor) + origin) or `{placement: {turn, x, y, z}}`. With depth, it also needs `frames` (`[{pose, intrinsics}]`, camera-to-room, the lens in the depth's pixels) and `depthShape` `[H, W]` |
| `points` | file, one per area | That area's `points.ply`, in its room frame |
| `depth` | file, one per area, optional | float16 `[len(frames), H, W]`. Node sends every other frame at half size. Used for where the floor meets the walls, and for the self-check |
| `cameras` | text (JSON) | Camera centres along the walk, in the world |
| `hints` | text (JSON), optional | SAM's finds in the world: `{doors, windows, stairs, fixtures, overhead}`, each `{id, center, low, high}` (`fixtures` and `overhead` also have `kind`) |
| `edits` | text (JSON), optional | Typed corrections to check against the points: `merge`, `split`, `move_wall`, `kind`, `door`, `no_door` (see `layout.py`) |
| `render` | text, optional | `1`: also return the pictures Spark reads. Send `keyframes` (JPEG parts) and `keyframeCams` (JSON `[{pose, intrinsics}]`, camera-to-world, the lens in the JPEG's pixels) to have the walls drawn into them |

The reply is JSON:

- `plan`: rooms as polygons, walls with their thickness and `check` (the self-check's confidence), openings, fixtures, each area's floor, and the verdict on every edit. In the plan frame: world (x, z) turned by −`rotation`, the floor at 0.
- `rooms`: each room's box, the shape `server/basement.ts` places areas by.
- `floorY`, `ceilingY`, `checked`, and `renders` (`topDown` PNG and `frames` JPEGs, base64) when asked.

### `GET /health`

`{"ok": true, "model", "revision", "device", "maxFrames"}`, behind the same token. On Modal this boots a GPU container and loads the model, so **call it as the homeowner starts filming**. By the time the frames arrive the 40–90 s cold start is already paid.

### `scan.json`

```jsonc
{
  "version": 1,
  "units": "m",
  "coordinateFrame": "room: …",            // see Coordinate frame
  "model": { "id": "facebook/map-anything-apache", "revision": "00f9c245…", "code": "v1.1.3", "device": "cuda" },
  "scaleSource": "model",                   // or "user_measurement"
  "scale": {
    "source": "model", "factor": 1.0,       // factor applied to the model's geometry
    "confidence": "low",                    // "low" (model) | "medium" | "high" (measured, ceiling level)
    "expectedErrorPct": 20,                 // research note: images-only scale is 10–25% off indoors; 3.5% once aligned
    "modelCeilingHeightM": 2.31,            // before the tape fix, so you can show the correction
    "modelMetricScale": 1.46,               // MapAnything's internal metric scale factor
    "known": { "floorToJoistsM": 2.1 }
  },
  "room": {
    "floor":   { "heightM": 0, "normal": [0,1,0], "rmsM": 0.012, "heightSpreadM": 0.02, "cellsMeasured": 140, "inliers": 52000 },
    "ceiling": { "heightM": 2.10, "normal": […], "tiltDeg": 0.4, "heightRangeAtCornersM": 0.03, "rmsM": 0.01,
                 "heightSpreadM": 0.03, "cellsMeasured": 90, "inliers": 31000, "note": "…" },  // null if none found
    "ceilingCandidates": [{ "heightM": 2.31, "inliers": 9000 }, { "heightM": 2.10, "inliers": 31000 }],
    "ceilingHeightM": 2.10,                 // null without a ceiling
    "widthM": 6.42,                         // along X, the longer side
    "depthM": 4.10,                         // along Z
    "box": { "min": [-3.21, 0, -2.05], "max": [3.21, 2.10, 2.05],
             "sides": { "minX": "wall", "maxX": "wall", "minZ": "wall", "maxZ": "extent" },
             "heightFrom": "ceiling" },     // "points" when no ceiling was found
    "walls": [{ "id": "wall-1", "axis": "x", "normal": [-1,0,0], "offset": 3.21,
                "segment": [[3.21,-2.0],[3.21,2.0]], "lengthM": 4.0, "rmsM": 0.014, "inliers": 12000 }]
  },
  "quality": {
    "wallsDoubled": false, "doubledWalls": [],   // [{ "walls": ["wall-3","wall-4"], "gapM": 0.14, "sharedFrames": 0.11 }]
    "floorSplit": null,                          // { "gapM", "inliers", "sharedFrames" } when the floor came out in two levels
    "pass": { "wallsNotDoubled": true, "flatFloor": true, "ceilingLevelWithin5cm": true },  // null = couldn't judge
    "warnings": ["…plain-language problems, safe to show…"]
  },
  "framesReceived": 412,
  "frames": [{
    "index": 0, "sourceIndex": 7, "name": "0007.jpg",       // sourceIndex = position in your request
    "width": 720, "height": 1280, "sharpness": 182.4,
    "model": { "width": 294, "height": 518, "resizedWidth": 294, "resizedHeight": 522, "cropLeft": 0, "cropTop": 2 },
    "intrinsics": [[fx,0,cx],[0,fy,cy],[0,0,1]],             // model pixels
    "pose": [[…4×4…]],                                       // camera-to-room
    "validFraction": 0.81, "depthOffset": 0                  // byte offset of this frame in depth.bin
  }],
  "files": { "points": { "count": 287000, … }, "depth": { "dtype": "float16", "shape": [48, 518, 294], "invalid": 0, … } },
  "timings": { "decodeS": 1.2, "inferS": 4.8, "fitS": 3.1, "exportS": 0.6, "totalS": 9.7 }
}
```

Field notes:
- **Walls:** each is a vertical plane `normal · p + offset = 0`, with the normal facing into the room, plus its floor-plan `segment` as `[x, z]` pairs. `axis` is `x` (a wall at x = const), `z`, or `other` (not square to the room).
- **Box sides:** `wall` means a fitted wall bounds the room on that side. `extent` means the camera never saw a wall there, so that side reaches the spread of points or the camera positions plus 0.3 m, whichever is farther (whoever filmed was in the room). Label those sizes "estimated".
- **Ceiling:** the highest large plane facing down. In an unfinished basement that can be the subfloor between joists rather than their underside; `ceilingCandidates` lists every level found, highest first.
- **`heightSpreadM`:** how much the surface's height wanders across the room (p5–p95 of 50 cm cell medians). It is the flat-floor and level-ceiling measure behind `quality.pass`.

### Coordinate frame

Every output is in the **room frame**:

- Units are metres.
- The origin is on the floor under the centre of the room box.
- **+Y is up.** X runs along the longer side of the room; Z = X × Y.
- It is right-handed, the same convention as three.js.

The floor is `y = 0`, so the room box is `[−W/2, W/2] × [0, H] × [−D/2, D/2]`.

`frames[i].pose` maps camera to room with **OpenCV camera axes** (x right, y down, z forward). For a three.js camera, which looks down −Z with +Y up, flip two axes: `R_three = R_pose · diag(1, −1, −1)`.

### Lifting a SAM box to 3D

`server/pipeline.ts` stores boxes as `{x, y, w, h}`, 0..1 of the frame it extracted. To lift one, use a scan frame whose `sourceIndex` is that frame, or the nearest one; if it isn't in the scan, try another frame from the track. Each pixel then works like this:

1. Map the box onto the model grid: `u = x · resizedWidth − cropLeft`, `v = y · resizedHeight − cropTop`.
2. Read depth `z` at `depth.bin[depthOffset + 2·(v·W + u)]`.
3. Un-project: `c = ((u − cx)·z/fx, (v − cy)·z/fy, z)`.
4. Transform: `p = pose · [c, 1]`.

This is the same formula that built the point cloud, so lifted boxes land on it.

```ts
type Box = { x: number; y: number; w: number; h: number }; // 0..1 of the original frame, as in server/pipeline.ts

function half(bits: number) {
  const e = (bits >> 10) & 0x1f, m = bits & 0x3ff, s = bits & 0x8000 ? -1 : 1;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

// Room-frame points (metres) under a SAM box on one scan frame. Returns null if nothing has depth.
export function liftBox(scan: any, depth: ArrayBuffer, frame: number, box: Box, erodePx = 2) {
  const f = scan.frames[frame];
  const [, H, W] = scan.files.depth.shape;
  const m = f.model;
  const u0 = Math.max(0, Math.ceil(box.x * m.resizedWidth - m.cropLeft) + erodePx);
  const v0 = Math.max(0, Math.ceil(box.y * m.resizedHeight - m.cropTop) + erodePx);
  const u1 = Math.min(W - 1, Math.floor((box.x + box.w) * m.resizedWidth - m.cropLeft) - erodePx);
  const v1 = Math.min(H - 1, Math.floor((box.y + box.h) * m.resizedHeight - m.cropTop) - erodePx);
  const [[fx, , cx], [, fy, cy]] = f.intrinsics;
  const P = f.pose; // camera-to-room, OpenCV camera axes
  const view = new DataView(depth, f.depthOffset, H * W * 2);
  const pts: number[][] = [];
  for (let v = v0; v <= v1; v++) {
    for (let u = u0; u <= u1; u++) {
      const z = half(view.getUint16((v * W + u) * 2, true));
      if (!(z > 0)) continue;
      const c = [((u - cx) * z) / fx, ((v - cy) * z) / fy, z];
      pts.push([0, 1, 2].map((r) => P[r][0] * c[0] + P[r][1] * c[1] + P[r][2] * c[2] + P[r][3]));
    }
  }
  if (!pts.length) return null;
  const pct = (q: number) => [0, 1, 2].map((a) => {
    const s = pts.map((p) => p[a]).sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(q * s.length))];
  });
  return { count: pts.length, median: pct(0.5), p05: pct(0.05), p95: pct(0.95) };
}
```

For an object SAM tracked across many frames, lift it on several frames and take medians. Sizes come from `p95 − p05`, and the height off the floor is just `y`. Windows are glass, so their depth is unreliable. For those, fit the wall plane from the pixels around the window and intersect the window-pixel rays with it, as in research note §6.5. The Python reference is `scan3d.export.lift_box`.

### three.js

```ts
const loader = new PLYLoader();
loader.setCustomPropertyNameMapping({ aFrame: ["frame"] }); // per-point capture order for the reveal shader
const geometry = loader.parse(ply);                          // position + color (0..1) + aFrame
```

---

## Scale

MapAnything predicts metric geometry, but from images alone the scale is often 10–25% off indoors (research note §4). Shape within a scan is consistent, so one number fixes everything:

- **No measurement:** `scaleSource: "model"`, `confidence: "low"`, `expectedErrorPct: 20`. Show sizes as "estimated".
- **`floorToJoistsM` given:** the service fits floor and ceiling planes and sets `factor = tape / scanHeight`. Every point, depth, camera position and length is multiplied by it; rotations and intrinsics don't change. `scaleSource: "user_measurement"`, and `expectedErrorPct` is 3.5 when the ceiling is level (6 otherwise). A tape number more than 1.5× off the scan's estimate is still applied, with a warning to check it.
- **No ceiling found:** the measurement can't be used. The scale stays `model`, with a warning.

Plane-to-plane height averages thousands of points, which is why it's the reference. A single window width depends on edge pixels.

## Pass/fail bar (Thursday's real-basement test)

From the research note: **walls aren't doubled, the floor is one flat plane, and ceiling height is within 5 cm after the one-measurement fix.** `quality.pass` checks the first two and the levelness half of the third automatically.

| Check | Field | Rule |
|---|---|---|
| Walls not doubled | `pass.wallsNotDoubled` | No two parallel walls 5–60 cm apart and overlapping by ≥ 0.5 m that were placed by *different* frames (shared-frame overlap < 0.35 on the stretch both cover). A shelf in front of a wall is seen by the same frames, so it doesn't trip it |
| Flat floor | `pass.flatFloor` | Floor height spread ≤ 4 cm across the room, and no second floor level 4–30 cm off placed by different frames |
| Ceiling within 5 cm | `pass.ceilingLevelWithin5cm` | Ceiling height spread ≤ 5 cm across the room |

Then by hand:

1. Tape-measure floor to joists, one window (width and height), and the room length.
2. Run the scan with `--floor-to-joists`, then check that `widthM`/`depthM` and the lifted window are within about 5% of the tape.
3. Open `preview.png` (red walls are the doubled ones) or `points.ply` in Blender.

```bash
python run_local.py scan basement.mp4 --out out/basement --max-frames 24 --floor-to-joists 2.10 --preview
```

---

## Setup

### Local (Apple Silicon)

```bash
cd services/scan3d
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python torch==2.14.1 torchvision==0.29.1 -r requirements.txt modal pytest httpx
.venv/bin/python -m pytest tests          # no weights needed: synthetic room, crop mapping, HTTP contract
```

The first real run downloads the pinned 4.9 GB checkpoint into `~/.cache/huggingface`.

```bash
.venv/bin/python run_local.py scan path/to/frames --out out/test --max-frames 16 --preview
.venv/bin/python run_local.py scan path/to/video.mp4 --out out/test --preview   # 5 fps, long side 1280, like the Node worker
SCAN3D_TOKEN=dev .venv/bin/python run_local.py serve --port 8790               # same API for the Node worker on localhost
SCAN3D_TOKEN=dev .venv/bin/python run_local.py post http://127.0.0.1:8790 path/to/frames --out out/test
```

Locally the cap is 48 frames, about 10 GB of memory and a minute a room on an M3 Pro. On a 16 GB Mac, set `SCAN3D_MAX_FRAMES=24` in the app's `.env`: it still works, but rooms measure less well.

### Deploy to Modal

```bash
cd services/scan3d
.venv/bin/modal token new                                   # once, opens the browser
TOKEN=$(openssl rand -hex 32)
.venv/bin/modal secret create scan3d-token SCAN3D_TOKEN=$TOKEN
echo "SCAN3D_MODAL_TOKEN=$TOKEN" >> ../../.env              # kept for production; `pnpm dev` uses the Mac runner
.venv/bin/modal run app.py::download_weights                # once: 4.9 GB into the scan3d-weights Volume
.venv/bin/modal deploy app.py                               # prints https://<you>--basement-ready-scan3d-scan3d-web.us-east.modal.run
SCAN3D_TOKEN=$TOKEN .venv/bin/python run_local.py post "$SCAN3D_URL" path/to/frames --out out/modal --preview   # smoke test
```

Production sets `SCAN3D_URL` (the printed endpoint), `SCAN3D_TOKEN` (the same token) and `SCAN3D_PARALLEL=3`, so a basement's areas run side by side.

`modal deploy` builds the CUDA image in Modal's cloud, so nothing heavy runs on the Mac. The image has torch 2.14.1 for CUDA 12.6, MapAnything at the pinned commit and the DINOv2 hub code. Weights load from the Volume with `HF_HUB_OFFLINE=1`, so a missing download fails fast rather than pulling 4.9 GB on a cold start.

Knobs live in `app.py`:
- `scaledown_window=60`: idle seconds before scaling to zero.
- `max_containers=3`: one container per area at once.
- `cpu=8.0`, `memory=32768`: the solid surface is fused on the CPU.
- `timeout=600`.

## Cost per scan

L40S on Modal is $0.000542/s ($1.95/h), checked Oct 28, 2026. CPU and RAM are billed on top; expect roughly 10–15% more (unverified, see modal.com/pricing). These are **estimates** from the list price; the timings are now measured (see [Measured on Modal](#measured-on-modal-l40s-oct-29)), the bill is not.

| Phase | Time (est.) | Cost |
|---|---|---|
| Warm scan, 48 frames: decode + model + fit + export | 10–20 s (model 3–6 s per research note; the fit took 1.4 s for 16 frames on an M3 Pro) | $0.005–0.011 |
| Cold start: container + loading 4.9 GB from the Volume | +40–90 s | +$0.02–0.05 |
| Idle tail before scale-to-zero (`scaledown_window=60`) | +60 s | +$0.033 |
| **One isolated scan (cold + idle tail)** | ~2–3 min billed | **≈ $0.06–0.10** |
| **Back-to-back scans while warm** | | **≈ $0.01 each** |

Keeping a container warm all day costs $1.95/h, which isn't worth it for judging, since the sample basement is precomputed. To cut the idle tail, lower `scaledown_window`. To cut cold starts, Modal memory snapshots are the next step (not set up).

## Measured on Modal (L40S, Oct 29)

| | Time |
|---|---|
| Cold start (container + weights from the Volume) | 28 s |
| One real area, 48 frames, warm: in the service | 19–21 s (model 8.5 s, fit 3 s, points 2 s, solid surface 6–7 s) |
| Same, round trip from the Mac (uploading 120 frames) | 27–28 s |
| The sample basement end to end (rough pass + area) | 75 s |

The Mac takes about 67 s for the model alone on the same area, and gives the same room size (7.56 × 3.72 m against 7.58 × 3.73 m).

## Measured locally (M3 Pro, 36 GB, MPS, torch 2.14.1, Oct 28)

The model takes 22–43 s to load: 43 s the first time, then 22–31 s. The first inference after a load adds about 4 s of warm-up.

| Input | Frames used | Inference | Fit | Scan total | Result |
|---|---|---|---|---|---|
| MapAnything example "Office" (1 photo) | 1 | 1.4 s warm, 6.0 s first | 0.2 s | 6.2 s | Floor found and level, 3 of 4 walls, ceiling not in view (`null`), single-view warning |
| Example "Desk" (2 × 12 MP photos, indoor) | 2 | 3.9 s | 0.3 s | 4.3 s | Floor flat (2.2 cm spread); drop ceiling at 3.18 m model scale; 8 cm spread from recessed lights, so it fails the 5 cm bar |
| Same via `fetch` + `res.formData()` + `floorToJoistsM: 2.7` | 2 | | | 4.3 s round trip | Factor 0.85; Node `liftBox` = Python `lift_box` exactly |
| Example "Test-Site" (outdoor, 25 frames) | 16 | 14.3 s | 1.4 s | 15.8 s | Ground = floor, stepped facades as square walls; one facade placed at depths 35 cm apart by different frames, so walls are flagged doubled |
| Same via `run_local.py serve` + `post` (HTTP) | 24 | 24.8 s | 2.1 s | 27.0 s (27.1 s round trip) | 22.6 MB up, 12.4 MB down |
| `public/samples/sample-basement.mp4` (pan over a still photo) | 16 of 60 | 14.2 s | 1.0 s | 15.3 s | Smeared, no parallax: fails all three checks, as it should |
| Synthetic room 4.20 × 3.10 × 2.10 m (`tests/`) | 24 cameras | | 0.3 s | | 2.099–2.100 m ceiling, 4.20 × 3.10 m, 40/40 seeds right on the doubled-wall check |

Every point in `points.ply` re-projects onto an exact pixel of its frame (≤ 0.002 px), and its depth matches `depth.bin` within 1.4 mm (float16), so lifted boxes land on the cloud. Reply size is about 5 MB of PLY plus 0.3 MB of depth per frame: around 20 MB at 48 frames.

## Known limits

- **Scale** is a guess until a tape number is given (see Scale).
- **Ceiling** may be the subfloor between joists in an unfinished basement. Check `ceilingCandidates`.
- **Doubled walls** are a real MapAnything failure: an outdoor 16-frame test placed one facade at depths 35 cm apart across frames. The check catches it, and the fix is in capture: a slow, closed loop of 40–60 frames.
- **Room box** assumes one roughly rectangular (Manhattan) room. L-shaped basements come out as their bounding box; walls marked `other` aren't square to it.
- **No real basement video yet.** Everything so far ran on MapAnything's example images, the repo sample (a pan across a still photo, so no parallax) and a synthetic room.
