// Whether the basement home has its own way in: the first thing that decides if it can be a second home at
// all, before any layout. Ontario's rule for a house five years old or more (2024 Building Code
// Compendium, Division B, Table 11.5.1.1.-C, compliance alternative C139, for Subsection 9.9.9.; the
// rules packs' exit_from_suite): the suite needs (a) its own door straight outside, with reasonable access
// to ground level, or (b) a shared exit, fire-separated at 30 minutes, that doesn't pass through the other
// home or a service room. Leaving through the other home (with an extra escape window) or a sprinklered
// house are the rare others.
import { along, distToSegment, edges, wallLength } from "./geometry";
import type { Design, Existing, Opening, Room, Wall } from "./types";

export const ENTRANCE_RULE = "exit_from_suite";
export const ENTRANCE_SOURCE = "Ontario Building Code, Division B, Table 11.5.1.1.-C, C139";
// A door this wide or wider in an outside wall is a way in: the scan calls narrower things doors too.
export const ENTRANCE_MIN_M = 0.7;
const NEW_DOOR_M = 0.9;

export type Entrance = { status: "own" | "needed" | "unknown"; why: string };

// The doors in outside walls wide enough to walk through.
export const outsideDoors = (walls: Wall[], openings: Opening[]) =>
  openings.filter((o) => o.kind === "door" && o.widthM >= ENTRANCE_MIN_M && walls.find((w) => w.id === o.wallId)?.kind === "foundation");

// From what they told us (`said`: is there a door from the basement straight outside?), which they know
// better than the scan, and else what the scan saw.
export function entranceOf(existing: Pick<Existing, "walls" | "openings">, said: boolean | null): Entrance {
  if (said === true) return { status: "own", why: "You told us there's a door from the basement straight outside." };
  if (said === null && outsideDoors(existing.walls, existing.openings).length) return { status: "own", why: "The video shows a door in an outside wall: the basement home's own way in." };
  if (said === false)
    return {
      status: "needed",
      why: `There's no door from the basement straight outside, and the stairs come up inside the house. A second home needs its own way in first (${ENTRANCE_SOURCE}): a new entrance at the side or back, or a shared stair to a side door, fire-separated.`,
    };
  return { status: "unknown", why: "Its own door straight outside, or a shared stair to a side door that can be fire-separated: tell us which there is." };
}

// What a finding of the rule says they answered: kept a fix (they said no), met (they said yes).
export function saidOutside(findings: { ruleId?: string; status?: string }[] | null | undefined): boolean | null {
  const f = (findings ?? []).find((x) => x.ruleId === ENTRANCE_RULE);
  return f?.status === "likely_fix" ? false : f?.status === "likely_ok" ? true : null;
}

// Where a new entrance goes: in an outside wall of the living space, on its longest stretch clear of
// windows and doors, as far from where they sleep as it can be. People come in where they live, not
// through a bedroom.
export function newEntrance(design: Design): Opening | null {
  const { walls, openings, rooms } = design.proposed;
  const living = rooms.filter((r) => r.unit === 2 && (r.kind === "living" || r.kind === "kitchen"));
  const beds = rooms.filter((r) => r.unit === 2 && r.kind === "bedroom");
  const onRoom = (w: Wall, r: Room) => edges(r.polygon).some(([p, q]) => distToSegment(along(w, wallLength(w) / 2), p, q) < 0.2 || (distToSegment(p, w.a, w.b) < 0.15 && distToSegment(q, w.a, w.b) < 0.15));
  let best: { w: Wall; t: number; score: number } | null = null;
  for (const w of walls.filter((x) => x.kind === "foundation" && living.some((r) => onRoom(x, r)))) {
    const L = wallLength(w);
    // The stretch clear of the openings already in it, with 30 cm either side.
    const taken = openings.filter((o) => o.wallId === w.id).map((o) => [o.offsetM - o.widthM / 2 - 0.3, o.offsetM + o.widthM / 2 + 0.3] as const);
    for (let t = NEW_DOOR_M / 2 + 0.3; t <= L - NEW_DOOR_M / 2 - 0.3 + 1e-9; t += 0.1) {
      if (taken.some(([a, b]) => t + NEW_DOOR_M / 2 > a && t - NEW_DOOR_M / 2 < b)) continue;
      const p = along(w, t);
      if (!living.some((r) => edges(r.polygon).some(([a, b]) => distToSegment(p, a, b) < 0.25))) continue;
      const fromBed = beds.length ? Math.min(...beds.map((b) => Math.min(...edges(b.polygon).map(([a, c]) => distToSegment(p, a, c))))) : 3;
      const score = Math.min(fromBed, 4);
      if (!best || score > best.score + 1e-6) best = { w, t, score };
    }
  }
  if (!best) return null;
  return { id: "", wallId: best.w.id, kind: "door", offsetM: Math.round(best.t * 1000) / 1000, widthM: NEW_DOOR_M, heightM: 2.03, status: "new", swing: "left", rating: null };
}
