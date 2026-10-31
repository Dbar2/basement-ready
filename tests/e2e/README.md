# End-to-end journeys

The whole homeowner journey in real browsers (Chromium and WebKit, at 390×844 and 1280×800), without spending Meta credits.

```bash
pnpm test:e2e
```

This runs `pnpm dev`'s two servers on their own ports (API 47873, web 47173, so a running `pnpm dev` is left alone), with a fresh database and storage under `tmp/e2e/<run>/`. Every call to Meta's models, the 3D service and public data is **replayed** from saved answers. A replay run makes no network calls, costs nothing, and comes out the same every time.

- **Pacing:** each saved answer arrives after a quarter of the time it took when recorded. Whichever finished first then (the 3D or the photos) finishes first again, and the wait screen moves as it would. `E2E_PACE=0 pnpm test:e2e` answers at once, which times only our own work (ffmpeg, storage, the database, the browser). It's for timing only: with instant answers the 3D lands before the photos start, the photos stage other frames, and those Muse calls show up as misses.
- **3D areas:** the test server measures three at a time, as Modal did when the takes were recorded (`E2E_SCAN3D_PARALLEL=1` for a take recorded on the Mac runner).
- **Chromium:** it runs the full Chromium build on the Mac's GPU. The headless shell draws WebGL in software, and the 3D views then block clicks for seconds.

Each run writes to `tmp/e2e/<run>/` while it runs. A run that passes then deletes that folder (a database and copied uploads, a gigabyte or more), keeping its report, screenshots and timing in `tmp/e2e/latest/`. A failed run keeps its folder, with traces, and only the newest two are kept. Record runs' timings also go to `tmp/e2e/recorded-timing.jsonl`, so replay reports can compare against the real services. A run folder holds:
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
- **Pictures are the one loose part** (`REPLAY_LOOSE=pictures`, set by the harness):
  - The design pictures start from the browser's own render of the 3D, so another browser or screen size sends other pixels.
  - The staged photos and the swipe deck pick their frames by what the 3D has measured so far.
  - So a Muse Image edit with no exact answer gets a recorded picture asked with the same prompt and size (or the same kind of prompt), and a SAM check of one picture gets a recorded one for the same concept.
  - Each is logged as "loose" and counted in the report. Everything else (SAM on the video, Spark, the 3D, public data) must match exactly.
  - The take's photo and card counts are kept but not held to: at least one photo, and enough cards to swipe.
- **No real key in replay:** the start sheet refuses uploads when the server has no Meta key, so the replay server gets the placeholder `replay-only-not-a-key`. Replay never sends it, and Meta's address points nowhere.
- **Public data:** on the test server, `tests/e2e/support/net-guard.ts` does the same for public data (`PUBLIC_CACHE`), such as city maps, the aerial photo and the city's forms.

Saved answers live in two folders:
- `tests/fixtures/replay/`: committed and small. Right now it holds Meta's model list (the server asks for it at boot) and the two Waterloo permit forms the sample's package fills in.
- `media/private/replay/` (gitignored, in the main checkout): recordings of real takes, including David's own footage. Every checkout and worktree shares these answers: they're keyed by what was asked, so branches never clash.
- **What a take came out as** (verdict, rooms and sizes, finds, questions, the design it picked with its price, fixes, every studio check, unit 2's area and the permit fee, permit sheets and things left, photo and card counts) is the code's, so it's kept per branch: `takes/<id>.json` for main, `takes/<branch>/<id>.json` for a branch. Replay reads its own branch's first, then main's, and must match it.
- **When the product changes on purpose** (new wording, a new model call, a changed Spark prompt): replay shows named misses or a changed outcome. Record the take again with `E2E_TAKES=…` (only what's new costs anything) and the outcome file is rewritten.

## What's recorded (Oct 30, topped up on main 8002e78 that night)

| Take | How it's sent | Where its answers live | Recorded outcome |
|---|---|---|---|
| `david-05x`: David's 0.5× take, 2 min, 601 frames | Start sheet: the app's example address, "Family, no rent", then Upload a video | `media/private/replay` (private) | "Yes … after 2 fixes" (fire separation, a new escape window), 3 rooms (Room 1, Rec room, Furnace room), 3 beams, 4 ducts, a bulkhead and a furnace; One bedroom at $69.4k–$117.6k, unit 2 54.1 m², permit fee $753; a 15-page set with 14 things left |
| `b2-family`: rendered basement b2, 64 s, 320 frames | Posted like the iPhone app, with its true camera path; "Rental at market rent" | `media/private/replay` (too big to commit) | "Looks like yes", 2 rooms (Rec room 6.2 × 4.17 and Laundry room 2.93 × 4.17 m; true 6.4 × 4.6 and 4.6 × 3.08), a bulkhead, panel and water heater, no beams; One bedroom at $33.4k–$54.9k, unit 2 23.3 m², fee $548; 14 pages with 16 left |
| `b2-kitchener`: b2 again, as a Kitchener house (desktop Chromium and phone WebKit only) | Posted like the iPhone app with the city "kitchener-on" and no address | `media/private/replay` | "Looks like yes"; answers Kitchener's water-meter question on the Permit tab ("One meter for both units", at "unit 1's furnace room") and finds it on A1 and A2; 17 left before it; fee $163 (Kitchener's minimum) |
| Sample basement | The app's own sample (its deck cards are in the repo) | The committed Meta model list and two city forms | — |

Recording cost about $2.49 for both takes on Oct 30, with the 3D on Modal. Two top-ups followed as main changed: $0.73 for the swipe deck and a new Spark read, then $0.86 for the one flow (the rebuilt deck, the layout pictures and the design's pictures). Late on Oct 30, main gained Muse Wonder's plan check, the floor plan's `/floorplan`, the as-built's painting, new Spark wording, video beams and "metal duct": $0.41, $0.23 and $0.12 re-recorded what changed (Wonder's plan checks, Spark's reads, the "dining table" picture checks; the practice session recorded "metal duct" for $0.25). Pointing and the service room then cost $0.79 (Spark's marks, a SAM point pass per take, the redrawn designs' pictures). On Oct 31, $0.14 for David's redrawn plan check and $0.03 for the Kitchener take's Spark read. With $0.41 of outcome re-records on Oct 30, about $6.21 in all, each recording approved by David or within the main session's budget. `media/private/replay` holds 178 MB.

## The journeys

| File | What it covers |
|---|---|
| `sample.spec.ts` | The sample basement through the one flow: the wait screen, its questions and its deck, then is-this-your-basement, a layout with its picture, the studio, the pictures and the book. Then Permit (the book's count matches; the review copy is downloaded and opened: a cover first and a page for every listed sheet), Money, Build, The answer, and a return visit landing where they left off. Needs no recordings. |
| `takes.spec.ts` | Each recorded take, from filming to the permit. It goes through the start sheet (address, who) and an upload, or posts the way the iPhone app does with its tracked camera path. Then the wait screen (questions, then swiping the deck: two loved, one passed, both on the board), the flow (plan check, layouts with their pictures, studio, pictures, book), every tab, the permit's readiness count, the timing, and the recorded outcome. Takes replay one at a time. A take that isn't recorded on this machine is skipped, with the reason. |
| `errors.spec.ts` | A video it can't read. A day's scans used up: it starts its own API with `SCANS_PER_DAY=0` (the other journeys get 1000) and checks the start sheet's message and the server's 503. |

Every journey fails on any console error, any page error, or any replay miss it set off. The API tags each miss with the journey whose request (or queued job) made the call (`x-e2e-test`, server/testTag.ts), so a take's misses never fail the sample beside it; a miss no journey set off fails the run from the report.

## Recording a take (spends Meta credits; ask David first)

```bash
E2E_TAKES=b2-family E2E_SCAN3D_URL=<the Modal endpoint> pnpm test:e2e:record
```

- **What it does:** it runs the named takes once, in desktop Chromium, against the real Meta API (the key comes from the main checkout's `.env`, read only by the test server) and the 3D service.
- **The 3D service:** with `E2E_SCAN3D_URL` set to the Modal endpoint, it uses Modal. The token is `.env`'s `SCAN3D_MODAL_TOKEN`, and three areas run at once, like production. Without it, it uses the Mac runner on port 8790 (`pnpm dev:scan3d`). Either way, `support/global-setup.ts` wakes the service first and keeps it awake. The scan only waits 3 s for the 3D service's health check, so a cold Modal container would otherwise mean a recording with no 3D.
- **What it saves:** the answers go to `media/private/replay/`. `E2E_RECORD_TO=committed` saves them into `tests/fixtures/replay/` instead (never for a private take).
- **Picking up where it stopped:** record mode reuses whatever is already saved, at the speed it was recorded. A recording that stopped halfway costs nothing the second time for what it already has, and races the same way a real run does.
- **Re-recording a take after the product changed:** add `E2E_LOOSE=pictures`, so pictures that differ only by timing or the browser's render reuse a recorded one of their kind instead of being paid for again. Leave it off when recording a new take, so it never borrows another take's pictures. To start a take over, delete its files and record again.
- **Rough cost per take:** SAM is $0.20 per 1,000 frames for each of its 11 concepts, at 5 frames a second. A 2-minute take is about $1.30 of SAM, plus Muse Image at $0.01 a photo, plus a few cents of Spark. The 3D is free on the Mac runner.

Add a take in `support/takes.ts`.

## Adding a journey piece

Each screen has a page object in `pages/`: `Home` and `StartSheet`, `WaitScreen`, `StyleDeck` (the swipe deck and board), `Flow` (the step bar, the plan check, layouts, studio and pictures), and `Workspace` with one class per tab. When a new piece lands (the quote's own screen, booking, whatever comes next):

1. Add a page object for its screen in `pages/`, with role- and label-based locators and one method per thing a homeowner does there.
2. Add a `journey.step("…", () => …)` where it falls in `sample.spec.ts` and `takes.spec.ts`. Each step gets a screenshot in the report.
3. Assert what it produced, not just that it opened: a number, a title or a file. Then add that to the take's `Outcome` (in `support/takes.ts`) if it comes from the models.
4. If it calls a model, record once (above). In replay, a new call shows up as a miss naming the model and route.
