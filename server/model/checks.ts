// The rules a design is checked against, live in the studio and counted on the permit's readiness
// list: room sizes, the escape window, headroom, door and hall widths, a clear way out, the alarms and
// a fire separation that closes all the way around the suite and the stair. Pure and shared by the
// browser and the server. Where a check can be fixed by a change to the design, it carries the edits.
//
// Numbers from the rules pack (data/rules/waterloo-on.json) and the approved sets the City marked up:
// 30-minute walls and 15-minute floors between the units, 20-minute doors with closers.
import { burnsFuel } from "./alarms";
import {
  add,
  along,
  bounds,
  centroid,
  clamp,
  dist,
  distToSegment,
  dot,
  edges,
  floorArea,
  inPolygon,
  mul,
  project,
  r2,
  solidPieces,
  sub,
  unit,
  wallLength,
  wallNormal,
  type Box,
} from "./geometry";
import type { Check, Design, Edit, Existing, Opening, Pt, Room, Wall } from "./types";

export const LIMITS = {
  bedroomM2: 7,
  livingM2: 13.5,
  ceilingM: 1.95,
  underM: 1.85,
  doorM: 0.81,
  hallM: 0.86,
  stairM: 0.86,
  egressM2: 0.35,
  egressSideM: 0.38,
};
// 5/8" drywall under the joists: the finished ceiling is this much lower than the scan (server/assess.ts).
const FINISH_M = 0.016;

type Side = 2 | "other" | "outside";

// What's on each side of a point: the suite, the rest of the house (the stair, the furnace room, the
// main unit's rooms), or outside the basement. Open space in the area the suite is in counts as suite.
export function sides(design: Design, existing: Existing) {
  const rooms = design.proposed.rooms;
  const suite = rooms.filter((r) => r.unit === 2);
  const others = rooms.filter((r) => r.unit !== 2);
  const region = existing.rooms.filter((er) => suite.some((s) => inPolygon(centroid(s.polygon), er.polygon)));
  const rest = existing.rooms.filter((er) => !region.includes(er));
  const at = (p: Pt): Side => {
    if (others.some((r) => inPolygon(p, r.polygon))) return "other";
    if (suite.some((r) => inPolygon(p, r.polygon)) || region.some((r) => inPolygon(p, r.polygon))) return 2;
    if (rest.some((r) => inPolygon(p, r.polygon))) return "other";
    return "outside";
  };
  return { suite, others, region, at };
}

// Rooms overlap where the layout drew the living space over the stairs: count each floor once, as every
// page does (geometry.ts floorArea).
const netArea = (room: Room, others: Room[]) => floorArea(room, others);

// Openings whose centre sits on a room's outline.
export function openingsOn(room: Room, design: Design, kind: Opening["kind"]) {
  const { walls, openings } = design.proposed;
  return openings.filter((o) => {
    const w = walls.find((x) => x.id === o.wallId);
    if (o.kind !== kind || !w) return false;
    const c = along(w, o.offsetM);
    return edges(room.polygon).some(([p, q]) => distToSegment(c, p, q) < 0.2);
  });
}

// Where a room's edge runs along a wall: the wall, and the stretch of it the edge covers.
function edgeOnWalls(room: Room, walls: Wall[], pick: (w: Wall) => boolean) {
  const out: { wall: Wall; t0: number; t1: number; edge: [Pt, Pt] }[] = [];
  for (const [p, q] of edges(room.polygon)) {
    for (const w of walls.filter(pick)) {
      const P = project(w, p), Q = project(w, q);
      if (Math.abs(P.off) > 0.08 || Math.abs(Q.off) > 0.08) continue;
      const L = wallLength(w);
      const t0 = clamp(Math.min(P.t, Q.t), 0, L), t1 = clamp(Math.max(P.t, Q.t), 0, L);
      if (t1 - t0 > 0.3) out.push({ wall: w, t0, t1, edge: [p, q] });
    }
  }
  return out.sort((a, b) => b.t1 - b.t0 - (a.t1 - a.t0));
}

const word = (r: Room, all: Room[]) => {
  const same = all.filter((x) => x.kind === r.kind);
  return same.length > 1 ? r.name : r.kind === "bedroom" ? "the bedroom" : r.name.toLowerCase();
};

// ---- The way out: a walk over the floor on a 10 cm grid, kept clear of walls ----

const CELL = 0.1;

export function reachable(design: Design, existing: Existing, radius: number, doorsOpen: boolean) {
  const { walls, openings, rooms, fixtures } = design.proposed;
  const floor = [...existing.rooms, ...rooms].map((r) => r.polygon);
  if (!floor.length) return { reached: () => false, exits: 0 };
  const box: Box = bounds(floor.flat());
  const nx = Math.ceil((box.maxX - box.minX) / CELL) + 1, nz = Math.ceil((box.maxZ - box.minZ) / CELL) + 1;
  const pt = (i: number, k: number): Pt => [box.minX + (i + 0.5) * CELL, box.minZ + (k + 0.5) * CELL];
  const pieces = walls.flatMap((w) => solidPieces(w, openings));
  const doors = openings.flatMap((o) => {
    const w = o.kind === "door" ? walls.find((x) => x.id === o.wallId) : null;
    return w ? [{ o, w }] : [];
  });
  const free = new Uint8Array(nx * nz);
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const p = pt(i, k);
      if (!floor.some((poly) => inPolygon(p, poly))) continue;
      const inDoor = doorsOpen && doors.some(({ o, w }) => {
        const { t, off } = project(w, p);
        return Math.abs(t - o.offsetM) <= o.widthM / 2 && Math.abs(off) < 0.35;
      });
      if (inDoor || pieces.every(([a, b]) => distToSegment(p, a, b) >= radius)) free[k * nx + i] = 1;
    }
  // Ways out: the stairs, and a door in a foundation wall (to the outside).
  const stairs = [...rooms.filter((r) => r.kind === "stairs").map((r) => r.polygon), ...fixtures.filter((f) => f.kind === "stairs" && f.sizeM).map((f) => rectAround(f.at, f.sizeM!))];
  const outside = doors.filter(({ w }) => w.kind === "foundation").map(({ o, w }) => along(w, o.offsetM));
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  for (let k = 0; k < nz; k++)
    for (let i = 0; i < nx; i++) {
      const j = k * nx + i;
      const p = pt(i, k);
      if (free[j] && (stairs.some((s) => inPolygon(p, s)) || outside.some((d) => dist(d, p) < 0.7))) {
        seen[j] = 1;
        queue.push(j);
      }
    }
  const exits = queue.length;
  for (let q = 0; q < queue.length; q++) {
    const j = queue[q], i = j % nx, k = (j - i) / nx;
    for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = k + dk;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = b * nx + a;
      if (free[n] && !seen[n]) {
        seen[n] = 1;
        queue.push(n);
      }
    }
  }
  const at = (p: Pt) => {
    const i = Math.floor((p[0] - box.minX) / CELL), k = Math.floor((p[1] - box.minZ) / CELL);
    return i >= 0 && k >= 0 && i < nx && k < nz && seen[k * nx + i] === 1;
  };
  // A room is reached when any of its floor is.
  const reached = (poly: Pt[]) => {
    const b = bounds(poly);
    for (let x = b.minX + CELL / 2; x < b.maxX; x += CELL) for (let z = b.minZ + CELL / 2; z < b.maxZ; z += CELL) if (inPolygon([x, z], poly) && at([x, z])) return true;
    return false;
  };
  return { reached, exits, at };
}

export const rectAround = (c: Pt, s: Pt): Pt[] => [
  [c[0] - s[0] / 2, c[1] - s[1] / 2],
  [c[0] + s[0] / 2, c[1] - s[1] / 2],
  [c[0] + s[0] / 2, c[1] + s[1] / 2],
  [c[0] - s[0] / 2, c[1] + s[1] / 2],
];

// ---- The checks ----

export function checkDesign(design: Design, existing: Existing): Check[] {
  const out: Check[] = [];
  const { walls, openings, rooms, fixtures, alarms } = design.proposed;
  const S = sides(design, existing);
  const studio = design.layout === "studio";
  const beds = S.suite.filter((r) => r.kind === "bedroom");
  const confirmedScale = existing.scale.source === "tape" || existing.scale.source === "arkit" || existing.scale.source === "user_measurement";

  // Bedroom sizes, and a one-tap fix: slide its new wall out far enough.
  if (!studio)
    for (const bed of beds) {
      const area = netArea(bed, S.others);
      const ok = area >= LIMITS.bedroomM2;
      let fix: Check["fix"];
      if (!ok) {
        const e = edgeOnWalls(bed, walls, (w) => w.kind === "new")[0];
        if (e) {
          const need = (LIMITS.bedroomM2 + 0.1 - area) / (e.t1 - e.t0);
          const n = wallNormal(e.wall);
          const away = dot(sub(centroid(bed.polygon), along(e.wall, (e.t0 + e.t1) / 2)), n) > 0 ? -1 : 1;
          const d = mul(n, away * need);
          fix = { label: `Make ${word(bed, beds)} ${Math.ceil(need * 100)} cm deeper`, edits: [{ op: "move_wall", wallId: e.wall.id, a: add(e.wall.a, d), b: add(e.wall.b, d) }] };
        }
      }
      out.push({
        id: `bedroom-size:${bed.id}`,
        label: `${beds.length > 1 ? bed.name : "Bedroom"} is at least ${LIMITS.bedroomM2} m²`,
        ok,
        detail: `About ${area.toFixed(1)} m².`,
        ruleId: "min_room_sizes",
        fix,
        at: centroid(bed.polygon),
      });
    }

  // An escape window in every place someone sleeps: 0.35 m² open, no side under 38 cm.
  for (const bed of beds) {
    const wins = openingsOn(bed, design, "window");
    const grade = (o: Opening): boolean | null => {
      if (o.widthM < LIMITS.egressSideM) return false;
      if (o.heightM == null) return null;
      return o.heightM >= LIMITS.egressSideM && o.widthM * o.heightM >= LIMITS.egressM2;
    };
    const grades = wins.map(grade);
    const ok = grades.includes(true) ? true : grades.includes(null) ? null : false;
    const name = studio ? "The sleeping area" : beds.length > 1 ? bed.name : "The bedroom";
    let detail: string;
    let fix: Check["fix"];
    const unknown = wins.find((o) => grade(o) === null);
    if (ok === true) detail = "Its window opens at least 0.35 m², no side under 38 cm.";
    else if (unknown) detail = `Its window is ${Math.round(unknown.widthM * 100)} cm wide. It has to open at least ${Math.ceil(Math.max(LIMITS.egressSideM, LIMITS.egressM2 / unknown.widthM) * 100)} cm tall: measure it.`;
    else {
      detail = wins.length ? "Its window is too small to climb out of. It needs a bigger one." : "There's no window on its outside wall. It needs a new escape window, with a window well.";
      const ext = edgeOnWalls(bed, walls, (w) => w.kind === "foundation")[0];
      const small = wins[0];
      if (small) fix = { label: "Make the window an escape window", edits: [{ op: "set_opening", openingId: small.id, widthM: Math.max(small.widthM, 0.9), heightM: 0.6, sillM: 1.2 }] };
      else if (ext && ext.t1 - ext.t0 >= 1.1) {
        const taken = openings.filter((o) => o.wallId === ext.wall.id);
        let at = (ext.t0 + ext.t1) / 2;
        for (const o of taken) if (Math.abs(o.offsetM - at) < (o.widthM + 0.9) / 2 + 0.1) at = clamp(o.offsetM + Math.sign(at - o.offsetM || 1) * ((o.widthM + 0.9) / 2 + 0.15), ext.t0 + 0.5, ext.t1 - 0.5);
        fix = {
          label: "Add an escape window here",
          edits: [{ op: "add_opening", opening: { id: "", wallId: ext.wall.id, kind: "window", offsetM: r2(at), widthM: 0.9, heightM: 0.6, sillM: 1.2, status: "new" } }],
        };
      } else detail += " Its walls are all inside: move it to an outside wall.";
    }
    out.push({ id: `escape:${bed.id}`, label: `${name} has an escape window`, ok, detail, ruleId: "egress_window_bedroom_area", fix, at: centroid(bed.polygon) });
  }

  // Living space: living, dining and kitchen together (and the sleeping area in a studio).
  const living = S.suite.filter((r) => r.kind === "living" || r.kind === "kitchen" || (studio && r.kind === "bedroom"));
  const livingM2 = living.reduce((s, r) => s + netArea(r, S.others), 0);
  out.push({
    id: "living-space",
    label: `Living space is at least ${LIMITS.livingM2} m²`,
    ok: livingM2 >= LIMITS.livingM2,
    detail: `About ${livingM2.toFixed(1)} m²${studio ? ", living, sleeping and kitchen together" : ", kitchen included"}.`,
    ruleId: "min_room_sizes",
  });

  // A home: somewhere to cook, wash and sleep.
  const missing = [
    !S.suite.some((r) => r.kind === "kitchen") && "a kitchen",
    !S.suite.some((r) => r.kind === "bathroom") && "a bathroom",
    !beds.length && !studio && "a bedroom",
  ].filter(Boolean) as string[];
  out.push({
    id: "rooms",
    label: "It has a kitchen, a bathroom and a place to sleep",
    ok: missing.length === 0,
    detail: missing.length ? `It still needs ${missing.join(" and ")}.` : "Kitchen sink, bathroom sink, toilet, tub or shower.",
    ruleId: "plumbing_fixtures_and_shutoff",
  });

  // Headroom: the ceiling, and under beams, ducts and bulkheads.
  const ceilings = S.suite.map((r) => r.ceilingM ?? existing.ceilingM).filter((c): c is number => c != null);
  const ceiling = ceilings.length ? Math.min(...ceilings) - FINISH_M : null;
  out.push({
    id: "ceiling",
    label: `Ceiling is at least ${LIMITS.ceilingM} m`,
    ok: ceiling == null ? null : ceiling >= LIMITS.ceilingM,
    detail: ceiling == null ? "Measure from the floor to the joists." : `About ${ceiling.toFixed(2)} m finished${confirmedScale ? "" : ", from the scan"}.`,
    ruleId: "ceiling_height_suite",
  });
  const overhead = fixtures.filter((f) => (f.kind === "beam" || f.kind === "duct" || f.kind === "bulkhead") && (f.guess || S.at(f.at) === 2));
  const measured = overhead.filter((f) => f.heightM != null).sort((a, b) => a.heightM! - b.heightM!);
  const low = measured[0];
  const KIND: Record<string, string> = { beam: "the beam", duct: "the duct", bulkhead: "the bulkhead" };
  out.push({
    id: "headroom",
    label: `${LIMITS.underM} m under beams, ducts and bulkheads`,
    ok: !overhead.length ? true : low ? low.heightM! - FINISH_M >= LIMITS.underM : null,
    detail: !overhead.length
      ? "Nothing low overhead was seen."
      : !low
        ? "Measure under the lowest beam or duct."
        : low.heightM! - FINISH_M >= LIMITS.underM
          ? `Lowest is ${KIND[low.kind]}, ${(low.heightM! - FINISH_M).toFixed(2)} m.`
          : `Under ${KIND[low.kind]} it's ${(low.heightM! - FINISH_M).toFixed(2)} m. It has to be raised or rerouted, or the room kept clear under it.${low.guess ? " Drag it on the plan to where it really runs." : ""}`,
    ruleId: "clearance_beams_ducts_suite",
    at: low?.at,
  });

  // Doors into and inside the suite.
  const doorAt = (o: Opening) => {
    const w = walls.find((x) => x.id === o.wallId)!;
    return { w, c: along(w, o.offsetM), n: wallNormal(w) };
  };
  const suiteDoors = openings.filter((o) => {
    if (o.kind !== "door" || !walls.some((x) => x.id === o.wallId)) return false;
    const { c, n } = doorAt(o);
    return S.at(add(c, mul(n, 0.2))) === 2 || S.at(add(c, mul(n, -0.2))) === 2;
  });
  const narrow = suiteDoors.filter((o) => o.widthM < LIMITS.doorM - 0.005);
  out.push({
    id: "doors",
    label: `Doors are at least ${Math.round(LIMITS.doorM * 1000)} mm wide`,
    ok: narrow.length === 0,
    detail: narrow.length ? `${narrow.length === 1 ? "One door is" : `${narrow.length} doors are`} ${narrow.map((o) => `${Math.round(o.widthM * 100)} cm`).join(", ")}.` : `${suiteDoors.length} door${suiteDoors.length === 1 ? "" : "s"}, all wide enough.`,
    fix: narrow.length ? { label: narrow.length === 1 ? "Widen it to 81 cm" : "Widen them to 81 cm", edits: narrow.map((o) => ({ op: "set_opening", openingId: o.id, widthM: LIMITS.doorM })) } : undefined,
    at: narrow[0] ? doorAt(narrow[0]).c : undefined,
  });

  // A clear way out from every room, and halls wide enough to walk.
  const person = reachable(design, existing, 0.3, false);
  const shut = S.suite.filter((r) => !person.reached(r.polygon));
  let pathFix: Check["fix"];
  if (shut.length && person.exits) {
    const edits: Edit[] = [];
    for (const r of shut) {
      const e = edgeOnWalls(r, walls, (w) => w.kind !== "foundation").find((x) => {
        const mid = along(x.wall, (x.t0 + x.t1) / 2);
        const n = wallNormal(x.wall);
        return x.t1 - x.t0 >= 0.95 && [0.45, -0.45, 0.6, -0.6].some((s) => person.at?.(add(mid, mul(n, s))));
      });
      if (e) edits.push({ op: "add_opening", opening: { id: "", wallId: e.wall.id, kind: "door", offsetM: r2((e.t0 + e.t1) / 2), widthM: LIMITS.doorM, heightM: 2.03, status: "new", swing: "left", rating: e.wall.rating ? "20min" : null } });
    }
    if (edits.length) pathFix = { label: edits.length === 1 ? "Add a door" : "Add the doors", edits };
  }
  out.push({
    id: "way-out",
    label: "Every room has a clear way out",
    ok: person.exits === 0 ? false : shut.length === 0,
    detail: person.exits === 0 ? "No stairs or outside door were found. The suite needs a way out." : shut.length ? `No way out of ${shut.map((r) => word(r, S.suite)).join(" or ")}: a wall closes it in.` : "To the stairs or an outside door.",
    ruleId: "exit_from_suite",
    fix: pathFix,
    at: shut[0] ? centroid(shut[0].polygon) : undefined,
  });
  if (!shut.length && person.exits) {
    const hall = reachable(design, existing, LIMITS.hallM / 2, true);
    const tight = S.suite.filter((r) => !hall.reached(r.polygon));
    out.push({
      id: "halls",
      label: `Halls are at least ${Math.round(LIMITS.hallM * 100)} cm wide`,
      ok: tight.length === 0,
      detail: tight.length ? `The way to ${tight.map((r) => word(r, S.suite)).join(" and ")} is narrower than ${Math.round(LIMITS.hallM * 100)} cm somewhere.` : "Wide enough everywhere.",
      at: tight[0] ? centroid(tight[0].polygon) : undefined,
    });
  }

  // Alarms: in each bedroom and outside it, CO when something burns fuel, all wired together.
  const smoke = alarms.filter((a) => a.kind === "smoke" || a.kind === "combo");
  const bare = beds.filter((b) => !smoke.some((a) => inPolygon(a.at, b.polygon)));
  const hallAlarm = studio || !beds.length || smoke.some((a) => S.at(a.at) === 2 && !beds.some((b) => inPolygon(a.at, b.polygon)));
  out.push({
    id: "smoke-alarms",
    label: studio || !beds.length ? "A smoke alarm where they sleep" : "Smoke alarms in the bedroom and outside it",
    ok: bare.length === 0 && hallAlarm && smoke.length > 0,
    detail: bare.length ? `None in ${bare.map((b) => word(b, beds)).join(" or ")}.` : !hallAlarm ? "None between the bedroom and the rest of the suite." : `${smoke.length} smoke alarm${smoke.length === 1 ? "" : "s"} on the plan.`,
    ruleId: "smoke_alarms_interconnected",
  });
  const fuel = burnsFuel(fixtures);
  const co = alarms.filter((a) => (a.kind === "co" || a.kind === "combo") && S.at(a.at) === 2);
  out.push({
    id: "co-alarms",
    label: "A CO alarm beside where they sleep",
    ok: fuel ? co.length > 0 : null,
    detail: fuel ? (co.length ? "The furnace or water heater may burn gas: CO alarms are on the plan." : "Something here may burn gas, and there's no CO alarm.") : "No furnace or water heater was seen. If either burns gas, a CO alarm goes beside the bedroom.",
    ruleId: "co_alarms_interconnected",
  });
  out.push({
    id: "alarms-linked",
    label: "Alarms are wired together across both homes",
    ok: alarms.length > 0,
    detail: "Hard-wired, interconnected with the main floor's, with a light that flashes. On the plans as a note.",
    ruleId: "smoke_alarms_interconnected",
  });

  // The fire separation: rated walls wherever the suite meets the rest of the house, no gaps, and
  // 20-minute doors with closers in it.
  const needs = new Set<string>();
  const windowsIn: Opening[] = [];
  for (const w of walls) {
    const L = wallLength(w), n = wallNormal(w);
    for (let t = Math.min(0.15, L / 2); t <= L - Math.min(0.15, L / 2) + 1e-9; t += 0.2) {
      const p = along(w, t);
      const a = S.at(add(p, mul(n, 0.15))), b = S.at(add(p, mul(n, -0.15)));
      if ((a === 2 && b === "other") || (a === "other" && b === 2)) {
        needs.add(w.id);
        break;
      }
    }
  }
  const unrated = walls.filter((w) => needs.has(w.id) && w.rating !== "30min");
  for (const o of openings) if (o.kind === "window" && needs.has(o.wallId)) windowsIn.push(o);
  out.push({
    id: "separation-walls",
    label: "Walls between the homes are 30-minute rated",
    ok: unrated.length === 0 && windowsIn.length === 0,
    detail: unrated.length
      ? `${unrated.length === 1 ? "One wall" : `${unrated.length} walls`} between the suite and the rest of the house ${unrated.length === 1 ? "isn't" : "aren't"} rated yet.`
      : windowsIn.length
        ? "A window sits in a wall between the homes. It has to go or be a rated wall."
        : "5/8\" Type X drywall on both sides, sealed at the edges.",
    ruleId: "fire_separation_between_units",
    fix: unrated.length ? { label: "Rate them 30 minutes", edits: unrated.map((w) => ({ op: "set_wall", wallId: w.id, rating: "30min" })) } : undefined,
    at: unrated[0] ? along(unrated[0], wallLength(unrated[0]) / 2) : undefined,
  });

  // Gaps: where the stair, the furnace room or the house's rooms meet the suite with no wall at all.
  const gaps: { a: Pt; b: Pt }[] = [];
  for (const room of S.others) {
    const c = centroid(room.polygon);
    for (const [p, q] of edges(room.polygon)) {
      const L = dist(p, q);
      if (L < 0.2) continue;
      const d = unit(sub(q, p));
      let nOut: Pt = [d[1], -d[0]];
      if (dot(sub(add(p, mul(d, L / 2)), c), nOut) < 0) nOut = [-nOut[0], -nOut[1]];
      let run: number[] = [];
      const flush = () => {
        if (run.length) gaps.push({ a: add(p, mul(d, Math.max(0, run[0] - 0.1))), b: add(p, mul(d, Math.min(L, run.at(-1)! + 0.1))) });
        run = [];
      };
      for (let t = 0.1; t <= L - 0.1 + 1e-9; t += 0.2) {
        const s = add(p, mul(d, t));
        const open = S.at(add(s, mul(nOut, 0.15))) === 2 && !walls.some((w) => distToSegment(s, w.a, w.b) < 0.1);
        if (open) run.push(t);
        else flush();
      }
      flush();
    }
  }
  out.push({
    id: "separation-closed",
    label: "The separation closes all the way around, stair included",
    ok: gaps.length === 0,
    detail: gaps.length ? `${gaps.length === 1 ? "One opening" : `${gaps.length} openings`} with no wall between the suite and the ${S.others.some((r) => r.kind === "stairs") ? "stair" : "rest of the house"}.` : "Continuous around the suite and the stair, and through bulkheads.",
    ruleId: "fire_separation_between_units",
    fix: gaps.length
      ? { label: "Close the gaps with rated walls", edits: gaps.map((g) => ({ op: "add_wall", wall: { id: "", a: g.a, b: g.b, thicknessM: 0.12, kind: "new", rating: "30min" } })) }
      : undefined,
    at: gaps[0] ? mul(add(gaps[0].a, gaps[0].b), 0.5) : undefined,
  });
  const ceilingOpen = S.suite.filter((r) => !r.ceilingRating);
  out.push({
    id: "separation-ceiling",
    label: "The ceiling under the main floor is a 15-minute separation",
    ok: ceilingOpen.length === 0,
    detail: ceilingOpen.length ? `${ceilingOpen.length === 1 ? "One room's" : `${ceilingOpen.length} rooms'`} ceiling isn't rated yet.` : "5/8\" Type X under the joists, carried through the bulkheads.",
    ruleId: "fire_separation_between_units",
    fix: ceilingOpen.length ? { label: "Rate the ceiling 15 minutes", edits: ceilingOpen.map((r) => ({ op: "set_room", roomId: r.id, ceilingRating: "15min" })) } : undefined,
  });
  const plainDoors = openings.filter((o) => o.kind === "door" && needs.has(o.wallId) && o.rating !== "20min");
  out.push({
    id: "separation-doors",
    label: "Doors between the homes are 20-minute, with a closer",
    ok: plainDoors.length === 0,
    detail: plainDoors.length ? `${plainDoors.length === 1 ? "A door" : `${plainDoors.length} doors`} in the separation ${plainDoors.length === 1 ? "isn't" : "aren't"} rated.` : "Solid-core, self-closing, latching.",
    ruleId: "fire_separation_between_units",
    fix: plainDoors.length ? { label: "Make them 20-minute doors", edits: plainDoors.map((o) => ({ op: "set_opening", openingId: o.id, rating: "20min" })) } : undefined,
    at: plainDoors[0] ? along(walls.find((w) => w.id === plainDoors[0].wallId)!, plainDoors[0].offsetM) : undefined,
  });

  // The furnace and water heater serve both homes: in a room of their own off the suite (or on the
  // house's side), behind the rated walls and a rated door.
  const appliances = fixtures.filter((f) => f.kind === "furnace" || f.kind === "water_heater");
  if (appliances.length) {
    const loose = appliances.filter((f) => S.at(f.at) === 2);
    const homes = rooms.filter((r) => r.unit !== 2 && appliances.some((f) => inPolygon(f.at, r.polygon)));
    const touches = (w: Wall, r: Room) => {
      const L = wallLength(w), n = wallNormal(w);
      for (let t = Math.min(0.15, L / 2); t <= L - Math.min(0.15, L / 2) + 1e-9; t += 0.2) {
        const p = along(w, t);
        if (inPolygon(add(p, mul(n, 0.15)), r.polygon) || inPolygon(add(p, mul(n, -0.15)), r.polygon)) return true;
      }
      return false;
    };
    const around = walls.filter((w) => needs.has(w.id) && homes.some((r) => touches(w, r)));
    const weak = around.filter((w) => w.rating !== "30min").length + openings.filter((o) => o.kind === "door" && around.some((w) => w.id === o.wallId) && o.rating !== "20min").length;
    const furnace = appliances.some((f) => f.kind === "furnace"), heater = appliances.some((f) => f.kind === "water_heater");
    const name = furnace && heater ? "The furnace and water heater" : furnace ? "The furnace" : "The water heater";
    out.push({
      id: "service-room",
      label: `${name} ${furnace && heater ? "are" : "is"} in a fire-separated service room`,
      ok: loose.length === 0 && weak === 0,
      detail: loose.length
        ? `${loose.length === appliances.length ? name : "One of them"} stands in the suite. ${furnace && heater ? "They serve" : "It serves"} both homes, so ${furnace && heater ? "they go" : "it goes"} in a room of ${furnace && heater ? "their" : "its"} own: 30-minute walls and a 20-minute door with a closer.`
        : weak
          ? "Its walls or door toward the suite aren't rated yet."
          : homes[0]
            ? `In the ${homes[0].name.toLowerCase()}, behind 30-minute walls and a 20-minute door with a closer.`
            : "On the house's side of the fire separation.",
      ruleId: "service_room_separation",
      at: loose[0]?.at,
    });
  }

  // The stair everyone uses to get out.
  const stair = fixtures.find((f) => f.kind === "stairs" && f.sizeM);
  if (stair) {
    const width = Math.min(stair.sizeM![0], stair.sizeM![1]);
    const ok = width >= LIMITS.stairM - 0.005 ? true : confirmedScale ? false : null;
    out.push({
      id: "stairs",
      label: `Stairs are at least ${Math.round(LIMITS.stairM * 100)} cm wide`,
      ok,
      detail: ok ? `About ${Math.round(width * 100)} cm, with a handrail, a guard and a light switch at the top and bottom.` : `They look about ${Math.round(width * 100)} cm wide. Measure them: exit stairs need ${Math.round(LIMITS.stairM * 100)} cm.`,
      ruleId: "stair_width",
      at: stair.at,
    });
  }

  // Notes for the drawings that a person confirms.
  const laundry = rooms.some((r) => r.kind === "laundry");
  out.push({
    id: "laundry",
    label: "Laundry for both homes",
    ok: laundry ? true : null,
    detail: laundry ? "On the plan, with its own dryer vent." : "Where does each home do laundry? A shared one sits outside both units, behind the separation.",
    ruleId: "plumbing_fixtures_and_shutoff",
  });
  out.push({
    id: "services",
    label: "Its own water shut-off, hot water and fan",
    ok: null,
    detail: "Its own water shut-off, hot water at most 49 °C, a 50 CFM bathroom fan. On the plans as notes.",
    ruleId: "plumbing_fixtures_and_shutoff",
  });
  out.push({
    id: "plan-confirmed",
    label: "The plan is confirmed",
    ok: existing.confirmedAt && confirmedScale ? true : null,
    detail: !existing.confirmedAt ? "Check the plan matches your basement." : confirmedScale ? "Checked by you, with a tape number." : "Checked by you. One tape number locks every size.",
  });
  return out;
}

export function tally(checks: Check[]) {
  return { ok: checks.filter((c) => c.ok === true).length, fix: checks.filter((c) => c.ok === false).length, confirm: checks.filter((c) => c.ok === null).length };
}
