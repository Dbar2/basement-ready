# End-to-end journeys

The whole homeowner journey in real browsers (Chromium and WebKit, at 390×844 and 1280×800), without spending Meta credits.

```bash
pnpm test:e2e
```

This runs `pnpm dev`'s two servers on their own ports (API 47873, web 47173, so a running `pnpm dev` is left alone), with a fresh database and storage under `tmp/e2e/<run>/`. Every call to Meta's models, the 3D service and public data is **replayed** from saved answers. A replay run makes no network calls, costs nothing, and comes out the same every time.

- **Pacing:** each saved answer arrives after a quarter of the time it took when recorded. Whichever finished first then (the 3D or the photos) finishes first again, and the wait screen moves as it would. `E2E_PACE=0 pnpm test:e2e` answers at once, which times only our own work (ffmpeg, storage, the database, the browser). It's for timing only: with instant answers the 3D lands before the photos start, the photos stage other frames, and those Muse calls show up as misses.
- **3D areas:** the test server measures three at a time, as Modal did when the takes were recorded (`E2E_SCAN3D_PARALLEL=1` for a take recorded on the Mac runner).
- **Chromium:** it runs the full Chromium build on the Mac's GPU. The headless shell draws WebGL in software, and the 3D views then block clicks for seconds.

Each run writes to `tmp/e2e/<run>/`:
- `report.html`: each journey's steps with a screenshot each, the timing table, and replay hits and misses
- `shots/`: the step screenshots
- `downloads/`: the permit packages the journeys downloaded
- `timing.jsonl`, `steps.jsonl`, `replay-log.jsonl` and, if anything was missing, `replay-misses.jsonl`

## How record and replay work

`server/replay.ts` sits in front of every `fetch` in `server/meta.ts` and `server/scan3d.ts`. The settings `META_CACHE` and `SCAN3D_CACHE` take one of three values:

| Value | What it does |
|---|---|
| `off` | The default, and what production uses. Real calls, nothing saved. |
| `record` | Uses a saved answer when there is one. Otherwise it makes the real call and saves the answer. |
| `replay` | Saved answers only. A missing one throws, is logged to `REPLAY_MISS_LOG`, and fails the journey. It never calls the network. |

- **The key:** a hash of the service, route, model and request body, with image, video and audio bytes hashed.
- **The saved file:** `<key>.json` holds the status, content type, the body (or `<key>.body.gz` beside it), the time the call took, and a short copy of the request.
- **Never saved:** headers and keys. Auth is added only when a call really goes out.
- **Public data:** on the test server, `tests/e2e/support/net-guard.ts` does the same for public data (`PUBLIC_CACHE`), such as city maps, the aerial photo and the city's forms.

Saved answers live in two folders:
- `tests/fixtures/replay/`: committed and small. Right now it holds the two Waterloo permit forms the sample's package fills in.
- `media/private/replay/` (gitignored, in the main checkout): recordings of real takes, including David's own footage. Each take's `takes/<id>.json` holds what it came out as when it was recorded (verdict, rooms and sizes, finds, questions, permit sheets, photo count). Replay must match it.

## What's recorded (Oct 30)

| Take | How it's sent | Where its answers live | Recorded outcome |
|---|---|---|---|
| `david-05x`: David's 0.5× take, 2 min, 601 frames | Start sheet: the app's example address, "Family, no rent", then Upload a video | `media/private/replay` (private) | "Yes … after 1 fix", 3 rooms, 14-page permit set, 1 photo |
| `b2-family`: rendered basement b2, 64 s, 320 frames | Posted like the iPhone app, with its true camera path; "Rental at market rent" | `media/private/replay` (43 MB, too big to commit) | "Looks like yes", 2 rooms (6.2 × 4.17 and 2.93 × 4.17 m; true 6.4 × 4.6 and 4.6 × 3.08), 14 pages, 2 photos |
| Sample basement | The app's own sample | Needs only the two committed city forms | — |

Both takes cost about $2.49 to record, together. The 3D ran on Modal.

## The journeys

| File | What it covers |
|---|---|
| `sample.spec.ts` | The sample basement: wait screen and its questions, verdict, floor plan, Ideas, Permit (profile, then the package downloaded and opened: page count and sheet titles), Money, Build. Needs no recordings. |
| `takes.spec.ts` | Each recorded take, from filming to the permit. It goes through the start sheet (address, who) and an upload, or posts the way the iPhone app does with its tracked camera path. Then the wait screen, every tab, the timing, and the recorded outcome. A take that isn't recorded on this machine is skipped, with the reason. |
| `errors.spec.ts` | A video it can't read. The over-limit path is a placeholder until session A's limits merge. |

Every journey fails on any console error, any page error, or any replay miss.

## Recording a take (spends Meta credits; ask David first)

```bash
E2E_TAKES=b2-family E2E_SCAN3D_URL=<the Modal endpoint> pnpm test:e2e:record
```

- **What it does:** it runs the named takes once, in desktop Chromium, against the real Meta API (the key comes from the main checkout's `.env`, read only by the test server) and the 3D service.
- **The 3D service:** with `E2E_SCAN3D_URL` set to the Modal endpoint, it uses Modal. The token is `.env`'s `SCAN3D_MODAL_TOKEN`, and three areas run at once, like production. Without it, it uses the Mac runner on port 8790 (`pnpm dev:scan3d`). Either way, `support/global-setup.ts` wakes the service first and keeps it awake. The scan only waits 3 s for the 3D service's health check, so a cold Modal container would otherwise mean a recording with no 3D.
- **What it saves:** the answers go to `media/private/replay/`. `E2E_RECORD_TO=committed` saves them into `tests/fixtures/replay/` instead (never for a private take).
- **Picking up where it stopped:** record mode reuses whatever is already saved, at the speed it was recorded. A recording that stopped halfway costs nothing the second time for what it already has, and races the same way a real run does.
- **Re-recording:** delete that take's files, or the folder, and record again.
- **Rough cost per take:** SAM is $0.20 per 1,000 frames for each of its 11 concepts, at 5 frames a second. A 2-minute take is about $1.30 of SAM, plus Muse Image at $0.01 a photo, plus a few cents of Spark. The 3D is free on the Mac runner.

Add a take in `support/takes.ts`.

## Adding a journey piece

Each screen has a page object in `pages/`: `Home` and `StartSheet`, `WaitScreen`, and `Workspace` with one class per tab. When a new piece lands (the swipe deck, plan confirm, the layout picker, the studio, pictures, the quote, permit readiness, booking):

1. Add a page object for its screen in `pages/`, with role- and label-based locators and one method per thing a homeowner does there.
2. Add a `journey.step("…", () => …)` where it falls in `sample.spec.ts` and `takes.spec.ts`. Each step gets a screenshot in the report.
3. Assert what it produced, not just that it opened: a number, a title or a file. Then add that to the take's `Outcome` (in `support/takes.ts`) if it comes from the models.
4. If it calls a model, record once (above). In replay, a new call shows up as a miss naming the model and route.
