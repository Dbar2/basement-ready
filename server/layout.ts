// A starting layout for the suite, drawn inside the real room from the scan: where the bedroom,
// bathroom, kitchen and living space could go. Pure and rule-checked: the bedroom gets the escape
// window, rooms meet minimum sizes, the stairs and furnace stay clear, and the bathroom goes where the
// plumbing already comes up through the floor. A designer refines it; this is so a homeowner can see
// their basement as a home.
import { LIMITS } from "./model/checks";
import type { Plan, Side } from "./plan";
import { nearestSide } from "./side";

export type ZoneKind = "bedroom" | "bathroom" | "kitchen" | "living" | "stairs" | "mechanical";
export type Rect = { x0: number; z0: number; x1: number; z1: number };
export type Zone = Rect & { kind: ZoneKind; name: string; areaM2: number };
export type Wall = { x0: number; z0: number; x1: number; z1: number };
export type Door = { x: number; z: number; along: "x" | "z"; widthM: number };
export type Layout = {
  version: 1;
  kind: "one_bedroom" | "studio";
  zones: Zone[];
  walls: Wall[]; // new partition walls
  doors: Door[]; // doors in the new walls
  // The biggest window, the bedroom's escape window if it meets the rule. inBedroom: the bedroom takes it
  // in (answers saved before Oct 30 lack it: their escape check's tick said so).
  window: { side: Side; atM: number; widthM: number; inBedroom?: boolean } | null;
  checks: { label: string; ok: boolean | null; detail: string }[];
};

const BEDROOM_MIN_M2 = 7; // Ontario Building Code 9.5.7: a bedroom other than the main one
const LIVING_MIN_M2 = 13.5; // the rules pack's combined living space minimum
const BED_DEPTH = 3.3;
const BED_ALONG = 3.2;
const BATH_DEPTH = 1.6;
const BATH_ALONG = 2.4;
const COUNTER = 0.65;
// A kitchen is at least a galley: one run of sink, range and fridge (2.4 m holds them, 3 m is roomier)
// and a clear aisle in front of it to work in.
const AISLE = 1.0;
const GALLEY = COUNTER + AISLE;
const KITCHEN_RUNS = [3.0, 2.4];
export const GALLEY_MIN_M2 = Math.round(KITCHEN_RUNS[1] * GALLEY * 100) / 100; // 3.96 m²
export const BATH_MIN_M2 = 3.5; // a three-piece bathroom is about 3.5 to 5 m²
const BATH_MAX_M2 = 5;
const DOOR_W = 0.8;
const DOOR_CLEAR = 1.0;

const r2 = (n: number) => Math.round(n * 100) / 100;
const area = (r: Rect) => r2(Math.abs(r.x1 - r.x0) * Math.abs(r.z1 - r.z0));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Work in (along, into-room) coordinates for one wall, then map back to the plan's x and z.
function frame(box: Plan["box"], side: Side) {
  const alongX = side === "minZ" || side === "maxZ";
  const aMin = alongX ? box.minX : box.minZ;
  const aMax = alongX ? box.maxX : box.maxZ;
  const c0 = side === "minX" ? box.minX : side === "maxX" ? box.maxX : side === "minZ" ? box.minZ : box.maxZ;
  const dir = side.startsWith("min") ? 1 : -1;
  const reach = alongX ? box.maxZ - box.minZ : box.maxX - box.minX;
  // A rectangle from a0..a1 along the wall, d0..d1 metres into the room.
  const rect = (a0: number, a1: number, d0: number, d1: number): Rect => {
    const c = [c0 + dir * d0, c0 + dir * d1].sort((p, q) => p - q);
    return alongX ? { x0: r2(a0), x1: r2(a1), z0: r2(c[0]), z1: r2(c[1]) } : { x0: r2(c[0]), x1: r2(c[1]), z0: r2(a0), z1: r2(a1) };
  };
  return { alongX, aMin, aMax, reach, rect };
}

const opposite: Record<Side, Side> = { minX: "maxX", maxX: "minX", minZ: "maxZ", maxZ: "minZ" };

// The landing at the foot of each flight whose foot the scan could tell: kept clear, so you can step off
// the stairs and open the door (server/model/seed.ts walls it in with the stairs).
export const LANDING_M = 1.0;
export function landings(plan: Plan): Rect[] {
  const box = plan.box;
  return plan.stairs.flatMap((st) => {
    if (!st.bottom) return [];
    const alongX = st.x1 - st.x0 >= st.z1 - st.z0;
    const [lo, hi] = alongX ? [st.x0, st.x1] : [st.z0, st.z1];
    const b = alongX ? st.bottom[0] : st.bottom[1];
    const [a0, a1] = Math.abs(b - hi) <= Math.abs(b - lo) ? [hi, Math.min(hi + LANDING_M, alongX ? box.maxX : box.maxZ)] : [Math.max(lo - LANDING_M, alongX ? box.minX : box.minZ), lo];
    return a1 - a0 > 0.05 ? [alongX ? { x0: r2(a0), x1: r2(a1), z0: st.z0, z1: st.z1 } : { x0: st.x0, x1: st.x1, z0: r2(a0), z1: r2(a1) }] : [];
  });
}

// The service room: the furnace and the water heater beside it (within 2.5 m) in one room. A found
// furnace or water heater is where the camera saw its face, which faces into the room: the room runs
// from the wall behind it to SERVICE_FRONT_M in front of the face, and half the appliance's width (and a
// little) past each side. An end that would leave a strip too narrow to use runs on to the wall. Both
// appliances serve the house and the suite, so the room is walled off from the suite at 30 minutes, with
// a 20-minute door (server/model/seed.ts).
const HALF_W: Record<string, number> = { furnace: 0.3, water_heater: 0.3 };
const SERVICE_FRONT_M = 0.6; // to stand at the front and service them
const SERVICE_END_M = 0.15;
const TO_WALL_M = 1.2; // a face this near a wall: the appliance stands against it
const USELESS_M = 1.5; // a strip narrower than this between the room and a wall is no use to the suite
export function serviceRoom(plan: Plan): { name: string; rect: Rect } | null {
  const box = plan.box;
  const mech = plan.fixtures.filter((x) => x.kind === "furnace" || x.kind === "water_heater");
  const first = mech.find((x) => x.kind === "furnace") ?? mech[0];
  if (!first) return null;
  const group = mech.filter((x) => Math.hypot(x.x - first.x, x.z - first.z) <= 2.5);
  const name = group.some((x) => x.kind === "furnace") ? "Furnace room" : "Water heater room";
  const cx = group.reduce((s, x) => s + x.x, 0) / group.length, cz = group.reduce((s, x) => s + x.z, 0) / group.length;
  const { side, dist } = nearestSide(box, cx, cz);
  const pad = (x: (typeof group)[number]) => HALF_W[x.kind] + SERVICE_END_M;
  let r: Rect;
  if (dist <= TO_WALL_M) {
    // Against a wall: back to it, out to the front, along it past each end.
    const alongX = side === "minZ" || side === "maxZ";
    const a0 = Math.min(...group.map((x) => (alongX ? x.x : x.z) - pad(x))), a1 = Math.max(...group.map((x) => (alongX ? x.x : x.z) + pad(x)));
    const faces = group.map((x) => (alongX ? x.z : x.x));
    const back = box[side];
    const front = side.startsWith("min") ? Math.max(...faces) + SERVICE_FRONT_M : Math.min(...faces) - SERVICE_FRONT_M;
    const [d0, d1] = [back, front].sort((p, q) => p - q);
    r = alongX ? { x0: a0, x1: a1, z0: d0, z1: d1 } : { x0: d0, x1: d1, z0: a0, z1: a1 };
  } else {
    // Out in the room: room to work all round.
    const grow = SERVICE_FRONT_M;
    r = { x0: Math.min(...group.map((x) => x.x - grow)), x1: Math.max(...group.map((x) => x.x + grow)), z0: Math.min(...group.map((x) => x.z - grow)), z1: Math.max(...group.map((x) => x.z + grow)) };
  }
  r = { x0: clamp(r.x0, box.minX, box.maxX), x1: clamp(r.x1, box.minX, box.maxX), z0: clamp(r.z0, box.minZ, box.maxZ), z1: clamp(r.z1, box.minZ, box.maxZ) };
  // A strip too narrow to use, left between the room and the stairs or a wall, goes in the room (never
  // over the stairs or their landing).
  const stairs: Rect[] = [...plan.stairs.map((st) => ({ x0: st.x0, x1: st.x1, z0: st.z0, z1: st.z1 })), ...landings(plan)];
  const onStairs = (q: Rect) => stairs.some((st) => q.x0 < st.x1 - 0.05 && q.x1 > st.x0 + 0.05 && q.z0 < st.z1 - 0.05 && q.z1 > st.z0 + 0.05);
  for (const st of stairs) {
    const acrossX = st.x0 < r.x1 - 0.05 && st.x1 > r.x0 + 0.05, acrossZ = st.z0 < r.z1 - 0.05 && st.z1 > r.z0 + 0.05;
    if (acrossX && st.z1 <= r.z0 + 0.01 && r.z0 - st.z1 < USELESS_M) r = { ...r, z0: st.z1 };
    if (acrossX && st.z0 >= r.z1 - 0.01 && st.z0 - r.z1 < USELESS_M) r = { ...r, z1: st.z0 };
    if (acrossZ && st.x1 <= r.x0 + 0.01 && r.x0 - st.x1 < USELESS_M) r = { ...r, x0: st.x1 };
    if (acrossZ && st.x0 >= r.x1 - 0.01 && st.x0 - r.x1 < USELESS_M) r = { ...r, x1: st.x0 };
  }
  for (const [k, edge] of [["x0", box.minX], ["x1", box.maxX], ["z0", box.minZ], ["z1", box.maxZ]] as const) {
    const left = Math.abs(r[k] - edge);
    if (left > 0.01 && left < USELESS_M && !onStairs({ ...r, [k]: edge })) r = { ...r, [k]: edge };
  }
  return { name, rect: { x0: r2(r.x0), x1: r2(r.x1), z0: r2(r.z0), z1: r2(r.z1) } };
}

// Options for exploring ideas: force a studio or a one-bedroom, or put the bedroom on another wall.
// `without`: rooms another room of the basement takes (server/model/seed.ts puts them there).
export type LayoutOptions = { kind?: Layout["kind"] | null; side?: Side | null; without?: ZoneKind[] };

// The scan has the window's width, not its height: it meets the rule only once a tape shows it does,
// and it can't when it's narrower than 38 cm. Never a tick for a size nobody has.
function escapeCheck(win: { widthM: number } | null, inBedroom: boolean): Layout["checks"][number] {
  const cm = win ? Math.round(win.widthM * 100) : 0;
  const narrow = Boolean(win && win.widthM < LIMITS.egressSideM);
  const tall = win ? Math.ceil(Math.max(LIMITS.egressSideM, LIMITS.egressM2 / win.widthM) * 100) : 0;
  return {
    label: "The bedroom has an escape window",
    ok: inBedroom && win ? (narrow ? false : null) : false,
    detail:
      inBedroom && win
        ? narrow
          ? `The bedroom's window is ${cm} cm wide, under the 38 cm an escape window needs: it needs a bigger one.`
          : `The bedroom sits on the wall with your biggest window, ${cm} cm wide. To be an escape window it has to open at least ${tall} cm tall (0.35 m², no side under 38 cm): measure it.`
        : win
          ? "The stairs are in the way of the window wall: the bedroom needs a new escape window where it is."
          : "No window was seen in this room: the bedroom needs a new escape window (in your fixes).",
  };
}

// An answer saved before Oct 30 ticked the escape window for the bedroom sitting on the biggest
// window's wall. Read back, its check says what the scan knows: the width, and the height to tape.
export function rejudgeEscape<L extends Pick<Layout, "window" | "checks">>(layout: L): L {
  const i = layout.checks.findIndex((c) => /escape window/i.test(c.label));
  if (i < 0 || !layout.window) return layout;
  const inBedroom = layout.window.inBedroom ?? layout.checks[i].ok === true;
  const checks = layout.checks.map((c, j) => (j === i ? escapeCheck(layout.window, inBedroom) : c));
  return { ...layout, window: { ...layout.window, inBedroom }, checks };
}

export function suggestLayout(plan: Plan, opts: LayoutOptions = {}): Layout {
  const { box } = plan;
  const skip = new Set(opts.without ?? []);
  const checks: Layout["checks"] = [];
  const zones: Zone[] = [];
  const walls: Wall[] = [];
  const doors: Door[] = [];
  const zone = (kind: ZoneKind, name: string, r: Rect) => zones.push({ kind, name, ...r, areaM2: area(r) });

  // The bedroom goes where the biggest window is: it's the escape window.
  const windows = plan.openings.filter((o) => o.kind === "window").sort((a, b) => b.widthM - a.widthM);
  const win = (opts.side ? windows.find((w) => w.side === opts.side) : windows[0]) ?? null;
  const sides: Side[] = ["minX", "maxX", "minZ", "maxZ"];
  const longest = sides.sort((a, b) => frame(box, b).aMax - frame(box, b).aMin - (frame(box, a).aMax - frame(box, a).aMin))[0];
  const side: Side = opts.side ?? win?.side ?? longest;
  const f = frame(box, side);
  const length = f.aMax - f.aMin;
  const studio = opts.kind ? opts.kind === "studio" : plan.areaM2 < 30 || f.reach < BED_DEPTH + 2.5;

  // Keep-outs that stay as they are: the stairs, and the furnace and water heater in their own
  // fire-separated service room.
  for (const s of plan.stairs) zone("stairs", "Stairs", { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 });
  const service = serviceRoom(plan);
  if (service) zone("mechanical", service.name, service.rect);

  // Nothing new goes on top of the stairs or into the furnace corner.
  const keepouts: Rect[] = [...zones.map((z) => ({ x0: z.x0, z0: z.z0, x1: z.x1, z1: z.z1 })), ...landings(plan)];
  // A doorway keeps a metre of floor clear in front of it, to walk through.
  for (const d of plan.openings.filter((o) => o.kind === "door")) {
    const fr = frame(box, d.side);
    const deep = DOOR_CLEAR - (d.beyondM ?? 0);
    if (deep > 0.05) keepouts.push(fr.rect(fr.aMin + d.atM - d.widthM / 2 - 0.1, fr.aMin + d.atM + d.widthM / 2 + 0.1, 0, deep));
  }
  // An electrical panel keeps a metre clear in front of it to work at, and no room goes round it.
  for (const p of plan.fixtures.filter((x) => x.kind === "panel")) {
    const { side: wall, dist } = nearestSide(box, p.x, p.z);
    const fr = frame(box, wall);
    const at = fr.alongX ? p.x : p.z;
    keepouts.push(fr.rect(at - 0.5, at + 0.5, 0, dist + DOOR_CLEAR));
  }
  const free = (r: Rect) => !keepouts.some((k) => r.x0 < k.x1 - 0.05 && r.x1 > k.x0 + 0.05 && r.z0 < k.z1 - 0.05 && r.z1 > k.z0 + 0.05);
  // Slide a span along a wall, nearest to `want` first, until it's clear.
  const slideOn = (fr: ReturnType<typeof frame>, want: number, len: number, d0: number, d1: number, lo = fr.aMin, hi = fr.aMax - len) => {
    const steps = [0, ...Array.from({ length: 40 }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1) * 0.2)];
    for (const s of steps) {
      const a0 = clamp(want + s, lo, hi);
      if (free(fr.rect(a0, a0 + len, d0, d1))) return a0;
    }
    return null;
  };
  const slide = (want: number, len: number, d0: number, d1: number, lo = f.aMin, hi = f.aMax - len) => slideOn(f, want, len, d0, d1, lo, hi);

  // A bathroom always gets its own walls and door: its inner side, and any side that isn't already a
  // room wall or the wall it shares with the bedroom.
  const encloseBath = (a0: number, shared: number | null, fr = f, len = BATH_ALONG, deep = BATH_DEPTH) => {
    const a1 = a0 + len;
    const inner = fr.rect(a0, a1, deep, deep);
    walls.push({ x0: inner.x0, z0: inner.z0, x1: inner.x1, z1: inner.z1 });
    for (const a of [a0, a1]) {
      if ([fr.aMin, fr.aMax, shared].some((b) => b !== null && Math.abs(a - b) < 0.05)) continue;
      const s = fr.rect(a, a, 0, deep);
      walls.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 });
    }
    const d = fr.rect(a0 + len / 2, a0 + len / 2, deep, deep);
    doors.push({ x: d.x0, z: d.z0, along: fr.alongX ? "x" : "z", widthM: DOOR_W });
  };

  // A bathroom that stops just short of the next room or the end wall takes the sliver in: [a0, a1].
  const SLIVER_M = 0.5;
  const stretch = (a0: number, len: number, fr = f, deep = BATH_DEPTH, most = BATH_MAX_M2): [number, number] => {
    let lo = a0, hi = a0 + len;
    const band = fr.rect(lo, hi, 0, deep);
    for (const k of keepouts) {
      const across = fr.alongX ? k.z0 < band.z1 - 0.05 && k.z1 > band.z0 + 0.05 : k.x0 < band.x1 - 0.05 && k.x1 > band.x0 + 0.05;
      if (!across) continue;
      const [k0, k1] = fr.alongX ? [k.x0, k.x1] : [k.z0, k.z1];
      if (k1 <= lo + 0.01 && lo - k1 < SLIVER_M) lo = Math.min(lo, k1);
      if (k0 >= hi - 0.01 && k0 - hi < SLIVER_M) hi = Math.max(hi, k0);
    }
    if (lo - fr.aMin < SLIVER_M) lo = fr.aMin;
    if (fr.aMax - hi < SLIVER_M) hi = fr.aMax;
    // Never past the size the room is for (a bathroom over 5 m² is more than three pieces need).
    if ((hi - lo) * deep > most + 1e-6) return [r2(a0), r2(a0 + len)];
    return [r2(lo), r2(hi)];
  };

  // Capped pipes in the floor: a bathroom on them needs no new drains. It goes against the wall
  // nearest the pipes, covering them, when that spot is clear; otherwise the usual spot, with a note.
  const rough = plan.fixtures.find((x) => x.kind === "plumbing") ?? null;
  const onRough = () => {
    if (!rough) return null;
    const { side: wall, dist } = nearestSide(box, rough.x, rough.z);
    if (dist > BATH_DEPTH + 0.6) return null;
    const fr = frame(box, wall);
    const along = fr.alongX ? rough.x : rough.z;
    const a0 = slideOn(fr, along - BATH_ALONG / 2, BATH_ALONG, 0, BATH_DEPTH);
    if (a0 === null || along < a0 - 0.1 || along > a0 + BATH_ALONG + 0.1) return null;
    return { wall, fr, a0 };
  };
  // A bathroom on another wall takes its depth out of the living space there.
  // (The living space runs to the far wall: the kitchen there is cut out of it, server/model/seed.ts.)
  let livingTrim = { aLo: 0, aHi: 0, far: 0 };
  const placeOnRough = (bedA0: number, bedA1: number) => {
    const rb = onRough();
    if (!rb) return null;
    zone("bathroom", "Bathroom", rb.fr.rect(rb.a0, rb.a0 + BATH_ALONG, 0, BATH_DEPTH));
    keepouts.push(rb.fr.rect(rb.a0, rb.a0 + BATH_ALONG, 0, BATH_DEPTH));
    const nextTo = rb.wall === side ? [bedA0, bedA1].find((b) => Math.abs(rb.a0 - b) < 0.05 || Math.abs(rb.a0 + BATH_ALONG - b) < 0.05) ?? null : null;
    encloseBath(rb.a0, nextTo, rb.fr);
    if (rb.wall === opposite[side]) livingTrim = { ...livingTrim, far: BATH_DEPTH };
    else if (rb.wall !== side) livingTrim = rb.wall.startsWith("min") ? { ...livingTrim, aLo: BATH_DEPTH } : { ...livingTrim, aHi: BATH_DEPTH };
    return rb;
  };

  const winAt = win ? f.aMin + win.atM : f.aMin + length / 2;
  const depth = Math.min(BED_DEPTH, f.reach * 0.45);
  // The bedroom must still take in the window: it can slide only so far.
  const bedLo = win ? Math.max(f.aMin, winAt - BED_ALONG + 0.3) : f.aMin;
  const bedHi = win ? Math.min(f.aMax - BED_ALONG, winAt - 0.3) : f.aMax - BED_ALONG;
  let bedA0 = slide(winAt - BED_ALONG / 2, BED_ALONG, 0, depth, bedLo, Math.max(bedLo, bedHi));
  const windowInBedroom = bedA0 !== null && Boolean(win);
  bedA0 ??= slide(f.aMin + length / 2 - BED_ALONG / 2, BED_ALONG, 0, depth) ?? clamp(winAt - BED_ALONG / 2, f.aMin, f.aMax - BED_ALONG);
  // Where the bathroom goes beside a bedroom at a0: on the plumbing, else in the studio's far corner or
  // beside the bedroom on its roomier side.
  const bathFor = (a0: number) => {
    const a1 = a0 + BED_ALONG;
    if (studio) return slide(a0 > f.aMin + length / 2 ? f.aMin : f.aMax - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
    return slide(f.aMax - a1 >= a0 - f.aMin ? a1 : a0 - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
  };
  const fitsBath = (a0: number) => {
    keepouts.push(f.rect(a0, a0 + BED_ALONG, 0, depth));
    const ok = onRough() !== null || bathFor(a0) !== null;
    keepouts.pop();
    return ok;
  };
  // No room for a bathroom beside it (a service room in the way): the bedroom slides along its wall,
  // still on the window, to the end that makes room for one.
  if (!skip.has("bedroom") && !skip.has("bathroom") && !fitsBath(bedA0)) {
    const lo = windowInBedroom ? bedLo : f.aMin, hi = windowInBedroom ? Math.max(bedLo, bedHi) : f.aMax - BED_ALONG;
    const better = [hi, lo].map((a) => r2(a)).find((a) => free(f.rect(a, a + BED_ALONG, 0, depth)) && fitsBath(a));
    if (better !== undefined) bedA0 = better;
  }
  const bedA1 = bedA0 + BED_ALONG;
  // No room for a bathroom beside the bed (or no bed in this room): against another wall with room for
  // one, in a corner first, the wall across from the bedroom before its own; along that wall or across it.
  const bathAnywhere = () => {
    const order = [opposite[side], ...(["minX", "maxX", "minZ", "maxZ"] as Side[]).filter((s) => s !== side && s !== opposite[side]), side];
    const spots: { fr: ReturnType<typeof frame>; b0: number; b1: number; deep: number }[] = [];
    for (const s of order) {
      const fr = frame(box, s);
      // 2.4 × 1.6 m; 2.2 × 1.6 m (3.5 m²) where that's what fits.
      for (const [len, deep] of [[BATH_ALONG, BATH_DEPTH], [BATH_DEPTH, BATH_ALONG], [2.2, BATH_DEPTH], [BATH_DEPTH, 2.2]]) {
        if (fr.aMax - fr.aMin < len || deep > fr.reach) continue;
        const fromCorner = (a: number) => Math.min(a - fr.aMin, fr.aMax - len - a);
        const at = [slideOn(fr, fr.aMin, len, 0, deep), slideOn(fr, fr.aMax - len, len, 0, deep)].filter((a): a is number => a !== null).sort((p, q) => fromCorner(p) - fromCorner(q));
        for (const a0 of at) {
          const [b0, b1] = stretch(a0, len, fr, deep);
          spots.push({ fr, b0, b1, deep });
        }
      }
    }
    // The first that still leaves the kitchen its galley.
    const leaves = (sp: (typeof spots)[number]) => {
      if (skip.has("kitchen")) return true;
      keepouts.push(sp.fr.rect(sp.b0, sp.b1, 0, sp.deep));
      const ok = galley() !== null;
      keepouts.pop();
      return ok;
    };
    const sp = spots.find(leaves) ?? spots[0];
    if (!sp) return;
    zone("bathroom", "Bathroom", sp.fr.rect(sp.b0, sp.b1, 0, sp.deep));
    keepouts.push(sp.fr.rect(sp.b0, sp.b1, 0, sp.deep));
    encloseBath(sp.b0, null, sp.fr, sp.b1 - sp.b0, sp.deep);
  };
  // Where a galley kitchen fits: along the wall across from the bedroom first, clear of the stairs and the
  // other rooms, else along another wall.
  const galley = (): Rect | null => {
    const order = [opposite[side], ...(["minX", "maxX", "minZ", "maxZ"] as Side[]).filter((s) => s !== side && s !== opposite[side]), side];
    for (const s of order) {
      const fr = frame(box, s);
      for (const run of KITCHEN_RUNS) {
        if (fr.aMax - fr.aMin < run || GALLEY > fr.reach) continue;
        const a0 = slideOn(fr, fr.aMin + (fr.aMax - fr.aMin - run) / 2, run, 0, GALLEY);
        if (a0 === null) continue;
        const [k0, k1] = stretch(a0, run, fr, GALLEY, Infinity);
        return fr.rect(k0, k1, 0, GALLEY);
      }
    }
    return null;
  };
  if (skip.has("bedroom")) {
    if (!skip.has("bathroom")) placeOnRough(Number.NaN, Number.NaN);
  } else if (studio) {
    // Sleeping corner by the window, a bathroom next to it, the rest is living and kitchen.
    zone("bedroom", "Sleeping area", f.rect(bedA0, bedA1, 0, depth));
    keepouts.push(f.rect(bedA0, bedA1, 0, depth));
    if (!skip.has("bathroom") && !placeOnRough(bedA0, bedA1)) {
      const bathA0 = slide(bedA0 > f.aMin + length / 2 ? f.aMin : f.aMax - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
      if (bathA0 !== null) {
        const [b0, b1] = stretch(bathA0, BATH_ALONG);
        zone("bathroom", "Bathroom", f.rect(b0, b1, 0, BATH_DEPTH));
        encloseBath(b0, null, f, b1 - b0);
      }
    }
  } else {
    // Bedroom on the window; bathroom beside it on the roomier side.
    zone("bedroom", "Bedroom", f.rect(bedA0, bedA1, 0, depth));
    keepouts.push(f.rect(bedA0, bedA1, 0, depth));
    const roomLeft = bedA0 - f.aMin, roomRight = f.aMax - bedA1;
    const rb = skip.has("bathroom") ? null : placeOnRough(bedA0, bedA1);
    const bathAt = rb || skip.has("bathroom") ? null : slide(roomRight >= roomLeft ? bedA1 : bedA0 - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
    const bath = bathAt === null ? null : stretch(bathAt, BATH_ALONG);
    const bathA0 = bath?.[0] ?? null;
    if (bath) {
      zone("bathroom", "Bathroom", f.rect(bath[0], bath[1], 0, BATH_DEPTH));
      keepouts.push(f.rect(bath[0], bath[1], 0, BATH_DEPTH));
    }
    // New walls: along the bedroom's inner edge, and between bedroom and bathroom (both ends of the
    // bedroom when the bathroom is over the plumbing instead).
    const inner = f.rect(bedA0, bedA1, depth, depth);
    walls.push({ x0: inner.x0, z0: inner.z0, x1: inner.x1, z1: inner.z1 });
    // (Both ends, where they aren't the room's own, when no bathroom stands beside it.)
    const ends = rb || !bath ? [bedA0, bedA1].filter((a) => a - f.aMin > 0.05 && f.aMax - a > 0.05) : [roomRight >= roomLeft ? bedA1 : bedA0];
    for (const a of ends) {
      const between = f.rect(a, a, 0, depth);
      walls.push({ x0: between.x0, z0: between.z0, x1: between.x1, z1: between.z1 });
    }
    // The bedroom door, on the inner wall away from the bathroom.
    const doorA = roomRight >= roomLeft ? bedA0 + 0.3 + DOOR_W / 2 : bedA1 - 0.3 - DOOR_W / 2;
    const d = f.rect(doorA, doorA, depth, depth);
    doors.push({ x: d.x0, z: d.z0, along: f.alongX ? "x" : "z", widthM: DOOR_W });
    if (bath) encloseBath(bath[0], roomRight >= roomLeft ? bedA1 : bedA0, f, bath[1] - bath[0]);
  }

  if (!skip.has("bathroom") && !zones.some((z) => z.kind === "bathroom")) bathAnywhere();

  // The kitchen: a galley where one fits; where none does, the counter across from the bedroom on its
  // own, for a designer to find it room. Living space is what's left in the middle.
  if (!skip.has("kitchen")) {
    const o = frame(box, opposite[side]);
    const kitchenLen = Math.min(3.0, o.aMax - o.aMin);
    const kWant = o.aMin + (o.aMax - o.aMin - kitchenLen) / 2;
    zone("kitchen", "Kitchen", galley() ?? o.rect(kWant, kWant + kitchenLen, 0, COUNTER));
  }
  // (It reaches over the rooms off its middle that don't take a whole strip: server/model/seed.ts cuts them out.)
  const band = skip.has("bedroom") ? 0 : studio ? Math.max(BATH_DEPTH, depth) : depth;
  if (!skip.has("living")) zone("living", studio ? "Living and kitchen" : "Living and dining", f.rect(f.aMin + livingTrim.aLo, f.aMax - livingTrim.aHi, band, f.reach - livingTrim.far));

  const bed = zones.find((z) => z.kind === "bedroom");
  if (bed) {
    checks.push(escapeCheck(win, windowInBedroom));
    checks.push({
      label: `Bedroom is at least ${BEDROOM_MIN_M2} m²`,
      ok: bed.areaM2 >= BEDROOM_MIN_M2,
      detail: `About ${bed.areaM2.toFixed(1)} m².`,
    });
  }
  if (rough) {
    const bath = zones.find((z) => z.kind === "bathroom");
    const over = bath && rough.x >= bath.x0 - 0.1 && rough.x <= bath.x1 + 0.1 && rough.z >= bath.z0 - 0.1 && rough.z <= bath.z1 + 0.1;
    checks.push({
      label: "The bathroom sits on your plumbing rough-in",
      ok: over ? true : null,
      detail: over
        ? "The video showed capped pipes there, so the drains are already in the floor."
        : "The video showed capped pipes, but a bathroom doesn't fit right on them here. Your designer can move it there: drains already in the floor cost much less.",
    });
  }
  if (!skip.has("bathroom") && !zones.some((z) => z.kind === "bathroom")) {
    checks.push({
      label: "There's room for a bathroom",
      ok: false,
      detail: "A bathroom (about 2.4 × 1.6 m) doesn't fit beside the bedroom here: your designer finds it a spot.",
    });
  }
  const livingArea = zones.filter((z) => z.kind === "living").reduce((s, z) => s + z.areaM2, 0);
  if (!skip.has("living"))
    checks.push({
      label: `Living space is at least ${LIVING_MIN_M2} m²`,
      ok: livingArea >= LIVING_MIN_M2,
      detail: `About ${livingArea.toFixed(1)} m², kitchen included.`,
    });
  checks.push({
    label: "Sizes are from the scan",
    ok: plan.trusted ? true : null,
    detail: plan.trusted ? "The scan passed its checks." : "The scan's sizes are rough; your designer confirms them.",
  });

  return { version: 1, kind: studio ? "studio" : "one_bedroom", zones, walls, doors, window: win ? { side: win.side, atM: win.atM, widthM: win.widthM, inBedroom: windowInBedroom && !skip.has("bedroom") } : null, checks };
}
