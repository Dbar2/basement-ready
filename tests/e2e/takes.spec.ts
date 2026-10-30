// A real take, film to permit: the start sheet (or the iPhone app's post), the wait screen with its
// questions and the basement assembling, then every workspace tab. Recorded once against the real
// services; replayed, it must come out exactly as it did then.
import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { Home } from "./pages/Home";
import { WaitScreen } from "./pages/WaitScreen";
import { Workspace } from "./pages/Workspace";
import { api, expect, test } from "./support/fixtures";
import { mode, runDir } from "./support/run";
import { recordedOutcome, saveOutcome, TAKES, unavailable, type Outcome } from "./support/takes";
import { milestones, scanEvents } from "./support/timing";

for (const take of TAKES) {
  test(`${take.label}: film to permit`, async ({ page, journey }, info) => {
    const why = unavailable(take);
    test.skip(why !== null, why ?? "");
    test.slow(); // a whole scan, then five tabs
    const home = new Home(page);
    const wait = new WaitScreen(page);
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
      scanId = (await res.json()).id;
      await journey.step("posted like the app, wait screen", () => page.goto(`/scans/${scanId}`));
    }
    const uploadS = (Date.now() - started) / 1000;

    // ---- The wait screen: stages, its questions, the basement assembling, the answer ----
    await journey.step("wait screen", () => wait.expectOpen());
    const asked = (await journey.step("questions while it checks", () => wait.answerAll(take.answers, mode === "record" ? 15 * 60_000 : 5 * 60_000)))!;
    await journey.step("answer ready", () => wait.waitForAnswer(mode === "record" ? 15 * 60_000 : 5 * 60_000));
    const toAnswerS = (Date.now() - started) / 1000;
    const events = await scanEvents(page.request, scanId);
    expect(events.filter((e) => e.type === "stage").map((e) => e.text)).toEqual(["prepare", "find", "assess"]);
    expect(events.some((e) => e.type === "find"), "SAM's finds were streamed").toBeTruthy();
    expect(events.some((e) => e.type === "model"), "the basement assembled in 3D").toBeTruthy();
    journey.timing({ kind: "scan", take: take.id, mode, scanId, uploadS, toAnswerS, milestones: milestones(events) });

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

    // ---- Permit: the owner once, then the package, opened ----
    await journey.step("permit, owner asked once", async () => {
      await ws.open("Permit");
      await ws.fillProfileIfAsked();
      await ws.permit().expectOpen();
    });
    const pdf = (await journey.step("permit package downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-${take.id}-permit.pdf`))))!;
    expect(pdf.pageCount).toBeGreaterThanOrEqual(8);
    expect(pdf.index).toMatchObject({ A0: "Cover and key plan", A2: "Existing basement plan", A3: "Proposed basement plan" });
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
    if (mode === "record") saveOutcome(take, outcome);
    else expect(outcome, "the same as when it was recorded").toEqual(recordedOutcome(take));
  });
}
