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

// Meta's prices as the app counts them (server/spend.ts PRICES): SAM $0.20 per 1,000 video frames and
// $0.0025 a picture, Muse Image $0.01 an image, Muse Spark $1.25 / $4.25 and Muse Wonder $4 / $20 per
// million tokens in / out. Modal: about $0.03 an area.
const SAM_PER_FRAME = 0.2 / 1000;
const SAM_PER_PICTURE = 2.5 / 1000;
// A token-priced read (Spark or Wonder), from the saved answer's usage.
const tokenUsd = (key: string, inPer: number, outPer: number) => {
  const at = [PRIVATE_REPLAY, COMMITTED_REPLAY].map((d) => join(d, `${key}.json`)).find((p) => existsSync(p));
  const usage = at ? JSON.parse(JSON.parse(readFileSync(at, "utf8")).body ?? "{}").usage : null;
  return usage ? (usage.input_tokens ?? 0) * inPer + (usage.output_tokens ?? 0) * outPer : 0;
};

export function costOf(calls: Call[], frames: number, onModal: boolean) {
  const n = (test: (c: Call) => boolean) => calls.filter(test).length;
  const parts = {
    samVideoConcepts: n((c) => c.model === "sam-3.1" && c.input === "video"),
    samPictureChecks: n((c) => c.model === "sam-3.1" && c.input === "image"),
    museImages: n((c) => c.route === "/images/edits"),
    sparkReads: n((c) => c.model?.startsWith("muse-spark") ?? false),
    wonderReads: n((c) => c.model?.startsWith("muse-wonder") ?? false),
    voice: n((c) => c.route === "/asr/transcribe"),
    areas3d: n((c) => c.service === "scan3d" && c.route === "/scan"),
  };
  const usd =
    parts.samVideoConcepts * Math.max(50, frames) * SAM_PER_FRAME +
    parts.samPictureChecks * SAM_PER_PICTURE +
    parts.museImages * 0.01 +
    calls.filter((c) => c.model?.startsWith("muse-spark")).reduce((s, c) => s + tokenUsd(c.key, 1.25e-6, 4.25e-6), 0) +
    calls.filter((c) => c.model?.startsWith("muse-wonder")).reduce((s, c) => s + tokenUsd(c.key, 4e-6, 20e-6), 0) +
    (onModal ? parts.areas3d * 0.03 : 0);
  return { ...parts, usd: Math.round(usd * 100) / 100 };
}
