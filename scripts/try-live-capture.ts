// Drives the real recorder in Chrome with a video file as the camera, to see the live scan work.
// Usage: pnpm try:live path/to/fakecam.y4m [seconds]   (needs `pnpm dev` running; spends ~$0.25 of SAM calls)
// Make a camera file: ffmpeg -i basement.mov -t 50 -vf "scale=480:854:force_original_aspect_ratio=increase,crop=480:854,fps=15" -pix_fmt yuv420p cam.y4m
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const [cam, secondsArg = "40"] = process.argv.slice(2);
if (!cam || !existsSync(cam)) {
  console.error("Usage: pnpm try:live path/to/fakecam.y4m [seconds]");
  process.exit(1);
}
const seconds = Number(secondsArg);
const out = "tmp/live-capture";
mkdirSync(out, { recursive: true });

// Use whichever Chrome for Testing build is already downloaded.
const cached = join(homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH ?? (existsSync(cached) ? cached : undefined),
  args: [
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    `--use-file-for-fake-video-capture=${resolve(cam)}`,
    "--autoplay-policy=no-user-gesture-required",
  ],
});
// BASE_URL=https://<mac-ip>:5173 checks the phone setup (pnpm dev:phone) the same way.
const base = process.env.BASE_URL ?? "http://localhost:5173";
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  permissions: ["camera", "microphone"],
  ignoreHTTPSErrors: true,
});
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("response", (r) => r.url().includes("/api/live/detect") && r.status() !== 200 && console.log("live detect", r.status()));

await page.goto(`${base}/`);
await page.getByRole("button", { name: /Check my basement/ }).click();
// "Who's it for?" must be answered before filming.
await page.getByRole("button", { name: "Parent or relative" }).click();
await page.getByRole("button", { name: /Film my basement/ }).click();
await page.getByRole("button", { name: /Start camera/ }).waitFor();
await page.screenshot({ path: `${out}/intro.png` });
await page.getByRole("button", { name: /Start camera/ }).click();
await page.getByRole("button", { name: "Start", exact: true }).waitFor();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${out}/ready.png` });
await page.getByRole("button", { name: "Start", exact: true }).click();

// A desktop browser has no compass, tilt sensor or gyro, so a pretend phone turns slowly round the
// basement (20°/s), and tilts up or down when the guide asks for the ceiling or the floor, so the
// coverage view paints. When the guide asks for the wide shot, it holds still.
await page.evaluate(() => {
  let a = 0;
  window.setInterval(() => {
    const task = document.querySelector(".cov-panel .guide-task")?.textContent ?? "";
    const still = task.startsWith("Step back");
    if (!still) a = (a + 2) % 360;
    const beta = task.startsWith("Tilt up") ? 140 : task.startsWith("Tilt down") ? 40 : 85;
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: a, beta, gamma: 0, absolute: true }));
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta, gamma: 0 }));
    const spin = still ? 2 : 20;
    window.dispatchEvent(new DeviceMotionEvent("devicemotion", { rotationRate: { alpha: spin, beta: 0, gamma: 0 }, interval: 100 }));
  }, 100);
});

let movedOn = false;
for (let t = 5; t <= seconds; t += 5) {
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({
    task: document.querySelector(".cov-panel .guide-task")?.textContent ?? null,
    voice: document.querySelector(".guide-voice p")?.textContent ?? null,
    shown: document.querySelector(".cov-count")?.textContent ?? null,
    painted: document.querySelector(".cov-legend")?.textContent ?? null,
    turn: document.querySelector(".guide-turn span")?.textContent ?? null,
    live3d: Boolean(document.querySelector(".cov-3d")),
    flash: document.querySelector(".cap-flash-label")?.textContent ?? null,
  }));
  console.log(`${String(t).padStart(3)}s`, JSON.stringify(state));
  // Stopped by itself at 2 minutes: that's the review.
  if (!state.task) break;
  await page.screenshot({ path: `${out}/t${String(t).padStart(3, "0")}.png` });
  // Answer the "what would you like this space to be?" task once, the way someone would.
  if (state.task?.startsWith("What would you like") && !movedOn) {
    movedOn = true;
    // The card can close itself first if it already heard talking.
    if (await page.getByRole("button", { name: "Bedroom for a parent" }).click({ timeout: 2000 }).then(() => true, () => false)) {
      console.log("     → tapped Bedroom for a parent");
    }
  }
}

// Open the assembling 3D from the coverage panel, the way you'd check it before stopping.
const open3d = page.locator(".cov-3d");
if (await open3d.count()) {
  await open3d.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/3d-full.png` });
  await page.locator(".cap-3d-full").getByRole("button", { name: "Keep filming" }).click();
}

const stop = page.getByRole("button", { name: "Done", exact: true });
if (await stop.count()) await stop.click();
await page.locator(".cap-review").waitFor({ timeout: 10_000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/review.png` });
console.log("review", JSON.stringify(await page.evaluate(() => document.querySelector(".cap-review-body")?.textContent)));
await browser.close();
console.log(`Screenshots in ${out}/`);
