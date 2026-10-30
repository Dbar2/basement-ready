// Renders the home page's still frames (public/img/scan-1.webp … scan-6.webp) from the live scroll story,
// so the stills are the example's real scan, drawn by the same scene. They're the poster while the 3D
// loads, and the whole story for reduced motion or no WebGL. Re-run after the example changes.
//
//   pnpm exec vite --port 5191 &   then   pnpm exec tsx scripts/landing-stills.ts [http://localhost:5191]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://localhost:5191";
const OUT = join(import.meta.dirname, "../public/img");

// The Chromium build Playwright left in its cache; set CHROMIUM to use another.
const CHROMIUM = process.env.CHROMIUM ?? join(homedir(), "Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
const browser = await chromium.launch({ executablePath: CHROMIUM, args: ["--enable-unsafe-swiftshader"] });
// A 960 × 800 stage: the 6:5 frame the stills are shown in.
const page = await browser.newPage({ viewport: { width: 1600, height: 800 }, deviceScaleFactor: 1.25 });
page.on("pageerror", (e) => console.error("page error:", e.message));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector(".lp-stage canvas", { timeout: 60_000 });
await page.waitForSelector(".lp-poster[data-hidden]", { timeout: 60_000 });

const tmp = mkdtempSync(join(tmpdir(), "stills-"));
for (let step = 1; step <= 6; step++) {
  await page.evaluate((t) => {
    const s = document.querySelector<HTMLElement>(".lp-story")!;
    const top = s.getBoundingClientRect().top + scrollY;
    scrollTo(0, top + ((s.offsetHeight - innerHeight) * t) / 6);
  }, step);
  // Let the eased camera settle; the staged furniture loads its models first.
  await page.waitForTimeout(step === 6 ? 9000 : 3500);
  const png = join(tmp, `scan-${step}.png`);
  await page.locator(".lp-stage").screenshot({ path: png });
  execFileSync("cwebp", ["-quiet", "-q", "78", "-m", "6", png, "-o", join(OUT, `scan-${step}.webp`)]);
  console.log(`scan-${step}.webp`);
}
rmSync(tmp, { recursive: true });
await browser.close();
