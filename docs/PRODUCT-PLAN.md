# Basement Ready: from hackathon demo to a real product

## Context

Today's build proves the core works on Meta's models: video in, SAM 3.1 tracking, Spark checking Waterloo rules, a verdict with proof. But it is a demo:
- there are no accounts and nothing is saved
- videos sit on one laptop
- questions can't be answered
- there's no 3D yet
- there's no way to get help building
- there are no tests and it isn't deployed

David wants a product to **sell to real people after the hackathon**, at Gablebird's level of effort. The hackathon still runs on its own clock: public repo, a live product and a 3-minute video by **Wed Nov 4, 9 PM ET**.

**Decisions made (Oct 28):**
- **Revenue:** free for homeowners; **pros pay** (designers and builders get qualified leads).
- **Accounts:** **scan first, sign up to save.**
- **Launch area:** **Waterloo Region** (Waterloo, Kitchener, Cambridge). Other Ontario addresses get provincial rules with a "confirm locally" note.
- **Code:** **stays open source** after the hackathon.

**Calibration (Gablebird inventory):**
- **What Gablebird has:**
  - a marketing site with SEO pages and free tools
  - Clerk sign-in
  - durable jobs with daily AI cost caps
  - Stripe built but switched off
  - PDF outputs
  - about 1,400 unit tests and 90 browser tests
  - Railway plus Cloudflare hosting
- **Gaps we will close:** Terms page, account deletion, CI, analytics and error tracking.

## Product v1 (what "sellable" means here)

**Homeowner**
1. **Guided capture:** an in-browser camera with a live checklist (stairs, every window, ceiling, furnace room, exits), plus upload from the camera roll. Upload goes straight to storage, with progress, and survives a dropped connection.
2. **The scan:**
   - SAM boxes tracking objects live (as built)
   - a MapAnything 3D scan that assembles on screen
   - real measurements: ceiling, window size, room sizes
3. **The answer:**
   - a verdict with proof frames
   - questions answered in place, with the verdict re-checked in code
   - a confidence state for each rule ("measured", "you told us", "needs checking")
4. **3D explorer:**
   - the real room from the scan
   - 2–3 layouts Spark proposes that pass the rules, built and checked in code
   - walk, top and cutaway views
   - cost updating as you change things
5. **Concept render:** Muse Image restyles a frame of *their* basement, labelled "virtually staged". SAM checks that the windows, stairs and beams didn't move.
6. **Money:** grant fit from the household's answers, with source and date. The cancelled federal loan is flagged.
7. **Get it built:**
   - pick up to 3 matched pros
   - consent to share
   - the brief goes to them by email and to their lead inbox
   - the Ontario BCIN registry link remains as a fallback
8. **Dashboard:** my basements, saved scans, answers, the brief, a share link, and delete my data.

**Pros (the paying side)**
9. Pro sign-up: business, designer (BCIN number) and/or builder, cities served, services. The profile is approved by an admin; BCIN is checked against the QuARTS registry.
10. Lead inbox: brief, scan, 3D, fixes and rough cost. Accept or decline; the homeowner's contact details are revealed only on accept.
11. Billing: Stripe for pros (subscription or lead credits), **built but switched off**. Founding pros are free until pricing is set.

**Trust and operations**
12. **Legal:**
    - Privacy (PIPEDA), Terms and disclaimers ("not an approval; the City decides")
    - raw video deleted after 30 days unless saved
    - delete my account and data
13. **Admin:** jobs, cost per scan, pro approvals, rules pack versions.
14. **Cost controls:** a daily USD cap, scan limits per user and per IP, a 2-minute video cap and 5 fps analysis (about $0.10–0.70 per scan).

## Architecture (extend what exists; don't rebuild)

| Layer | Choice | Why |
|---|---|---|
| Web | React 19 + Vite (existing `src/`), add TanStack Router for real URLs | Shareable links, marketing pages, dashboard |
| API | Hono on Node (existing `server/index.ts`) | Already wired |
| Worker | New `worker/` process running the existing pipeline (`server/pipeline.ts`, `server/assess.ts`) | Scans survive restarts; the API stays fast |
| Database | **Postgres on Railway + Drizzle ORM + migrations** | A separate worker plus multiple users needs a real database. Gablebird's SQLite is single-process. |
| Jobs | Postgres job table with `FOR UPDATE SKIP LOCKED`, leases, retries and per-step status | No Redis; durable |
| Storage | **Cloudflare R2**: presigned direct uploads, a lifecycle rule deleting raw video at 30 days | Wrangler is already logged in |
| Auth | **Clerk** (email code + Google), roles `homeowner`, `pro`, `admin`; anonymous scans claimed at sign-up | Same as Gablebird, which David knows |
| Email | **Resend** (brief to pros, "your scan is ready") | Connector already present; needs the domain |
| 3D | **MapAnything Apache checkpoint on Modal** (L40S, scales to zero), plus plane fitting for a room model; output in R2 | Per `docs/research/mapanything.md` |
| Payments | Stripe, flag-gated off | Same approach as Gablebird |
| Ops | Railway: web+API service, worker service, Postgres. Domain on Cloudflare. GitHub Actions CI. Plausible or GA4. Sentry. | Railway, Cloudflare and gh are all logged in |

**Reuse as-is:**
- the Meta client (`server/meta.ts`)
- the SAM parser (`server/sam.ts`)
- trust-rule enforcement and fix grouping (`server/assess.ts`)
- rules loading and grant matching (`server/rules.ts`, which becomes a per-municipality loader)
- the live scan screen (`src/screens/LiveScan.tsx`)
- the results screen (`src/screens/Result.tsx`)
- the brand tokens (`brand/tokens.css`)
- the sample-baking script (`scripts/make-sample.ts`)

**New, by area:**
- `server/db/` (schema, migrations)
- `worker/`
- `server/storage.ts` (R2)
- `server/auth.ts`
- `server/pros/`
- `server/billing/`
- `services/scan3d/` (Modal, Python)
- `src/routes/`
- `src/capture/`
- `src/explorer/`
- `src/marketing/`
- `src/pro/`
- `data/rules/kitchener-on.json` and `data/rules/cambridge-on.json`

## Build order (7 days)

| Day | Here (foundation and flow) | Parallel sessions (separate worktrees) |
|---|---|---|
| **Wed Oct 28** | Router; Postgres + Drizzle schema; Clerk; R2 uploads; job table + worker; first Railway deploy with a live URL | 1. Kitchener + Cambridge rules packs. 2. MapAnything service on Modal. 3. Guided capture recorder. 4. Marketing + legal pages |
| Thu Oct 29 | Pipeline on the worker with DB and R2; answerable questions and re-check; dashboard and save; David's basement through the pipeline | (sessions finish; merge) |
| Fri Oct 30 | 3D scan reveal from MapAnything; 3D explorer with Spark layouts; concept render with SAM check | |
| Sat Oct 31 | Pro side: sign-up, approval, matching, consent, brief email, lead inbox; admin | |
| Sun Nov 1 | Municipality loader for 3 cities; cost controls; privacy and deletion; tests (unit, e2e, eval); CI | |
| Mon Nov 2 | Domain and email live; responsive QA at 1440 and 390; site preflight; production deploy | |
| Tue Nov 3 | README ("built during the event", model map); 3-minute demo with motion graphics; X post | |
| Wed Nov 4 | Buffer, then submit early | |

If time runs short, cut in this order:
1. Stripe UI
2. Concept render
3. Explorer editing (keep viewing)
4. Townships coverage

## What only David can do (blocking or soon)

1. **Register basementready.com and .ca today.** Both were free at 10 AM on Oct 28. This blocks email and the live domain.
2. **Clerk:** create the application; put the publishable and secret keys in `.env`.
3. **Modal:** create an account and claim the $100 hackathon credits; install the CLI token.
4. **Resend:** API key, then verify the domain once it's registered.
5. **Film the basement:** phone upright, 1x lens, lights on, talking, 60–90 s, plus one tape measurement from the floor to the underside of the joists.
6. **Approve Railway spend.** Expect about $5–20/month: web, worker and Postgres.

## Verification

- **Unit (vitest):**
  - the rules engine, with measured checks and operators
  - the SAM parser
  - fix grouping and costs
  - grant matching per household
  - the job state machine
  - the trust rule (an unproven claim gets downgraded)
- **API tests:** scan create, upload, status, answer and re-check, claim on sign-up, delete my data, pro lead consent.
- **Playwright e2e:** with a mocked Meta client in test mode. Cover the sample flow; upload a fixture video then results; answer a question and see the verdict change; sign up and the scan is saved; pro sign-up then lead received. Screenshots at 1440 and 390 with a no-sideways-scroll check.
- **Spark eval harness:** about 5 fixture scans with expected findings, run on demand with a spend log.
- **Live:** run David's real basement video end to end on the Railway URL, then run the `site-preflight` and `responsive-qa` skills before submission.
- **CI:** GitHub Actions runs typecheck, unit and e2e on every push.

## Decision: web for the hackathon, iPhone capture app after (Oct 28)

The hackathon product stays on the web. Judges use laptops, a native app would need TestFlight and Apple review, and the web flow already has:
- live SAM finds while filming
- coaching and the coverage radar
- the 3D view and the floor plan

**After Nov 4: the iPhone capture app.** Its job is better capture. It feeds the same pipeline and the same results page.
- **ARKit camera poses and depth** for real scale without a tape measure. On Pro iPhones, LiDAR gives clean walls. The poses and depth go to the server with the video, replacing MapAnything's scale guess.
- **Live outlines locked onto objects** (SAM finds anchored in AR), plus haptics and background upload.
- **AR walk-through** of the planned suite in the real basement.
- **Multi-room floor plans.** Consider Apple RoomPlan for geometry, but keep every AI step on Meta's models (SAM, Spark, Muse Image) so the product stays Meta-first.
- **Build:** Swift/SwiftUI, Xcode 27 (installed), the iPhone 17 Pro simulators for development, then TestFlight with an Apple Developer account ($99/yr).

**Built since this plan (Oct 28):**
- live finds, coaching and the coverage radar in the recorder
- wishes captured from speech and tied to the moment they were said
- the 3D point-cloud view and the measured floor plan, with m/ft and SVG export
- tape-measure scaling
- a quality gate so a rough scan can't decide rules
