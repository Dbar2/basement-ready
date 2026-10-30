// What a page of our own PDFs draws, read back from its content stream: the lines (with their width,
// colour and the clip box around them) and the text (where it sits). Enough to check a drawing against
// its own labels: a dimension's line is as long as its label says, at the scale the sheet prints.
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";

type Rect = { x: number; y: number; w: number; h: number };
// `seq`: drawing order on the page, so a label can be paired with the line drawn just before it.
export type Seg = { seq: number; x0: number; y0: number; x1: number; y1: number; width: number; grey: number | null; clip: Rect | null };
export type Label = { seq: number; x: number; y: number; text: string };

export async function pageDrawing(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const c = doc.context.lookup(page.node.Contents()!);
    const streams = c instanceof PDFArray ? c.asArray().map((r) => doc.context.lookup(r)) : [c];
    const ops = streams.map((s) => Buffer.from(decodePDFRawStream(s as PDFRawStream).decode()).toString("latin1")).join("\n");
    const tokens = ops.match(/<[0-9A-Fa-f\s]*>|\[[^\]]*\]|\/\S+|[^\s<>\[\]]+/g) ?? [];
    const segs: Seg[] = [];
    const labels: Label[] = [];
    type G = { width: number; grey: number | null; clip: Rect | null };
    let g: G = { width: 1, grey: null, clip: null };
    const stack: G[] = [];
    let at: [number, number] | null = null;
    let pendingClip: Rect | null = null;
    let tm: [number, number] = [0, 0];
    const num = (i: number) => Number(tokens[i]);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t === "q") stack.push({ ...g });
      else if (t === "Q") g = stack.pop() ?? g;
      else if (t === "w") g.width = num(i - 1);
      else if (t === "RG") g.grey = num(i - 3) === num(i - 2) && num(i - 2) === num(i - 1) ? num(i - 1) : null;
      else if (t === "re") pendingClip = { x: num(i - 4), y: num(i - 3), w: num(i - 2), h: num(i - 1) };
      else if (t === "W" && pendingClip) g.clip = pendingClip;
      else if (t === "m") at = [num(i - 2), num(i - 1)];
      else if (t === "l" && at) {
        const to: [number, number] = [num(i - 2), num(i - 1)];
        segs.push({ seq: i, x0: at[0], y0: at[1], x1: to[0], y1: to[1], ...g });
        at = to;
      } else if (t === "Tm") tm = [num(i - 2), num(i - 1)];
      else if (t === "Tj" && tokens[i - 1]?.startsWith("<")) labels.push({ seq: i, x: tm[0], y: tm[1], text: Buffer.from(tokens[i - 1].slice(1, -1).replace(/\s/g, ""), "hex").toString("latin1") });
    }
    return { segs, labels };
  });
}

const inside = (r: Rect, x: number, y: number, slack = 0.5) => x >= Math.min(r.x, r.x + r.w) - slack && x <= Math.max(r.x, r.x + r.w) + slack && y >= Math.min(r.y, r.y + r.h) - slack && y <= Math.max(r.y, r.y + r.h) + slack;

// Every dimension label ("12'-8" (3867)", or "... TO MATCH LINE" on a plan cut into sheets) against the
// chain line drawn just before it (server/permit/draw.ts chainSeg draws the line, its ticks, then the
// label): how long that line is at the page's scale, and whether the sheet's clip cuts it short.
// `ptPerM`: points per metre at the scale the sheet prints.
export function chainMismatches(page: { segs: Seg[]; labels: Label[] }, ptPerM: number, toleranceMm = 5) {
  const chains = page.segs.filter((s) => Math.abs(s.width - 0.45) < 0.01 && s.grey != null && s.grey > 0.3 && s.grey < 0.45 && Math.hypot(s.x1 - s.x0, s.y1 - s.y0) > 1);
  const out: string[] = [];
  let checked = 0;
  for (const l of page.labels) {
    const m = /^\d+'-\d+" \((\d+)\)( TO MATCH LINE)?$/.exec(l.text);
    if (!m) continue;
    const s = chains.filter((c) => c.seq < l.seq).at(-1);
    if (!s) continue;
    checked++;
    const drawnMm = (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / ptPerM) * 1000;
    if (Math.abs(drawnMm - Number(m[1])) > toleranceMm) out.push(`${l.text} is drawn ${Math.round(drawnMm)} mm long`);
    else if (s.clip && !(inside(s.clip, s.x0, s.y0) && inside(s.clip, s.x1, s.y1))) out.push(`${l.text}: its line runs past the sheet's edge`);
  }
  return { checked, out };
}
