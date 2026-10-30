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

type Take = { id: string; video: string; capture: string; who: string; answers: Record<string, string> };

// Same as tests/e2e/support/takes.ts. Takes that came in through the start sheet's upload (david-05x)
// need the start sheet walked exactly as recorded; run those through `pnpm test:e2e` instead.
const TAKES: Take[] = [
  {
    id: "b2-family",
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
  if (!existsSync(t.video) || !existsSync(t.capture)) return `its video or camera path isn't on this machine (${MEDIA_ROOT})`;
  const recorded = replayDirs().some((d) => existsSync(join(d, "takes", `${t.id}.json`)) || (existsSync(join(d, "takes")) && readdirSync(join(d, "takes")).includes(`${t.id}.json`)));
  if (!recorded) return "not recorded yet: pnpm test:e2e:record spends Meta credit (ask David first)";
  return null;
}

// Posts the take, answers the wait screen's questions as the recording did, and waits for the answer.
// Returns the scan id and the claim the workspace needs (kept in localStorage "br-claims").
export async function runTake(id: string, baseURL: string, log: (s: string) => void): Promise<{ scanId: string; claim: { basementId: string; claimToken: string } }> {
  const t = TAKES.find((x) => x.id === id)!;
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  try {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
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
    const claim = { basementId: posted.basementId, claimToken: posted.claimToken };
    await page.goto("/");
    await page.evaluate((c) => localStorage.setItem("br-claims", JSON.stringify([c])), claim);
    await page.goto(`/scans/${posted.id}`);
    log(`  take ${id}: scan ${posted.id}, replaying`);
    const until = Date.now() + 6 * 60_000;
    for (;;) {
      if (Date.now() > until) throw new Error("the replayed scan didn't finish in 6 minutes");
      const status = (await (await page.request.get(`/api/scans/${posted.id}`)).json()).status;
      if (status === "done") break;
      if (status === "failed") throw new Error("the replayed scan failed (a replay miss? see server/replay-misses.jsonl)");
      const ask = page.locator(".live-ask");
      if (await ask.isVisible().catch(() => false)) {
        const q = (await ask.locator("h2").textContent()) ?? "";
        const want = Object.entries(t.answers).find(([k]) => q.includes(k))?.[1];
        const option = want ? ask.getByRole("button", { name: want, exact: true }) : ask.locator(".live-ask-options button").first();
        await option.click().catch(() => {});
      }
      await page.waitForTimeout(1500);
    }
    return { scanId: posted.id, claim };
  } finally {
    await browser.close();
  }
}
