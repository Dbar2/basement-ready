# Basement Ready for iPhone

Film the basement with ARKit world tracking: the camera's real position for every frame, at true scale. The app sends the take to the same server as the web, then opens the web's wait screen and result. What it sends is in [CAPTURE.md](CAPTURE.md).

- **Start:** the address (type-ahead from the server) and who it's for. Nothing else.
- **Filming:** a big live map of the basement from ARKit's own planes and points.
  - Floor, walls found, where you are and where you've been.
  - Bright dashes where nobody has looked yet; hatching where the ceiling isn't filmed.
  - The camera picture as an inset, and one line of guidance.
  - The guide's voice clips (`public/voice`), up to 5 minutes, and live finds from SAM every 2.5 s.
- **After:** a look at the take, then a background upload, then `/scans/<id>` in a web view.

## Build

You need Xcode and XcodeGen (`brew install xcodegen`). The Xcode project is made from `project.yml` and isn't committed.

```bash
cd ios && make generate
```

```bash
cd ios && make test
```

```bash
cd ios && make build-device
```

`make run-sim` runs it in the simulator. The simulator has no ARKit, so Debug builds play a pretend walk round an 8 × 6 m basement instead. It exercises the map, guide, voice and upload; it doesn't replace a real take.

## Put it on your iPhone

1. Plug the iPhone into the Mac with a cable, unlock it, and tap **Trust** if it asks.
2. On the iPhone, **Settings → Privacy & Security → Developer Mode** must be on. Turning it on restarts the phone.
3. On the Mac, run:

   ```bash
   cd ios && make install
   ```

   Or open `BasementReady.xcodeproj`, pick the iPhone at the top and press Run.
4. The first time, iOS may say the developer isn't trusted. Go to **Settings → General → VPN & Device Management**, tap **Apple Development: David Barry**, then **Trust**.
5. Open Basement Ready. Allow the camera, and allow the local network if you're using the Mac's server.

It's signed with the free development certificate, so it runs on your own registered phones only. Others need TestFlight, which needs the Apple Developer Program ($99 a year).

## Which server

The gear on the start screen picks the server:

- **Mac (dev):** `https://<this Mac's Wi-Fi address>:5173`, written into Debug builds when they're built. Run `pnpm dev:phone` on the Mac, with the phone on the same Wi-Fi. Debug builds accept that server's self-signed certificate, for that address only.
- **Live site:** `https://web-production-0c550.up.railway.app`.
- **Another address:** type it in.

## Needs a real iPhone

These can't be checked in the simulator:

- ARKit tracking and the video's pixels.
- Planes and points growing into the map on a real walk.
- Dropped frames over 5 minutes.
- The voice through the loudspeaker in a basement.
- LiDAR depth on a Pro phone.
- A background upload with the screen locked.
