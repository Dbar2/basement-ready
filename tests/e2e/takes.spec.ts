// A real take, film to permit: the start sheet (or the iPhone app's post), the wait screen with its
// questions and the basement assembling, then every workspace tab. Recorded once against the real
// services; replayed, it must come out exactly as it did then.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Home } from "./pages/Home";
import { StyleDeck } from "./pages/StyleDeck";
import { WaitScreen } from "./pages/WaitScreen";
import { expectSheets, Workspace } from "./pages/Workspace";
import { api, expect, test } from "./support/fixtures";
import { costOf, realCalls } from "./support/costs";
import { mode, runDir } from "./support/run";
import { recordedOutcome, saveOutcome, TAKES, unavailable, type Outcome } from "./support/takes";
import { milestones, scanEvents } from "./support/timing";

for (const take of TAKES) {
  test(`${take.label}: film to permit`, async ({ page, journey }, info) => {
    const why = unavailable(take);
    test.skip(why !== null, why ?? "");
    test.slow(); // a whole scan, then five tabs
    // Without the file in this tab (the app path), the wait screen asks for the server's copy of the video
    // every 2 s until it's saved (src/screens/LiveScan.tsx): those 404s are expected.
    journey.allowConsole(/status of 404 .*@ .*\/api\/scans\/[0-9a-f-]+\/video$/);
    // Known, dev only: after an upload the wait screen plays the file through a blob URL that it makes in
    // useMemo and revokes in an effect cleanup, which React's StrictMode runs once on mount
    // (src/screens/LiveScan.tsx), so the video is blank under `pnpm dev`. Production builds don't do that.
    journey.allowConsole(/ERR_FILE_NOT_FOUND @ blob:|WebKitBlobResource error/);
    const home = new Home(page);
    const wait = new WaitScreen(page);
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
    const uploadS = (Date.now() - started) / 1000;

    // ---- The wait screen: stages, its questions, the basement assembling, the answer ----
    await journey.step("wait screen", () => wait.expectOpen());
    const asked = (await journey.step("questions while it checks", () => wait.answerAll(take.answers, mode === "record" ? 15 * 60_000 : 5 * 60_000)))!;
    // Their own basement restyled while it measures: two loved, one passed, and the board shows the two.
    await journey.step("swipe your style", async () => {
      await deck.expectOpen();
      await deck.swipeAll(["love", "pass", "love"]);
    });
    // The server's word first, so a slow scan and a stuck screen fail differently.
    await expect
      .poll(async () => (await api(page, `/api/scans/${scanId}`)).status, { timeout: mode === "record" ? 15 * 60_000 : 5 * 60_000, intervals: [2_000] })
      .toBe("done");
    await journey.step("answer ready", () => wait.waitForAnswer(60_000));
    const toAnswerS = (Date.now() - started) / 1000;
    const events = await scanEvents(page.request, scanId);
    expect(events.filter((e) => e.type === "stage").map((e) => e.text)).toEqual(["prepare", "find", "assess"]);
    expect(events.some((e) => e.type === "find"), "SAM's finds were streamed").toBeTruthy();
    expect(events.some((e) => e.type === "model"), "the basement assembled in 3D").toBeTruthy();
    const frames = (events.find((e) => typeof e.data?.frameCount === "number")?.data.frameCount as number) ?? 0;
    // In record mode, only the calls that really went out make the times real-service times.
    journey.timing({ kind: "scan", take: take.id, mode, scanId, frames, uploadS, toAnswerS, realCalls: realCalls(started).length, milestones: milestones(events) });

    // ---- Your plan: the verdict and the measured rooms ----
    await journey.step("your plan", () => wait.seePlan());
    await ws.expectOpen();
    const scan = await api(page, `/api/scans/${scanId}`);
    const r = scan.result;
    await expect(ws.plan().verdict).toHaveText(r.headline);
    await expect(page.locator("main.workspace")).toHaveAttribute("data-verdict", r.verdict);
    const withPlans = (r.rooms ?? []).filter((x: any) => x.plan);
    expect(withPlans.length, "rooms measured in 3D").toBeGreaterThan(0);
    const floor = (await journey.step("floor plan", () => ws.plan().floorPlan()))!;
    expect(floor.label).toMatch(new RegExp(`^Floor plan of the basement, ${withPlans.length} rooms?, `));

    // ---- Ideas: the photos of what it could look like, once they've landed ----
    await journey.step("ideas", async () => {
      await ws.open("Ideas");
      await ws.ideas().expectOpen();
    });
    await expect.poll(async () => (await api(page, `/api/scans/${scanId}`)).result?.concepts?.status, { timeout: mode === "record" ? 10 * 60_000 : 2 * 60_000 }).not.toBe("pending");
    const concepts = (await api(page, `/api/scans/${scanId}`)).result?.concepts;
    // And the deck, once it's dealt every card it will.
    await expect.poll(async () => (await api(page, `/api/scans/${scanId}/cards`)).status, { timeout: mode === "record" ? 10 * 60_000 : 2 * 60_000 }).toMatch(/^(done|failed)$/);
    const deckNow = await api(page, `/api/scans/${scanId}/cards`);

    // ---- Permit: the owner once, then the package, opened ----
    await journey.step("permit, owner asked once", async () => {
      await ws.open("Permit");
      await ws.fillProfileIfAsked();
      await ws.permit().expectOpen();
    });
    const left = await ws.permit().left();
    const pdf = (await journey.step("permit package downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-${take.id}-permit.pdf`))))!;
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
    const outcome: Outcome = {
      verdict: r.verdict,
      headline: r.headline,
      rooms: (r.rooms ?? []).map((x: any) => ({ name: x.name, size: x.plan ? `${x.plan.widthM} × ${x.plan.depthM} m` : null })),
      finds: count((r.detections ?? []).map((d: any) => d.label)),
      asked,
      permit: { pages: pdf.pageCount, sheets: pdf.index, left },
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
    } else expect(outcome, "the same as when it was recorded").toEqual(recordedOutcome(take));
  });
}
