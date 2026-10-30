// The object-id image: a second render of the same angle where every piece of furniture, wall and
// floor is one flat colour that encodes its number, so a tap anywhere on a picture says what's there.
// Each channel carries 4 bits in its high nibble (the low nibble sits mid-way), so colours a byte or
// two off still decode: 12 bits, 4095 things.
export type IdImage = { width: number; height: number; data: Uint8Array | Uint8ClampedArray; ids: string[] };

export const MAX_IDS = 4095;

// Index 1..4095 -> 0..255 RGB. 0 is nothing (cleared to black).
export function idColour(index: number): [number, number, number] {
  if (index < 1 || index > MAX_IDS) throw new Error(`id ${index} out of range`);
  return [((index & 0xf) << 4) | 8, (((index >> 4) & 0xf) << 4) | 8, (((index >> 8) & 0xf) << 4) | 8];
}

export function decodeId(r: number, g: number, b: number): number {
  return (r >> 4) | ((g >> 4) << 4) | ((b >> 4) << 8);
}

// What's at (x, y) in the image's pixels: the commonest id in a small window, so an edge pixel or a
// thin chair leg still answers. Null for nothing (the real room).
export function idAt(img: IdImage, x: number, y: number, radius = 3): string | null {
  const counts = new Map<number, number>();
  const cx = Math.round(x), cy = Math.round(y);
  for (let v = cy - radius; v <= cy + radius; v++) {
    if (v < 0 || v >= img.height) continue;
    for (let u = cx - radius; u <= cx + radius; u++) {
      if (u < 0 || u >= img.width) continue;
      const o = (v * img.width + u) * 4;
      const i = decodeId(img.data[o], img.data[o + 1], img.data[o + 2]);
      // The tapped pixel itself counts double: it wins a tie.
      if (i > 0 && i < img.ids.length) counts.set(i, (counts.get(i) ?? 0) + (u === cx && v === cy ? 2 : 1));
    }
  }
  let best = 0, n = 0;
  for (const [i, c] of counts) if (c > n || (c === n && i < best)) [best, n] = [i, c];
  return best ? img.ids[best] : null;
}

// A tap on the picture as shown (any size) -> the id image's pixels.
export function idAtTap(img: IdImage, tap: { x: number; y: number }, shown: { width: number; height: number }) {
  return idAt(img, (tap.x / shown.width) * img.width, (tap.y / shown.height) * img.height, Math.max(2, Math.round(img.width / 240)));
}

type Box = { x: number; y: number; w: number; h: number };

// Where each thing shows in the picture: its box (0..1 of the picture) and the share of the picture it
// covers. What SAM is held to, and what the gallery outlines when something is tapped.
export function idBoxes(img: IdImage): Map<string, { box: Box; share: number }> {
  const n = img.ids.length;
  const x0 = new Int32Array(n).fill(img.width), y0 = new Int32Array(n).fill(img.height), x1 = new Int32Array(n).fill(-1), y1 = new Int32Array(n).fill(-1);
  const count = new Int32Array(n);
  for (let v = 0; v < img.height; v++) {
    for (let u = 0; u < img.width; u++) {
      const o = (v * img.width + u) * 4;
      const i = decodeId(img.data[o], img.data[o + 1], img.data[o + 2]);
      if (i <= 0 || i >= n) continue;
      count[i]++;
      if (u < x0[i]) x0[i] = u;
      if (u > x1[i]) x1[i] = u;
      if (v < y0[i]) y0[i] = v;
      if (v > y1[i]) y1[i] = v;
    }
  }
  const out = new Map<string, { box: Box; share: number }>();
  for (let i = 1; i < n; i++) {
    if (!count[i]) continue;
    out.set(img.ids[i], {
      box: { x: x0[i] / img.width, y: y0[i] / img.height, w: (x1[i] - x0[i] + 1) / img.width, h: (y1[i] - y0[i] + 1) / img.height },
      share: count[i] / (img.width * img.height),
    });
  }
  return out;
}

// WebGL reads pixels bottom row first: the same image, top row first.
export function flipRows(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(data.length);
  const row = width * 4;
  for (let v = 0; v < height; v++) out.set(data.subarray((height - 1 - v) * row, (height - v) * row), v * row);
  return out;
}
