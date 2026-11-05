// Records the live example basement as sharp, constant-30fps H.264 clips for the demo video.
// Frames come from Chrome's own screencast (CDP Page.startScreencast) at full device pixels, each with
// its swap timestamp; ffmpeg turns them into a CFR MP4. Playwright's recordVideo is VP8 and soft.
//
// Only the public, replayed example (/scans/sample) is recorded: it makes no paid calls and sends nothing.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Playwright from the repo (or the main checkout when run from a worktree without browsers to match).
function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_MODULE, "playwright", path.resolve(import.meta.dirname, "../../../node_modules/playwright")].filter(Boolean);
  for (const t of tries) {
    try {
      return require(t);
    } catch {
      // next
    }
  }
  throw new Error("Playwright not found: set PLAYWRIGHT_MODULE to its folder");
}
const { chromium } = loadPlaywright();

export const SITE = process.env.SITE || "https://www.basementready.com";
export const FOOTAGE = path.resolve(import.meta.dirname, "../../public/footage");
const WORK = process.env.RECORD_WORK || path.join(FOOTAGE, ".frames");

export const DEVICES = {
  desktop: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  phone: {
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  },
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch(device, storageState) {
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : { channel: "chromium" }), args: ["--use-angle=metal", "--enable-gpu", "--hide-scrollbars"] });
  const d = DEVICES[device];
  const context = await browser.newContext({ ...d, storageState, reducedMotion: "no-preference", colorScheme: "light", locale: "en-CA" });
  const page = await context.newPage();
  return { browser, context, page, device, size: { w: d.viewport.width * d.deviceScaleFactor, h: d.viewport.height * d.deviceScaleFactor } };
}

// One clip: start() begins capturing, mark() notes a moment, stop() writes the MP4 and its moments.
export class Clip {
  constructor(session, name) {
    this.s = session;
    this.name = name;
    this.dir = path.join(WORK, name);
    this.frames = [];
    this.marks = [];
  }

  async start() {
    fs.rmSync(this.dir, { recursive: true, force: true });
    fs.mkdirSync(this.dir, { recursive: true });
    this.cdp = await this.s.context.newCDPSession(this.s.page);
    this.cdp.on("Page.screencastFrame", (f) => {
      const file = path.join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.jpg`);
      fs.writeFileSync(file, Buffer.from(f.data, "base64"));
      this.frames.push({ file, t: f.metadata.timestamp });
      this.cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: this.s.size.w, maxHeight: this.s.size.h, everyNthFrame: 1 });
    // A frame at the very start, even on a still page.
    await this.s.page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await sleep(150);
    this.t0 = this.frames[0]?.t ?? Date.now() / 1000;
    return this;
  }

  // A moment at "now", in seconds from the clip's first frame.
  mark(what) {
    const t = Date.now() / 1000 - this.t0;
    this.marks.push({ t, what });
    console.log(`  [${this.name}] ${t.toFixed(1)}s ${what}`);
  }

  async stop() {
    const tEnd = Date.now() / 1000;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    await sleep(200);
    const frames = this.frames.filter((f) => f.t <= tEnd);
    if (!frames.length) throw new Error(`${this.name}: no frames`);
    const lines = [];
    for (let i = 0; i < frames.length; i++) {
      const next = i + 1 < frames.length ? frames[i + 1].t : tEnd;
      const dur = Math.max(0.001, next - frames[i].t);
      lines.push(`file '${frames[i].file}'`, `duration ${dur.toFixed(4)}`);
    }
    lines.push(`file '${frames[frames.length - 1].file}'`);
    const list = path.join(this.dir, "list.txt");
    fs.writeFileSync(list, lines.join("\n"));
    const out = path.join(FOOTAGE, `${this.name}.mp4`);
    const r = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-movflags", "+faststart", "-r", "30", out],
      { stdio: "inherit" },
    );
    if (r.status !== 0) throw new Error(`${this.name}: ffmpeg failed`);
    const duration = tEnd - this.t0;
    const fps = frames.length / duration;
    fs.writeFileSync(path.join(FOOTAGE, `${this.name}.json`), JSON.stringify({ name: this.name, size: this.s.size, duration, captureFps: fps, marks: this.marks }, null, 2));
    console.log(`  [${this.name}] wrote ${out}: ${duration.toFixed(1)}s, ${frames.length} frames (${fps.toFixed(1)} fps captured)`);
    if (!process.env.KEEP_FRAMES) fs.rmSync(this.dir, { recursive: true, force: true });
    return { out, duration, fps };
  }
}

// Smooth scroll of the window or of an element, eased, at the page's own frame rate.
export async function smoothScroll(page, { to, by, ms = 2000, selector = null }) {
  await page.evaluate(
    ({ to, by, ms, selector }) =>
      new Promise((resolve) => {
        const el = selector ? document.querySelector(selector) : document.scrollingElement;
        const from = el.scrollTop;
        const target = to != null ? to : from + by;
        const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
        const t0 = performance.now();
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + (target - from) * ease(k);
          if (k < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }),
    { to, by, ms, selector },
  );
}

// The button or link whose visible text is exactly `text` (arrows and spacing normalised).
export async function byText(page, text, { root = "button,a" } = {}) {
  const norm = (s) => s.replace(/\s+/g, " ").trim();
  const handles = await page.$$(root);
  let found = null;
  for (const h of handles) {
    const t = norm((await h.textContent()) || "");
    if (t === norm(text) && (await h.isVisible())) found = h;
  }
  if (!found) throw new Error(`No visible "${text}"`);
  return found;
}

// Wait until a visible button/link with this text exists.
export async function waitText(page, text, timeout = 60000) {
  const t0 = Date.now();
  for (;;) {
    try {
      return await byText(page, text);
    } catch (e) {
      if (Date.now() - t0 > timeout) throw e;
      await sleep(250);
    }
  }
}

// A deliberate press: glide the pointer over, pause so the cut reads, then click (or tap on a phone).
export async function press(session, handle, { pause = 600 } = {}) {
  await handle.scrollIntoViewIfNeeded();
  const box = await handle.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (session.device === "phone") {
    await sleep(pause);
    await session.page.touchscreen.tap(x, y);
  } else {
    await session.page.mouse.move(x, y, { steps: 12 });
    await sleep(pause);
    await session.page.mouse.click(x, y);
  }
}

// The page is still: no image loading, fonts ready, two frames painted.
export async function settle(page, ms = 600) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; })));
  });
  await sleep(ms);
}
