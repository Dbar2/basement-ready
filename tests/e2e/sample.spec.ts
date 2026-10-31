// The example basement through the guide: the answer, the design and every Build card to the book, then a
// return visit. Scripted (server/guide/sample.ts): it never calls a model, so it runs anywhere for free.
import { join } from "node:path";
import { expectSheets, Guide } from "./pages/Guide";
import { Home } from "./pages/Home";
import { expect, test } from "./support/fixtures";
import { runDir } from "./support/run";

test("the example through the guide: answer, design, build, the book", async ({ page, journey }, info) => {
  test.slow(); // every Build card, each saved and answered
  const home = new Home(page);
  const guide = new Guide(page);

  await journey.step("home", () => home.open());
  await journey.step("try the example", () => home.trySample());
  await journey.step("the example's guide", () => guide.open("sample"));
  expect(await guide.milestone()).toBe("Answer");

  const walked = await guide.walk({ answers: {}, saveAs: (w) => join(runDir, "downloads", `${info.project.name}-sample-${w}.pdf`), step: journey.step, measuringMs: 60_000 });

  // The answer, said with its price; a design used; every Build card to the book.
  expect(walked.answer?.headline, "the answer's headline").toMatch(/second home/);
  expect(walked.answer?.said, "the answer's price").toMatch(/roughly \$[\d.,]+k?[–-]\$[\d.,]+k?/);
  expect(walked.design.recommended, "a layout used").toBeTruthy();
  expect(walked.stopped, "nothing the walk couldn't get past").toBeNull();
  expect(walked.build).toEqual(expect.arrayContaining(["permit set", "tape", "owner", "review", "book"]));
  // A Waterloo house: no water-meter question (Kitchener's, Building Bulletin BB 2026-04).
  expect(walked.build).not.toContain("water");
  expectSheets(walked.pdfs.review!);
  if (walked.pdfs.submit) expectSheets(walked.pdfs.submit);
  expect(walked.pdfs.book?.pageCount, "the book's pages").toBeGreaterThan(3);
  expect(await guide.milestone()).toBe("Build");

  // ---- Coming back lands where they left off ----
  await journey.step("a return visit", async () => {
    await page.reload();
    await guide.expectOpen();
    await expect(guide.live.locator('[data-card="download"]')).toBeVisible();
    expect(await guide.milestone()).toBe("Build");
  });
});
