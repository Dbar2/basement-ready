// A video's finds of one thing, from SAM's tracks (server/meta.ts samVideo). Only what holds for half a
// second counts, at most six of a thing. Beams follow the photos' rule (server/photoFinds.ts): SAM's
// "support beam" also tracks every joist, post, stud and stair stringer, so a beam track must be long and
// level on its clearest frame, and joists come as several long tracks at once where a basement shows one
// beam at a time: of long tracks seen over the same frames, only the widest stays. Checked on David's takes
// and the Blender basements (scripts/practice/tracks.ts).
import { isLongBeam } from "./photoFinds";
import type { Detection } from "./pipeline";
import { bestFrame, parseSam, type SamTrack } from "./sam";

type Concept = { concept: string; kind: string; label: string };

const MAX = 6;

const width = (t: SamTrack) => {
  const b = bestFrame(t).box;
  return (b.x2 - b.x1) / b.w;
};
const span = (t: SamTrack) => [t.frames[0].frame, t.frames[t.frames.length - 1].frame];

// The widest long track first, then each next one seen over other frames.
export function oneBeamAtATime(tracks: SamTrack[]): SamTrack[] {
  const kept: SamTrack[] = [];
  for (const t of tracks.filter((t) => isLongBeam(bestFrame(t).box)).sort((a, b) => width(b) - width(a))) {
    const [from, to] = span(t);
    if (kept.every((k) => span(k)[1] < from || span(k)[0] > to)) kept.push(t);
  }
  return kept.sort((a, b) => a.id - b.id);
}

export function videoFinds(c: Concept, raw: string, fps: number): Detection[] {
  const held = parseSam(raw).filter((t) => t.frames.length >= Math.ceil(fps / 2));
  const tracks = (c.kind === "beam" ? oneBeamAtATime(held) : held).slice(0, MAX);
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return tracks.map((t, i) => {
    const b = bestFrame(t);
    return {
      id: `${c.kind}-${c.label.toLowerCase().replace(/\s+/g, "-")}-${i + 1}`,
      kind: c.kind,
      label: c.label,
      concept: c.concept,
      frame: b.frame,
      seconds: b.frame / fps,
      box: { x: b.box.x1 / b.box.w, y: b.box.y1 / b.box.h, w: (b.box.x2 - b.box.x1) / b.box.w, h: (b.box.y2 - b.box.y1) / b.box.h },
      framesSeen: t.frames.length,
      confidence: b.box.c ?? null,
      track: t.frames.map((f) => [f.frame, r(f.box.x1 / f.box.w), r(f.box.y1 / f.box.h), r((f.box.x2 - f.box.x1) / f.box.w), r((f.box.y2 - f.box.y1) / f.box.h)]),
    };
  });
}
