# Vision QA reviewer (development only)

Screenshots every screen of the journey and asks Claude Opus whether anything is wrong, unpolished or off-brand. It's a tool for us, not part of the app: nothing in `src/` or `server/` imports it (a test checks), and the app itself still calls only Meta models.

## Run it

```bash
pnpm qa                       # capture, free checks, Opus review, report
pnpm qa --only studio,3d      # just some screens (ids, groups: journey 3d docs marketing, or prefix-*)
pnpm qa:capture               # capture and free checks only, no model calls
pnpm qa:review                # review the latest capture again (new prompt, more budget)
pnpm qa --budget 1 --browsers chromium --viewports desktop
pnpm qa --dry-run             # build and price every review request, send nothing
pnpm qa --take b2-family      # add a recorded take (replays its Meta and 3D answers for free)
pnpm qa --base-url http://localhost:5174   # check another checkout's running dev server
pnpm qa --help
```

It starts its own API and Vite dev server on ports 48787 and 48173 with a fresh embedded database and no Meta key, so it never spends Meta credit. `--web build` uses the production bundle instead; `--base-url` points it at a server you already run.

The report lands in `tmp/qa/<run>/report.html` (also `tmp/qa/latest/`). Other sessions read `tmp/qa/<run>/findings.json` (shape: `Report` in `schema.ts`).

## The key

The review reads `ANTHROPIC_API_KEY` from the environment or from the checkout's `.env` (a worktree reads the main checkout's). It's never printed and never passed to the app's servers. Without it, the run still captures everything and runs the free checks, and the report says "capture only".

## What it captures

- Every journey screen (`plan.ts`): home, the wait screen, the five workspace tabs, plan confirm, studio, pictures, swipe your style, the book, the designer brief. At 390×844 and 1280×800, in Chromium and WebKit, full page (up to 7–8 screens tall).
- The 3D views (home story, the starting layout, the raw scan, studio, pictures) from three fixed cameras: eye level, straight down with the ceiling cut away, and a corner. `three.ts` does this without touching the app: three.js announces its renderers to `window.__THREE_DEVTOOLS__`, and the hook puts the camera where we want it.
- The plan over the scan: the confirmed plan's walls, openings and fixtures drawn over a top-down render of the raw scan, cut at about 1.2 m.
- Every page of the permit set (review copy) and the book PDF, drawn with macOS `sips`.
- A recorded take with `--take b2-family`. It's posted the way the iPhone app sends a take, and the recorded Meta and 3D answers replay (`server/replay.ts`). Only then does the server get a placeholder Meta key, because uploads are refused without one. The placeholder can't reach anything: Meta's address is set to one that doesn't exist, and replay answers first.

## What it checks

- **Free checks** on every page shot (`lint.ts`): sideways scroll, broken images, cut-off text, "you qualify"/"approved", leaked `undefined`/`NaN`, internal error statistics, orange, mint used as text, low contrast, small tap targets, off-brand fonts, page errors, blank pages and blank 3D.
- **Opus** (`review.ts`, `prompts.ts`): one request per screen with its phone and desktop shots together, plus Safari only where it differs from Chrome by more than 6%. The checklist covers correctness (3D on the floor, walls on the plan, labels, impossible geometry, real windows and stairs kept), polish, the brand rules, credibility and copy. Each finding has a severity (P0/P1/P2), where, a fix and a box, which the report crops.
- **Numbers across screens**: one text-only request with the numbers on every screen and PDF page, plus the plan model, to catch areas, ceilings, costs and counts that disagree.

## Cost

- Budget: `--budget` dollars a run (default 3). Each request holds its estimate before it goes, so parallel requests can't overshoot. Requests that don't fit are listed as "skipped (budget)".
- Images are cut to screen-tall pieces. The first two go sharp and the rest at half detail. PDF pages go at 1800 px. Safari goes only where it differs.
- Cache: a request whose images and text are unchanged (same prompt version, model and effort) reuses its earlier answer from `tmp/qa/cache` for free. Bump `PROMPT_VERSION` in `prompts.ts` when the checklist changes.
- `--effort` (default medium) trades depth for output tokens.
- On the full capture of main (Oct 30): 30 requests, 188 images, about $3.10 by the dry run's deliberately high output estimate. A real run should land around $2–3. Re-runs cost only what changed.

## Without a key

`--notes <file>` merges findings written by hand, or by a Claude Code session reading the shots, into the report (shape: `Notes` in `schema.ts`). They're labelled "notes", never "Opus".
