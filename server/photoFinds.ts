// A photo take's finds. In a video SAM follows each thing from frame to frame, and only what it holds
// for half a second counts. Photos are each one look from a different spot, so SAM reads every photo for
// every thing on its own (server/meta.ts samImage), only sure finds count (the live finds' bar,
// server/live.ts), and the same window seen in two photos of a room is matched up afterwards by where
// the room's 3D puts it. The finds keep the video's Detection shape: one photo is one frame.
import { minConfidence } from "./live";
import type { Detection } from "./pipeline";
import { parseSam, type SamBox } from "./sam";

type Concept = { concept: string; kind: string; label: string };

const FPS = 5; // server/pipeline.ts ANALYSIS_FPS: a photo's "seconds" is its frame number at this rate
const PER_PHOTO = 4; // at most this many of one thing in one photo
const MIN_AREA = 0.001; // of the picture: smaller is a speck, not a find

// SAM's "support beam" also outlines every joist, post, stud and stair stringer. A beam is long and level:
// at least this much of the picture wide and this many times wider than tall (in pixels), which may be a
// little less sure than the bar since its shape vouches for it. A photo keeps its widest one; a video keeps
// one at a time (server/videoFinds.ts). Nothing else stands in: the fire rules no longer need a ceiling
// find (server/assess.ts fireRules). Tuned on practice photos, checked on real takes (scripts/practice).
export const BEAM = { minWidth: 0.4, minAspect: 2, min: 0.65 };

export const isLongBeam = (b: SamBox, min = BEAM.min) =>
  (b.c ?? 1) >= min && (b.x2 - b.x1) / b.w >= BEAM.minWidth && b.x2 - b.x1 >= BEAM.minAspect * (b.y2 - b.y1);

function oneBeam(boxes: SamBox[], min: number): SamBox[] {
  return boxes.filter((b) => isLongBeam(b, Math.min(min, BEAM.min))).sort((a, b) => b.x2 - b.x1 - (a.x2 - a.x1)).slice(0, 1);
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const slug = (label: string) => label.toLowerCase().replace(/\s+/g, "-");

// One photo's sure finds of one thing, biggest first.
export function photoFinds(frame: number, c: Concept, raw: string, min = minConfidence(c.concept)): Detection[] {
  const boxes = parseSam(raw)
    .map((t) => t.frames[0]?.box)
    .filter((b): b is SamBox => Boolean(b) && b.w > 0 && b.h > 0);
  return (c.kind === "beam" ? oneBeam(boxes, min) : boxes.filter((b) => (b.c ?? 1) >= min))
    .map((b) => ({ x: b.x1 / b.w, y: b.y1 / b.h, w: (b.x2 - b.x1) / b.w, h: (b.y2 - b.y1) / b.h, c: b.c ?? null }))
    .filter((b) => b.w * b.h >= MIN_AREA)
    .sort((a, b) => b.w * b.h - a.w * a.h)
    .slice(0, PER_PHOTO)
    .map((b, i): Detection => {
      const box = { x: r3(b.x), y: r3(b.y), w: r3(b.w), h: r3(b.h) };
      return {
        id: `${c.kind}-${slug(c.label)}-p${frame}-${i + 1}`,
        kind: c.kind,
        label: c.label,
        concept: c.concept,
        frame,
        seconds: frame / FPS,
        box,
        framesSeen: 1,
        confidence: b.c,
        track: [[frame, box.x, box.y, box.w, box.h]],
      };
    });
}

// Every photo read for every thing, a few looks at a time, photo by photo, so each photo's finds land
// together and in order. `landed` hears a photo's finds as soon as its last look is back. A look that
// fails counts as nothing found, as a failed video concept does.
export async function findInPhotos(
  count: number,
  concepts: Concept[],
  look: (concept: string, photo: number) => Promise<string>,
  landed: (photo: number, found: Detection[]) => Promise<void> = async () => {},
  atOnce = 8,
): Promise<Detection[]> {
  const tasks = Array.from({ length: count }, (_, n) => concepts.map((c, k) => ({ n, c, k }))).flat();
  const found: { k: number; d: Detection }[][] = Array.from({ length: count }, () => []);
  const left = new Array<number>(count).fill(concepts.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(atOnce, tasks.length) }, async () => {
      while (next < tasks.length) {
        const { n, c, k } = tasks[next++];
        const raw = await look(c.concept, n).catch(() => "");
        found[n].push(...photoFinds(n, c, raw).map((d) => ({ k, d })));
        if (--left[n] === 0) {
          const kept = new Set(withoutBeamsInside(found[n].map((x) => x.d)));
          found[n] = found[n].filter((x) => kept.has(x.d)).sort((a, b) => a.k - b.k);
          await landed(n, found[n].map((x) => x.d));
        }
      }
    }),
  );
  return found.flatMap((f) => f.map((x) => x.d));
}

// A "beam" that sits mostly inside a duct or the stairs found in the same picture is that duct, or the
// stairs' stringer. At three quarters inside, practice photos lose only those, never a beam beside a duct.
const INSIDE = 0.75;

export function withoutBeamsInside<T extends Pick<Detection, "kind" | "frame" | "box">>(found: T[]): T[] {
  const others = found.filter((d) => d.kind === "duct" || d.kind === "stairs");
  const inside = (a: T["box"], b: T["box"]) =>
    (Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))) / (a.w * a.h || 1);
  return found.filter((d) => d.kind !== "beam" || !others.some((o) => o.frame === d.frame && inside(d.box, o.box) >= INSIDE));
}

// A room has one of these: two of them in a room's photos are two looks at the same one.
const ONE_PER_ROOM = new Set(["Furnace", "Water heater", "Electrical panel", "Stairs"]);
// Two looks at one thing land this close on the floor plan (metres). Long things (a beam, a duct, the
// stairs) are seen in parts, so their centres can sit further apart.
const NEAR_M = 0.5;
const NEAR_LONG_M = 1.0;
const LONG_KINDS = new Set(["beam", "duct", "stairs"]);

const score = (d: Detection) => d.box.w * d.box.h * (d.confidence ?? 1);

// The same thing seen in more than one photo of a room becomes one find: its best look leads (the proof
// picture), every look joins its track, and framesSeen counts the photos it's in. `floorAt` is where the
// room's 3D puts a find on the floor plan, or null without one. Rooms are never mixed.
export function mergePhotoFinds(
  detections: Detection[],
  roomOf: (frame: number) => number,
  floorAt: (d: Detection) => [number, number] | null,
): { finds: Detection[]; matched: number } {
  type Group = { members: Detection[]; at: [number, number][] };
  const groups = new Map<string, Group[]>();
  for (const d of [...detections].sort((a, b) => score(b) - score(a))) {
    const key = `${roomOf(d.frame)}|${d.label}`;
    const list = groups.get(key) ?? groups.set(key, []).get(key)!;
    const p = floorAt(d);
    const near = LONG_KINDS.has(d.kind) ? NEAR_LONG_M : NEAR_M;
    const same = ONE_PER_ROOM.has(d.label)
      ? list[0]
      : p &&
        list.find((g) => {
          if (!g.at.length) return false;
          const cx = g.at.reduce((s, q) => s + q[0], 0) / g.at.length;
          const cz = g.at.reduce((s, q) => s + q[1], 0) / g.at.length;
          return Math.hypot(p[0] - cx, p[1] - cz) <= near;
        });
    if (same) {
      same.members.push(d);
      if (p) same.at.push(p);
    } else list.push({ members: [d], at: p ? [p] : [] });
  }
  // Back in the order things were first found, each kind numbered again from 1.
  const firstSeen = new Map<string, number>();
  detections.forEach((d, i) => firstSeen.has(d.label) || firstSeen.set(d.label, i));
  const merged = [...groups.values()]
    .flat()
    .map((g): Detection => {
      const lead = g.members[0];
      const track = g.members.flatMap((m) => m.track).sort((a, b) => a[0] - b[0]);
      const confidences = g.members.map((m) => m.confidence).filter((c): c is number => c != null);
      return {
        ...lead,
        framesSeen: new Set(track.map((t) => t[0])).size,
        confidence: confidences.length ? Math.max(...confidences) : null,
        track,
      };
    })
    .sort((a, b) => firstSeen.get(a.label)! - firstSeen.get(b.label)! || a.track[0][0] - b.track[0][0]);
  const counts = new Map<string, number>();
  const finds = merged.map((d) => {
    const n = (counts.get(d.label) ?? 0) + 1;
    counts.set(d.label, n);
    return { ...d, id: `${d.kind}-${slug(d.label)}-${n}` };
  });
  return { finds, matched: detections.length - finds.length };
}
