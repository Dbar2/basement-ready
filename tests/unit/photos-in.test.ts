// Photos in, instead of a video: the upload's checks (count, kind, size, room tags), photos turned
// upright by their EXIF and written as frames in room order, SAM's finds per photo, the same thing
// seen in two photos matched by where the 3D puts it, each room measured from its own photos, and the
// staged pictures free to start from any photo. No network: SAM and the 3D are stubbed.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

// Storage goes to a folder of its own, never the repo's media/ (set before server/storage.ts loads).
vi.hoisted(() => {
  process.env.LOCAL_STORAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/br-photos-in-${process.pid}-${Date.now()}`;
});

import { pickFrames } from "../../server/concepts";
import { findInPhotos, isLevel, mergePhotoFinds, photoFinds } from "../../server/photoFinds";
import { exifOrientation, MAX_PHOTOS, MIN_PHOTOS, readPhotos, roomOrder, savePhotos, sniffPhoto, uprightFilter, uprightPhoto, type PhotoKind } from "../../server/photoInput";
import { CONCEPTS, findWords, measurePhotoRooms, type Detection } from "../../server/pipeline";
import type { Scan3d } from "../../server/scan3d";
import { keys, storage } from "../../server/storage";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

// A JPEG with an EXIF orientation tag, as a phone writes it.
function withExif(jpeg: Buffer, orientation: number, bigEndian = false): Buffer {
  const tiff = Buffer.alloc(26);
  const u16 = (v: number, at: number) => (bigEndian ? tiff.writeUInt16BE(v, at) : tiff.writeUInt16LE(v, at));
  const u32 = (v: number, at: number) => (bigEndian ? tiff.writeUInt32BE(v, at) : tiff.writeUInt32LE(v, at));
  tiff.write(bigEndian ? "MM" : "II", 0, "ascii");
  u16(42, 2);
  u32(8, 4);
  u16(1, 8); // one entry
  u16(0x0112, 10); // Orientation
  u16(3, 12); // SHORT
  u32(1, 14);
  u16(orientation, 18);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), head, payload, jpeg.subarray(2)]);
}

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...Buffer.from("JFIF\0"), 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const file = (bytes: Buffer, size = bytes.length) => ({ size, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer });
const jpegs = (n: number) => Array.from({ length: n }, (_, i) => file(Buffer.concat([JPEG.subarray(0, -2), Buffer.from([i]), JPEG.subarray(-2)])));
// The photo itself, as ffmpeg would return it: here, which photo it was.
const marked = async (b: Buffer, _k: PhotoKind) => Buffer.from(`frame of photo ${b[b.length - 3]}`);

describe("the upload's checks", () => {
  it("takes 5 to 20 photos", async () => {
    expect(await readPhotos(jpegs(MIN_PHOTOS - 1), JSON.stringify(Array(4).fill("Room 1")), marked)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/at least 5/) });
    expect(await readPhotos(jpegs(MAX_PHOTOS + 1), JSON.stringify(Array(21).fill("Room 1")), marked)).toMatchObject({ ok: false, status: 400, error: expect.stringMatching(/Up to 20/) });
    expect(await readPhotos(undefined, undefined, marked)).toMatchObject({ ok: false, status: 400 });
    expect(await readPhotos(jpegs(20), JSON.stringify(Array(20).fill("Room 1")), marked)).toMatchObject({ ok: true });
  });

  it("needs a room for every photo, and at most 8 rooms", async () => {
    for (const rooms of [undefined, "not json", JSON.stringify(["Room 1", "Room 1"]), JSON.stringify(["Room 1", "", "Room 1", "Room 1", "Room 1"])]) {
      expect(await readPhotos(jpegs(5), rooms, marked)).toMatchObject({ ok: false, status: 400, error: "Each photo needs its room." });
    }
    const nine = Array.from({ length: 9 }, (_, i) => `Room ${i + 1}`);
    expect(await readPhotos(jpegs(9), JSON.stringify(nine), marked)).toMatchObject({ ok: false, error: expect.stringMatching(/8 rooms/) });
  });

  it("refuses a photo over 25 MB, by number, before reading any", async () => {
    const files = jpegs(6);
    files[3] = { size: 26 * 1024 * 1024, arrayBuffer: async () => { throw new Error("read"); } };
    expect(await readPhotos(files, JSON.stringify(Array(6).fill("Room 1")), marked)).toMatchObject({ ok: false, status: 413, error: expect.stringMatching(/Photo 4 is too large/) });
  });

  it("knows a photo by its bytes, not its name: JPEG, PNG, WebP and HEIC", async () => {
    expect(sniffPhoto(JPEG)).toBe("jpeg");
    expect(sniffPhoto(Buffer.from("89504e470d0a1a0a0000000d", "hex"))).toBe("png");
    expect(sniffPhoto(Buffer.concat([Buffer.from("RIFF\0\0\0\0WEBPVP8 ")]))).toBe("webp");
    expect(sniffPhoto(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic\0\0\0\0")]))).toBe("heic");
    expect(sniffPhoto(Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypqt  \0\0\0\0")]))).toBeNull(); // a .mov
    const files = jpegs(5);
    files[2] = file(Buffer.from("%PDF-1.7 not a photo at all"));
    expect(await readPhotos(files, JSON.stringify(Array(5).fill("Room 1")), marked)).toMatchObject({ ok: false, status: 415, error: expect.stringMatching(/Photo 3 isn't a photo/) });
  });

  it("says which photo couldn't be opened", async () => {
    const fails = async (b: Buffer, k: PhotoKind) => (b[b.length - 3] === 1 ? Promise.reject(new Error("ffmpeg")) : marked(b, k));
    expect(await readPhotos(jpegs(5), JSON.stringify(Array(5).fill("Room 1")), fails)).toMatchObject({ ok: false, status: 415, error: expect.stringMatching(/couldn't open photo 2/) });
  });

  it("puts the photos in room order, rooms in the order they first appear", async () => {
    const tags = ["Room 1", "Room 2", "room 1", "Family room", "Room 2", "Room 1", "  Family   room "];
    expect(roomOrder(tags.map((t) => t.replace(/\s+/g, " ").trim()))).toEqual({
      order: [0, 2, 5, 1, 4, 3, 6],
      rooms: [
        { name: "Room 1", from: 0, to: 3 },
        { name: "Room 2", from: 3, to: 5 },
        { name: "Family room", from: 5, to: 7 },
      ],
    });
    const r = await readPhotos(jpegs(7), JSON.stringify(tags), marked);
    if (!r.ok) throw new Error(r.error);
    expect(r.frames.map(String)).toEqual([0, 2, 5, 1, 4, 3, 6].map((i) => `frame of photo ${i}`));
    expect(r.take).toEqual({ count: 7, rooms: [{ name: "Room 1", from: 0, to: 3 }, { name: "Room 2", from: 3, to: 5 }, { name: "Family room", from: 5, to: 7 }] });
  });

  it("writes the frames in room order where a video's frames go, and the take's record", async () => {
    const r = await readPhotos(jpegs(6), JSON.stringify(["B", "A", "B", "A", "B", "A"]), marked);
    if (!r.ok) throw new Error(r.error);
    const key = await savePhotos("11111111-2222-3333-4444-555555555555", r.frames, r.take);
    expect(key).toBe(keys.photos("11111111-2222-3333-4444-555555555555"));
    const dir = process.env.LOCAL_STORAGE_DIR!;
    const frames = [0, 1, 2, 3, 4, 5].map((n) => readFileSync(join(dir, keys.frame("11111111-2222-3333-4444-555555555555", n)), "utf8"));
    expect(frames).toEqual([0, 2, 4, 1, 3, 5].map((i) => `frame of photo ${i}`));
    const take = JSON.parse(readFileSync(join(dir, key), "utf8"));
    expect(take.rooms).toEqual([{ name: "B", from: 0, to: 3 }, { name: "A", from: 3, to: 6 }]);
    expect(await storage.get(keys.frame("11111111-2222-3333-4444-555555555555", 6))).toBeNull();
  });
});

describe("photos turned upright", () => {
  it("reads the EXIF orientation, either byte order, and 1 when there is none", () => {
    expect(exifOrientation(withExif(JPEG, 6))).toBe(6);
    expect(exifOrientation(withExif(JPEG, 8, true))).toBe(8);
    expect(exifOrientation(JPEG)).toBe(1);
    expect(exifOrientation(withExif(JPEG, 42))).toBe(1);
  });

  it("turns each orientation the way jpegtran does", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(uprightFilter)).toEqual([null, "hflip", "hflip,vflip", "vflip", "transpose=0", "transpose=1", "transpose=3", "transpose=2"]);
  });

  it.skipIf(!hasFfmpeg)("turns a sideways phone photo upright, 1280 px on its long side, with no metadata left", async () => {
    const dir = mkdtempSync(join(tmpdir(), "br-upright-"));
    // Upright it's a tall picture, bright on top. The phone stored it turned on its side and tagged it 6.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=white:s=1500x1000,format=yuv420p", "-f", "lavfi", "-i", "color=black:s=1500x1000", "-filter_complex", "[0][1]vstack,transpose=2", "-frames:v", "1", join(dir, "stored.jpg")]);
    const stored = readFileSync(join(dir, "stored.jpg"));
    const up = await uprightPhoto(withExif(stored, 6), "jpeg");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", "pipe:0", "-vf", "scale=2:2", "-f", "rawvideo", "-pix_fmt", "gray", join(dir, "px")], { input: up });
    const [topLeft, , bottomLeft] = readFileSync(join(dir, "px"));
    const size = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], { input: up }).toString().trim();
    expect(size).toBe("960,1280"); // 1500 × 2000 tall, made 1280 long
    expect(topLeft).toBeGreaterThan(200); // white on top again
    expect(bottomLeft).toBeLessThan(60);
    expect(up.includes(Buffer.from("Exif\0\0", "binary"))).toBe(false);
  });

  it.skipIf(!hasFfmpeg)("never makes a small photo bigger", async () => {
    const dir = mkdtempSync(join(tmpdir(), "br-small-"));
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=gray:s=800x600", "-frames:v", "1", join(dir, "small.png")]);
    const up = await uprightPhoto(readFileSync(join(dir, "small.png")), "png");
    expect(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", "-i", "pipe:0"], { input: up }).toString().trim()).toBe("800,600");
  });
});

// SAM's text for one image: `<0f>` then each object's box.
const sam = (...boxes: [number, number, number, number, number][]) =>
  `<0f>${boxes.map(([x1, y1, x2, y2, c], i) => `${i ? "," : ""}${i}<|box;x1=${x1};y1=${y1};x2=${x2};y2=${y2};w=1280;h=960;c=${c}|><|mask;x=0;y=0;data=1,1,!|>`).join("")}`;
const WINDOW = CONCEPTS.find((c) => c.label === "Window")!;
const FURNACE = CONCEPTS.find((c) => c.label === "Furnace")!;
const BEAM = CONCEPTS.find((c) => c.label === "Beam")!;

describe("SAM on each photo", () => {
  it("keeps sure finds of a fair size, biggest first, in the video's shape", () => {
    const found = photoFinds(3, WINDOW, sam([100, 100, 400, 300, 0.9], [600, 100, 640, 120, 0.95], [700, 200, 900, 400, 0.3], [800, 500, 1100, 900, 0.7]));
    // The speck and the unsure one are left out; the bigger window comes first.
    expect(found.map((d) => d.box.y)).toEqual([0.521, 0.104]);
    expect(found[0]).toMatchObject({ kind: "window", label: "Window", frame: 3, seconds: 0.6, framesSeen: 1, confidence: 0.7 });
    expect(found[0].track).toEqual([[3, 0.625, 0.521, 0.234, 0.417]]);
    expect(found.map((d) => d.id)).toEqual(["window-window-p3-1", "window-window-p3-2"]);
    expect(photoFinds(0, WINDOW, "")).toEqual([]);
  });

  it("keeps one beam a photo: the widest long, level one before the joists and posts SAM also calls beams", () => {
    // A beam across the ceiling counts from 0.65: its shape vouches for it.
    expect(photoFinds(0, BEAM, sam([0, 0, 1280, 100, 0.66]))).toHaveLength(1);
    expect(photoFinds(0, BEAM, sam([0, 0, 1280, 100, 0.6]))).toHaveLength(0);
    // A long one wins over a surer joist or post, and of several long ones the widest.
    const one = photoFinds(0, BEAM, sam([100, 50, 400, 80, 0.95], [600, 100, 660, 900, 0.95], [100, 50, 700, 120, 0.8], [0, 200, 1200, 320, 0.67]));
    expect(one).toHaveLength(1);
    expect(one[0].box).toMatchObject({ x: 0, w: 0.938 });
    // With no long one, the widest sure box stands in, so the open joists still show; four joists are one find.
    const joists = photoFinds(0, BEAM, sam([100, 50, 400, 80, 0.9], [500, 40, 640, 70, 0.75], [700, 30, 900, 60, 0.8], [900, 20, 1000, 50, 0.72]));
    expect(joists).toHaveLength(1);
    expect(joists[0].box.x).toBe(0.078);
    // Unsure joists don't.
    expect(photoFinds(0, BEAM, sam([100, 50, 400, 80, 0.68]))).toHaveLength(0);
    // A post or a stair stringer (taller than wide in the picture) is never the beam, however sure.
    expect(photoFinds(0, BEAM, sam([600, 0, 680, 960, 0.95]))).toHaveLength(0);
    expect(photoFinds(0, BEAM, sam([100, 200, 500, 900, 0.9]))).toHaveLength(0);
    expect(isLevel({ x1: 0, y1: 0, x2: 300, y2: 300, w: 720, h: 1280 })).toBe(true);
    expect(isLevel({ x1: 580, y1: 0, x2: 627, y2: 1279, w: 720, h: 1280 })).toBe(false);
  });

  it("counts a duct from 0.55 sure", () => {
    const DUCT = CONCEPTS.find((c) => c.label === "Duct")!;
    expect(photoFinds(0, DUCT, sam([0, 0, 900, 200, 0.57]))).toHaveLength(1);
    expect(photoFinds(0, DUCT, sam([0, 0, 900, 200, 0.52]))).toHaveLength(0);
  });

  it("reads every photo for every thing, and hears each photo's finds as it lands, in order", async () => {
    const asked: string[] = [];
    const heard: [number, string[]][] = [];
    const concepts = [WINDOW, FURNACE];
    const all = await findInPhotos(
      3,
      concepts,
      async (concept, n) => {
        asked.push(`${n}:${concept}`);
        if (n === 1 && concept === "furnace") throw new Error("SAM 500");
        if (concept === "furnace") return sam([500, 300, 800, 900, 0.8]);
        return n === 2 ? "" : sam([100, 100, 300, 300, 0.9]);
      },
      async (n, finds) => void heard.push([n, finds.map((d) => d.label)]),
      2,
    );
    expect(asked.sort()).toEqual(["0:basement window", "0:furnace", "1:basement window", "1:furnace", "2:basement window", "2:furnace"]);
    expect(heard).toEqual([[0, ["Window", "Furnace"]], [1, ["Window"]], [2, ["Furnace"]]]);
    expect(all.map((d) => `${d.frame}:${d.label}`)).toEqual(["0:Window", "0:Furnace", "1:Window", "2:Furnace"]);
  });

  it("drops a beam that sits inside a duct or the stairs in the same photo, never one beside them", async () => {
    const DUCT = CONCEPTS.find((c) => c.label === "Duct")!;
    const STAIRS = CONCEPTS.find((c) => c.label === "Stairs")!;
    const boxes: Record<string, string> = {
      // Photo 0: SAM calls the round duct a beam too. Photo 1: a real beam right beside the duct.
      "0:support beam": sam([100, 60, 900, 160, 0.8]),
      "0:ceiling duct": sam([80, 40, 920, 180, 0.7]),
      "1:support beam": sam([0, 200, 1200, 300, 0.8]),
      "1:ceiling duct": sam([0, 100, 1200, 230, 0.7]),
      // Photo 2: a wide box on the stairs' stringer.
      "2:support beam": sam([400, 300, 900, 500, 0.8]),
      "2:staircase": sam([350, 100, 1000, 950, 0.9]),
    };
    const all = await findInPhotos(3, [BEAM, DUCT, STAIRS], async (concept, n) => boxes[`${n}:${concept}`] ?? "");
    expect(all.map((d) => `${d.frame}:${d.label}`)).toEqual(["0:Duct", "1:Beam", "1:Duct", "2:Stairs"]);
  });

  it("says what each photo showed in plain words", () => {
    const labels = (...l: string[]) => l.map((label) => ({ label }));
    expect(findWords(labels("Window", "Window", "Door", "Stairs"))).toBe("2 windows, a door and the stairs");
    expect(findWords(labels("Electrical panel"))).toBe("an electrical panel");
    expect(findWords(labels("Beam", "Beam", "Water heater"))).toBe("2 beams and a water heater");
  });
});

const det = (label: string, kind: string, frame: number, w = 0.2, confidence = 0.8): Detection => ({
  id: `${kind}-${frame}-${Math.random()}`,
  kind,
  label,
  concept: label.toLowerCase(),
  frame,
  seconds: frame / 5,
  box: { x: 0.1, y: 0.1, w, h: 0.2 },
  framesSeen: 1,
  confidence,
  track: [[frame, 0.1, 0.1, w, 0.2]],
});

describe("the same thing seen in two photos", () => {
  // Room 1 is photos 0–3, room 2 is photos 4–7.
  const roomOf = (f: number) => (f < 4 ? 0 : 1);

  it("is one find when the 3D puts both looks within half a metre", () => {
    const a = det("Window", "window", 0, 0.3);
    const b = det("Window", "window", 2, 0.2);
    const c = det("Window", "window", 3, 0.25); // another window, across the room
    const at = new Map<Detection, [number, number]>([[a, [1, 0]], [b, [1.3, 0.2]], [c, [4, 0]]]);
    const { finds, matched } = mergePhotoFinds([a, b, c], roomOf, (d) => at.get(d) ?? null);
    expect(matched).toBe(1);
    expect(finds.map((d) => d.id)).toEqual(["window-window-1", "window-window-2"]);
    // The best look leads, as the proof picture; every look joins its track.
    expect(finds[0]).toMatchObject({ frame: 0, framesSeen: 2, box: a.box });
    expect(finds[0].track.map((t) => t[0])).toEqual([0, 2]);
    expect(finds[1]).toMatchObject({ frame: 3, framesSeen: 1 });
  });

  it("never matches across rooms, even at the same spot", () => {
    const a = det("Window", "window", 1);
    const b = det("Window", "window", 5);
    expect(mergePhotoFinds([a, b], roomOf, () => [0, 0]).finds).toHaveLength(2);
  });

  it("allows a metre for long things seen in parts: a beam, a duct, the stairs", () => {
    const a = det("Beam", "beam", 0);
    const b = det("Beam", "beam", 1);
    const at = new Map<Detection, [number, number]>([[a, [0, 0]], [b, [0.9, 0]]]);
    expect(mergePhotoFinds([a, b], roomOf, (d) => at.get(d)!).finds).toHaveLength(1);
    const w1 = det("Window", "window", 0), w2 = det("Window", "window", 1);
    const at2 = new Map<Detection, [number, number]>([[w1, [0, 0]], [w2, [0.9, 0]]]);
    expect(mergePhotoFinds([w1, w2], roomOf, (d) => at2.get(d)!).finds).toHaveLength(2);
  });

  it("without the 3D, keeps one furnace a room but every window", () => {
    const finds = mergePhotoFinds(
      [det("Furnace", "mechanical", 0), det("Furnace", "mechanical", 2), det("Furnace", "mechanical", 6), det("Window", "window", 0), det("Window", "window", 1)],
      roomOf,
      () => null,
    ).finds;
    expect(finds.map((d) => `${d.label} ${d.frame}`)).toEqual(["Furnace 0", "Furnace 6", "Window 0", "Window 1"]);
    expect(finds.map((d) => d.id)).toEqual(["mechanical-furnace-1", "mechanical-furnace-2", "window-window-1", "window-window-2"]);
  });
});

describe("each room measured from its own photos", () => {
  const take = {
    count: 9,
    rooms: [
      { name: "Room 1", from: 0, to: 4 },
      { name: "Hall", from: 4, to: 6 },
      { name: "Family room", from: 6, to: 9 },
    ],
  };
  const fake = (from: number) => ({ scan: { from }, sentFrames: [] }) as unknown as Scan3d;

  it("sends each room's run of photos on its own and skips a room with too few", async () => {
    const sent: string[] = [];
    const logs: string[] = [];
    const landed: number[] = [];
    const scans = await measurePhotoRooms(
      take,
      async (r, areas) => {
        sent.push(`${r.from}-${r.to} of ${areas}`);
        return fake(r.from);
      },
      async (t) => void logs.push(t),
      async (i) => void landed.push(i),
    );
    expect(sent).toEqual(["0-4 of 2", "6-9 of 2"]);
    expect(scans.map((s) => (s ? (s.scan as { from: number }).from : null))).toEqual([0, null, 6]);
    expect(landed).toEqual([0, 2]);
    // The wait screen's time left reads these (src/screens/waitTime.ts).
    expect(logs).toEqual(["Hall: 2 photos is too few to measure, so only its finds count", "Measuring area 1 of 2: Room 1", "Measuring area 2 of 2: Family room"]);
  });

  it("carries on past a room that fails, and measures nothing without the 3D service", async () => {
    const logs: string[] = [];
    const scans = await measurePhotoRooms(take, async (r) => (r.from === 0 ? Promise.reject(new Error("scan3d 500")) : fake(r.from)), async (t) => void logs.push(t));
    expect(scans.map(Boolean)).toEqual([false, false, true]);
    expect(logs).toContain("Room 1 couldn't be measured this time; its finds still count");
    expect(await measurePhotoRooms(take, null, async () => {})).toEqual([null, null, null]);
  });
});

describe("staged pictures from a photo take", () => {
  it("may start from neighbouring photos, where a video's picks sit 5 s apart", () => {
    const window = { kind: "window", frame: 2, framesSeen: 1, box: { x: 0.3, y: 0.2, w: 0.2, h: 0.2 }, track: [[2, 0.3, 0.2, 0.2, 0.2]] as [number, number, number, number, number][] };
    const views = new Map([0, 1, 2, 3, 4, 5].map((f) => [f, { depthM: 2 + f / 10, tilt: 0.05, area: f < 3 ? 0 : 1 }]));
    const video = pickFrames([window], null, "unsure", 6, null, views, null);
    const photos = pickFrames([window], null, "unsure", 6, null, views, null, undefined, 1);
    expect(video).toHaveLength(1);
    // The window's photo for the bedroom, the photo that sees farthest, then the next farthest.
    expect(photos.map((p) => p.frame)).toEqual([2, 5, 4]);
    expect(new Set(photos.map((p) => p.frame)).size).toBe(photos.length);
  });

  it("before any 3D is saved, also starts from the photo furthest from the first, likely another room", () => {
    // Photos 0–3 are one room, 4–7 another; the doors are in photo 2, the furnace fills photo 6.
    const door = { kind: "exit", frame: 2, framesSeen: 1, box: { x: 0.4, y: 0.2, w: 0.15, h: 0.5 }, track: [[2, 0.4, 0.2, 0.15, 0.5]] as [number, number, number, number, number][] };
    const furnace = { kind: "mechanical", frame: 7, framesSeen: 1, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.6 }, track: [[7, 0.2, 0.2, 0.3, 0.6]] as [number, number, number, number, number][] };
    expect(pickFrames([door, furnace], null, "unsure", 8, null, null, null, undefined, 1).map((p) => `${p.frame} ${p.title}`)).toEqual(["2 Living and kitchen", "6 Another angle"]);
    expect(pickFrames([door, furnace], null, "unsure", 8, null, null, null).map((p) => p.frame)).toEqual([2]);
  });
});
