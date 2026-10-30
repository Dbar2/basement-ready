// Swipe your style, then pick a layout, in real browsers: Chromium on a phone (390) and a computer
// (1280), WebKit on a phone. Swipes ten cards (by drag, by button, by arrow key), checks the board
// builds and reads a style, opens one card big, picks a layout, and fails on any console error.
// Usage: BASE_URL=http://localhost:5183 tsx scripts/try-ideas.ts [scanId]   (the example by default)
// A real scan needs this browser to hold its claim: CLAIM=basementId:claimToken. Its layout pictures
// are made with Muse Image (about $0.01 each).
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Browser, type Page } from "playwright";

// Whatever full Chromium Playwright has cached (its headless shell may not be); WebKit as installed.
const cache = join(homedir(), "Library/Caches/ms-playwright");
const chrome = ["chromium-1243", "chromium-1208"].map((d) => join(cache, d, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")).find(existsSync);
const safari = ["webkit-2248", "webkit-2359"].map((d) => join(cache, d, "pw_run.sh")).find(existsSync);
const only = process.env.ONLY;

const base = process.env.BASE_URL ?? "http://localhost:5173";
const scanId = process.argv[2] ?? "sample";
const out = "tmp/ideas";
mkdirSync(out, { recursive: true });

type Run = { name: string; engine: "chromium" | "webkit"; width: number; height: number; touch: boolean };
const runs: Run[] = [
  { name: "chromium-390", engine: "chromium", width: 390, height: 844, touch: true },
  { name: "chromium-1280", engine: "chromium", width: 1280, height: 860, touch: false },
  { name: "webkit-390", engine: "webkit", width: 390, height: 844, touch: true },
];

// A drag the way a finger or mouse does it: down on the card, across in steps, up.
async function drag(page: Page, dx: number) {
  const card = page.locator(".deck-card[data-top]");
  const box = (await card.boundingBox())!;
  const x = box.x + box.width / 2, y = box.y + box.height * 0.4;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y + i);
  await page.mouse.up();
}

async function topTitle(page: Page) {
  return (await page.locator(".deck-card[data-top] h3").textContent())?.trim() ?? "";
}

async function swipeOne(page: Page, i: number) {
  await page.waitForSelector(".deck-card[data-top]:not([data-waiting])", { timeout: 60_000 });
  const before = await topTitle(page);
  const count = await page.locator(".deck-count").textContent();
  // Mix the three ways: drag, button, key; love two in three.
  const love = i % 3 !== 1;
  if (i % 3 === 0) await drag(page, love ? 260 : -260);
  else if (i % 3 === 1) await page.getByRole("button", { name: love ? /Love it/ : /Not for me/ }).first().click();
  else await page.keyboard.press(love ? "ArrowRight" : "ArrowLeft");
  await page.waitForFunction((c) => document.querySelector(".deck-count")?.textContent !== c, count, { timeout: 5000 });
  return { before, love };
}

async function one(browser: Browser, run: Run) {
  const context = await browser.newContext({ viewport: { width: run.width, height: run.height }, deviceScaleFactor: 2, hasTouch: run.touch });
  const claim = process.env.CLAIM?.split(":");
  if (claim) await context.addInitScript((c) => localStorage.setItem("br-claims", JSON.stringify([{ basementId: c[0], claimToken: c[1] }])), claim);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 200)}`));
  await page.goto(`${base}/scans/${scanId}/ideas`);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.waitForSelector(".deck-card[data-top]");
  await page.screenshot({ path: `${out}/${run.name}-1-deck.png` });

  let loved = 0;
  for (let i = 0; i < 10; i++) {
    const { love } = await swipeOne(page, i);
    if (love) loved++;
    if (i === 4) await page.waitForTimeout(900);
    if (i === 4) await page.screenshot({ path: `${out}/${run.name}-2-midway.png` });
  }
  const tiles = await page.locator(".board-tile").count();
  if (tiles !== loved) problems.push(`board has ${tiles} cards, ${loved} were loved`);
  const reads = (await page.locator(".board-reads").textContent()) ?? "";
  if (!/Reads as/.test(reads)) problems.push(`board doesn't read a style: "${reads}"`);
  // Every picture on the board says it's virtually staged.
  const labels = await page.locator(".board-tile .mono").allTextContents();
  if (labels.some((l) => !/virtually staged/i.test(l))) problems.push("a board picture isn't labelled virtually staged");

  // Undo brings the last card back.
  const lastCount = await page.locator(".deck-count").textContent();
  await page.getByRole("button", { name: "Undo" }).click();
  await page.waitForFunction((c) => document.querySelector(".deck-count")?.textContent !== c, lastCount);
  // One card big, then close it.
  await page.waitForSelector(".deck-card[data-top]:not([data-waiting])");
  await page.locator(".deck-card[data-top]").click();
  await page.waitForSelector("dialog.card-dialog[open]");
  await page.screenshot({ path: `${out}/${run.name}-3-bigger.png` });
  await page.getByRole("button", { name: "Love it" }).last().click();
  await page.waitForSelector("dialog.card-dialog", { state: "detached" });

  // Reorder the board and take one off.
  if ((await page.locator(".board-tile").count()) > 2) {
    await page.locator(".board-tile").nth(1).getByRole("button", { name: /earlier/ }).click();
    await page.locator(".board-tile").nth(2).getByRole("button", { name: /off the board/ }).click();
  }
  await page.locator(".ideas-board").scrollIntoViewIfNeeded();
  await page.waitForTimeout(900); // the board settles
  // Viewport shots: a full-page one resizes the window, which sets the board's tiles moving again.
  await page.screenshot({ path: `${out}/${run.name}-4-board.png` });

  // Pick a layout.
  await page.getByRole("button", { name: /Pick a layout/ }).click();
  await page.waitForSelector(".layout-card");
  const options = await page.locator(".layout-card h3").allTextContents();
  if (options.length < 3) problems.push(`only ${options.length} layouts`);
  await page.waitForFunction(() => [...document.querySelectorAll(".layout-card .pic")].every((p) => p.hasAttribute("data-ready")), null, { timeout: 90_000 }).catch(() => problems.push("a layout's picture never loaded"));
  await page.locator(".layouts").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${run.name}-5-layouts.png` });
  await page.locator(".layout-card").nth(1).getByRole("button", { name: /Pick this layout/ }).click();
  await page.waitForSelector(".layouts-done");
  const saved = await page.locator(".layouts-done").textContent();
  await page.locator(".layouts-done").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${out}/${run.name}-6-picked.png` });

  // Nothing wider than the screen.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`page scrolls sideways by ${overflow}px`);
  await context.close();
  return { run: run.name, loved, tiles, reads: reads.trim(), options, saved: saved?.trim(), problems };
}

let failed = false;
for (const run of runs) {
  if (only && run.name !== only) continue;
  const browser = run.engine === "webkit" ? await webkit.launch({ executablePath: safari }) : await chromium.launch({ executablePath: process.env.CHROME_PATH ?? chrome });
  try {
    const r = await one(browser, run);
    console.log(JSON.stringify(r, null, 2));
    if (r.problems.length) failed = true;
  } catch (err) {
    failed = true;
    console.error(`${run.name}: ${err instanceof Error ? err.message : err}`);
  } finally {
    await browser.close();
  }
}
process.exit(failed ? 1 : 0);
