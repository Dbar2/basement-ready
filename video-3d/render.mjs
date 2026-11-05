// Renders one 3D clip for the demo video: steps the capture page frame by frame in headless Chromium at
// 2x (3840×2160) and pipes the frames to ffmpeg, which downscales to 1920×1080 and encodes H.264 CRF 14.
//   node video-3d/render.mjs <shot 1-4> [--stills 0,60,120] [--out file.mp4]
// One clip at a time, one browser, closed at the end: the Mac is rendering the edit at the same time.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const NAMES = { 1: "01-assemble", 2: "02-finds", 3: "03-plan-to-3d", 4: "04-flythrough" };
const shot = Number(process.argv[2] ?? 1);
const arg = (k) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const outDir = join(here, "..", "..", "..", "..", "media", "video-clips");
const stills = arg("--stills")?.split(",").map(Number);
const out = arg("--out") ?? join(outDir, `${NAMES[shot]}.mp4`);
const scale = Number(arg("--scale") ?? 2);
mkdirSync(dirname(out), { recursive: true });

const server = await createServer({ configFile: join(here, "vite.config.ts") });
await server.listen();
const browser = await chromium.launch({
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  page.on("console", (m) => console.log("[page]", m.text()));
  page.on("pageerror", (e) => console.log("[page error]", e.message));
  await page.goto(`http://localhost:5199/?shot=${shot}${process.env.SCAN_DIR ? "&src=private" : ""}`);
  await page.waitForFunction(() => typeof window.__frame === "function", null, { timeout: 60000 });
  // Warm up until the scan, textures and models are in and the first frame has drawn.
  for (let i = 0; i < 600; i++) {
    await page.evaluate(() => window.__frame(0));
    const ok = await page.evaluate(
      (needsAtlas) => window.__mounted && !window.__loading() && document.fonts.status === "loaded" && (!needsAtlas || document.querySelector("canvas")?.dataset.atlas === "2048"),
      shot <= 3,
    );
    if (ok && i > 8) break;
    await page.waitForTimeout(100);
  }
  const renderer = await page.evaluate(() => {
    const gl = document.querySelector("canvas")?.getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  console.log("renderer:", renderer);
  const duration = await page.evaluate(() => window.__duration);
  const total = Math.round(duration * 30);

  if (stills) {
    for (const f of stills) {
      await page.evaluate((i) => window.__frame(i), f);
      await page.evaluate((i) => window.__frame(i), f);
      const file = out.replace(/\.mp4$/, `-f${String(f).padStart(3, "0")}.jpg`);
      await page.screenshot({ path: file, type: "jpeg", quality: 90 });
      console.log("still", file);
    }
  } else {
    const ff = spawn(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", "30", "-c:v", "mjpeg", "-i", "-",
        "-vf", "scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "14",
        "-profile:v", "high", "-r", "30", "-movflags", "+faststart", "-an", out],
      { stdio: ["pipe", "inherit", "inherit"] },
    );
    const t0 = Date.now();
    for (let i = 0; i < total; i++) {
      await page.evaluate((n) => window.__frame(n), i);
      // A second draw at the same time lets React commit anything the first frame changed.
      await page.evaluate((n) => window.__frame(n), i);
      const buf = await page.screenshot({ type: "jpeg", quality: 96 });
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
      if (i % 30 === 0) console.log(`frame ${i}/${total}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r, j) => ff.on("close", (c) => (c === 0 ? r() : j(new Error(`ffmpeg ${c}`)))));
    console.log("wrote", out, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
} finally {
  await browser.close();
  await server.close();
}
