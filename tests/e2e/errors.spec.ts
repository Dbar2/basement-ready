// When it goes wrong: a video it can't read, and (once session A's limits land) a scan over the limit.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Home } from "./pages/Home";
import { WaitScreen } from "./pages/WaitScreen";
import { api, expect, test } from "./support/fixtures";
import { runDir } from "./support/run";

test("a video it can't read: the wait screen says so", async ({ page, journey }, info) => {
  test.slow(); // the job tries twice, 15 s apart, before it gives up
  // Not a video at all: ffmpeg fails before any model is called, so this is free in every mode.
  const broken = join(runDir, "inputs", `${info.project.name}-broken.mp4`);
  mkdirSync(join(runDir, "inputs"), { recursive: true });
  writeFileSync(broken, "this is not a video\n".repeat(64));
  // The wait screen plays the video it was given; this one can't play, and the server never makes a copy.
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
  await journey.step("error shown", async () => {
    await expect(page.locator(".live-caption").first()).toHaveText(/Something went wrong reading your video/, { timeout: 90_000 });
  });
  const scan = await api(page, `/api/scans/${scanId}`);
  expect(scan.status).toBe("error");
  expect(scan.error).toBe("We couldn't read this video.");
});

// Session A ("journey and limits") adds a daily scan limit and its own screen. When it merges: lower the
// limit for this test's server (SCANS_PER_DAY in tests/e2e/support/run.ts is 1000 so the other journeys
// never hit it), upload once more than the limit, and check the start sheet shows the limit message.
test.fixme("over the limit: the start sheet says when to come back", async () => {});
