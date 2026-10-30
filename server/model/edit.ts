// One change to the basement, applied the same way wherever it comes from: a drag in the plan or the
// 3D, a one-tap fix, or a change muse-spark proposed. Pure: the old model is never touched, so the
// browser keeps every step for undo and redo.
//
// Moving a wall carries what's joined to it: the walls that end on it stretch, and the rooms it bounds
// grow or shrink with it, so the plan stays closed and the checks see the new sizes.
import { placeAlarms, burnsFuel } from "./alarms";
import { add, along, clamp, dot, mul, project, r3, roundPt, sub, wallDir, wallLength, wallNormal } from "./geometry";
import type { Design, Edit, Existing, Fixture, Opening, Pt, Room, Wall } from "./types";

export type Layer = { walls: Wall[]; openings: Opening[]; rooms: Room[]; fixtures: Fixture[] };

const NEAR = 0.06; // a point this close to a wall's line is on it

export function nextId(prefix: string, taken: { id: string }[]) {
  const ids = new Set(taken.map((t) => t.id));
  for (let n = taken.length + 1; ; n++) if (!ids.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
}

// An opening's centre stays inside its wall.
function fit(o: Opening, w: Wall): Opening {
  const L = wallLength(w);
  const half = Math.min(o.widthM, L) / 2;
  return { ...o, widthM: r3(Math.min(o.widthM, L)), offsetM: r3(clamp(o.offsetM, half, L - half)) };
}

function moveWall(layer: Layer, wallId: string, a: Pt, b: Pt): Layer {
  const w = layer.walls.find((x) => x.id === wallId);
  if (!w) return layer;
  const moved: Wall = { ...w, a: roundPt(a), b: roundPt(b) };
  const L = wallLength(w);
  // A slide sideways (same direction and length): what's joined to the wall comes along.
  const d = sub(moved.a, w.a);
  const n = wallNormal(w);
  const slide = Math.abs(dot(wallDir(w), wallDir(moved)) - 1) < 1e-4 && Math.abs(wallLength(moved) - L) < 0.01;
  const dn = mul(n, dot(d, n));
  const onOld = (p: Pt) => {
    const { t, off } = project(w, p);
    return Math.abs(off) < NEAR && t > -NEAR && t < L + NEAR;
  };
  let walls = layer.walls.map((x) => (x.id === wallId ? moved : x));
  let openings = layer.openings;
  let rooms = layer.rooms;
  if (slide && Math.hypot(dn[0], dn[1]) > 1e-6) {
    const before = new Map(layer.walls.map((x) => [x.id, x]));
    walls = walls.map((x) => {
      if (x.id === wallId) return x;
      const ma = onOld(x.a), mb = onOld(x.b);
      if (!ma && !mb) return x;
      return { ...x, a: ma ? roundPt(add(x.a, dn)) : x.a, b: mb ? roundPt(add(x.b, dn)) : x.b };
    });
    // Openings on a stretched wall stay where they are in the room.
    openings = openings.map((o) => {
      const old = before.get(o.wallId);
      const now = walls.find((x) => x.id === o.wallId);
      if (!old || !now || o.wallId === wallId || (old.a === now.a && old.b === now.b)) return o;
      return { ...o, offsetM: r3(project(now, along(old, o.offsetM)).t) };
    });
    rooms = rooms.map((r) => {
      const polygon = slideOutline(r.polygon, w, dn);
      return polygon ? { ...r, polygon } : r;
    });
  }
  // A wall squeezed to nothing goes, with its openings.
  const gone = new Set(walls.filter((x) => wallLength(x) < 0.02).map((x) => x.id));
  walls = walls.filter((x) => !gone.has(x.id));
  openings = openings.filter((o) => !gone.has(o.wallId)).map((o) => {
    const ow = walls.find((x) => x.id === o.wallId);
    return ow ? fit(o, ow) : o;
  });
  return { ...layer, walls, openings, rooms };
}

// A room's outline where a wall slid: the stretch of its edge along the wall moves with the wall. An
// edge longer than the wall gets a step in it (the living space around a bedroom becomes an L), so
// neighbouring rooms never overlap. Null when the room doesn't touch the wall.
export function slideOutline(poly: Pt[], w: Pick<Wall, "a" | "b">, dn: Pt): Pt[] | null {
  const L = wallLength(w);
  const on = (p: Pt) => {
    const { t, off } = project(w, p);
    return Math.abs(off) < NEAR && t > -NEAR && t < L + NEAR;
  };
  const line = (p: Pt) => Math.abs(project(w, p).off) < NEAR;
  const out: Pt[] = [];
  let touched = false;
  poly.forEach((p, i) => {
    const q = poly[(i + 1) % poly.length];
    if (on(p)) touched = true;
    out.push(on(p) ? roundPt(add(p, dn)) : p);
    if (!line(p) || !line(q)) return;
    const tp = project(w, p).t, tq = project(w, q).t;
    const lo = Math.max(Math.min(tp, tq), 0), hi = Math.min(Math.max(tp, tq), L);
    if (hi - lo < 0.02) return;
    touched = true;
    // Walking from p to q: step onto the wall's new line where the overlap starts, back where it ends.
    const [enter, leave] = tp <= tq ? [lo, hi] : [hi, lo];
    if (!on(p)) out.push(roundPt(along(w, enter)), roundPt(add(along(w, enter), dn)));
    if (!on(q)) out.push(roundPt(add(along(w, leave), dn)), roundPt(along(w, leave)));
  });
  if (!touched) return null;
  // Drop repeated points and points in the middle of a straight run.
  const clean = out.filter((p, i) => {
    const prev = out[(i - 1 + out.length) % out.length];
    return Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4;
  });
  return clean.filter((p, i) => {
    const a = clean[(i - 1 + clean.length) % clean.length], b = clean[(i + 1) % clean.length];
    return Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) > 1e-6;
  });
}

export function editLayer<T extends Layer>(layer: T, e: Edit): T {
  switch (e.op) {
    case "move_wall":
      return { ...layer, ...moveWall(layer, e.wallId, e.a, e.b) };
    case "add_wall": {
      const id = layer.walls.some((w) => w.id === e.wall.id) || !e.wall.id ? nextId("wall", layer.walls) : e.wall.id;
      return { ...layer, walls: [...layer.walls, { ...e.wall, id, a: roundPt(e.wall.a), b: roundPt(e.wall.b) }] };
    }
    case "remove_wall":
      return { ...layer, walls: layer.walls.filter((w) => w.id !== e.wallId), openings: layer.openings.filter((o) => o.wallId !== e.wallId) };
    case "set_wall":
      return {
        ...layer,
        walls: layer.walls.map((w) =>
          w.id === e.wallId
            ? { ...w, ...(e.rating !== undefined ? { rating: e.rating } : {}), ...(e.kind ? { kind: e.kind } : {}), ...(e.thicknessM ? { thicknessM: e.thicknessM } : {}) }
            : w,
        ),
      };
    case "add_opening": {
      const w = layer.walls.find((x) => x.id === e.opening.wallId);
      if (!w) return layer;
      const id = layer.openings.some((o) => o.id === e.opening.id) || !e.opening.id ? nextId(e.opening.kind, layer.openings) : e.opening.id;
      return { ...layer, openings: [...layer.openings, fit({ ...e.opening, id }, w)] };
    }
    case "move_opening":
    case "set_opening":
      return {
        ...layer,
        openings: layer.openings.map((o) => {
          if (o.id !== e.openingId) return o;
          const w = layer.walls.find((x) => x.id === o.wallId);
          const next: Opening =
            e.op === "move_opening"
              ? { ...o, offsetM: e.offsetM }
              : {
                  ...o,
                  ...(e.widthM !== undefined ? { widthM: e.widthM } : {}),
                  ...(e.heightM !== undefined ? { heightM: e.heightM } : {}),
                  ...(e.sillM !== undefined ? { sillM: e.sillM } : {}),
                  ...(e.rating !== undefined ? { rating: e.rating } : {}),
                  ...(e.swing !== undefined ? { swing: e.swing } : {}),
                };
          return w ? fit(next, w) : next;
        }),
      };
    case "remove_opening":
      return { ...layer, openings: layer.openings.filter((o) => o.id !== e.openingId) };
    case "add_room": {
      const id = layer.rooms.some((r) => r.id === e.room.id) || !e.room.id ? nextId(e.room.kind, layer.rooms) : e.room.id;
      return { ...layer, rooms: [...layer.rooms, { ...e.room, id, polygon: e.room.polygon.map(roundPt) }] };
    }
    case "remove_room":
      return { ...layer, rooms: layer.rooms.filter((r) => r.id !== e.roomId) };
    case "set_room":
      return {
        ...layer,
        rooms: layer.rooms.map((r) =>
          r.id === e.roomId
            ? {
                ...r,
                ...(e.kind ? { kind: e.kind } : {}),
                ...(e.name !== undefined ? { name: e.name } : {}),
                ...(e.polygon ? { polygon: e.polygon.map(roundPt) } : {}),
                ...(e.unit !== undefined ? { unit: e.unit } : {}),
                ...(e.ceilingRating !== undefined ? { ceilingRating: e.ceilingRating } : {}),
              }
            : r,
        ),
      };
    case "add_fixture": {
      const id = layer.fixtures.some((f) => f.id === e.fixture.id) || !e.fixture.id ? nextId(e.fixture.kind, layer.fixtures) : e.fixture.id;
      return { ...layer, fixtures: [...layer.fixtures, { ...e.fixture, id, at: roundPt(e.fixture.at) }] };
    }
    case "set_fixture":
      return {
        ...layer,
        fixtures: layer.fixtures.map((f) =>
          f.id === e.fixtureId
            ? {
                ...f,
                ...(e.kind ? { kind: e.kind } : {}),
                ...(e.at ? { at: roundPt(e.at), guess: false } : {}),
                ...(e.sizeM ? { sizeM: e.sizeM } : {}),
                ...(e.heightM !== undefined ? { heightM: e.heightM } : {}),
              }
            : f,
        ),
      };
    case "remove_fixture":
      return { ...layer, fixtures: layer.fixtures.filter((f) => f.id !== e.fixtureId) };
    case "set_finishes":
      return layer;
  }
}

// A change to a design. The alarms follow the rooms: they're placed again by the rules after every edit.
export function applyEdit(design: Design, e: Edit, now = new Date().toISOString()): Design {
  if (e.op === "set_finishes") return { ...design, finishes: { ...design.finishes, ...e.finishes }, updatedAt: now };
  const layer = editLayer({ ...design.proposed }, e);
  const next: Design = { ...design, proposed: { ...layer, alarms: design.proposed.alarms }, updatedAt: now };
  next.proposed.alarms = placeAlarms(next, burnsFuel(layer.fixtures));
  return next;
}

export const applyEdits = (design: Design, edits: Edit[], now?: string) => edits.reduce((d, e) => applyEdit(d, e, now), design);

// A correction to the basement as it is, on "Is this your basement?".
export function editExisting(existing: Existing, e: Edit): Existing {
  return { ...existing, ...editLayer({ walls: existing.walls, openings: existing.openings, rooms: existing.rooms, fixtures: existing.fixtures }, e) };
}

// Every size times k: from a tape number, the scan was that much too big or small.
export function rescale(existing: Existing, k: number): Existing {
  const p = (q: Pt): Pt => roundPt(mul(q, k));
  const m = (v: number | null | undefined) => (v == null ? v : r3(v * k));
  return {
    ...existing,
    walls: existing.walls.map((w) => ({ ...w, a: p(w.a), b: p(w.b) })),
    openings: existing.openings.map((o) => ({ ...o, offsetM: r3(o.offsetM * k), widthM: r3(o.widthM * k), heightM: m(o.heightM) ?? null, ...(o.sillM != null ? { sillM: m(o.sillM) } : {}) })),
    rooms: existing.rooms.map((r) => ({ ...r, polygon: r.polygon.map(p), ...(r.ceilingM != null ? { ceilingM: m(r.ceilingM) } : {}) })),
    fixtures: existing.fixtures.map((f) => ({ ...f, at: p(f.at), ...(f.sizeM ? { sizeM: p(f.sizeM) } : {}), ...(f.heightM != null ? { heightM: m(f.heightM) } : {}) })),
    ceilingM: m(existing.ceilingM) ?? null,
    scale: { ...existing.scale, factor: Math.round((existing.scale.factor ?? 1) * k * 10000) / 10000 },
  };
}

// They taped one wall: everything scales so that wall reads what the tape said. With two or more
// tape numbers the scale is their average, so one slip of the tape doesn't throw the plan.
export function withTape(existing: Existing, wallId: string, lengthM: number): Existing {
  const tapes = [...(existing.scale.tapeM ?? []).filter((t) => t.wallId !== wallId), { wallId, lengthM }];
  const ratios = tapes.flatMap((t) => {
    const w = existing.walls.find((x) => x.id === t.wallId);
    const L = w ? wallLength(w) : 0;
    return L > 0.2 && t.lengthM > 0.2 ? [t.lengthM / L] : [];
  });
  if (!ratios.length) return existing;
  const k = ratios.reduce((s, r) => s + r, 0) / ratios.length;
  const out = rescale(existing, k);
  return { ...out, scale: { ...out.scale, source: "tape", tapeM: tapes } };
}
