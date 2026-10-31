// A video's finds from SAM's tracks (server/videoFinds.ts): what holds for half a second counts, at most
// six of a thing, and beams are one long, level track at a time, never the joists, posts and stringers
// SAM also tracks as "support beam".
import { describe, expect, it } from "vitest";
import { videoFinds } from "../../server/videoFinds";

const BEAM = { concept: "support beam", kind: "beam", label: "Beam" };
const WINDOW = { concept: "basement window", kind: "window", label: "Window" };

// SAM's video text: one line per frame, `<Nf>` then each track's box. A track here is [id, from, to, box].
type Track = [number, number, number, [number, number, number, number, number]];
function sam(...tracks: Track[]) {
  const last = Math.max(...tracks.map((t) => t[2]));
  const lines: string[] = [];
  for (let f = 0; f <= last; f++) {
    const here = tracks.filter(([, from, to]) => f >= from && f <= to);
    if (!here.length) continue;
    lines.push(`<${f}f>${here.map(([id, , , [x1, y1, x2, y2, c]], i) => `${i ? "," : ""}${id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=720;h=1280;c=${c}|>`).join("")}`);
  }
  return lines.join("\n");
}

describe("videoFinds", () => {
  it("keeps what holds for half a second, at most six, in the pipeline's shape", () => {
    const found = videoFinds(WINDOW, sam([0, 0, 1, [0, 0, 100, 100, 0.9]], [1, 10, 20, [100, 200, 300, 300, 0.8]]), 5);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ id: "window-window-1", kind: "window", label: "Window", framesSeen: 11, confidence: 0.8 });
    expect(found[0].track[0]).toEqual([10, 0.139, 0.156, 0.278, 0.078]);
    const many = Array.from({ length: 9 }, (_, i): Track => [i, i * 10, i * 10 + 4, [0, 0, 100, 100, 0.9]]);
    expect(videoFinds(WINDOW, sam(...many), 5)).toHaveLength(6);
  });

  it("keeps a long, level beam and never a post, a stud or a short joist", () => {
    const found = videoFinds(BEAM, sam(
      [0, 0, 10, [0, 200, 700, 300, 0.75]], // a beam across the frame
      [1, 20, 30, [300, 0, 360, 1279, 0.9]], // a post
      [2, 40, 50, [100, 100, 300, 160, 0.9]], // a short piece of joist
      [3, 60, 70, [0, 300, 700, 400, 0.6]], // long but unsure
    ), 5);
    expect(found.map((d) => d.track[0][0])).toEqual([0]);
  });

  it("keeps one long beam at a time: of joists seen together, only the widest", () => {
    const found = videoFinds(BEAM, sam(
      [0, 0, 20, [0, 100, 600, 160, 0.8]],
      [1, 5, 25, [0, 200, 720, 260, 0.75]], // widest of the three seen together
      [2, 10, 30, [50, 300, 500, 350, 0.9]],
      [3, 50, 60, [100, 250, 600, 300, 0.7]], // later, on its own
    ), 5);
    expect(found.map((d) => [d.id, d.track[0][0]])).toEqual([["beam-beam-1", 5], ["beam-beam-2", 50]]);
  });
});
