# Basement Ready for iPhone

Film the basement with ARKit world tracking: the camera's real position for every frame, at true scale. The app sends the take to the same server as the web, then opens the web's wait screen and result. What it sends is in [CAPTURE.md](CAPTURE.md).

- **Look:** the Drawing Set (brand/ui.md): an architect's sheet, hairlines instead of cards, one mint rectangle button per screen, Hanken Grotesk and Geist Mono (bundled in `Resources/Fonts`, OFL; mono only for figures). Tokens and button styles live in `Brand/Brand.swift`.
- **Opening:** the logo draws itself in ink on the light sheet (the B forms the house). The first time, a four-page guide shows how to film: start at the stairs, sweep each wall slowly, pan into a room from its door, point back at what glows. "How to film" on the start screen opens it again. Reduce Motion gets still pictures.
- **Start:** the address (type-ahead from the server) and who it's for. Nothing else.
- **Filming:** the camera fills the screen, and the basement assembles on top of it as it's filmed (`Overlay/`, Metal, 60 fps), from ARKit's own planes and feature points:
  - floor tiles as the floor is found, and the filmed ceiling overhead
  - walls painting in once ARKit finds them
  - ARKit's feature points, coloured from the camera picture
  - a still mint glow wherever nothing has been filmed yet: a curtain at the edge of the known floor, or a patch of ceiling. Point at it and it fills in. (David chose to keep it, Oct 30, though the Drawing Set rules out glows.)
  - a mint tag with an ink arrow at the edge of the screen toward the nearest glow when it's off screen (left, right, behind, or up at the ceiling)
  - a light sheet at the bottom: the one instruction, the figures in mono, and the record button (an ink ring; tapping it is Done). No map: the camera is the map.
  - **Scan only** (top right) swaps the camera for a dark void, so only what's been captured shows.
  - A room seen only from its doorway counts: looks reach 6 m, and the guide says to pan from the door, never to walk into every corner.
  - One line of guidance, the guide's voice clips (`public/voice`), up to 5 minutes, and live finds from SAM every 2.5 s.
- **After:** a look at the take, then a background upload, then `/scans/<id>` in a web view. A take the server turns away (today's limit, no connection) stays on the phone to send again.
- **Your last scan:** the start screen opens the last answer this phone sent.

## Build

You need Xcode and XcodeGen (`brew install xcodegen`). The Xcode project is made from `project.yml` and isn't committed.

### Your signing team

The simulator build needs no team. To put it on a phone, sign it with your own Apple team (a free Apple ID works):

1. In Xcode, open **Settings → Accounts**, add your Apple ID, and note the **Team ID** (10 characters).
2. In `ios/`, copy the example and put your Team ID in it. The file isn't committed.

   ```bash
   cd ios && cp Signing.local.xcconfig.example Signing.local.xcconfig
   ```

3. If the bundle ID is taken on your team, change `PRODUCT_BUNDLE_IDENTIFIER` in `project.yml` to your own, such as `com.yourname.basementready`.
4. Run `make generate` again.

```bash
cd ios && make generate
```

```bash
cd ios && make test
```

```bash
cd ios && make build-device
```

`make test` runs the unit tests and the UI test (below), and starts the free test server for it if it isn't running. `make test-unit` skips the UI test.

`make run-sim` runs it in the simulator. The simulator has no ARKit, so Debug builds play a pretend walk round an 8 × 6 m basement instead. For anything closer to a real take, replay one (next section).

## Test it without a basement

Debug builds can **replay a recorded take** as if it were ARKit: the camera picture, the camera's position for every frame, and their timing. Everything downstream is the real thing: the overlay, coverage, the guide and its voice, live finds, the video writer and the upload.

```bash
cd ios && make build-sim && scripts/replay.sh Fixtures/b2-finished-family
```

- **A take** is a folder with a video (`.mp4` or `.mov`) and its `capture.json` (CAPTURE.md). What ARKit would have seen comes from:
  - `sensors.jsonl`, which the app writes beside every real take: ARKit's own points and planes, five times a second. It isn't uploaded.
  - or, for a Blender test basement, its room boxes, `Fixtures/<id>/geometry.json` (exported from `scripts/eval/generate.py`). Points are rays cast from the true camera path, coloured from the video, and walls are "found" once enough rays hit them.
- **Fixtures:**
  - `Fixtures/b2-finished-family` is a small copy of the Blender basement b2 (360 × 640, 825 KB), so the UI test needs nothing else.
  - The full-size test basements are in `media/eval/<id>/` (on the SSD): `scripts/replay.sh "media/eval/b3-three-rooms-bulkhead"` picks up `Fixtures/b3-three-rooms-bulkhead/geometry.json` by itself.
  - A real take from the phone: Debug builds keep the last three sent takes. Copy one off with `xcrun devicectl device copy from --device <phone> --domain-type appDataContainer --domain-identifier com.davidbarry.basementready --source "Library/Application Support/Kept" --destination <folder>`, then replay its folder.
- **Options** (after the folder): the speed (`scripts/replay.sh <take> 2`), then any launch arguments, e.g. `-BRScanOnly` to start in Scan only, `-BRReplayLoop` to play it again and again. It talks to the free test server (below); `SERVER=<url>` points it at another, but a server with real keys makes real, paid calls (live finds every 2.5 s). `LOG=<file>` keeps the app's once-a-second `BRPERF` line (frame rate, lag, frame handler and map times, video frames kept and dropped, memory).
- **The test server**, `scripts/test-server.sh`: the API on 8797 and the web on 5183, beside any `pnpm dev`. It's the web end-to-end tests' replay mode: Meta and the 3D are answered from saved recordings or fail, and nothing else leaves the Mac, so it costs nothing. A new take has no saved answers, so its scan stops at the first model call; the upload and the result page still run.
- **The UI test** (`BasementReadyUITests`): start → "Not sure" → Start filming → the replayed b2 at 2× → Scan only → Done after 30 s → Send it → the web result, with screenshots in the result bundle. About 50 s. `BR_REPLAY_TAKE` films another take.
- **Debug launch arguments:** `-BRFilmNow` (straight to filming), `-BRReplay <folder>`, `-BRReplayGeometry <file>`, `-BRReplaySpeed <n>`, `-BRReplayLoop`, `-BRScanOnly`, `-BRDemoWalk`, `-BRSkipIntro`, `-BRShowGuide`, `-BRGuidePage <n>`, `-BRResetGuide`, `-BRFreezeAt <s>`, and `-serverURL <url>`.

### What the tests check

- **The freeze at 0:06** (fixed Oct 30): the frame handler did the coverage map's work and gave ARKit's own camera buffers to the video encoder, so ARKit ran out of buffers and stopped sending frames. `CapturePipelineTests` feeds 60 frames a second from a pool that refuses a seventh buffer, like ARKit's camera, with the map slowed to 300 ms. The frame handler must stay under 8 ms (p99) and give every buffer straight back. It also samples memory every 10 s of take, which must stay flat.
- On David's iPhone 15 (Oct 30), an 83 s take ran at a steady 60 fps with the frame handler at 0.4 ms on average, no video frames dropped, and memory flat at about 250 MB.
- `ProjectionTests`: the overlay lands exactly on the camera picture, for ARKit's sideways picture and an upright one.
- `ReplayTests`: rays hit the test basement's walls, floor and ceiling, through doorways; walls are found once seen enough; a sensor log plays back.

## Put it on your iPhone

1. Plug the iPhone into the Mac with a cable, unlock it, and tap **Trust** if it asks.
2. On the iPhone, **Settings → Privacy & Security → Developer Mode** must be on. Turning it on restarts the phone.
3. On the Mac, run:

   ```bash
   cd ios && make install
   ```

   Or open `BasementReady.xcodeproj`, pick the iPhone at the top and press Run.
4. The first time, iOS may say the developer isn't trusted. Go to **Settings → General → VPN & Device Management**, tap your developer name, then **Trust**.
5. Open Basement Ready. Allow the camera, and allow the local network if you're using the Mac's server.

It's signed with the free development certificate, so it runs on your own registered phones only. Others need TestFlight, which needs the Apple Developer Program ($99 a year).

## Which server

The gear on the start screen picks the server:

- **Mac (dev):** `https://<this Mac's Wi-Fi address>:5173`, written into Debug builds when they're built. Run `pnpm dev:phone` on the Mac, with the phone on the same Wi-Fi. Debug builds accept that server's self-signed certificate, for that address only.
- **Live site:** `https://www.basementready.com`.
- **Another address:** type it in.

## Needs a real iPhone

These can't be checked in the simulator:

- ARKit tracking and the video's pixels.
- How dense ARKit's points are on a real basement's plain walls (the replay's are denser).
- Dropped frames over a full 5 minutes (83 s checked on an iPhone 15).
- The voice through the loudspeaker in a basement.
- LiDAR depth on a Pro phone.
- A background upload with the screen locked.
