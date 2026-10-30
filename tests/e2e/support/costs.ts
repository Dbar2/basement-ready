// What recording spent: only calls that really went out (a saved answer reused in record mode is free).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMMITTED_REPLAY, files, PRIVATE_REPLAY } from "./run";

type Call = { at: string; event: string; key: string; service: string; route: string; model: string | null; input: string | null; status?: number };

// The calls made for real in this run since `since` (ms), from the replay log.
export function realCalls(since: number, until = Infinity): Call[] {
  if (!existsSync(files.replayLog)) return [];
  return readFileSync(files.replayLog, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Call)
    .filter((c) => c.event === "recorded" && c.status === 200 && Date.parse(c.at) >= since && Date.parse(c.at) <= until);
}

// Meta's prices (Oct 2026): SAM $0.20 per 1,000 frames with a 50-frame minimum per request, Muse Image
// $0.01 an image, Muse Spark $1.25 / $4.25 per million tokens in / out. Modal: about $0.03 an area.
const SAM_PER_FRAME = 0.2 / 1000;
const sparkUsd = (key: string) => {
  const at = [PRIVATE_REPLAY, COMMITTED_REPLAY].map((d) => join(d, `${key}.json`)).find((p) => existsSync(p));
  const usage = at ? JSON.parse(JSON.parse(readFileSync(at, "utf8")).body ?? "{}").usage : null;
  return usage ? (usage.input_tokens ?? 0) * 1.25e-6 + (usage.output_tokens ?? 0) * 4.25e-6 : 0;
};

export function costOf(calls: Call[], frames: number, onModal: boolean) {
  const n = (test: (c: Call) => boolean) => calls.filter(test).length;
  const parts = {
    samVideoConcepts: n((c) => c.model === "sam-3.1" && c.input === "video"),
    samPictureChecks: n((c) => c.model === "sam-3.1" && c.input === "image"),
    museImages: n((c) => c.route === "/images/edits"),
    sparkReads: n((c) => c.model?.startsWith("muse-spark") ?? false),
    voice: n((c) => c.route === "/asr/transcribe"),
    areas3d: n((c) => c.service === "scan3d" && c.route === "/scan"),
  };
  const usd =
    parts.samVideoConcepts * Math.max(50, frames) * SAM_PER_FRAME +
    parts.samPictureChecks * 50 * SAM_PER_FRAME +
    parts.museImages * 0.01 +
    calls.filter((c) => c.model?.startsWith("muse-spark")).reduce((s, c) => s + sparkUsd(c.key), 0) +
    (onModal ? parts.areas3d * 0.03 : 0);
  return { ...parts, usd: Math.round(usd * 100) / 100 };
}
