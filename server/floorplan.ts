// The whole basement's floor plan for an app take, once SAM's finds are in: read from every area's 3D at
// once (services/scan3d /floorplan), with each area's depth, SAM's doors, windows, stairs and mechanicals
// lifted into the phone's world, and the walls checked against the depth. Then muse-spark-1.3 looks at the
// plan drawn over the points from above and into a few frames, and proposes typed corrections; the 3D
// service keeps one only if the points agree. At most two rounds, each counted in the day's spend.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BasementPlan } from "../src/api";
import type { BasementScan, WatchLike } from "./basement";
import { overSpend } from "./limits";
import { outputText, responses } from "./meta";
import type { Detection } from "./pipeline";
import { locate } from "./plan";
import { runFloorPlan, type FloorPlanResult, type Scan3d } from "./scan3d";

const ROUNDS = 2;
const KEYFRAMES_PER_AREA = 2;

type V3 = [number, number, number];

// An area's room frame -> the phone's world: world = rotationᵀ·(room / factor) + origin.
function toWorld(s3: Scan3d) {
  const R = s3.scan.world.rotation as number[][];
  const o = s3.scan.world.origin as number[];
  const f = s3.scan.scale?.factor ?? 1;
  return {
    point: (p: number[]): V3 => [0, 1, 2].map((r) => (R[0][r] * p[0] + R[1][r] * p[1] + R[2][r] * p[2]) / f + o[r]) as V3,
    // A camera-to-room pose as camera-to-world.
    pose: (P: number[][]): number[][] => {
      const rows = [0, 1, 2].map((r) => [
        ...[0, 1, 2].map((c) => R[0][r] * P[0][c] + R[1][r] * P[1][c] + R[2][r] * P[2][c]),
        (R[0][r] * P[0][3] + R[1][r] * P[1][3] + R[2][r] * P[2][3]) / f + o[r],
      ]);
      return [...rows, [0, 0, 0, 1]];
    },
  };
}

const FIXTURE: Record<string, string> = { "Electrical panel": "panel", "Water heater": "water_heater", "Plumbing rough-in": "plumbing", "Floor drain": "plumbing", Furnace: "furnace" };

// SAM's finds in the phone's world, each from the area that saw it in the most frames.
export function hintsFrom(scans: Scan3d[], detections: Detection[]) {
  const hints: Record<string, { id: string; kind?: string; center: V3; low: V3; high: V3; views: number }[]> = { doors: [], windows: [], stairs: [], fixtures: [], overhead: [] };
  for (const d of detections) {
    let best: { s3: Scan3d; at: NonNullable<ReturnType<typeof locate>> } | null = null;
    for (const s3 of scans) {
      const at = locate(s3, d);
      if (at && (!best || at.views > best.at.views)) best = { s3, at };
    }
    if (!best) continue;
    const w = toWorld(best.s3);
    const a = w.point(best.at.low), b = w.point(best.at.high);
    const h = { id: d.id, center: w.point(best.at.center), low: [0, 1, 2].map((k) => Math.min(a[k], b[k])) as V3, high: [0, 1, 2].map((k) => Math.max(a[k], b[k])) as V3, views: best.at.views };
    if (d.kind === "exit") hints.doors.push(h);
    else if (d.kind === "window") hints.windows.push(h);
    else if (d.kind === "stairs") hints.stairs.push(h);
    else if (d.kind === "mechanical") hints.fixtures.push({ ...h, kind: FIXTURE[d.label] ?? "furnace" });
    else if (d.kind === "duct" || d.kind === "beam") hints.overhead.push({ ...h, kind: /bulkhead/i.test(d.label) ? "bulkhead" : d.kind });
  }
  return hints;
}

// A few frames spread over each area, with the camera in the phone's world and the lens in the JPEG's own
// pixels, for drawing the plan's walls into.
export function keyframes(work: string, scans: Scan3d[], perArea = KEYFRAMES_PER_AREA) {
  const out: { jpeg: Uint8Array<ArrayBuffer>; pose: number[][]; intrinsics: number[][]; frame: number }[] = [];
  for (const s3 of scans) {
    const frames = s3.scan.frames ?? [];
    if (!frames.length) continue;
    const w = toWorld(s3);
    for (let k = 0; k < perArea; k++) {
      // From the middle of each stretch of the area's frames, the one with the most depth.
      const lo = Math.floor((k * frames.length) / perArea), hi = Math.floor(((k + 1) * frames.length) / perArea);
      const pick = frames.slice(lo, hi).reduce((a: any, b: any) => ((b.validFraction ?? 0) > (a.validFraction ?? 0) ? b : a), frames[lo]);
      const n = s3.sentFrames[pick.sourceIndex];
      let jpeg: Uint8Array<ArrayBuffer>;
      try {
        jpeg = new Uint8Array(readFileSync(join(work, "frames", `${String(n).padStart(4, "0")}.jpg`)));
      } catch {
        continue;
      }
      const m = pick.model, K = pick.intrinsics as number[][];
      const sx = pick.width / m.resizedWidth, sy = pick.height / m.resizedHeight;
      out.push({ jpeg, frame: n, pose: w.pose(pick.pose), intrinsics: [[K[0][0] * sx, 0, (K[0][2] + m.cropLeft) * sx], [0, K[1][1] * sy, (K[1][2] + m.cropTop) * sy], [0, 0, 1]] });
    }
  }
  return out;
}

const insidePoly = (poly: [number, number][], p: [number, number]) => {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < xi + ((p[1] - zi) * (xj - xi)) / (zj - zi)) r = !r;
  }
  return r;
};

// The watched rooms on the plan's rooms: a room the camera was inside goes to the plan room its camera
// positions fell in most; a room only seen from a doorway goes to a plan room nobody entered, off the room
// it was seen from. The plan's rooms get the watch's names and kinds (a closet, a hall); measurements stay
// the 3D's. Returns the watched rooms the plan has nothing for.
export function applyWatch(plan: BasementPlan, watch: WatchLike, cameras: number[][], frames: number[], fps = 5) {
  const c = Math.cos(-plan.rotation), s = Math.sin(-plan.rotation);
  const uv = cameras.map(([x, , z]): [number, number] => [c * x - s * z, s * x + c * z]);
  const matched = new Map<string, string>(); // watched id -> plan room id
  for (const w of watch.rooms) {
    if (!w.entered) continue;
    const counts = new Map<string, number>();
    frames.forEach((n, i) => {
      if (!w.visits.some(([a, b]) => n >= a * fps && n < b * fps)) return;
      const r = plan.rooms.find((x) => insidePoly(x.polygon, uv[i]));
      if (r) counts.set(r.id, (counts.get(r.id) ?? 0) + 1);
    });
    const best = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (best && ![...matched.values()].includes(best[0])) matched.set(w.id, best[0]);
  }
  for (const w of watch.rooms) {
    if (w.entered) continue;
    const from = w.seenFrom ? matched.get(w.seenFrom) : undefined;
    const r = plan.rooms.find((x) => !(x as { entered?: boolean }).entered && ![...matched.values()].includes(x.id) && (!from || (x as { seenFrom?: string }).seenFrom === from));
    if (r) matched.set(w.id, r.id);
  }
  for (const w of watch.rooms) {
    const r = plan.rooms.find((x) => x.id === matched.get(w.id));
    if (!r) continue;
    r.name = (w.spokenName || w.name || r.name)?.slice(0, 40);
    if (w.kind === "closet" && r.areaM2 <= 5) r.kind = "closet";
    else if (w.kind === "hall") r.kind = "hall";
  }
  return watch.rooms.filter((w) => !matched.has(w.id));
}

// A point inside a polygon, near its middle (the middle of an L isn't in it).
export function inside(poly: [number, number][]): [number, number] {
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const c: [number, number] = [xs.reduce((a, b) => a + b, 0) / xs.length, zs.reduce((a, b) => a + b, 0) / zs.length];
  const isIn = (p: [number, number]) => {
    let r = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if (zi > p[1] !== zj > p[1] && p[0] < xi + ((p[1] - zi) * (xj - xi)) / (zj - zi)) r = !r;
    }
    return r;
  };
  if (isIn(c)) return c;
  let best: [number, number] = poly[0];
  let bestD = Infinity;
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  for (let i = 1; i < 20; i++)
    for (let j = 1; j < 20; j++) {
      const p: [number, number] = [x0 + ((x1 - x0) * i) / 20, z0 + ((z1 - z0) * j) / 20];
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d < bestD && isIn(p)) [best, bestD] = [p, d];
    }
  return best;
}

// Spark's corrections, in its words (ids from the pictures), as the 3D service's (points in the phone's
// world, lines in the plan frame). Ones that name something not in the plan are dropped.
export function toEdits(plan: BasementPlan, corrections: any[]): Record<string, unknown>[] {
  const c = Math.cos(plan.rotation), s = Math.sin(plan.rotation);
  const world = ([u, v]: [number, number]) => [Math.round((c * u - s * v) * 1000) / 1000, Math.round((s * u + c * v) * 1000) / 1000];
  const room = (id: unknown) => plan.rooms.find((r) => r.id.toLowerCase() === String(id).toLowerCase());
  const at = (id: unknown) => {
    const r = room(id);
    return r ? world(inside(r.polygon)) : null;
  };
  const out: Record<string, unknown>[] = [];
  for (const x of Array.isArray(corrections) ? corrections.slice(0, 6) : []) {
    const why = String(x?.why ?? "").slice(0, 160);
    if (x?.op === "merge" && Array.isArray(x.rooms) && x.rooms.length === 2) {
      const a = at(x.rooms[0]), b = at(x.rooms[1]);
      if (a && b) out.push({ op: "merge", at: [a, b], why, said: x.rooms });
    } else if (x?.op === "split" && (x.axis === "u" || x.axis === "v") && Number.isFinite(Number(x.at))) {
      const a = at(x.room);
      if (a) out.push({ op: "split", at: a, axis: x.axis, value: Number(x.at), why, said: x.room });
    } else if (x?.op === "move_wall" && (x.axis === "u" || x.axis === "v") && Number.isFinite(Number(x.from)) && Number.isFinite(Number(x.to))) {
      const a = at(x.room);
      if (a) out.push({ op: "move_wall", at: a, axis: x.axis, from: Number(x.from), to: Number(x.to), why, said: x.room });
    } else if (x?.op === "kind" && typeof x.kind === "string") {
      const a = at(x.room);
      if (a) out.push({ op: "kind", at: a, kind: x.kind, ...(x.name ? { name: String(x.name).slice(0, 40) } : {}), why, said: x.room });
    } else if (x?.op === "door" && Array.isArray(x.rooms) && x.rooms.length === 2) {
      const a = at(x.rooms[0]), b = at(x.rooms[1]);
      if (a && b) out.push({ op: "door", at: [a, b], why, said: x.rooms });
    } else if (x?.op === "no_door") {
      const d = plan.openings.find((o) => o.id.toLowerCase() === String(x.door).toLowerCase());
      if (d) out.push({ op: "no_door", at: world(d.at), why, said: x.door });
    }
  }
  return out;
}

const INSTRUCTIONS = `You check a floor plan read from a 3D scan of a basement. A program measured it; you look at it.

You get a picture from above: the 3D points (walls are the dark lines of points) with the plan drawn on them. Rooms are filled and labelled R1, R2 with their area and ceiling height. Walls are thick lines labelled W1, W2; a dashed wall is one the camera didn't see clearly. Doors are red, labelled D1; windows orange. Stairs and fixtures are outlines with their names. A 1 m bar is at the top left. Axes: u to the right, v down, in metres; the plan JSON has every room's polygon in the same metres.
You also get video frames with the plan's walls drawn in: green for walls the depth agrees with, red for doubtful ones, each labelled with its id.

Reply with JSON only:
{"corrections": [...], "unsure": ["W3"], "note": "one plain sentence"}

Corrections, only ones you can see in the pictures (each is checked against the 3D points, and dropped if they disagree):
- {"op":"merge","rooms":["R1","R2"],"why":"..."}: these are one room
- {"op":"split","room":"R1","axis":"u","at":3.2,"why":"..."}: a wall runs across R1 along u = 3.2 (axis "v": along v = at)
- {"op":"move_wall","room":"R1","axis":"u","from":5.1,"to":5.6,"why":"..."}: R1's edge on the line u = 5.1 is really at u = 5.6
- {"op":"kind","room":"R3","kind":"closet","name":"Closet","why":"..."}: kinds: closet, mechanical (furnace or utility room), stairs, bathroom, laundry, storage, hall, other
- {"op":"door","rooms":["R1","R2"],"why":"..."}: a door joins these rooms that the plan doesn't show
- {"op":"no_door","door":"D2","why":"..."}: there's no door there
"unsure": walls whose place you doubt from the frames. Leave corrections empty when the plan looks right. At most 6 corrections.
When "watchedTheWholeVideo" is given, it's what a model that watched the whole video saw: the rooms in order, which the camera only looked into from a doorway (enteredByCamera false), and the doors between them. Its room count and doors are good evidence; its sizes aren't. A room nobody walked into is drawn from what the camera saw through its door, so its walls are less sure.`;

function summary(plan: BasementPlan) {
  return {
    rooms: plan.rooms.map((r) => ({ id: r.id.toUpperCase(), areaM2: r.areaM2, ceilingM: r.ceilingM, low: r.low, kind: r.kind, polygon: r.polygon })),
    walls: plan.walls.map((w) => ({ id: w.id.toUpperCase(), rooms: w.rooms.map((x) => x.toUpperCase()), kind: w.kind, doubtful: Boolean(w.guess) })),
    doors: plan.openings.filter((o) => o.kind === "door").map((o) => ({ id: o.id.toUpperCase(), rooms: o.rooms.map((x) => x.toUpperCase()), widthM: o.widthM })),
    fixtures: plan.fixtures.map((f) => ({ kind: f.kind, at: f.at })),
  };
}

export async function askSpark(plan: BasementPlan, renders: NonNullable<FloorPlanResult["renders"]>, said: string, watch?: WatchLike | null) {
  const watched = watch && {
    rooms: watch.rooms.map((r) => ({ id: r.id, name: r.spokenName || r.name, kind: r.kind, enteredByCamera: r.entered, seenFrom: r.seenFrom })),
    doors: watch.doors.map((d) => ({ from: d.from, to: d.to, kind: d.kind })),
  };
  const content: unknown[] = [
    { type: "input_text", text: JSON.stringify({ plan: summary(plan), homeownerSaid: said.slice(0, 1500) || "(nothing)", ...(watched ? { watchedTheWholeVideo: watched } : {}) }) },
    { type: "input_text", text: "From above:" },
    { type: "input_image", image_url: `data:image/png;base64,${renders.topDown}` },
    ...renders.frames.flatMap((f, i) => [
      { type: "input_text", text: `Frame ${i + 1} with the plan's walls drawn in:` },
      { type: "input_image", image_url: `data:image/jpeg;base64,${f}` },
    ]),
  ];
  const r = await responses({ model: "muse-spark-1.3", input: [{ role: "developer", content: INSTRUCTIONS }, { role: "user", content }] });
  const text = outputText(r);
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) return { corrections: [], unsure: [], note: "" };
  try {
    const j = JSON.parse(text.slice(start, end + 1));
    return { corrections: Array.isArray(j.corrections) ? j.corrections : [], unsure: Array.isArray(j.unsure) ? j.unsure.map(String) : [], note: String(j.note ?? "").slice(0, 300) };
  } catch {
    return { corrections: [], unsure: [], note: "" };
  }
}

const mid = (w: { a: [number, number]; b: [number, number] }): [number, number] => [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];

// The plan, read and then reviewed. `review` false: read only (no Meta calls).
export async function readBasementPlan(
  work: string,
  b: BasementScan,
  detections: Detection[],
  // save: the final plan drawn from above over the points (PNG), for anything else that reads the plan.
  opts: { said?: string; review?: boolean; log?: (text: string) => Promise<void>; ask?: typeof askSpark; save?: (png: Buffer) => Promise<unknown> } = {},
): Promise<BasementPlan | null> {
  if (!b.tracked) return null;
  const ask = opts.ask ?? askSpark;
  // The whole-take watch lands well before the 3D; don't hold the plan up long if it hasn't.
  const watch = b.watch ? await Promise.race([b.watch.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 30_000))]) : null;
  const hints: Record<string, unknown> = hintsFrom(b.scans, detections);
  // A room the watch saw only from its doorway: keep looking for small rooms nobody went into.
  const peek = watch?.rooms.filter((r) => !r.entered).length ?? 0;
  if (peek) hints.peek = peek;
  const frames = keyframes(work, b.scans);
  const review = opts.review ?? true;
  let res = await runFloorPlan(b.scans, b.tracked.cameras, { depth: true, hints, keyframes: frames, render: true });
  if (!res.plan) return null;
  const edits: Record<string, unknown>[] = [];
  const unsure: [number, number][] = [];
  let rounds = 0;
  let note = "";
  while (review && rounds < ROUNDS && res.renders && !(await overSpend())) {
    rounds++;
    await opts.log?.(rounds === 1 ? "Checking the floor plan against the video" : "Checking the floor plan again");
    if (watch) applyWatch(res.plan!, watch, b.tracked.cameras, b.tracked.frames);
    const said = await ask(res.plan!, res.renders, opts.said ?? "", watch).catch((err) => {
      console.error(`[plan] Spark: ${err instanceof Error ? err.message : err}`);
      return null;
    });
    if (!said) break;
    note = said.note || note;
    for (const id of said.unsure) {
      const w = res.plan!.walls.find((x) => x.id.toLowerCase() === id.toLowerCase());
      if (w) unsure.push(mid(w));
    }
    const fresh = toEdits(res.plan!, said.corrections).map((e, i) => ({ ...e, n: edits.length + i + 1 }));
    if (!fresh.length) break;
    edits.push(...fresh);
    res = await runFloorPlan(b.scans, b.tracked.cameras, { depth: true, hints, edits, keyframes: frames, render: true });
    if (!res.plan) return null;
    const ids = new Set(fresh.map((e) => e.n));
    const kept = res.plan.edits.filter((e) => ids.has(e.n as number) && e.ok).length;
    await opts.log?.(kept ? `Kept ${kept} of ${fresh.length} corrections the 3D agreed with` : "The 3D didn't support those corrections; keeping the plan as measured");
    if (!kept) break;
  }
  const plan = res.plan;
  if (res.renders?.topDown) await opts.save?.(Buffer.from(res.renders.topDown, "base64")).catch(() => {});
  const missing = watch ? applyWatch(plan, watch, b.tracked.cameras, b.tracked.frames) : [];
  // Walls Spark doubted are guesses too: the plan screen asks about them.
  for (const p of unsure) {
    const w = plan.walls.reduce<(typeof plan.walls)[number] | null>((best, x) => (!best || Math.hypot(mid(x)[0] - p[0], mid(x)[1] - p[1]) < Math.hypot(mid(best)[0] - p[0], mid(best)[1] - p[1]) ? x : best), null);
    if (w && Math.hypot(mid(w)[0] - p[0], mid(w)[1] - p[1]) < 0.4) w.guess = true;
  }
  plan.review = review || missing.length ? { rounds, unsure: plan.walls.filter((w) => w.guess).map((w) => w.id), ...(note ? { note } : {}), ...(missing.length ? { notPlaced: missing.map((r) => r.spokenName || r.name) } : {}) } : null;
  return plan;
}
