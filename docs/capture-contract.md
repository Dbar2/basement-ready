# Capture contract: what the iPhone app sends

The iPhone app films with ARKit world tracking, so every frame knows where the camera was, at true scale, with gravity pointing down. The server passes those camera positions to MapAnything, which then measures the basement in one connected, true-to-size piece instead of guessing scale from the video alone. Raw ARKit tracking and LiDAR depth are phone sensors, not AI models. Apple's RoomPlan is not used.

## Upload

`POST /api/scans`, multipart, with the same fields the web sends (`video`, `household`, `address`, `addressMunicipality`, `municipality`, `lens`, `wideAt`). It adds:

| Part | Type | When |
|---|---|---|
| `capture` | `capture.json` (below) | always, from the app |
| `depth` | `depth.bin`, float16 | only on LiDAR phones |

## `capture.json`, version 1

```json
{
  "version": 1,
  "device": "iPhone15,4",
  "lens": "wide",
  "videoStartTime": 0,
  "imageResolution": [1920, 1440],
  "orientation": "portrait",
  "frames": [
    { "t": 0.033, "transform": [16 numbers], "intrinsics": [fx, fy, cx, cy], "tracking": "normal" }
  ],
  "depth": { "width": 256, "height": 192, "format": "float16", "file": "depth.bin", "frames": [{ "t": 0.033, "offset": 0 }] }
}
```

- `t`: the frame's presentation time in the uploaded video, in seconds from its first frame.
- `transform`: ARKit's `camera.transform`, camera-to-world, **column-major** (as `simd_float4x4` stores it).
  - World: +Y up (gravity), metres.
  - Camera: +X right, +Y up, looking down −Z, in the sensor's own landscape orientation.
- `intrinsics`: `camera.intrinsics` as fx, fy, cx, cy, in pixels at `imageResolution` (the sensor's landscape size).
- `tracking`: `normal`, `limited:<reason>` or `notAvailable`. Frames that aren't `normal` are not used as known positions.
- `orientation`: how the video is shown upright. `portrait` means the sensor image is turned 90° clockwise, `landscapeRight` means 0°, `landscapeLeft` 180°, `portraitUpsideDown` 270°. `rotationCW` (0, 90, 180 or 270) may be sent instead.
- `depth` (LiDAR only): `sceneDepth` maps in metres, `width` × `height` float16 each, at the given byte offsets in `depth.bin`.

## On the server (`server/capture.ts`)

1. Each 5 fps analysis frame N takes the tracked record nearest to N/5 s.
2. **Pose:** ARKit to OpenCV camera axes (`T · diag(1, −1, −1, 1)`), then the turn that makes the picture upright.
3. **Intrinsics:** turned with the picture, then scaled to the 1280 px analysis frame.
4. The 3D service receives, for every frame it is sent, `intrinsics` (3×3) and `pose` (OpenCV camera-to-world in ARKit's gravity-aligned world).
