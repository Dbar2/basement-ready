// The browsers Playwright left in its cache. QA_CHROMIUM / QA_WEBKIT point at others; with neither set
// and nothing cached, Playwright's own default is used.
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, webkit, type Browser as PwBrowser } from "playwright";
import type { Browser } from "./plan";

const CACHE = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(homedir(), "Library/Caches/ms-playwright");

// The newest cached build of a browser: "chromium-1243" beats "chromium-1208".
function newest(prefix: string, inside: string): string | undefined {
  if (!existsSync(CACHE)) return undefined;
  const dirs = readdirSync(CACHE)
    .filter((d) => d.startsWith(`${prefix}-`))
    .sort((a, b) => Number(b.split("-").pop()) - Number(a.split("-").pop()));
  return dirs.map((d) => join(CACHE, d, inside)).find((p) => existsSync(p));
}

export const chromiumPath = () => process.env.QA_CHROMIUM ?? newest("chromium", "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
export const webkitPath = () => process.env.QA_WEBKIT ?? newest("webkit", "pw_run.sh");

// Chromium with the Mac's GPU: the headless shell draws WebGL in software and the 3D views then stall
// (same flags as the end-to-end tests).
export function launch(browser: Browser): Promise<PwBrowser> {
  if (browser === "chromium") return chromium.launch({ executablePath: chromiumPath(), args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
  return webkit.launch({ executablePath: webkitPath() });
}
