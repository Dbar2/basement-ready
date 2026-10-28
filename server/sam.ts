// Parses SAM 3.1's special-token output into tracks.
// Video output is one line per frame: `<12f>0<|box;x1=..;...|><|mask;...|>,1<|box;...|>...`
// The ordinal before each box is the object's track id across frames.

export type SamBox = { x1: number; y1: number; x2: number; y2: number; w: number; h: number; c?: number };
export type SamTrack = { id: number; frames: { frame: number; box: SamBox }[] };

function parseBox(body: string): SamBox {
  const v: Record<string, number> = {};
  for (const part of body.split(";")) {
    const [k, n] = part.split("=");
    if (k && n !== undefined) v[k.trim()] = Number(n);
  }
  return { x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, w: v.w, h: v.h, c: v.c };
}

export function parseSam(text: string): SamTrack[] {
  const tracks = new Map<number, SamTrack>();
  for (const chunk of text.split(/(?=<\d+f>)/)) {
    const head = chunk.match(/^<(\d+)f>/);
    if (!head) continue;
    const frame = Number(head[1]);
    // The ordinal sits right after the frame marker or a record-separating comma.
    for (const m of chunk.matchAll(/(?:>|,)(\d+)<\|box;([^|]+)\|>/g)) {
      const id = Number(m[1]);
      const box = parseBox(m[2]);
      if (!Number.isFinite(box.x1)) continue;
      if (!tracks.has(id)) tracks.set(id, { id, frames: [] });
      tracks.get(id)!.frames.push({ frame, box });
    }
  }
  return [...tracks.values()];
}

// The frame where the object is biggest and most confident: the best proof shot.
export function bestFrame(track: SamTrack) {
  let best = track.frames[0];
  let score = -1;
  for (const f of track.frames) {
    const area = (f.box.x2 - f.box.x1) * (f.box.y2 - f.box.y1);
    const s = area * (f.box.c ?? 1);
    if (s > score) {
      score = s;
      best = f;
    }
  }
  return best;
}
