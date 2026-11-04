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
- **When the product changes on purpose** (new wording, a new model call, a changed Spark prompt): replay shows named misses or a changed outcome. With no misses, `E2E_REWRITE=1 pnpm test:e2e --project=chromium-desktop tests/e2e/takes.spec.ts` writes the new outcomes from a replay, which can't cost anything. With misses, record the take again with `E2E_TAKES=…` (only what's new costs anything; ask David first) and the outcome file is rewritten.

## What's recorded (Nov 4, outcomes for the guide on main 7f3baf4)

| Take | How it's sent | Where its answers live | Recorded outcome |
|---|---|---|---|
| `david-05x`: a private take of a real basement, 2 min | Start sheet: the app's example address, "Family, no rent", then Upload a video | `media/private/replay` (private) | Kept private |
| `b2-family`: rendered basement b2, 64 s, 320 frames | Posted like the iPhone app, with its true camera path; "Rental at market rent" | `media/private/replay` (too big to commit) | "Looks like yes"; Studio, $48,965–$83,752, unit 2 30.7 m², fee $597; Build: tape, four windows, owners, upstairs, review, who builds it, submit (13 pages), book (16 pages) |
| `b2-kitchener`: b2 again, as a Kitchener house (desktop Chromium and phone WebKit only) | Posted like the iPhone app with the city "kitchener-on" and no address | `media/private/replay` | "Looks like yes"; Studio, $48,531–$83,318, fee $163 (Kitchener's minimum); Build adds the water meter ("One meter for both", at "unit 1's furnace room", on the submit copy's A1 and A2) and apply before work starts |
| Sample basement | The app's own sample (its deck cards are in the repo) | The committed Meta model list and two city forms | — |

Recording cost about $2.49 for both takes on Oct 30, with the 3D on Modal. Two top-ups followed as main changed: $0.73 for the swipe deck and a new Spark read, then $0.86 for the one flow (the rebuilt deck, the layout pictures and the design's pictures). Late on Oct 30, main gained Muse Wonder's plan check, the floor plan's `/floorplan`, the as-built's painting, new Spark wording, video beams and "metal duct": $0.41, $0.23 and $0.12 re-recorded what changed (Wonder's plan checks, Spark's reads, the "dining table" picture checks; the practice session recorded "metal duct" for $0.25). Pointing and the service room then cost $0.79 (Spark's marks, a SAM point pass per take, the redrawn designs' pictures). On Oct 31, $0.14 for David's redrawn plan check and $0.03 for the Kitchener take's Spark read. With $0.41 of outcome re-records on Oct 30, about $6.21 in all, each recording approved by David or within the main session's budget. `media/private/replay` holds 178 MB.

## The journeys

| File | What it covers |
|---|---|
| `sample.spec.ts` | The example at `/scans/sample/guide` (scripted, no model calls): the guide's questions, the answer with its price, Design (is this your basement, a layout, a look) and every Build card (tape, a window, owners, bedrooms upstairs, the review copy, apply, who builds it, the submit copy) to the book, then a return visit that lands on the book. Needs no recordings. |
| `takes.spec.ts` | Each recorded take, film to permit, through the guide: the start sheet and an upload, or a post the way the iPhone app sends it (its claim kept in `br-claims`; scans are private). The walk (`pages/Guide.ts`) answers the wait questions, confirms the plan, uses the recommended layout, picks a look and fills every Build card, downloading the review copy, the submit copy and the book. It checks the permit set's structure and Kitchener's water meter on the submit copy's A1 and A2 (and none for Waterloo), the timing, and the recorded outcome. Takes replay one at a time. |
| `errors.spec.ts` | A video it can't read: the guide says so in its thread (no Try again: filming again is the way on). A day's scans used up: it starts its own API with `SCANS_PER_DAY=0` (the other journeys get 1000) and checks the start sheet's message and the server's 503. |

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

Each screen has a page object in `pages/`: `Home` and `StartSheet`, and `Guide`, which walks the guide from the screen alone (its live message, card and choices). The guide's own GET saves the thread, so the walk never polls it beside the page. When a new piece lands (a card, a visual, a step):

1. Teach `Guide.walk` its step: a card kind in `card()`, or a message's way on in `walk()`. Keep steps for visuals that are still placeholders (`layouts`, `beforeAfter`) loose: tap the guide's way on, assert nothing about the picture.
2. The walk names each step for the report (`journey.step`), so it gets its screenshot.
3. Assert what it produced, not just that it opened: a number, a title or a file. Then add that to the take's `Outcome` (in `support/takes.ts`) if it comes from the models.
4. If it calls a model, record once (above). In replay, a new call shows up as a miss naming the model and route.
