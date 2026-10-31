// Labels on a plan kept from running through each other. Room names stay where they are; each find's
// label takes the first of its spots that runs into neither a room name nor a label already placed,
// trying its full text and then its short one. Plan pixels (the SVG's own units), text centred on x
// with its baseline at y.

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Tag = { id: string; text: string; short?: string; size: number; spots: [number, number][] };
export type Placed = { x: number; y: number; text: string };

// Monospace tags: about 0.64 of the font size per character, letter spacing included.
export function textBox(x: number, y: number, text: string, size: number, perChar = 0.64): Box {
  const w = text.length * size * perChar;
  return { x0: x - w / 2, y0: y - size * 0.85, x1: x + w / 2, y1: y + size * 0.25 };
}

const hits = (a: Box, b: Box, pad: number) => a.x0 < b.x1 + pad && b.x0 < a.x1 + pad && a.y0 < b.y1 + pad && b.y0 < a.y1 + pad;

const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

// within: the drawing's edges, when a label mustn't run off them (a plan filling a pane).
export function placeTags(fixed: Box[], tags: Tag[], pad = 4, within?: Box): Map<string, Placed> {
  const taken = [...fixed];
  const out = new Map<string, Placed>();
  const inside = (b: Box) => !within || (b.x0 >= within.x0 && b.x1 <= within.x1 && b.y0 >= within.y0 && b.y1 <= within.y1);
  for (const t of tags) {
    let pick: Placed | null = null;
    for (const text of t.short && t.short !== t.text ? [t.text, t.short] : [t.text]) {
      for (const [x, y] of t.spots) {
        const box = textBox(x, y, text, t.size);
        if (inside(box) && !taken.some((b) => hits(box, b, pad))) {
          pick = { x, y, text };
          break;
        }
      }
      if (pick) break;
    }
    // Nowhere clear: the short text where it covers least (running off the edge counts most).
    if (!pick) {
      const text = t.short ?? t.text;
      const [x, y] = t.spots.reduce((best, s) => {
        const cost = (p: [number, number]) => {
          const box = textBox(p[0], p[1], text, t.size);
          return taken.reduce((sum, b) => sum + overlap(box, b), 0) + (inside(box) ? 0 : 1e9);
        };
        return cost(s) < cost(best) ? s : best;
      });
      pick = { x, y, text };
    }
    taken.push(textBox(pick.x, pick.y, pick.text, t.size));
    out.set(t.id, pick);
  }
  return out;
}

// A callout beside the thing it's about (a wall's length, a room's name), in screen pixels: clear of
// that point, inside the pane and under its tools, on the side with the room. Tried right or left first
// (whichever has more room), then below, then above; the first that keeps the point uncovered wins,
// else the one nearest to it. The leader runs from the point to a short horizontal shoulder at the
// callout's edge, as leaders do on the drawings.
export type Callout = { x: number; y: number; side: "right" | "left" | "below" | "above"; leader: [number, number][] };

export function placeCallout(at: [number, number], size: { w: number; h: number }, pane: { w: number; h: number; top?: number; bottom?: number }, gap = 28, clear = 10): Callout {
  const [ax, ay] = at;
  const m = 8;
  const top = pane.top ?? m, bottom = pane.h - (pane.bottom ?? m);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const fitX = (x: number) => clamp(x, m, Math.max(m, pane.w - size.w - m));
  const fitY = (y: number) => clamp(y, top, Math.max(top, bottom - size.h));
  const sides: Callout["side"][] = ax <= pane.w / 2 ? ["right", "left", "below", "above"] : ["left", "right", "below", "above"];
  const boxes = sides.map((side) => {
    const x = side === "right" ? ax + gap : side === "left" ? ax - gap - size.w : ax - size.w / 2;
    const y = side === "below" ? ay + gap : side === "above" ? ay - gap - size.h : ay - size.h / 2;
    return { side, x: fitX(x), y: fitY(y) };
  });
  // How far the point is outside each box (0 or less: covered).
  const outside = (b: { x: number; y: number }) => Math.max(b.x - ax, ax - (b.x + size.w), b.y - ay, ay - (b.y + size.h));
  const pick = boxes.find((b) => outside(b) >= clear) ?? boxes.reduce((best, b) => (outside(b) > outside(best) ? b : best));
  return { ...pick, leader: leaderTo(at, pick, size) };
}

function leaderTo([ax, ay]: [number, number], b: { x: number; y: number }, size: { w: number; h: number }): [number, number][] {
  const inY = (y: number) => Math.max(b.y + 10, Math.min(b.y + size.h - 10, y));
  const inX = (x: number) => Math.max(b.x + 10, Math.min(b.x + size.w - 10, x));
  if (ax <= b.x) return [[ax, ay], [b.x - 12, inY(ay)], [b.x, inY(ay)]];
  if (ax >= b.x + size.w) return [[ax, ay], [b.x + size.w + 12, inY(ay)], [b.x + size.w, inY(ay)]];
  // Above or below the box: drop to its edge, the shoulder along it.
  const ey = ay < b.y ? b.y : b.y + size.h;
  return [[ax, ay], [inX(ax), ey]];
}
