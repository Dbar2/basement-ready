// The sample basement, start to finish: it never calls a model, so it runs anywhere for free.
import { join } from "node:path";
import { Home } from "./pages/Home";
import { StyleDeck } from "./pages/StyleDeck";
import { WaitScreen } from "./pages/WaitScreen";
import { expectSheets, Workspace } from "./pages/Workspace";
import { runDir } from "./support/run";
import { expect, test } from "./support/fixtures";
import sample from "../../public/samples/sample/result.json" with { type: "json" };

test("the sample basement: wait screen, plan, ideas, permit, money, build", async ({ page, journey }, info) => {
  const home = new Home(page);
  const wait = new WaitScreen(page);
  const ws = new Workspace(page);
  const deck = new StyleDeck(page);

  await journey.step("home", () => home.open());
  await journey.step("sample wait screen", async () => {
    await home.trySample();
    await wait.expectOpen();
  });
  const asked = await journey.step("wait screen questions", () => wait.answerAll());
  expect(asked!.length, "the sample asks at least one question").toBeGreaterThan(0);
  await journey.step("swipe your style: two loved, one passed", async () => {
    await deck.expectOpen();
    await deck.swipeAll(["love", "pass", "love"]);
  });
  await journey.step("answer ready", () => wait.waitForAnswer(60_000));

  await journey.step("your plan", async () => {
    await wait.seePlan();
    await ws.expectOpen();
    await expect(page.locator("main.workspace")).toHaveAttribute("data-verdict", /^(yes|fix|no)$/);
    await expect(ws.plan().verdict).toHaveText(/second home/);
    await expect(ws.plan().scanned).toBeVisible();
  });
  // The rooms and their sizes, as measured: one room, its overall width and depth on the drawing.
  const plan = await journey.step("floor plan", () => ws.plan().floorPlan());
  const box = sample.rooms[0].plan.box;
  expect(plan!.label).toMatch(/^Floor plan of the basement, 1 rooms?, /);
  expect(plan!.texts).toEqual(expect.arrayContaining([`${(box.maxX - box.minX).toFixed(2)} m`, `${(box.maxZ - box.minZ).toFixed(2)} m`]));

  await journey.step("ideas", async () => {
    await ws.open("Ideas");
    await ws.ideas().expectOpen();
  });

  await journey.step("permit, owner asked once", async () => {
    await ws.open("Permit");
    await ws.fillProfileIfAsked();
    await ws.permit().expectOpen();
  });
  expect(await ws.permit().left(), "things left before the submit copy").toBeGreaterThanOrEqual(0);
  const pdf = await journey.step("permit package downloaded", () => ws.permit().downloadPackage(join(runDir, "downloads", `${info.project.name}-sample-permit.pdf`)));
  expectSheets(pdf!);
  journey.timing({ take: "sample", kind: "permit", pages: pdf!.pageCount, sheets: pdf!.index });

  await journey.step("money", async () => {
    await ws.open("Money");
    await ws.money().expectOpen();
  });
  await journey.step("build", async () => {
    await ws.open("Build");
    await ws.build().expectOpen();
  });
});
