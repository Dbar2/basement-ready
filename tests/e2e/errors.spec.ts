// When it goes wrong: a video it can't read, and a day's scans used up.
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Home } from "./pages/Home";
import { WaitScreen } from "./pages/WaitScreen";
import { api, expect, test } from "./support/fixtures";
import { API_PORT, apiCommand, apiEnv, runDir } from "./support/run";

test("a video it can't read: the wait screen says so", async ({ page, journey }, info) => {
  test.slow(); // the job tries twice, 15 s apart, before it gives up
  // Not a video at all: ffmpeg fails before any model is called, so this is free in every mode.
  const broken = join(runDir, "inputs", `${info.project.name}-broken.mp4`);
  mkdirSync(join(runDir, "inputs"), { recursive: true });
  writeFileSync(broken, "this is not a video\n".repeat(64));
  // The wait screen plays the video it was given; this one can't play, and the server never makes a copy.
  // (WebKit also reports the dev-only revoked blob URL noted in takes.spec.ts.)
  journey.allowConsole(/Failed to load resource: the server responded with a status of 404|404 \(Not Found\)|WebKitBlobResource error/);

  const home = new Home(page);
  const wait = new WaitScreen(page);
  await journey.step("home", () => home.open());
  const sheet = (await journey.step("start sheet: who", async () => {
    const s = await home.startSheet();
    await s.who("Not sure");
    return s;
  }))!;
  const scanId = (await journey.step("broken video uploaded", () => sheet.upload(broken)))!;
  await journey.step("wait screen", () => wait.expectOpen());
  // The test server runs one scan at a time, so this may wait behind a recorded take: the server's word
  // first, then the screen must say it promptly.
  await expect.poll(async () => (await api(page, `/api/scans/${scanId}`)).status, { timeout: 5 * 60_000, intervals: [2_000] }).toBe("error");
  await journey.step("error shown", async () => {
    const failed = page.getByRole("alert").filter({ has: page.getByRole("heading", { name: "We couldn't finish this scan" }) });
    await expect(failed).toBeVisible({ timeout: 15_000 });
    await expect(failed.getByRole("link", { name: "See the example" })).toBeVisible();
  });
  expect((await api(page, `/api/scans/${scanId}`)).error).toMatch(/^We couldn't read this video/);
});

// Over the limit, for real: this journey starts its own API (replay mode, its own database) with the day's
// scans set to 0, and points the page's /api calls at it. The other journeys keep their generous limits.
const PROJECTS = ["chromium-phone", "chromium-desktop", "webkit-phone", "webkit-desktop"];
test.describe("over the limit", () => {
  let server: ChildProcess | null = null;
  let port = 0;
  test.beforeAll(async ({}, info) => {
    port = API_PORT + 10 + Math.max(0, PROJECTS.indexOf(info.project.name));
    const dir = join(runDir, `limits-${info.project.name}`);
    server = spawn(apiCommand(), {
      shell: true,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...apiEnv(), API_PORT: String(port), PGLITE_DIR: join(dir, "pglite"), LOCAL_STORAGE_DIR: join(dir, "storage"), SCANS_PER_DAY: "0" },
    });
    await expect.poll(async () => (await fetch(`http://localhost:${port}/api/health`).catch(() => null))?.ok ?? false, { timeout: 60_000 }).toBe(true);
  });
  test.afterAll(() => {
    if (server?.pid) process.kill(-server.pid);
  });

  test("the start sheet says today's scans are used up, and an upload is turned away", async ({ page, journey }) => {
    // Fetched from the limited API by Playwright and handed back as the page's own: same origin to the page.
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      url.port = String(port);
      await route.fulfill({ response: await route.fetch({ url: url.href }) });
    });
    const home = new Home(page);
    await journey.step("home", () => home.open());
    const sheet = (await journey.step("start sheet: used up", async () => {
      const s = await home.startSheet();
      await s.who("Not sure");
      await expect(s.dialog.getByRole("alert")).toHaveText(/real scans are used up/);
      return s;
    }))!;
    await expect(sheet.dialog.getByRole("button", { name: /See the example/ })).toBeVisible();
    await expect(sheet.dialog.getByRole("button", { name: "Upload a video" })).toBeHidden();
    // And the server holds the line if a take is sent anyway.
    const res = await page.request.post(`http://localhost:${port}/api/scans`, { multipart: { video: { name: "take.mp4", mimeType: "video/mp4", buffer: Buffer.from("not a video") }, who: "unsure" } });
    expect(res.status()).toBe(503);
    expect((await res.json()).allowance).toMatchObject({ ok: false, reason: "day", leftToday: 0 });
  });
});
