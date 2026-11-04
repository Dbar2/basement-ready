// A real take, film to permit, through the guide: the start sheet (or the iPhone app's post), then the
// guide's three milestones: the answer with its wait questions, the design (is this your basement, a
// layout, a look), and the Build cards to the submit copy and the book. Recorded once against the real
// services; replayed, it must come out exactly as it did then.
import { readFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { checkDesign } from "../../server/model/checks";
import { chosenDesign } from "../../server/model/legacy";
import type { Model } from "../../server/model/types";
import { expectSheets, Guide, sheetText } from "./pages/Guide";
import { Home } from "./pages/Home";
import { costOf, realCalls } from "./support/costs";
import { claimedApi, claimsHeader, expect, missesFor, oneAtATime, test, type Journey } from "./support/fixtures";
import { mode, runDir } from "./support/run";
import { recordedOutcome, saveOutcome, TAKES, unavailable, type Outcome } from "./support/takes";
import { milestones, scanEvents } from "./support/timing";

// Kitchener asks how the two units' water is metered (Building Bulletin BB 2026-04); Waterloo doesn't.
const METER = "single meter option, one water meter for both units, at unit 1's furnace room.";

for (const take of TAKES) {
  test(`${take.label}: film to permit`, async ({ page, journey }, info) => {
    const why = unavailable(take, info.project.name);
    test.skip(why !== null, why ?? "");
    test.slow(); // a whole scan, then every Build card, and maybe a wait for another take to finish
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
    // Without the file in this tab (the app path), the guide's video asks for the server's copy until it's
    // saved (src/guide/visuals/VideoFinds.tsx): those 404s are expected.
    journey.allowConsole(/status of 404 .*@ .*\/api\/scans\/[0-9a-f-]+\/video$/);
    // Known, WebKit only: leaving the uploaded video revokes its blob URL while WebKit's video element is
    // still reading it. The page has moved on; nothing is lost.
    if (info.project.name.startsWith("webkit")) journey.allowConsole(/WebKitBlobResource error 1\.\) @ blob:/);
    const home = new Home(page);
    const guide = new Guide(page);

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
          municipality: take.municipality ?? "waterloo-on",
          lens: "wide",
        },
      });
      expect(res.ok(), `POST /api/scans → ${res.status()}`).toBeTruthy();
      const posted = await res.json();
      scanId = posted.id;
      // The same device: its claim kept where the web app keeps it (src/api.ts rememberClaim). A scan is
      // private: without it, every page and request about the scan is a 404.
      await page.goto("/");
      await page.evaluate((claim) => localStorage.setItem("br-claims", JSON.stringify([claim])), { basementId: posted.basementId, claimToken: posted.claimToken });
    }
    made(scanId);
    const uploadS = (Date.now() - started) / 1000;

    // ---- The guide, from the questions while it measures to the book ----
    await journey.step("the guide", () => guide.open(scanId));
    const kitchener = (take.municipality ?? "waterloo-on").startsWith("kitchener");
    const pdf = (which: string) => join(runDir, "downloads", `${info.project.name}-${take.id}-${which}.pdf`);
    const walked = await guide.walk({
      answers: take.answers,
      saveAs: pdf,
      step: journey.step,
      measuringMs: mode === "record" ? 15 * 60_000 : 5 * 60_000,
      waterMeter: kitchener ? { option: "One meter for both", where: "unit 1's furnace room" } : undefined,
    });
    expect(walked.answer, "the guide gave its answer").not.toBeNull();

    // Where the time went, from the scan's own event log.
    const events = await scanEvents(page.request, scanId, await claimsHeader(page));
    expect(events.filter((e) => e.type === "stage").map((e) => e.text)).toEqual(["prepare", "find", "assess"]);
    expect(events.some((e) => e.type === "find"), "SAM's finds were streamed").toBeTruthy();
    const frames = (events.find((e) => typeof e.data?.frameCount === "number")?.data.frameCount as number) ?? 0;
    const toAnswerS = (events.find((e) => e.type === "done")?.at as number | undefined) ?? null;
    journey.timing({ kind: "scan", take: take.id, mode, scanId, frames, uploadS, toAnswerS, realCalls: realCalls(started).length, milestones: milestones(events) });

    // ---- The permit set: the review copy, the submit copy, Kitchener's water meter on A1 and A2 ----
    const review = walked.pdfs.review;
    expect(review, "the review copy was downloaded").toBeTruthy();
    expectSheets(review!);
    const submit = walked.pdfs.submit ?? null;
    if (submit) {
      expectSheets(submit);
      for (const n of ["A1", "A2"]) {
        if (kitchener) expect(sheetText(submit, n), `${n}: the water meter`).toContain(METER);
        else expect(sheetText(submit, n), `${n}: no water meter`).not.toContain("Water meter");
      }
    }
    if (kitchener) expect(walked.build, "Kitchener asks about the water meter").toContain("water");
    else expect(walked.build, "Waterloo doesn't ask about the water meter").not.toContain("water");

    // ---- The same as when it was recorded ----
    const r = (await claimedApi(page, `/api/scans/${scanId}`)).result;
    const count = (labels: string[]) => Object.fromEntries([...new Set(labels)].sort().map((l) => [l, labels.filter((x) => x === l).length]));
    const mark = (ok: boolean | null) => (ok === true ? "met" : ok === false ? "not met" : "to check");
    // Every check the studio runs on the design they used, the service room's among them.
    const saved = (await claimedApi(page, `/api/scans/${scanId}/model`)).model as Model;
    const chosen = chosenDesign(saved)!;
    if (walked.design.recommended) expect(chosen.name).toBe(walked.design.recommended);
    const reviewText = review!.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ");
    const bookText = walked.pdfs.book?.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ") ?? "";
    const outcome: Outcome = {
      verdict: r.verdict,
      headline: r.headline,
      rooms: (r.rooms ?? []).map((x: any) => ({ name: x.name, size: x.plan ? `${x.plan.widthM} × ${x.plan.depthM} m` : null })),
      finds: count((r.detections ?? []).map((d: any) => d.label)),
      asked: walked.asked,
      answer: walked.answer!.said,
      design: {
        name: chosen.name,
        look: walked.design.look,
        price: /Hired out (\$[\d.,]+k?[–-]\$[\d.,]+k?)/.exec(bookText)?.[1] ?? null,
        fixes: (r.fixGroups ?? []).map((g: { title: string }) => g.title),
        checks: checkDesign(chosen, saved.existing).map((c) => `${mark(c.ok)}: ${c.label}`),
        unitArea: /([\d.]+ m² \([\d,]+ sq ft\))/.exec(review!.pages[0].text.replace(/\s+/g, " "))?.[1] ?? null,
        permitFee: /About (\$[\d,]+)\./.exec(reviewText)?.[1] ?? null,
      },
      build: walked.build,
      stopped: walked.stopped,
      permit: { pages: review!.pageCount, sheets: review!.index, submitPages: submit?.pageCount ?? null },
      water: walked.water,
      book: walked.pdfs.book?.pageCount ?? null,
      photos: r.concepts?.items?.length ?? 0,
    };
    if (take.truth) {
      const truth = JSON.parse(readFileSync(take.truth, "utf8"));
      info.annotations.push({ type: "measured vs true", description: `${outcome.rooms.map((x) => `${x.name} ${x.size}`).join("; ")} — true: ${truth.rooms.map((x: any) => `${x.name} ${x.widthM} × ${x.depthM} m`).join("; ")}` });
    }
    if (mode === "record") {
      saveOutcome(take, outcome);
      // What recording it cost: the calls that really went out (saved answers reused are free).
      journey.timing({ kind: "cost", take: take.id, frames, ...costOf(realCalls(started), frames, Boolean(process.env.E2E_SCAN3D_URL?.includes(".modal.run"))) });
    } else if (process.env.E2E_REWRITE === "1") {
      // The product changed on purpose and nothing new is asked of a model: the outcome is written from a
      // replay, which never calls the network, so it can't cost anything. Never from a replay that missed.
      expect(missesFor(`${info.testId}-${info.retry}`), "no missing answers before writing the outcome").toBe(0);
      saveOutcome(take, outcome);
    } else {
      // Everything the models decided, exactly as recorded. The photos' count is kept but not held to: which
      // frames get staged depends on what the 3D has measured by then (server/replay.ts looseKeys).
      const { photos: _p, ...decided } = outcome;
      const { photos: _q, ...recorded } = recordedOutcome(take)!;
      expect(decided, "the same as when it was recorded").toEqual(recorded);
    }
  }
}
