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
const DOOR_W = 0.8;

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

// Options for exploring ideas: force a studio or a one-bedroom, or put the bedroom on another wall.
export type LayoutOptions = { kind?: Layout["kind"] | null; side?: Side | null };

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

  // Keep-outs that stay as they are: the stairs, and the furnace (or water heater) in its own
  // fire-separated corner.
  for (const s of plan.stairs) zone("stairs", "Stairs", { x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 });
  const mech = plan.fixtures.find((x) => x.kind === "furnace") ?? plan.fixtures.find((x) => x.kind === "water_heater");
  for (const fx of mech ? [mech] : []) {
    const half = 0.9;
    zone("mechanical", fx.kind === "furnace" ? "Furnace room" : "Water heater", {
      x0: r2(clamp(fx.x - half, box.minX, box.maxX - 2 * half)),
      x1: r2(clamp(fx.x + half, box.minX + 2 * half, box.maxX)),
      z0: r2(clamp(fx.z - half, box.minZ, box.maxZ - 2 * half)),
      z1: r2(clamp(fx.z + half, box.minZ + 2 * half, box.maxZ)),
    });
  }

  // Nothing new goes on top of the stairs or into the furnace corner.
  const keepouts: Rect[] = zones.map((z) => ({ x0: z.x0, z0: z.z0, x1: z.x1, z1: z.z1 }));
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
  const encloseBath = (a0: number, shared: number | null, fr = f) => {
    const a1 = a0 + BATH_ALONG;
    const inner = fr.rect(a0, a1, BATH_DEPTH, BATH_DEPTH);
    walls.push({ x0: inner.x0, z0: inner.z0, x1: inner.x1, z1: inner.z1 });
    for (const a of [a0, a1]) {
      if ([fr.aMin, fr.aMax, shared].some((b) => b !== null && Math.abs(a - b) < 0.05)) continue;
      const s = fr.rect(a, a, 0, BATH_DEPTH);
      walls.push({ x0: s.x0, z0: s.z0, x1: s.x1, z1: s.z1 });
    }
    const d = fr.rect(a0 + BATH_ALONG / 2, a0 + BATH_ALONG / 2, BATH_DEPTH, BATH_DEPTH);
    doors.push({ x: d.x0, z: d.z0, along: fr.alongX ? "x" : "z", widthM: DOOR_W });
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
  let livingTrim = { aLo: 0, aHi: 0, far: COUNTER };
  const placeOnRough = (bedA0: number, bedA1: number) => {
    const rb = onRough();
    if (!rb) return null;
    zone("bathroom", "Bathroom", rb.fr.rect(rb.a0, rb.a0 + BATH_ALONG, 0, BATH_DEPTH));
    keepouts.push(rb.fr.rect(rb.a0, rb.a0 + BATH_ALONG, 0, BATH_DEPTH));
    const nextTo = rb.wall === side ? [bedA0, bedA1].find((b) => Math.abs(rb.a0 - b) < 0.05 || Math.abs(rb.a0 + BATH_ALONG - b) < 0.05) ?? null : null;
    encloseBath(rb.a0, nextTo, rb.fr);
    if (rb.wall === opposite[side]) livingTrim = { ...livingTrim, far: Math.max(COUNTER, BATH_DEPTH) };
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
  const bedA1 = bedA0 + BED_ALONG;
  if (studio) {
    // Sleeping corner by the window, a bathroom next to it, the rest is living and kitchen.
    zone("bedroom", "Sleeping area", f.rect(bedA0, bedA1, 0, depth));
    keepouts.push(f.rect(bedA0, bedA1, 0, depth));
    if (!placeOnRough(bedA0, bedA1)) {
      const bathA0 = slide(bedA0 > f.aMin + length / 2 ? f.aMin : f.aMax - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
      if (bathA0 !== null) {
        zone("bathroom", "Bathroom", f.rect(bathA0, bathA0 + BATH_ALONG, 0, BATH_DEPTH));
        encloseBath(bathA0, null);
      }
    }
  } else {
    // Bedroom on the window; bathroom beside it on the roomier side.
    zone("bedroom", "Bedroom", f.rect(bedA0, bedA1, 0, depth));
    keepouts.push(f.rect(bedA0, bedA1, 0, depth));
    const roomLeft = bedA0 - f.aMin, roomRight = f.aMax - bedA1;
    const rb = placeOnRough(bedA0, bedA1);
    const bathA0 = rb ? null : slide(roomRight >= roomLeft ? bedA1 : bedA0 - BATH_ALONG, BATH_ALONG, 0, BATH_DEPTH);
    if (bathA0 !== null) {
      zone("bathroom", "Bathroom", f.rect(bathA0, bathA0 + BATH_ALONG, 0, BATH_DEPTH));
      keepouts.push(f.rect(bathA0, bathA0 + BATH_ALONG, 0, BATH_DEPTH));
    }
    // New walls: along the bedroom's inner edge, and between bedroom and bathroom (both ends of the
    // bedroom when the bathroom is over the plumbing instead).
    const inner = f.rect(bedA0, bedA1, depth, depth);
    walls.push({ x0: inner.x0, z0: inner.z0, x1: inner.x1, z1: inner.z1 });
    const ends = rb ? [bedA0, bedA1].filter((a) => a - f.aMin > 0.05 && f.aMax - a > 0.05) : [roomRight >= roomLeft ? bedA1 : bedA0];
    for (const a of ends) {
      const between = f.rect(a, a, 0, depth);
      walls.push({ x0: between.x0, z0: between.z0, x1: between.x1, z1: between.z1 });
    }
    // The bedroom door, on the inner wall away from the bathroom.
    const doorA = roomRight >= roomLeft ? bedA0 + 0.3 + DOOR_W / 2 : bedA1 - 0.3 - DOOR_W / 2;
    const d = f.rect(doorA, doorA, depth, depth);
    doors.push({ x: d.x0, z: d.z0, along: f.alongX ? "x" : "z", widthM: DOOR_W });
    if (bathA0 !== null) encloseBath(bathA0, roomRight >= roomLeft ? bedA1 : bedA0);
  }

  // Kitchen along the opposite wall, clear of the stairs; living space is what's left in the middle.
  const o = frame(box, opposite[side]);
  const kitchenLen = Math.min(3.0, o.aMax - o.aMin);
  const kWant = o.aMin + (o.aMax - o.aMin - kitchenLen) / 2;
  let kA0: number | null = null;
  for (const s of [0, ...Array.from({ length: 40 }, (_, i) => (i % 2 ? -1 : 1) * (Math.floor(i / 2) + 1) * 0.2)]) {
    const a0 = clamp(kWant + s, o.aMin, o.aMax - kitchenLen);
    if (free(o.rect(a0, a0 + kitchenLen, 0, COUNTER))) {
      kA0 = a0;
      break;
    }
  }
  zone("kitchen", "Kitchen", o.rect(kA0 ?? kWant, (kA0 ?? kWant) + kitchenLen, 0, COUNTER));
  const band = studio ? Math.max(BATH_DEPTH, depth) : depth;
  const living = f.rect(f.aMin + livingTrim.aLo, f.aMax - livingTrim.aHi, band, f.reach - livingTrim.far);
  zone("living", studio ? "Living and kitchen" : "Living and dining", living);

  const bed = zones.find((z) => z.kind === "bedroom")!;
  checks.push(escapeCheck(win, windowInBedroom));
  checks.push({
    label: `Bedroom is at least ${BEDROOM_MIN_M2} m²`,
    ok: bed.areaM2 >= BEDROOM_MIN_M2,
    detail: `About ${bed.areaM2.toFixed(1)} m².`,
  });
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
  if (!zones.some((z) => z.kind === "bathroom")) {
    checks.push({
      label: "There's room for a bathroom",
      ok: false,
      detail: "A bathroom (about 2.4 × 1.6 m) doesn't fit beside the bedroom here: your designer finds it a spot.",
    });
  }
  const livingArea = zones.filter((z) => z.kind === "living").reduce((s, z) => s + z.areaM2, 0);
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

  return { version: 1, kind: studio ? "studio" : "one_bedroom", zones, walls, doors, window: win ? { side: win.side, atM: win.atM, widthM: win.widthM, inBedroom: windowInBedroom } : null, checks };
}
