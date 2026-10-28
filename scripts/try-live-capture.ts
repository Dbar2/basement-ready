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
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, permissions: ["camera", "microphone"] });
const page = await context.newPage();
page.on("pageerror", (e) => console.log("PAGE ERROR", e.message));
page.on("response", (r) => r.url().includes("/api/live/detect") && r.status() !== 200 && console.log("live detect", r.status()));

await page.goto("http://localhost:5173/");
await page.getByRole("button", { name: "Scan my basement" }).click();
await page.getByRole("button", { name: /Film it now/ }).click();
await page.getByRole("button", { name: /Start camera/ }).click();
await page.getByRole("button", { name: /Start recording/ }).click();

// A desktop browser has no compass or tilt sensor, so turn a pretend phone slowly round the room,
// and tilt it up to the ceiling for a few seconds, to exercise the ring's track and the ceiling step.
await page.evaluate(() => {
  let a = 0;
  const started = performance.now();
  window.setInterval(() => {
    a = (a + 2) % 360;
    const t = (performance.now() - started) / 1000;
    const beta = t > 30 && t < 35 ? 150 : 85;
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientationabsolute", { alpha: a, beta, gamma: 0, absolute: true }));
    window.dispatchEvent(new DeviceOrientationEvent("deviceorientation", { alpha: a, beta, gamma: 0 }));
  }, 100);
});

let movedOn = false;
for (let t = 5; t <= seconds; t += 5) {
  await page.waitForTimeout(5000);
  const state = await page.evaluate(() => ({
    room: document.querySelector(".cap-room")?.textContent ?? null,
    coach: document.querySelector(".cap-coach")?.textContent ?? null,
    done: [...document.querySelectorAll('.ring-icon[data-done="true"]')].map((e) => e.getAttribute("aria-label")),
    track: `${document.querySelectorAll('.ring-track[data-on="true"]').length}/36`,
    mapped: document.querySelector(".room-done-title b")?.textContent ?? null,
    flash: document.querySelector(".cap-flash-label")?.textContent ?? null,
    threeD: document.querySelector(".cap-3d-label")?.textContent ?? null,
  }));
  console.log(`${String(t).padStart(3)}s`, JSON.stringify(state));
  await page.screenshot({ path: `${out}/t${String(t).padStart(3, "0")}.png` });
  // The first time a room is mapped, move on to the next one, the way someone would.
  if (state.mapped && !movedOn) {
    movedOn = true;
    await page.locator(".room-done").getByRole("button", { name: "Next room" }).click();
    console.log("     → Next room");
  }
}

// Open the assembling 3D, the way you'd check coverage before stopping.
const card = page.locator(".cap-3d");
if (await card.count()) {
  await card.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/3d-full.png` });
  await page.locator(".cap-3d-full").getByRole("button", { name: "Keep filming" }).click();
}

const stop = page.getByRole("button", { name: "Stop and review" });
if (await stop.count()) {
  await stop.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/review.png` });
}
await browser.close();
console.log(`Screenshots in ${out}/`);
