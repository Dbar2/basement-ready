// A real take, film to permit: the start sheet (or the iPhone app's post), the wait screen with its
// questions and the basement assembling, then every workspace tab. Recorded once against the real
// services; replayed, it must come out exactly as it did then.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Flow } from "./pages/Flow";
import { Home } from "./pages/Home";
import { WaitScreen } from "./pages/WaitScreen";
import { Workspace } from "./pages/Workspace";
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
    const flow = new Flow(page);
    const ws = new Workspace(page);

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

    // ---- The flow: the plan check, a layout, the studio, the pictures, the book ----
    const scan = await api(page, `/api/scans/${scanId}`);
    const r = scan.result;
    await journey.step("is this your basement?", async () => {
      await wait.checkPlan();
      await flow.plan().expectOpen();
    });
    if (r.capture?.photos) await journey.step("one tape number", () => flow.plan().tapeIfAsked("7.3"));
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
    expect((await ws.book().facts())["The design"]).toBe(picked);
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

    // ---- Permit: the owner once, the readiness count, then the review copy, opened ----
    await journey.step("permit, owner asked once", async () => {
      await ws.open("Permit");
      await ws.fillProfileIfAsked();
      await ws.permit().expectOpen();
    });
    const pdf = (await journey.step("permit review copy downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-${take.id}-permit.pdf`))))!;
    expect(pdf.pageCount).toBeGreaterThanOrEqual(8);
    expect(pdf.index).toMatchObject({ A0: "Cover, key plan and project data", A2: "Basement plan: unit 2", A3: "Main floor: unit 1 (schematic)" });
    expect(pdf.sheets.map((s) => s.number)).toEqual(Object.keys(pdf.index));

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
      permit: { pages: pdf.pageCount, sheets: pdf.index },
      photos: concepts?.items?.length ?? 0,
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
