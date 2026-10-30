// What every journey gets: named steps with a screenshot each, console errors caught, the browser kept
// off the internet, and replay misses checked. Journeys import `test` and `expect` from here.
import { test as base, expect, type Page } from "@playwright/test";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { files, runDir } from "./run";

export type Journey = {
  // A named step: runs `fn`, then screenshots the page into tmp/e2e/<run>/shots.
  step: <T>(name: string, fn?: () => Promise<T>) => Promise<T | undefined>;
  // Stage times for the timing report (support/timing.ts).
  timing: (row: Record<string, unknown>) => void;
  // Console messages that are expected in this test (a forced failure logs its 500, say).
  allowConsole: (pattern: RegExp) => void;
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const isLocal = (url: string) => /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/|data:|blob:|about:)/.test(url);

const missCount = () => (existsSync(files.missLog) ? readFileSync(files.missLog, "utf8").split("\n").filter(Boolean).length : 0);

export const test = base.extend<{ journey: Journey }>({
  journey: [
    async ({ page }, use, info) => {
      mkdirSync(runDir, { recursive: true });
      const errors: string[] = [];
      // Headless WebKit drops a WebGL context now and then when several pages draw at once; it says so in
      // the console. The page itself carries on.
      const allowed: RegExp[] = [/^WebGL: context lost\./];
      const external = new Set<string>();
      const started = Date.now();
      const misses = missCount();

      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`${m.text()}${m.location().url ? ` @ ${m.location().url}` : ""}`);
      });
      page.on("pageerror", (e) => errors.push(`page error: ${e.message}`));
      // No network: anything not served by the test servers (web fonts, say) is answered empty, as the
      // type the page asked for so it doesn't log a parse error.
      await page.route((url) => !isLocal(url.href), async (route) => {
        external.add(new URL(route.request().url()).host);
        const type = route.request().resourceType();
        await route.fulfill(type === "stylesheet" ? { status: 200, contentType: "text/css", body: "" } : { status: 204, body: "" });
      });

      const shots = join(runDir, "shots", slug(info.project.name), slug(info.titlePath.slice(1).join(" ")));
      let n = 0;
      const step: Journey["step"] = async (name, fn) =>
        test.step(name, async () => {
          const out = fn ? await fn() : undefined;
          const path = join(shots, `${String(++n).padStart(2, "0")}-${slug(name)}.png`);
          // A screenshot is evidence, not the test: one WebKit can't take in 15 s is skipped.
          await page.screenshot({ path, timeout: 15_000 }).catch(() => {});
          appendFileSync(
            files.steps,
            JSON.stringify({ test: info.titlePath.slice(1).join(" › "), project: info.project.name, n, step: name, shot: relative(runDir, path), ms: Date.now() - started }) + "\n",
          );
          return out;
        });

      await use({
        step,
        timing: (row) => appendFileSync(files.timing, JSON.stringify({ project: info.project.name, test: info.title, ...row }) + "\n"),
        allowConsole: (pattern) => allowed.push(pattern),
      });

      if (external.size) info.annotations.push({ type: "blocked", description: [...external].join(", ") });
      const unexpected = errors.filter((e) => !allowed.some((p) => p.test(e)));
      expect(unexpected, "console errors").toEqual([]);
      expect(missCount() - misses, `replay misses (see ${relative(process.cwd(), files.missLog)})`).toBe(0);
    },
    { auto: true },
  ],
});

export { expect };

// One at a time across workers: a recorded take replays its races (the 3D against the photos and the
// deck) the way they went when it was recorded, alone on the server, so two takes never share it.
export async function oneAtATime<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const lock = join(runDir, "locks", name);
  mkdirSync(join(runDir, "locks"), { recursive: true });
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

// The JSON a page fetched from the API, for asserting real outcomes beside what's on screen.
// A minute's grace: the test server is one process, and while a take finishes (the 3D merge, the permit
// set) it can be busy for twenty seconds and more.
export async function api<T = any>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path, { timeout: 60_000 });
  expect(res.ok(), `${path} → ${res.status()}`).toBeTruthy();
  return res.json();
}
