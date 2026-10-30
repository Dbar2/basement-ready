// Where the time goes in one scan, from its own event log (server/pipeline.ts emits each step with the
// seconds since the job started). Rows go into tmp/e2e/<run>/timing.jsonl and the report.
import type { APIRequestContext } from "@playwright/test";

export type ScanEvent = { at: number; type: string; text: string; data?: any };

// The whole event log of a finished scan: the events stream replays everything and ends at "done".
export async function scanEvents(request: APIRequestContext, scanId: string): Promise<ScanEvent[]> {
  const res = await request.get(`/api/scans/${scanId}/events`, { timeout: 60_000 });
  return (await res.text())
    .split("\n")
    .filter((l) => l.startsWith("data:"))
    .map((l) => JSON.parse(l.slice(5)));
}

// Seconds from the job's start to each milestone, in the order a homeowner sees them.
export function milestones(events: ScanEvent[]) {
  const first = (test: (e: ScanEvent) => boolean) => events.find(test)?.at ?? null;
  const last = (test: (e: ScanEvent) => boolean) => events.findLast(test)?.at ?? null;
  const stage = (id: string) => first((e) => e.type === "stage" && e.text === id);
  return {
    framesRead: first((e) => e.type === "log" && /^Reading \d+ frames/.test(e.text)),
    findStarted: stage("find"),
    firstFind: first((e) => e.type === "find"),
    allFinds: last((e) => e.type === "find"),
    walk3d: first((e) => e.type === "path"),
    firstArea3d: first((e) => e.type === "model" && e.data?.area !== "all"),
    measured: first((e) => e.type === "measure"),
    whole3d: first((e) => e.type === "model" && e.data?.area === "all"),
    assessStarted: stage("assess"),
    answer: first((e) => e.type === "done"),
    firstPhoto: first((e) => e.type === "photo"),
    photosDone: first((e) => e.type === "photos"),
    error: first((e) => e.type === "error"),
  };
}

export const MILESTONE_LABELS: Record<keyof ReturnType<typeof milestones>, string> = {
  framesRead: "Frames read (ffmpeg)",
  findStarted: "SAM started",
  firstFind: "First find",
  allFinds: "All finds (SAM)",
  walk3d: "3D walk",
  firstArea3d: "First area in 3D",
  measured: "Measured",
  whole3d: "Whole basement in 3D",
  assessStarted: "Rules check started",
  answer: "Answer ready",
  firstPhoto: "First photo",
  photosDone: "All photos",
  error: "Error",
};
