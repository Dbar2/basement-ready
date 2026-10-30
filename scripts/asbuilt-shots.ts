// Screenshots of the 3D for checking the as-built model by eye: Chromium (on the Mac's GPU, like
// tests/e2e) and WebKit, at 390 and 1280 wide. Each shot is a URL that sets <body data-ready> once
// it's drawn (src/three/AsBuiltPreview.tsx does; app pages get a fixed wait).
// Usage: tsx scripts/asbuilt-shots.ts shots.json OUT_DIR, where shots.json is
//   [{ "name": "b1-above", "url": "http://localhost:5184/tools/asbuilt-preview.html?dir=/tmp/asbuilt/b1/&view=above",
//      "browsers": ["chromium", "webkit"], "widths": [390, 1280], "wait": 0, "click": ["text=Scan"] }]
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright";

// PLAYWRIGHT_MODULE: another checkout's playwright, when the browsers installed belong to its version.
const { chromium, webkit } = (await import(process.env.PLAYWRIGHT_MODULE ?? "playwright")) as typeof import("playwright");

// `ready`: a selector to wait for (default body[data-ready]); `storage`: localStorage to set first
// (a scan's claim, to open its plan).
// `steps`: more screenshots from the same page, each after its own clicks (named `${name}-${step}`).
type Step = { name: string; click?: string[]; after?: number };
type Shot = { name: string; url: string; browsers?: ("chromium" | "webkit")[]; widths?: number[]; wait?: number; ready?: string; click?: string[]; after?: number; selector?: string; storage?: Record<string, string>; steps?: Step[] };

const [list, out] = process.argv.slice(2);
const shots: Shot[] = JSON.parse(readFileSync(list, "utf8"));
mkdirSync(out, { recursive: true });

const browsers: Record<string, () => Promise<Browser>> = {
  chromium: () => chromium.launch({ channel: "chromium", args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] }),
  webkit: () => webkit.launch(),
};

for (const name of ["chromium", "webkit"] as const) {
  const todo = shots.filter((s) => (s.browsers ?? ["chromium", "webkit"]).includes(name));
  if (!todo.length) continue;
  const browser = await browsers[name]();
  for (const s of todo) {
    for (const width of s.widths ?? [390, 1280]) {
      const phone = width < 600;
      const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 800 }, deviceScaleFactor: phone ? 2 : 1, ...(phone && name === "chromium" ? { isMobile: true, hasTouch: true } : phone ? { hasTouch: true } : {}) });
      const page = await ctx.newPage();
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const t0 = Date.now();
      if (s.storage) await ctx.addInitScript((kv) => Object.entries(kv).forEach(([k, v]) => localStorage.setItem(k, v)), s.storage);
      await page.goto(s.url, { waitUntil: "load" });
      if (s.wait) await page.waitForTimeout(s.wait);
      else await page.waitForSelector(s.ready ?? "body[data-ready]", { timeout: 150_000, state: "attached" }).catch(() => errors.push("never ready"));
      for (const step of s.steps ?? [{ name: "", click: s.click, after: s.after }]) {
        const file = join(out, `${s.name}${step.name ? `-${step.name}` : ""}-${name}-${width}.png`);
        try {
          for (const c of step.click ?? []) {
            await page.locator(c).first().click({ timeout: 20_000 });
            await page.waitForTimeout(800);
          }
          if (step.after) await page.waitForTimeout(step.after);
          await (s.selector ? page.locator(s.selector).first() : page).screenshot({ path: file });
          console.log(`${file} ${((Date.now() - t0) / 1000).toFixed(1)} s${errors.length ? `  errors: ${errors.join(" | ")}` : ""}`);
        } catch (err) {
          // One shot failing doesn't stop the rest.
          console.log(`${file} FAILED: ${(err instanceof Error ? err.message : String(err)).split("\n")[0]}${errors.length ? `  errors: ${errors.join(" | ")}` : ""}`);
        }
      }
      await ctx.close();
    }
  }
  await browser.close();
}
