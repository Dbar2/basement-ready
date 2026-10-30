// How long the scan has left, from its own progress: the 3D's "Measuring area i of N" logs say how
// many areas are left and how long each one took, so the guess sharpens as it goes and follows a fast
// GPU or a slow Mac alike. A take with no 3D only waits on the finds and the rules check.
type Logged = { at: number; type: string; text: string };

const FINDS_S = 60; // reading the video and SAM's finds
const ROUGH_S = 45; // the rough pass over the whole walk
const AREA_S = 70; // one area, until the first one has been timed
const TAIL_S = 15; // the rules check and saving, once the 3D is done
const TYPICAL_AREAS = 2;

export function secondsLeft(events: Logged[], now: number): number | null {
  if (events.some((e) => e.type === "done")) return 0;
  const logs = events.filter((e) => e.type === "log");
  const no3d = logs.some((e) => /3D scan unavailable/.test(e.text));
  const mapping = no3d ? undefined : logs.find((e) => /Mapping your whole basement/.test(e.text));
  const areas = no3d
    ? []
    : logs.flatMap((e) => {
        const m = /Measuring area (\d+) of (\d+)/.exec(e.text);
        if (m) return [{ at: e.at, i: Number(m[1]), n: Number(m[2]) }];
        return /Measuring your basement/.test(e.text) ? [{ at: e.at, i: 1, n: 1 }] : [];
      });
  const measured = events.some((e) => e.type === "measure");
  if (!mapping && !areas.length) return Math.max(10, FINDS_S + 20 - now);
  if (measured) return Math.max(5, TAIL_S - (now - events.filter((e) => e.type === "measure").at(-1)!.at));
  if (!areas.length) return Math.max(0, ROUGH_S - (now - mapping!.at)) + TYPICAL_AREAS * AREA_S + TAIL_S;
  const last = areas.at(-1)!;
  // Each area so far took this long; the one under way is at least as long as it's been going.
  const took = areas.slice(1).map((a, k) => a.at - areas[k].at);
  const perArea = Math.max(took.length ? took.reduce((s, x) => s + x, 0) / took.length : AREA_S, now - last.at + 5);
  return (last.n - last.i) * perArea + Math.max(5, perArea - (now - last.at)) + TAIL_S;
}

export function leftWords(sec: number | null): string {
  if (sec === null) return "";
  if (sec <= 0) return "Done";
  if (sec < 15) return "Almost there";
  if (sec < 45) return "Less than a minute left";
  if (sec < 90) return "About a minute left";
  return `About ${Math.round(sec / 60)} min left`;
}

// When the wait itself is the news: nothing new for a minute and a half, or well past a usual scan, is
// slow; nothing new for 10 minutes is stalled, and "Try again" is offered (the server only re-runs it
// once no job is waiting for it).
export const SLOW_QUIET_S = 90;
export const SLOW_TOTAL_S = 8 * 60;
export const STALLED_QUIET_S = 10 * 60;

export function waitState(quietS: number, scanS: number): "ok" | "slow" | "stalled" {
  if (quietS >= STALLED_QUIET_S) return "stalled";
  if (quietS >= SLOW_QUIET_S || scanS >= SLOW_TOTAL_S) return "slow";
  return "ok";
}
