// Interaction takes on the public example, with a drawn cursor (headless capture has none): typing a
// question in the ask bar and the answer arriving, and orbiting and switching the 3D layouts.
// Usage (from video/): node tools/record/interact.mjs [ask] [orbit]
import fs from "node:fs";
import path from "node:path";
import { Clip, launch, settle, sleep, SITE, waitText, press, FOOTAGE } from "./lib.mjs";

const only = process.argv.slice(2);
const GUIDE = `${SITE}/scans/sample/guide`;
const STATES = path.join(FOOTAGE, ".states");

const CURSOR = `
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 16 L21 16 Z" fill="#0F2A1E" stroke="#FBFCFA" stroke-width="2" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0px', top: '0px', zIndex: 2147483647, pointerEvents: 'none', transform: 'translate(-2px,-2px)' });
    document.documentElement.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  });
`;

async function session(state) {
  const s = await launch("desktop", fs.existsSync(state) ? state : undefined);
  await s.page.addInitScript(CURSOR);
  await s.page.goto(GUIDE, { waitUntil: "networkidle" });
  await settle(s.page, 1200);
  await s.page.mouse.move(1500, 700);
  return s;
}

if (!only.length || only.includes("ask")) {
  const s = await session(path.join(STATES, "desktop-explain.json"));
  const { page } = s;
  try {
    const clip = await new Clip(s, "desktop-ask").start();
    const input = page.locator('input[placeholder*="Ask anything"], textarea[placeholder*="Ask anything"]').first();
    const box = await input.boundingBox();
    await page.mouse.move(box.x + 60, box.y + box.height / 2, { steps: 25 });
    await sleep(500);
    await page.mouse.click(box.x + 60, box.y + box.height / 2);
    clip.mark("ask bar focused");
    await page.keyboard.type("What's a fire separation?", { delay: 85 });
    clip.mark("typed the question");
    await sleep(700);
    await page.keyboard.press("Enter");
    clip.mark("sent");
    await sleep(6500);
    clip.mark("answer and drawing shown");
    await clip.stop();
  } finally {
    await s.browser.close();
  }
}

if (!only.length || only.includes("orbit")) {
  const s = await session(path.join(STATES, "desktop-layouts.json"));
  const { page } = s;
  try {
    const clip = await new Clip(s, "desktop-orbit").start();
    await press(s, await waitText(page, "Looks right →", 30000), { pause: 600 });
    clip.mark("tapped 'Looks right'");
    await sleep(4500);
    clip.mark("layouts in 3D");
    // orbit: a slow drag across the 3D view
    const cx = 560, cy = 560;
    await page.mouse.move(cx, cy, { steps: 15 });
    await page.mouse.down();
    await page.mouse.move(cx + 320, cy - 40, { steps: 90 });
    await page.mouse.up();
    clip.mark("orbited");
    await sleep(800);
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, -120);
      await sleep(120);
    }
    clip.mark("zoomed in");
    await sleep(1200);
    const studio = await waitText(page, "Show Studio", 8000).catch(() => null);
    if (studio) {
      await press(s, studio, { pause: 600 });
      clip.mark("switched to Studio");
      await sleep(4000);
    }
    await page.mouse.move(cx, cy, { steps: 15 });
    await page.mouse.down();
    await page.mouse.move(cx - 260, cy + 30, { steps: 80 });
    await page.mouse.up();
    clip.mark("orbited back");
    await sleep(1500);
    await clip.stop();
  } finally {
    await s.browser.close();
  }
}
