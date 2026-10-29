// The whole homeowner journey in a real browser, with a video file as the camera: landing, address,
// filming with the guide, review, upload, the wait and its questions, then the answer.
// Usage: BASE_URL=https://localhost:5173 tsx scripts/try-journey.ts tmp/david/fakecam.y4m [seconds]
// Needs `pnpm dev:phone` (or `pnpm dev` with BASE_URL=http://localhost:5173). A real scan: about $0.90 of Meta credit.
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const scanFlag = process.argv.indexOf("--scan");
const resumeScan = scanFlag > 0 ? process.argv[scanFlag + 1] : null;
const [cam, secondsArg = "60"] = process.argv.slice(2).filter((_, i, all) => all[i - 1] !== "--scan" && all[i] !== "--scan");
if (!resumeScan && (!cam || !existsSync(cam))) {
  console.error("Usage: tsx scripts/try-journey.ts path/to/fakecam.y4m [seconds]");
  process.exit(1);
}
const base = process.env.BASE_URL ?? "http://localhost:5173";
const out = "tmp/journey";
mkdirSync(out, { recursive: true });
const t0 = Date.now();
const log = (m: string) => console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s  ${m}`);

const cached = join(homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? (existsSync(cached) ? cached : undefined),
  args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", ...(cam ? [`--use-file-for-fake-video-capture=${resolve(cam)}`] : []), "--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, permissions: ["camera", "microphone"], ignoreHTTPSErrors: true });
const page = await context.newPage();
const problems: string[] = [];
page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 140)}`));
let n = 0;
const shot = async (name: string) => page.screenshot({ path: `${out}/${String(++n).padStart(2, "0")}-${name}.png` });

if (resumeScan) {
  // Pick up a scan already uploaded: straight to the wait and the answer.
  await page.goto(`${base}/scans/${resumeScan}`);
} else {
// 1. Landing and address.
await page.goto(`${base}/`);
await shot("landing");
await page.getByRole("button", { name: /Check my basement/ }).click();
await page.locator("#addr-input").pressSequentially("120 avondale", { delay: 40 });
await page.locator(".addr-list li").first().click();
await page.waitForSelector(".prop-head:not(.muted)", { timeout: 20000 });
await page.getByRole("button", { name: "A parent or relative" }).click();
log(`address: ${await page.locator(".prop-head").textContent()}`);
await shot("address");

// 2. The guide.
await page.getByRole("button", { name: /Film my basement/ }).click();
await shot("how-to");
await page.getByRole("button", { name: /Start camera/ }).click();
await page.getByRole("button", { name: "Start", exact: true }).waitFor();
await shot("ready");
await page.getByRole("button", { name: "Start", exact: true }).click();
log("filming");
// A desktop browser has no compass or tilt: turn a pretend phone round each room, tilt up now and then.
await page.evaluate(() => {
  let a = 0;
  const started = performance.now();
  window.setInterval(() => {
    a = (a + 2.5) % 360;
    const t = (performance.now() - started) / 1000;
    const beta = t % 30 > 18 && t % 30 < 22 ? 150 : 85;
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: a, beta, gamma: 0, absolute: true }));
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta, gamma: 0 }));
  }, 100);
});
const seconds = Number(secondsArg);
let tapped = false;
for (let t = 10; t <= seconds; t += 10) {
  await page.waitForTimeout(10_000);
  const s = await page.evaluate(() => ({
    room: document.querySelector(".guide-room-label")?.textContent,
    task: document.querySelector(".guide-task")?.textContent,
    voice: document.querySelector(".guide-voice p")?.textContent,
    shown: document.querySelector(".guide-count")?.textContent,
  }));
  log(`${t}s · ${s.room} · ${s.task} · “${s.voice}” · ${s.shown}`);
  await shot(`filming-${t}s`);
  if (!tapped && s.task?.startsWith("What would you like")) {
    tapped = await page.getByRole("button", { name: "Bedroom for a parent" }).click({ timeout: 2000 }).then(() => true, () => false);
    if (tapped) log("tapped “Bedroom for a parent”");
  }
}
await page.getByRole("button", { name: "Done", exact: true }).click();

// 3. Review and upload.
await page.waitForSelector(".cap-review");
await shot("review");
log(`review: ${(await page.locator(".cap-facts").textContent())?.replace(/\s+/g, " ")}`);
await page.getByRole("button", { name: /Use this video/ }).click();
await page.waitForURL(/\/scans\//, { timeout: 120_000 });
log(`uploaded: ${page.url()}`);
}

// 4. The wait, answering what it asks.
await page.waitForSelector(".live-ask, .live-ready, .decision", { timeout: 30_000 });
await shot("wait");
const answers: Record<string, string> = { "Is there a door": "No", "Is there a bathroom": "Not sure" };
for (let i = 0; i < 3; i++) {
  if (await page.locator(".decision").count()) break; // a finished scan opens straight on the answer
  const q = await page.locator(".live-ask h2").textContent({ timeout: 3000 }).catch(() => null);
  if (!q) break;
  const pick = Object.entries(answers).find(([k]) => q.startsWith(k))?.[1];
  if (pick) await page.locator(".live-ask-options").getByRole("button", { name: pick, exact: true }).click();
  else await page.locator(".live-ask-options .btn").first().click();
  log(`answered “${q}” → ${pick ?? "first option"}`);
}
await shot("wait-after-questions");
await page.waitForSelector(".decision", { timeout: 6 * 60_000 });
await page.waitForTimeout(1000);
log(`answer: ${await page.locator(".verdict-line").textContent()}`);
await shot("result-top");
for (const h of ["Your plan", "Money you can get", "What has to change", "What every basement suite needs", "Your designer confirms", "From public records", "Your basement, scanned", "What you want"]) {
  const found = await page.evaluate((t) => {
    const el = [...document.querySelectorAll("h2")].find((x) => x.textContent === t);
    el?.scrollIntoView({ block: "start" });
    return Boolean(el);
  }, h);
  if (!found) {
    log(`(no “${h}” section)`);
    continue;
  }
  await page.waitForTimeout(h.includes("scanned") ? 3000 : 400);
  await shot(h.toLowerCase().replace(/[^a-z]+/g, "-"));
}
log(problems.length ? `problems:\n  ${[...new Set(problems)].join("\n  ")}` : "no page errors");
await browser.close();
console.log(`Screenshots in ${out}/`);
