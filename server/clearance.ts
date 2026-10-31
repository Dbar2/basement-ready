// Headroom under the ducts, beams and bulkheads, read across the whole basement once its rooms are
// measured (server/pipeline.ts finishRooms). A reading is set aside, and said so, when it can't be
// headroom:
// - It hangs more than MAX_DROP_M below its room's ceiling. Nothing you walk under is that deep; it's the
//   furnace's own ductwork, a post, or a box the 3D placed too low.
// - The same find was read more than DISAGREE_M apart in two rooms.
// Set-aside readings stay on the plan with no height, for a tape. What's left decides the clearance
// rule in code (server/assess.ts), the same on every take, and is what the plan and the permit show.
import type { Measurements } from "./scan3d";

export const MAX_DROP_M = 0.6;
export const DISAGREE_M = 0.25;
// 5/8" drywall under joists, ducts and beams: the finished headroom is this much lower than the scan's.
export const FINISH_ALLOWANCE_M = 0.016;

export type Doubtful = { detectionId: string; label: string; clearanceM: number; why: string };
type Measured = { name: string; measurements: Measurements | null };

// "Room 1", "your basement", "the Rec room": a room's name as it reads in a sentence.
export const placeName = (name: string) => (/^room \d+$/i.test(name) ? name : /^your basement$/i.test(name) ? "your basement" : `the ${name}`);

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const m2 = (n: number) => `${n.toFixed(2)} m`;

export function sortClearances<R extends Measured>(rooms: R[]): R[] {
  const ceilings = rooms.flatMap((r) => (r.measurements?.ceilingHeightM != null ? [r.measurements.ceilingHeightM] : []));
  const basementCeiling = ceilings.length ? median(ceilings) : null;
  const readings = new Map<string, number[]>();
  for (const r of rooms) for (const c of r.measurements?.clearances ?? []) readings.set(c.detectionId, [...(readings.get(c.detectionId) ?? []), c.clearanceM]);
  return rooms.map((r) => {
    const m = r.measurements;
    if (!m?.clearances.length) return r;
    // A room whose ceiling wasn't read is judged against the basement's.
    const ceiling = m.ceilingHeightM ?? basementCeiling;
    const kept: Measurements["clearances"] = [];
    const doubtful: Doubtful[] = [...(m.doubtful ?? [])];
    for (const c of m.clearances) {
      const others = readings.get(c.detectionId)!.filter((x) => x !== c.clearanceM);
      const what = c.label.toLowerCase();
      const why =
        ceiling != null && ceiling - c.clearanceM > MAX_DROP_M
          ? `${m2(c.clearanceM)} under the ${what} in ${placeName(r.name)} is ${m2(ceiling - c.clearanceM)} below its ${m2(ceiling)} ceiling, deeper than anything you walk under: likely the furnace's own ductwork or a box placed too low`
          : others.some((x) => Math.abs(x - c.clearanceM) > DISAGREE_M)
            ? `the ${what} read ${m2(c.clearanceM)} in ${placeName(r.name)} but ${others.map(m2).join(" and ")} from another room`
            : null;
      if (why) doubtful.push({ ...c, why });
      else kept.push(c);
    }
    return { ...r, measurements: { ...m, clearances: kept, ...(doubtful.length ? { doubtful } : {}) } };
  });
}

// Everything overhead the scan found in a room, set-aside readings with no height, for the plan.
export const overheadFinds = (m: Pick<Measurements, "clearances" | "doubtful"> | null | undefined): { detectionId: string; label: string; clearanceM: number | null }[] => [
  ...(m?.clearances ?? []),
  ...(m?.doubtful ?? []).map((d) => ({ detectionId: d.detectionId, label: d.label, clearanceM: null })),
];

export type ClearanceDecision = {
  status: "likely_ok" | "likely_fix" | "designer_checks";
  why: string;
  evidence: string[];
  measured: { value: number; unit: "m"; marginM: number; limit: number; source: Measurements["scaleSource"] } | null;
};

// The clearance rule from the lowest reading left in the basement, finished, with its error margin: a
// fix when even its best case is under the limit, met when its worst case clears it, the designer's to
// confirm in between. Null when nothing overhead was measured.
export function clearanceRule(rooms: Measured[], limit: number): ClearanceDecision | null {
  const readings = rooms.flatMap((r) => (r.measurements?.clearances ?? []).map((c) => ({ ...c, room: r.name, m: r.measurements! })));
  const doubtful = rooms.flatMap((r) => r.measurements?.doubtful ?? []);
  if (!readings.length && !doubtful.length) return null;
  // The lowest one set aside, as the example; a count for the rest.
  const worst = doubtful.reduce<Doubtful | null>((a, b) => (!a || b.clearanceM < a.clearanceM ? b : a), null);
  const setAside = worst
    ? ` ${doubtful.length === 1 ? "One reading was" : `${doubtful.length} readings were`} set aside as not headroom${doubtful.length > 1 ? ", the lowest" : ""}: ${worst.why}. A tape measurement settles ${doubtful.length === 1 ? "it" : "them"}.`
    : "";
  if (!readings.length) {
    return { status: "designer_checks", why: `The scan couldn't measure the headroom under the beams and ducts.${setAside}`, evidence: ["scan3d"], measured: null };
  }
  const low = readings.reduce((a, b) => (b.clearanceM < a.clearanceM ? b : a));
  const finished = low.clearanceM - FINISH_ALLOWANCE_M;
  // A tape is good to 5 cm; a scan to its own error, and at least a fifth when its floor or ceiling wasn't level.
  const pct = low.m.trusted ? low.m.expectedErrorPct : Math.max(low.m.expectedErrorPct, 20);
  const margin = low.m.scaleSource === "user_measurement" ? 0.05 : (finished * pct) / 100;
  const status = finished - margin >= limit ? "likely_ok" : finished + margin < limit ? "likely_fix" : "designer_checks";
  const reading = `The scan reads about ${m2(finished)} under the ${low.label.toLowerCase()} in ${placeName(low.room)} once finished (±${Math.round(margin * 100)} cm); the rule needs ${limit} m.`;
  const then = status === "likely_fix" ? " It has to be rerouted or raised, or the suite's rooms kept out from under it." : status === "designer_checks" ? " Your designer confirms it with a tape." : "";
  return {
    status,
    why: `${reading}${then}${setAside}`,
    evidence: [low.detectionId, "scan3d"],
    measured: { value: Math.round(finished * 100) / 100, unit: "m", marginM: Math.round(margin * 100) / 100, limit, source: low.m.scaleSource },
  };
}
