// Recorded takes: a real filmed basement, scanned once against the real services by the end-to-end tests
// (`pnpm test:e2e:record`), whose saved answers replay here for free. Posted the way the iPhone app sends
// a take, with the same fields the recording used, so every model call finds its saved answer.
// Needs server/replay.ts (the end-to-end tests' branch) and the take's files in media/.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { chromium } from "playwright";
import { chromiumPath } from "./browsers";
import { MEDIA_ROOT } from "./paths";
import { replayAvailable, replayDirs } from "./servers";

// How each take came in when it was recorded: the iPhone app's post (with its camera path), or the
// start sheet's upload (address and who it's for, then the video). Replay matches on the requests, so
// both are repeated exactly.
type Take = {
  id: string;
  video: string;
  answers: Record<string, string>;
} & ({ via: "app"; capture: string; who: string } | { via: "upload"; address: string; who: string });

// Same as tests/e2e/support/takes.ts.
const TAKES: Take[] = [
  {
    id: "david-05x",
    via: "upload",
    video: join(MEDIA_ROOT, "private/scans/566dc57b-b578-43b0-b897-484eee974de6/input.mp4"),
    address: "120 Avondale",
    who: "Family, no rent",
    answers: { "What would you like it to be": "A suite for family" },
  },
  {
    id: "b2-family",
    via: "app",
    video: join(MEDIA_ROOT, "eval/b2-finished-family/walkthrough.mp4"),
    capture: join(MEDIA_ROOT, "eval/b2-finished-family/capture.json"),
    who: "rental_market",
    answers: { "What would you like it to be": "A rental suite" },
  },
];

export function takeProblem(id: string): string | null {
  const t = TAKES.find((x) => x.id === id);
  if (!t) return `unknown take "${id}" (known: ${TAKES.map((x) => x.id).join(", ")})`;
  if (!replayAvailable()) return "replay isn't on this branch yet (server/replay.ts comes with the end-to-end tests)";
  if (!existsSync(t.video) || (t.via === "app" && !existsSync(t.capture))) return `its video or camera path isn't on this machine (${MEDIA_ROOT})`;
  const recorded = replayDirs().some((d) => existsSync(join(d, "takes", `${t.id}.json`)) || (existsSync(join(d, "takes")) && readdirSync(join(d, "takes")).includes(`${t.id}.json`)));
  if (!recorded) return "not recorded yet: pnpm test:e2e:record spends Meta credit (ask David first)";
  return null;
}

// Sends the take in as it was recorded, answers the wait screen's questions as the recording did, and
// waits for the answer. Returns the scan id and the device claims the workspace needs ("br-claims").
export async function runTake(id: string, baseURL: string, log: (s: string) => void): Promise<{ scanId: string; claims: unknown[] }> {
  const t = TAKES.find((x) => x.id === id)!;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
    await context.addInitScript({ content: "window.__name = window.__name || ((f) => f);" });
    const page = await context.newPage();
    let scanId: string;
    if (t.via === "app") {
      const res = await page.request.post("/api/scans", {
        timeout: 180_000,
        multipart: {
          video: { name: basename(t.video), mimeType: "video/mp4", buffer: readFileSync(t.video) },
          capture: { name: "capture.json", mimeType: "application/json", buffer: readFileSync(t.capture) },
          who: t.who,
          household: "unsure",
          municipality: "waterloo-on",
          lens: "wide",
        },
      });
      if (!res.ok()) throw new Error(`POST /api/scans → ${res.status()}`);
      const posted = await res.json();
      scanId = posted.id;
      await page.goto("/");
      await page.evaluate((c) => localStorage.setItem("br-claims", JSON.stringify([c])), { basementId: posted.basementId, claimToken: posted.claimToken });
      await page.goto(`/scans/${scanId}`);
    } else {
      // The start sheet (tests/e2e/pages/Home.ts): address, who it's for, then the video.
      await page.goto("/");
      await page.getByRole("button", { name: /Check my basement/ }).first().click();
      const sheet = page.getByRole("dialog");
      // The address list comes from the city's (replayed) map service; type again if it's slow to show.
      const box = sheet.getByRole("combobox", { name: "Your address" });
      const option = sheet.getByRole("option", { name: t.address }).first();
      for (let attempt = 0; ; attempt++) {
        await box.fill("");
        await box.pressSequentially(t.address, { delay: 40 });
        if (await option.waitFor({ timeout: 20_000 }).then(() => true, () => false)) break;
        if (attempt >= 2) throw new Error(`the start sheet never listed "${t.address}"`);
      }
      await option.click();
      await sheet.getByRole("button", { name: t.who }).click();
      const chooser = page.waitForEvent("filechooser");
      await sheet.getByRole("button", { name: "Upload a video" }).click();
      await (await chooser).setFiles(t.video);
      await page.waitForURL(/\/scans\/[0-9a-f-]{36}$/, { timeout: 180_000 });
      scanId = page.url().split("/").pop()!;
    }
    log(`  take ${id}: scan ${scanId}, replaying`);
    const until = Date.now() + 8 * 60_000;
    for (;;) {
      if (Date.now() > until) throw new Error("the replayed scan didn't finish in 8 minutes");
      const status = (await (await page.request.get(`/api/scans/${scanId}`)).json()).status;
      if (status === "done") break;
      if (status === "failed" || status === "error") throw new Error("the replayed scan failed (a replay miss? see server/replay-misses.jsonl)");
      // Its questions, as tests/e2e/pages/WaitScreen.ts answers them.
      const ask = page.locator(".live-ask");
      if (await ask.isVisible().catch(() => false)) {
        const q = ((await ask.getByRole("heading").first().textContent()) ?? "").toLowerCase();
        const want = Object.entries(t.answers).find(([k]) => q.includes(k.toLowerCase()))?.[1];
        const option = want ? ask.getByRole("button", { name: want, exact: true }) : ask.locator(".live-ask-options button").first();
        if (want && !(await option.count())) {
          await ask.getByRole("textbox").fill(want);
          await ask.getByRole("button", { name: "Save" }).click().catch(() => {});
        } else {
          await option.click().catch(() => {});
        }
        await page.waitForTimeout(1200);
        continue;
      }
      await page.waitForTimeout(1500);
    }
    const claims = await page.evaluate(() => {
      try {
        return JSON.parse(localStorage.getItem("br-claims") ?? "[]");
      } catch {
        return [];
      }
    });
    return { scanId, claims };
  } finally {
    await browser.close();
  }
}
