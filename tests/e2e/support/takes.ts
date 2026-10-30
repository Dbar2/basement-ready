// The filmed basements the journeys run on. Each one is recorded once against the real services
// (`pnpm test:e2e:record`), which also saves what it came out as; replay checks it comes out the same.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { WaitAnswers } from "../pages/WaitScreen";
import { COMMITTED_REPLAY, MEDIA_ROOT, mode, PRIVATE_REPLAY, RECORD_DIR } from "./run";

export type Take = {
  id: string;
  label: string;
  video: string;
  // "upload": the start sheet's Upload a video. "app": posted the way the iPhone app sends a take, with
  // its tracked camera path (docs/capture-contract.md).
  via: "upload" | "app";
  capture?: string;
  // David's own footage: never recorded into the committed folder.
  private: boolean;
  address: string | null;
  who: { label: string; id: string }; // the start sheet's "Who's it for?" (src/screens/Start.tsx WHO)
  answers: WaitAnswers;
  // The rendered test basements come with their true rooms (scripts/eval/generate.py).
  truth?: string;
};

const media = (...p: string[]) => join(MEDIA_ROOT, ...p);

// Same answers every time: the model's answers were recorded for exactly these. Any other question gets
// its first option.

export const TAKES: Take[] = [
  {
    id: "david-05x",
    label: "David's 0.5× take (web upload)",
    video: media("private/scans/566dc57b-b578-43b0-b897-484eee974de6/input.mp4"),
    via: "upload",
    private: true,
    address: "120 Avondale",
    who: { label: "Family, no rent", id: "family" },
    answers: { "What would you like it to be": "A suite for family" },
  },
  {
    id: "b2-family",
    label: "Rendered basement b2 (app, tracked camera)",
    video: media("eval/b2-finished-family/walkthrough.mp4"),
    capture: media("eval/b2-finished-family/capture.json"),
    via: "app",
    private: false,
    address: "120 Avondale",
    who: { label: "Rental at market rent", id: "rental_market" },
    answers: { "What would you like it to be": "A rental suite" },
    truth: media("eval/b2-finished-family/truth.json"),
  },
];

// What a take came out as when it was recorded; replay must match it.
export type Outcome = {
  verdict: string;
  headline: string;
  rooms: { name: string; size: string | null }[];
  finds: Record<string, number>;
  asked: { question: string; answer: string }[];
  permit: { pages: number; sheets: Record<string, string> };
  photos: number;
};

// Beside its saved answers.
const outcomeFile = (t: Take) => join(RECORD_DIR, "takes", `${t.id}.json`);
const recordedIn = (t: Take) => [PRIVATE_REPLAY, COMMITTED_REPLAY].map((d) => join(d, "takes", `${t.id}.json`)).find((p) => existsSync(p));

export function recordedOutcome(t: Take): Outcome | null {
  const at = recordedIn(t);
  return at ? JSON.parse(readFileSync(at, "utf8")) : null;
}

export function saveOutcome(t: Take, o: Outcome) {
  const file = outcomeFile(t);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, JSON.stringify(o, null, 1) + "\n");
}

// Why a take can't run here, or null when it can.
export function unavailable(t: Take): string | null {
  if (!existsSync(t.video)) return `its video isn't on this machine (${t.video})`;
  if (t.capture && !existsSync(t.capture)) return `its camera path isn't on this machine (${t.capture})`;
  if (mode === "replay" && !recordedOutcome(t)) return "not recorded yet: run pnpm test:e2e:record (it spends Meta credits; ask first)";
  if (mode === "record" && !process.env.E2E_TAKES?.split(",").includes(t.id)) return "recording costs money: name it in E2E_TAKES to record it";
  if (mode === "record" && t.private && RECORD_DIR === COMMITTED_REPLAY) return "a private take is never recorded into the committed folder";
  return null;
}
