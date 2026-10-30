import { describe, expect, it } from "vitest";
import { mergeMesh } from "../../server/basement";

// A BRM1 file: one triangle per centre given (x, z in metres, on the floor), each vertex coloured `rgb`.
function brm(centres: [number, number][], rgb: number): ArrayBuffer {
  const nv = centres.length * 3, nf = centres.length;
  const buf = new ArrayBuffer(12 + nf * 12 + nv * 6 + nv * 3);
  const head = new DataView(buf);
  [..."BRM1"].forEach((ch, i) => head.setUint8(i, ch.charCodeAt(0)));
  head.setUint32(4, nv, true);
  head.setUint32(8, nf, true);
  const F = new Uint32Array(buf, 12, nf * 3), P = new Int16Array(buf, 12 + nf * 12, nv * 3);
  new Uint8Array(buf, 12 + nf * 12 + nv * 6, nv * 3).fill(rgb);
  centres.forEach(([x, z], f) => {
    for (let k = 0; k < 3; k++) {
      F[f * 3 + k] = f * 3 + k;
      P.set([Math.round(x * 1000) + (k === 1 ? 20 : 0), 0, Math.round(z * 1000) + (k === 2 ? 20 : 0)], (f * 3 + k) * 3);
    }
  });
  return buf;
}

function read(b: Buffer) {
  const nv = b.readUInt32LE(4), nf = b.readUInt32LE(8);
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return { nv, nf, faces: new Uint32Array(ab, 12, nf * 3), pos: new Int16Array(ab, 12 + nf * 12, nv * 3), col: new Uint8Array(ab, 12 + nf * 12 + nv * 6, nv * 3) };
}

describe("one solid surface for the whole basement", () => {
  const a = { x0: -2, z0: -2, x1: 2, z1: 2 }, b = { x0: 2, z0: -2, x1: 6, z1: 2 };

  it("places each area and drops what lies inside a neighbour's box", () => {
    // Area A: its own floor, its wall near the shared side, and a look through the door deep into B.
    const roomA = brm([[0, 0], [2.1, 0], [4, 0]], 10);
    // Area B is filmed in its own frame, centred on itself, then shifted 4 m along x.
    const roomB = brm([[0, 0]], 20);
    const out = read(mergeMesh([{ mesh: roomA, placement: { turn: 0, x: 0, z: 0 }, rect: a }, { mesh: roomB, placement: { turn: 0, x: 4, z: 0 }, rect: b }], [a, b]));
    expect(out.nf).toBe(3); // A's look into B went; its wall just past the line stayed
    expect(out.nv).toBe(9);
    expect(Math.max(...out.faces)).toBe(8);
    // B's triangle moved into place and kept its colour.
    expect(out.pos[6 * 3]).toBe(4000);
    expect(out.col[8 * 3]).toBe(20);
  });

  it("keeps surfaces outside every box (a hall nobody boxed)", () => {
    const out = read(mergeMesh([{ mesh: brm([[0, 5]], 10), placement: { turn: 0, x: 0, z: 0 }, rect: a }], [a, b]));
    expect(out.nf).toBe(1);
  });

  it("turns an area by quarter turns", () => {
    const out = read(mergeMesh([{ mesh: brm([[1, 0]], 10), placement: { turn: 1, x: 0, z: 0 }, rect: a }], [a]));
    // x' = c x - s z, z' = s x + c z with a quarter turn: (1, 0) -> (0, 1).
    expect(out.pos[0]).toBe(0);
    expect(out.pos[2]).toBe(1000);
  });
});
