// What SAM can't find by name, found by pointing (server/pointFinds.ts): Spark boxes a furnace, a bulkhead,
// a rough-in, a water heater or a panel, SAM outlines it from the box, and an unsure or room-sized outline
// is dropped. In a video the watch says when each was filmed and SAM tracks them all in one request. No
// network: Spark and SAM are stubbed.
import { describe, expect, it } from "vitest";
import { findInPhotos } from "../../server/photoFinds";
import { framesNear, pointInPhoto, pointInVideo, pointPrompt, readPoints, wantedFrom, withoutNamed } from "../../server/pointFinds";
import type { Detection } from "../../server/pipeline";

const reply = (text: string) => ({ output: [{ type: "message", content: [{ type: "output_text", text }] }], usage: { input_tokens: 2000, output_tokens: 500 } });
const samBox = (id: number, [x1, y1, x2, y2, c]: number[], frame = 0, w = 1000, h = 1000) => `<${frame}f>${id}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=${w};h=${h};c=${c}|>`;

describe("reading Spark's marks", () => {
  it("keeps boxes of the five things, with their middles, and drops anything else", () => {
    const points = readPoints(
      'Sure: {"found":[{"kind":"furnace","x1":500,"y1":400,"x2":700,"y2":800},{"kind":"sofa","x1":0,"y1":0,"x2":10,"y2":10},{"kind":"bulkhead","x1":0,"y1":0,"x2":1200,"y2":300},{"kind":"plumbing_rough_in","x":150,"y":700}]}',
    );
    expect(points).toEqual([
      { key: "furnace", x: 0.6, y: 0.6, box: [0.5, 0.4, 0.7, 0.8] },
      { key: "plumbing_rough_in", x: 0.15, y: 0.7 },
    ]);
  });

  it("writes SAM a box or a point per object, numbered from 1, frame by frame", () => {
    expect(pointPrompt([{ frame: 0, x: 0.6, y: 0.6, box: [0.5, 0.4, 0.7, 0.8] }], 1280, 960)).toBe("<0f>1<|box;x1=640;y1=384;x2=896;y2=768;w=1280;h=960|>");
    expect(pointPrompt([{ frame: 40, x: 0.5, y: 0.5 }, { frame: 12, x: 0.1, y: 0.2 }, { frame: 40, x: 0.9, y: 0.9 }], 720, 1280)).toBe(
      "<12f>2<|point;x=72;y=256;w=720;h=1280|><40f>1<|point;x=360;y=640;w=720;h=1280|>3<|point;x=648;y=1152;w=720;h=1280|>",
    );
  });
});

describe("pointInPhoto", () => {
  it("asks SAM once a mark, keeps fair outlines, and counts what it cost", async () => {
    const asked: string[] = [];
    const sam = async (text: string) => {
      asked.push(text);
      if (text.includes("x1=500")) return samBox(1, [520, 410, 690, 790, 0.88]); // the furnace
      if (text.includes("x1=0;")) return samBox(1, [0, 0, 1000, 900, 0.9]); // the whole room
      return samBox(1, [100, 600, 140, 640, 0.2]); // unsure
    };
    const ask = async () =>
      reply('{"found":[{"kind":"furnace","x1":500,"y1":400,"x2":700,"y2":800},{"kind":"bulkhead","x1":0,"y1":0,"x2":1000,"y2":900},{"kind":"plumbing_rough_in","x1":100,"y1":600,"x2":140,"y2":650}]}');
    const { finds, costUsd } = await pointInPhoto(3, "data:image/jpeg;base64,AA==", 1000, 1000, ask, sam);
    expect(asked).toHaveLength(3);
    expect(finds).toHaveLength(1);
    expect(finds[0]).toMatchObject({ id: "mechanical-furnace-p3-pt1", kind: "mechanical", label: "Furnace", frame: 3, box: { x: 0.52, y: 0.41, w: 0.17, h: 0.38 }, confidence: 0.88 });
    expect(costUsd).toBeCloseTo(2000 * 1.25e-6 + 500 * 4.25e-6 + 3 * 0.0025, 6);
  });

  it("finds nothing when Spark's reply can't be read", async () => {
    const { finds } = await pointInPhoto(0, "x", 100, 100, async () => reply("no idea"), async () => "");
    expect(finds).toEqual([]);
  });
});

const det = (label: string, kind: string, frame: number, box: number[]): Detection => ({
  id: `${kind}-${label}-${frame}`, kind, label, concept: label, frame, seconds: frame / 5, box: { x: box[0], y: box[1], w: box[2], h: box[3] }, framesSeen: 1, confidence: 0.9, track: [[frame, ...box] as [number, number, number, number, number]],
});

describe("withoutNamed", () => {
  it("drops a pointed water heater SAM already found by name, never a furnace", () => {
    const named = [det("Water heater", "mechanical", 2, [0.5, 0.3, 0.1, 0.4])];
    const pointed = [det("Water heater", "mechanical", 2, [0.52, 0.32, 0.1, 0.38]), det("Water heater", "mechanical", 2, [0.1, 0.3, 0.1, 0.4]), det("Furnace", "mechanical", 2, [0.5, 0.3, 0.1, 0.4])];
    expect(withoutNamed(pointed, named).map((d) => `${d.label} ${d.box.x}`)).toEqual(["Water heater 0.1", "Furnace 0.5"]);
  });

  it("drops a pointed bulkhead on a duct SAM found: it's the bare duct", () => {
    const named = [det("Duct", "duct", 0, [0.6, 0, 0.3, 0.2])];
    const pointed = [det("Bulkhead", "duct", 0, [0.62, 0, 0.3, 0.22]), det("Bulkhead", "duct", 0, [0, 0, 0.3, 0.2])];
    expect(withoutNamed(pointed, named).map((d) => d.box.x)).toEqual([0]);
  });

  it("lands a photo's pointed finds with its others, after them", async () => {
    const WINDOW = { concept: "basement window", kind: "window", label: "Window" };
    const all = await findInPhotos(1, [WINDOW], async () => `<0f>0<|box;x1=100;y1=100;x2=300;y2=200;w=1000;h=1000;c=0.9|>`, undefined, 8, async (n) => [det("Furnace", "mechanical", n, [0.5, 0.4, 0.2, 0.4])]);
    expect(all.map((d) => d.label)).toEqual(["Window", "Furnace"]);
  });
});

describe("pointing in a video", () => {
  const watch = {
    rooms: [
      { fixtures: [{ kind: "furnace", atS: 20, note: "in the corner" }, { kind: "laundry", atS: 25, note: "" }, { kind: "water_heater", atS: null, note: "" }], low: [{ kind: "bulkhead", atS: 30, note: "" }, { kind: "duct", atS: 31, note: "" }] },
      { fixtures: [{ kind: "furnace", atS: 60, note: "seen again" }], low: [] },
    ],
  } as any;

  it("wants what only pointing finds, when the watch says it was filmed", () => {
    expect(wantedFrom(watch).map((w) => `${w.key}@${w.atS}`)).toEqual(["furnace@20", "bulkhead@30", "furnace@60"]);
    expect(framesNear(20, 5, 600)).toEqual([97, 100, 103]);
    expect(framesNear(0.1, 5, 600)).toEqual([0, 1, 4]);
  });

  it("marks each on a frame, tracks them in one request, keeps the same furnace once and drops a room-sized one", async () => {
    const samCalls: string[] = [];
    const ask = async (body: any) => {
      const q: string = body.input[0].content[0].text;
      if (q.includes("bulkhead")) return reply('{"found":true,"frame":1,"x1":0,"y1":0,"x2":1000,"y2":900}');
      return reply('{"found":true,"frame":1,"x1":400,"y1":500,"x2":600,"y2":900}');
    };
    const sam = async (text: string) => {
      samCalls.push(text);
      // Object 1 (the furnace at 20 s), 2 (the bulkhead) and 3 (the furnace again at 60 s) through frames 98–102.
      const lines = [];
      for (let f = 98; f <= 102; f++) lines.push(`<${f}f>1<|box;x1=280;y1=640;x2=440;y2=1150;w=720;h=1280;c=0.8|>,2<|box;x1=0;y1=0;x2=720;y2=1200;w=720;h=1280;c=0.9|>,3<|box;x1=285;y1=645;x2=440;y2=1150;w=720;h=1280;c=0.7|>`);
      return lines.join("\n");
    };
    const { finds, costUsd } = await pointInVideo(watch, { frameUrl: () => "data:image/jpeg;base64,AA==", fileId: "file-1", frameCount: 600, fps: 5, w: 720, h: 1280 }, ask, sam);
    expect(samCalls).toHaveLength(1);
    expect(samCalls[0]).toContain("<100f>1<|box;x1=288;y1=640;x2=432;y2=1152");
    expect(finds.map((d) => [d.id, d.label, d.framesSeen])).toEqual([["mechanical-furnace-pt1", "Furnace", 5]]);
    expect(costUsd).toBeCloseTo(3 * (2000 * 1.25e-6 + 500 * 4.25e-6) + 600 * 0.0002, 6);
  });
});
