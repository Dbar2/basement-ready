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

export function placeTags(fixed: Box[], tags: Tag[], pad = 4): Map<string, Placed> {
  const taken = [...fixed];
  const out = new Map<string, Placed>();
  for (const t of tags) {
    let pick: Placed | null = null;
    for (const text of t.short && t.short !== t.text ? [t.text, t.short] : [t.text]) {
      for (const [x, y] of t.spots) {
        if (!taken.some((b) => hits(textBox(x, y, text, t.size), b, pad))) {
          pick = { x, y, text };
          break;
        }
      }
      if (pick) break;
    }
    // Nowhere clear: the short text where it covers least.
    if (!pick) {
      const text = t.short ?? t.text;
      const [x, y] = t.spots.reduce((best, s) => {
        const cost = (p: [number, number]) => taken.reduce((sum, b) => sum + overlap(textBox(p[0], p[1], text, t.size), b), 0);
        return cost(s) < cost(best) ? s : best;
      });
      pick = { x, y, text };
    }
    taken.push(textBox(pick.x, pick.y, pick.text, t.size));
    out.set(t.id, pick);
  }
  return out;
}
