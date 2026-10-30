// The sample basement, start to finish, through the one flow: the wait screen, the plan check, a layout,
// the studio, the pictures, the book, then the permit, money and build tabs and the answer. It never
// calls a model (its pictures are committed), so it runs anywhere for free.
import { join } from "node:path";
import { Flow } from "./pages/Flow";
import { Home } from "./pages/Home";
import { StyleDeck } from "./pages/StyleDeck";
import { WaitScreen } from "./pages/WaitScreen";
import { expectSheets, Workspace } from "./pages/Workspace";
import { runDir } from "./support/run";
import { expect, test } from "./support/fixtures";
import sample from "../../public/samples/sample/result.json" with { type: "json" };

test("the sample basement: wait screen, plan, layout, studio, pictures, book, permit, money, build", async ({ page, journey }, info) => {
  const home = new Home(page);
  const wait = new WaitScreen(page);
  const flow = new Flow(page);
  const ws = new Workspace(page);
  const deck = new StyleDeck(page);

  await journey.step("home", () => home.open());
  await journey.step("sample wait screen", async () => {
    await home.trySample();
    await wait.expectOpen();
    await flow.expectStep(1, "Swipe your style");
  });
  const asked = await journey.step("wait screen questions", () => wait.answerAll());
  expect(asked!.length, "the sample asks at least one question").toBeGreaterThan(0);
  await journey.step("swipe your style: two loved, one passed", async () => {
    await deck.expectOpen();
    await deck.swipeAll(["love", "pass", "love"]);
  });
  await journey.step("answer ready", () => wait.waitForAnswer(60_000));

  // ---- 2. Is this your basement? The measured room, its overall width and depth on the drawing ----
  await journey.step("is this your basement?", async () => {
    await wait.checkPlan();
    await flow.plan().expectOpen();
    await flow.expectStep(2, "Is this your basement?");
  });
  const drawing = (await flow.plan().drawing())!;
  const box = sample.rooms[0].plan.box;
  expect(drawing.label).toMatch(/^Your basement's plan, /);
  expect(drawing.texts).toEqual(expect.arrayContaining([`${(box.maxX - box.minX).toFixed(2)} m`, `${(box.maxZ - box.minZ).toFixed(2)} m`]));
  await journey.step("plan confirmed", () => flow.plan().confirm());

  // ---- 3. Pick a layout: the decision beside the cards, a picture on each ----
  const layouts = flow.layouts();
  await journey.step("layouts", async () => {
    await layouts.expectOpen();
    await expect(layouts.decision).toContainText(sample.headline);
  });
  const captions = (await journey.step("a picture of each layout", () => layouts.pictures()))!;
  expect(captions.every((c) => /Virtually staged/.test(c)), captions.join(" | ")).toBe(true);
  const names = (await layouts.names())!;
  expect(names).toEqual(expect.arrayContaining(["One bedroom", "Studio"]));
  await journey.step("studio picked", () => layouts.pick("Studio"));
  // Every screen's total for the picked design, as its raw numbers (data-low/data-high): one quote.
  const totals: Record<string, string> = {};
  const total = async (where: string, scope: import("@playwright/test").Locator) => {
    const el = scope.locator("[data-total]").first();
    await expect(el).toBeVisible();
    totals[where] = `${await el.getAttribute("data-low")}–${await el.getAttribute("data-high")}`;
  };
  await total("layout card", page.locator(".layout-card[data-chosen]"));
  // The decision is priced again for the pick: it catches up with the card, or the test fails.
  await expect(layouts.decision.locator("[data-total]")).toHaveAttribute("data-low", totals["layout card"].split("–")[0], { timeout: 15_000 });
  await total("the decision beside it", layouts.decision);

  // ---- 4. The studio opens on it, checked and priced ----
  await journey.step("studio", async () => {
    await layouts.designIt();
    await flow.studio().expectOpen();
    await flow.expectStep(4, "Your design in 3D");
  });
  expect(await flow.studio().chosen()).toBe("Studio");
  await expect(flow.studio().cost).toHaveText(/^\$[\d.]+k–\$[\d.]+k hired out$/);
  await total("studio", flow.studio().cost);

  // ---- 5. Pictures of it ----
  await journey.step("pictures", async () => {
    await flow.studio().toPictures();
    await flow.pictures().expectOpen();
  });
  const labels = (await flow.pictures().labels())!;
  expect(labels.length).toBeGreaterThan(0);
  expect(new Set(labels)).toEqual(new Set(["Virtually staged"]));

  // ---- 6. The book, on the design they picked ----
  await journey.step("book", async () => {
    await flow.pictures().toBook();
    await ws.expectOpen();
    await ws.book().expectOpen();
  });
  const facts = (await ws.book().facts())!;
  const bookPermit = await ws.book().permitLine();
  await total("book", ws.book().cover);
  expect(facts["The design"]).toBe("Studio");

  // The book counts what the Permit tab counts.
  const [ready, checks] = (/^(\d+) of (\d+) checks ready$/.exec(facts.Permit) ?? []).slice(1).map(Number);
  await journey.step("permit, with the same count as the book", async () => {
    await ws.open("Permit");
    await ws.permit().expectOpen();
    expect(checks - ready).toBe(await ws.permit().left());
  });
  await journey.step("permit, owner asked once", async () => {
    await ws.fillProfileIfAsked();
    await ws.permit().expectOpen();
  });
  const pdf = await journey.step("permit review copy downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-sample-permit.pdf`)));
  expectSheets(pdf!);
  journey.timing({ take: "sample", kind: "permit", pages: pdf!.pageCount, sheets: pdf!.index });

  await journey.step("money", async () => {
    await ws.open("Money");
    await ws.money().expectOpen();
  });

  // One unit area and one fee: Money's permit step, the book's quote and the permit set's cover and fee.
  const moneyPermit = await ws.money().permitStep();
  const sqft = /for about ([\d,]+) sq ft/.exec(moneyPermit.note)?.[1];
  const fee = /\$[\d,]+$/.exec(moneyPermit.meta)?.[0];
  expect(sqft, moneyPermit.note).toBeTruthy();
  expect(fee, moneyPermit.meta).toBeTruthy();
  expect(bookPermit.amount).toBe(fee);
  expect(bookPermit.basis).toContain(`(${sqft} sq ft)`);
  const pdfText = pdf!.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ");
  expect(pdf!.pages[0].text.replace(/\s+/g, " ")).toContain(`(${sqft} sq ft)`);
  expect(pdfText).toContain(`About ${fee}.`);
  expect(pdfText).toContain(`for about ${sqft} sq ft`);
  await journey.step("build", async () => {
    await ws.open("Build");
    await ws.build().expectOpen();
  });
  await journey.step("the answer", async () => {
    await ws.open("The answer");
    await expect(page.locator("main.workspace")).toHaveAttribute("data-verdict", /^(yes|fix|no)$/);
    await expect(ws.answer().verdict).toHaveText(/second home/);
    await expect(ws.answer().scanned).toBeVisible();
  });

  await total("the answer", page.locator("section.decision"));
  // The layouts, the studio, the book and the answer show the same total for the same design.
  expect(Object.keys(totals)).toHaveLength(5);
  expect(new Set(Object.values(totals)), JSON.stringify(totals)).toEqual(new Set([totals.book]));

  // ---- Coming back lands where they left off ----
  await journey.step("back on the pictures, then a return visit", async () => {
    await flow.back.click();
    await expect(page).toHaveURL(/\/pictures$/);
    await flow.pictures().expectOpen();
    await page.goto("/scans/sample");
    await expect(page).toHaveURL(/\/pictures$/, { timeout: 30_000 });
  });
});
