# What the iPhone app sends (capture contract v1, as built)

The app films with ARKit world tracking and sends the take to the same `POST /api/scans` the web uses. The shared contract is `docs/capture-contract.md`; this is exactly what the app writes. The code is `BasementReady/Capture/CaptureLog.swift`, `ARCapture.swift`, `VideoWriter.swift`, `DepthWriter.swift` and `Upload/Uploader.swift`.

ARKit tracking and LiDAR depth are phone sensors, not AI models. RoomPlan and ARKit's plane classification are not used.

## The upload

`POST /api/scans`, `multipart/form-data`, parts in this order:

| Part | Value |
|---|---|
| `household` | `relative`, `renter` or `unsure` (for servers from before `who`) |
| `who` | `family`, `rental_capped`, `rental_market` or `unsure` |
| `address` | the picked address (`""` if none was picked) |
| `addressMunicipality` | e.g. `Waterloo` (only with an address) |
| `municipality` | the rules pack, e.g. `waterloo-on`; `other-on` without an address |
| `lens` | `wide` (ARKit uses the 1× camera) |
| `wideAt` | seconds into the take of the still wide shot, one decimal (only if they held still) |
| `capture` | `capture.json`, `application/json` |
| `depth` | `depth.bin`, `application/octet-stream` (LiDAR phones only) |
| `video` | `basement-YYYY-MM-DD-HHMM.mp4`, `video/mp4` |

The start screen's four answers map like this:

| On screen | `household` | `who` |
|---|---|---|
| Family, no rent | `relative` | `family` |
| Rental, about $1,200/mo or less | `renter` | `rental_capped` |
| Rental at market rent | `renter` | `rental_market` |
| Not sure | `unsure` | `unsure` |

The server saves who it's for and the rent from `who` (`server/eligibility.ts` `fromWho`): the rent is the city's own capped amount ($1,198 or $1,236 a month), or `none` / `market`, so the wait screen never asks either again. The app sends no separate rent answer.

The web view keeps the scan's claim token (`ResultView.swift`), so the answers the wait screen saves are the owner's. The start screen's **Your last scan** opens the last take this phone sent (`lastScan` in the app's settings).

## The video

- HEVC (`hvc1`) in an `.mp4`, about 5 Mbit/s. A full 5 minutes is about 190 MB, under the server's 400 MB limit.
- **Picture size:** ARKit's own camera image, the largest 4:3 format of the 1× camera (1920 × 1440 on an iPhone 15). The 4K formats are 16:9, which crops the view, and the server works at 1280 px anyway.
- **Frame rate:** ARKit runs at 60 Hz. The video keeps every other frame, so about 30 fps; the poses keep all of them.
- **Orientation:** pixels are stored in the sensor's landscape orientation (`imageResolution`, e.g. 1920 × 1440). The track's display matrix turns them 90° clockwise, so players and ffmpeg (which auto-rotates) show a 1440 × 1920 portrait picture. This was checked with ffmpeg: a mark in the sensor image's top-left corner ends up top-right in the upright frame.
- **Timing:** the first frame is at 0 s, and every frame's presentation time is its ARFrame timestamp minus the first one's.
- There's no sound track. Nothing is asked while filming, so there's nothing to hear.

## `capture.json`

```json
{
  "version": 1,
  "device": "iPhone15,4",
  "lens": "wide",
  "videoStartTime": 0,
  "arkitStartTime": 81234.123456,
  "imageResolution": [1920, 1440],
  "orientation": "portrait",
  "frames": [
    { "t": 0.01667, "transform": [16 numbers], "intrinsics": [1450.2, 1450.2, 959.8, 719.6], "tracking": "normal" }
  ],
  "depth": { "width": 256, "height": 192, "format": "float16", "file": "depth.bin", "frames": [{ "t": 0.0, "offset": 0 }] }
}
```

- **`frames`:** one per ARFrame, every frame (about 60 a second, ~18,000 for 5 minutes, ~4 MB). They're written even while tracking is limited, so the take keeps going through a brief loss.
- **`t`:** seconds on the video's timeline, the same clock as the video's presentation times. It has 5 decimals.
  - `videoStartTime` is always 0: the video starts at the first record.
  - `arkitStartTime` (extra, for debugging) is that first frame's `ARFrame.timestamp`, in seconds of device uptime.
- **`transform`:** `ARFrame.camera.transform`, camera-to-world, written column by column (column-major, as `simd_float4x4` stores it).
  - ARKit world: metres, +Y up (gravity), `worldAlignment = .gravity`.
  - At the start, the camera looks along −Z.
  - Camera axes: +X right, +Y up and looking down −Z, in the sensor's landscape orientation. With the phone upright, +X is the phone's bottom and +Y its right side.
  - Each number is the shortest decimal that reads back as the same 32-bit float.
- **`intrinsics`:** `camera.intrinsics` as `fx, fy, cx, cy`, in pixels at `imageResolution`.
- **`tracking`:** `normal`, `limited:initializing`, `limited:excessiveMotion`, `limited:insufficientFeatures`, `limited:relocalizing`, or `notAvailable`.
- **`orientation`:** always `portrait`: the app is portrait-only, and the video is written with the 90° clockwise turn.
- **Bad frames:** a record with a non-finite number is left out.

## `sensors.jsonl` (kept on the phone, never sent)

Five times a second, ARKit's feature points (`{"t":…,"p":[x,y,z,…]}`), and each plane as it's found, grows or goes (`{"t":…,"plane":"<id>","v":true,"m":[16],"b":[x,y,z,…]}`, `{"t":…,"gone":"<id>"}`), in ARKit's world. It lets the replay harness play a real take back exactly as the phone saw it (README.md). It isn't uploaded.

## `depth.bin` (LiDAR phones only)

The phone's own `sceneDepth` maps (`ARWorldTrackingConfiguration.supportsFrameSemantics(.sceneDepth)`), in a plain file:

- **Rate:** five a second, at most one every 0.2 s.
- **Layout:** each map is `width × height` little-endian float16 metres, row by row, in the sensor's landscape orientation (same as the camera image, at 256 × 192). Each frame's `offset` is its byte offset in the file.
- **Confidence:** a pixel ARKit marks as low confidence is written as `0`, meaning no reading. NaN and non-positive values are also `0`.
- **Size:** about 98 KB per map, so about 150 MB for 5 minutes.

The iPhone 15 has no LiDAR, so its takes have no `depth` block and no `depth` part.

## Checks

- **XCTest** (`make test`): column-major order, intrinsics order, tracking names, the depth index, float16 conversion, the exact multipart bytes, the scan body's fields and order, and the video's codec, display turn and timeline.
- **Against the server's own code:**
  - The app's 18,000-frame sample goes through `server/capture.ts` `cleanCapture` and `cameraAt` with `rotationCW` 90, giving upright 1280 px intrinsics centred on the 960 × 1280 frame.
  - The multipart body, read by the same Web `formData()` parser Hono uses, gives every field and file back.

## Clip ids the guide looks for

The guide plays clips from `public/voice/<id>.mp3`, which are bundled at build time. Each line tries its ids in order and plays the first that exists. Extra takes named `<id>_2.mp3`, `<id>_3.mp3` and so on are picked at random. Ids marked *new* don't exist yet; until they do, that line shows on screen without a voice.

| Line on screen | Clip ids, best first |
|---|---|
| Film the stairs on your way down. | `intro` |
| Walk slowly along the walls, about 2 m back. | `walls` |
| Tilt up and film the ceiling. | `ceiling` |
| Turn left / right. That wall isn't filmed yet. | `turn_left` / `turn_right` |
| Turn around. The wall behind you isn't filmed yet. | `wall_behind` *new*, `turn_around` |
| Tilt up. The ceiling here isn't filmed yet. | `tilt_up` |
| Tilt back down to the walls. | `tilt_down` |
| Slow down a little. | `slow_down` |
| Too dark or too plain here. Turn on a light. | `too_dark` |
| Point back at where you just were. | `lost_place` *new* |
| Got a wall. | `wall_found` *new* |
| The walls look good. | `walls_done` |
| Got the ceiling. | `ceiling_done` |
| New space. Take it slow. | `new_space` (that take only: the others ask to walk the walls again) |
| That's looking good. | `looking_good` *new* |
| Step back into a corner and hold still. | `wide` |
| Got the wide shot. | `wide_done` |
| That's everything. Tap Done when you're ready. | `enough` |
| Keep going, just a little longer. | `keep_going` |
| Got the stairs. | `stairs_found` *new*, `stairs_done` |
| Found a window. | `window_found` |
| Found the furnace. | `furnace_found` |
| Found the electrical panel. | `panel_found` *new* |
| A door. Pan slowly through it from here. | `door_found` |
| A duct / a beam. Mind your head. | `mind_head` *new* |
| One minute left. / 30 seconds left. | `one_minute` *new* / `thirty_seconds` *new* |

`plans` and `plans_heard` are never played: nothing is asked while filming.
