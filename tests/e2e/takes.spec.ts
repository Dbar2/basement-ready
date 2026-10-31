// A real take, film to permit: the start sheet (or the iPhone app's post), the wait screen with its
// questions and the basement assembling, then every workspace tab. Recorded once against the real
// services; replayed, it must come out exactly as it did then.
import { readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { Flow } from "./pages/Flow";
import { Home } from "./pages/Home";
import { StyleDeck } from "./pages/StyleDeck";
import { WaitScreen } from "./pages/WaitScreen";
import { expectSheets, Workspace } from "./pages/Workspace";
import type { Page, Response, TestInfo } from "@playwright/test";
import { api, expect, oneAtATime, test, type Journey } from "./support/fixtures";
import { costOf, realCalls } from "./support/costs";
import { mode, runDir } from "./support/run";
import { recordedOutcome, saveOutcome, TAKES, unavailable, type Outcome } from "./support/takes";
import { milestones, scanEvents } from "./support/timing";

for (const take of TAKES) {
  test(`${take.label}: film to permit`, async ({ page, journey }, info) => {
    const why = unavailable(take);
    test.skip(why !== null, why ?? "");
    test.slow(); // a whole scan, then five tabs, and maybe a wait for another take to finish
    let scanId: string | null = null;
    try {
      await oneAtATime("takes", () => run(page, journey, info, (id) => (scanId = id)));
    } finally {
      // Its upload, frames and 3D are a few hundred megabytes in this run's storage: gone once it's checked.
      // Never throws: the server may still be writing its pictures, and the test's own result matters more.
      if (scanId && !process.env.E2E_KEEP) {
        try {
          rmSync(join(runDir, "storage", "scans", scanId), { recursive: true, force: true, maxRetries: 3 });
        } catch {}
      }
    }
  });

  async function run(page: Page, journey: Journey, info: TestInfo, made: (scanId: string) => void) {
    // Without the file in this tab (the app path), the wait screen asks for the server's copy of the video
    // every 2 s until it's saved (src/screens/LiveScan.tsx): those 404s are expected.
    journey.allowConsole(/status of 404 .*@ .*\/api\/scans\/[0-9a-f-]+\/video$/);
    // Known, WebKit only: leaving the wait screen revokes the uploaded video's blob URL while WebKit's video
    // element is still reading it (src/screens/LiveScan.tsx). The page has moved on; nothing is lost.
    if (info.project.name.startsWith("webkit")) journey.allowConsole(/WebKitBlobResource error 1\.\) @ blob:/);
    const home = new Home(page);
    const wait = new WaitScreen(page);
    const flow = new Flow(page);
    const ws = new Workspace(page);
    const deck = new StyleDeck(page);

    // ---- In: the start sheet and an upload, or a post the way the iPhone app sends a take ----
    let scanId: string;
    const started = Date.now();
    if (take.via === "upload") {
      await journey.step("home", () => home.open());
      const sheet = await journey.step("start sheet: address and who", async () => {
        const s = await home.startSheet();
        if (take.address) await s.address(take.address);
        await s.who(take.who.label);
        return s;
      });
      scanId = (await journey.step("video uploaded", () => sheet!.upload(take.video)))!;
    } else {
      const res = await page.request.post("/api/scans", {
        timeout: 180_000,
        multipart: {
          video: { name: basename(take.video), mimeType: "video/mp4", buffer: readFileSync(take.video) },
          capture: { name: "capture.json", mimeType: "application/json", buffer: readFileSync(take.capture!) },
          who: take.who.id,
          household: "unsure",
          municipality: "waterloo-on",
          lens: "wide",
        },
      });
      expect(res.ok(), `POST /api/scans → ${res.status()}`).toBeTruthy();
      const posted = await res.json();
      scanId = posted.id;
      // The same device: its claim token kept where the web app keeps it (src/api.ts rememberClaim), or the
      // workspace stays locked to whoever filmed it.
      await page.goto("/");
      await page.evaluate((claim) => localStorage.setItem("br-claims", JSON.stringify([claim])), { basementId: posted.basementId, claimToken: posted.claimToken });
      await journey.step("posted like the app, wait screen", () => page.goto(`/scans/${scanId}`));
    }
    made(scanId);
    const uploadS = (Date.now() - started) / 1000;

    // ---- The wait screen: stages, its questions, the basement assembling, the answer ----
    await journey.step("wait screen", () => wait.expectOpen());
    const asked = (await journey.step("questions while it checks", () => wait.answerAll(take.answers, mode === "record" ? 15 * 60_000 : 5 * 60_000)))!;
    // Their own basement restyled while it measures: two loved, one passed, and the board shows the two.
    const swiped = (await journey.step("swipe your style", async () => {
      await deck.expectOpen();
      return deck.swipeAll(["love", "pass", "love"]);
    }))!;
    // The server's word first, so a slow scan and a stuck screen fail differently.
    await expect
      .poll(async () => (await api(page, `/api/scans/${scanId}`)).status, { timeout: mode === "record" ? 15 * 60_000 : 5 * 60_000, intervals: [2_000] })
      .toBe("done");
    // On the wait screen it says it's measured; if the swipes were done on step 1, it's already past that.
    if (!swiped.wentBack) await journey.step("answer ready", () => wait.waitForAnswer(60_000));
    const toAnswerS = (Date.now() - started) / 1000;
    const events = await scanEvents(page.request, scanId);
    expect(events.filter((e) => e.type === "stage").map((e) => e.text)).toEqual(["prepare", "find", "assess"]);
    expect(events.some((e) => e.type === "find"), "SAM's finds were streamed").toBeTruthy();
    expect(events.some((e) => e.type === "model"), "the basement assembled in 3D").toBeTruthy();
    const frames = (events.find((e) => typeof e.data?.frameCount === "number")?.data.frameCount as number) ?? 0;
    // In record mode, only the calls that really went out make the times real-service times.
    journey.timing({ kind: "scan", take: take.id, mode, scanId, frames, uploadS, toAnswerS, realCalls: realCalls(started).length, milestones: milestones(events) });

    // ---- The flow: the plan check, a layout, the studio, the pictures, the book ----
    const scan = await api(page, `/api/scans/${scanId}`);
    const r = scan.result;
    await journey.step("is this your basement?", async () => {
      // Swiped on step 1 of the step bar (the wait screen had moved on): on to step 2 from there.
      if (swiped.wentBack) await flow.steps.getByRole("link", { name: /^Step 2: Is this your basement\?/ }).click();
      else await wait.checkPlan();
      await flow.plan().expectOpen();
    });
    if (r.capture?.photos) await journey.step("one tape number", () => flow.plan().tapeIfAsked("7.3"));
    // Muse Wonder's check of the plan lands after the answer (server/watchScan.ts), and the plan screen
    // waits a minute for its questions. Read them, as a homeowner would, before saying yes: then the
    // check is always made (and recorded), and what it adds to the permit list is always there.
    if (r.watch)
      await journey.step("the plan check's questions", () =>
        expect.poll(async () => (await api(page, `/api/scans/${scanId}`)).result?.planCheck !== undefined, { timeout: mode === "record" ? 5 * 60_000 : 2 * 60_000, intervals: [2_000] }).toBe(true),
      );
    await journey.step("plan confirmed", () => flow.plan().confirm());
    const layouts = flow.layouts();
    await journey.step("layouts, with the decision", async () => {
      await layouts.expectOpen();
      await expect(layouts.decision).toContainText(r.headline);
    });
    await journey.step("a picture of each layout", () => layouts.pictures());
    const picked = (await layouts.names())[0];
    await journey.step(`${picked} picked`, () => layouts.pick(picked));
    await journey.step("studio", async () => {
      await layouts.designIt();
      await flow.studio().expectOpen();
    });
    expect(await flow.studio().chosen()).toBe(picked);
    await journey.step("pictures", async () => {
      await flow.studio().toPictures();
      await flow.pictures().expectOpen();
    });
    await journey.step("book", async () => {
      await flow.pictures().toBook();
      await ws.expectOpen();
      await ws.book().expectOpen();
    });
    const facts = (await ws.book().facts())!;
    expect(facts["The design"]).toBe(picked);
    await expect(page.locator("main.workspace")).toHaveAttribute("data-verdict", r.verdict);

    // ---- The answer: the verdict and the measured rooms ----
    const withPlans = (r.rooms ?? []).filter((x: any) => x.plan);
    expect(withPlans.length, "rooms measured in 3D").toBeGreaterThan(0);
    await journey.step("the answer", async () => {
      await ws.open("The answer");
      await expect(ws.answer().verdict).toHaveText(r.headline);
    });
    const floor = (await journey.step("floor plan", () => ws.answer().floorPlan()))!;
    expect(floor.label).toMatch(new RegExp(`^Floor plan of the basement, ${withPlans.length} rooms?, `));
    // The photos of what it could look like, once they've landed.
    await expect.poll(async () => (await api(page, `/api/scans/${scanId}`)).result?.concepts?.status, { timeout: mode === "record" ? 10 * 60_000 : 2 * 60_000 }).not.toBe("pending");
    const concepts = (await api(page, `/api/scans/${scanId}`)).result?.concepts;
    // And the deck, once it's dealt every card it will.
    await expect.poll(async () => (await api(page, `/api/scans/${scanId}/cards`)).status, { timeout: mode === "record" ? 10 * 60_000 : 2 * 60_000 }).toMatch(/^(done|failed)$/);
    const deckNow = await api(page, `/api/scans/${scanId}/cards`);

    // ---- Permit: the owner once, the readiness count, then the review copy, opened ----
    // Saving the owner's details ticks "Owner details": the count is read from the first status the page
    // is sent with it ticked, once the heading shows it (WebKit can draw the old count for a moment).
    let sent: number | null = null;
    const onStatus = (res: Response) => {
      if (!new URL(res.url()).pathname.endsWith("/permit/status") || !res.ok()) return;
      void res.json().then(
        (s: { left: number; items: { id: string; done: boolean }[] }) => {
          if (s.items.find((i) => i.id === "owner")?.done !== false) sent = s.left;
        },
        () => {},
      );
    };
    page.on("response", onStatus);
    await journey.step("permit, owner asked once", async () => {
      await ws.open("Permit");
      await ws.fillProfileIfAsked();
      await ws.permit().expectOpen();
    });
    await expect.poll(async () => sent !== null && (await ws.permit().left()) === sent, { timeout: 15_000 }).toBe(true);
    page.off("response", onStatus);
    const left = await ws.permit().left();
    const pdf = (await journey.step("permit review copy downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-${take.id}-permit.pdf`))))!;
    expectSheets(pdf);

    await journey.step("money", async () => {
      await ws.open("Money");
      await ws.money().expectOpen();
    });
    await journey.step("build", async () => {
      await ws.open("Build");
      await ws.build().expectOpen();
    });

    // ---- The same as when it was recorded ----
    const count = (labels: string[]) => Object.fromEntries([...new Set(labels)].sort().map((l) => [l, labels.filter((x) => x === l).length]));
    // The answer as it stands now, priced on the design they picked (server/priced.ts).
    const now = (await api(page, `/api/scans/${scanId}`)).result;
    const pdfText = pdf.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ");
    const mark = (ok: boolean | null) => (ok === true ? "met" : ok === false ? "not met" : "to check");
    const outcome: Outcome = {
      verdict: r.verdict,
      headline: r.headline,
      rooms: (r.rooms ?? []).map((x: any) => ({ name: x.name, size: x.plan ? `${x.plan.widthM} × ${x.plan.depthM} m` : null })),
      finds: count((r.detections ?? []).map((d: any) => d.label)),
      asked,
      permit: { pages: pdf.pageCount, sheets: pdf.index, left },
      design: {
        name: picked,
        price: facts["Hired out"] ?? "",
        fixes: (now.fixGroups ?? []).map((g: { title: string }) => g.title),
        checks: (now.design?.layout?.checks ?? []).map((c: { label: string; ok: boolean | null }) => `${mark(c.ok)}: ${c.label}`),
        unitArea: /Unit 2 floor area (\S+ m² \([\d,]+ sq ft\))/.exec(pdfText)?.[1] ?? null,
        permitFee: /About (\$[\d,]+)\./.exec(pdfText)?.[1] ?? null,
      },
      photos: concepts?.items?.length ?? 0,
      cards: deckNow.cards.length,
    };
    if (take.truth) {
      const truth = JSON.parse(readFileSync(take.truth, "utf8"));
      info.annotations.push({ type: "measured vs true", description: `${outcome.rooms.map((x) => `${x.name} ${x.size}`).join("; ")} — true: ${truth.rooms.map((x: any) => `${x.name} ${x.widthM} × ${x.depthM} m`).join("; ")}` });
    }
    if (mode === "record") {
      saveOutcome(take, outcome);
      // What recording it cost: the calls that really went out (saved answers reused are free).
      journey.timing({ kind: "cost", take: take.id, frames, ...costOf(realCalls(started), frames, Boolean(process.env.E2E_SCAN3D_URL?.includes(".modal.run"))) });
    } else {
      // Everything the models decided, exactly as recorded. The pictures' counts are kept but not held
      // to: which frames get staged depends on what the 3D has measured by then (server/replay.ts looseKeys).
      const { photos, cards, ...decided } = outcome;
      const { photos: _p, cards: _c, ...recorded } = recordedOutcome(take)!;
      expect(decided, "the same as when it was recorded").toEqual(recorded);
      expect(photos, "photos of what it could look like").toBeGreaterThan(0);
      expect(cards, "cards dealt (three were swiped)").toBeGreaterThanOrEqual(3);
    }
  }
}
