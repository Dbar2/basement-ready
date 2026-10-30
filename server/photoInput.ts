// Photos in, instead of a video: 5–20 photos, each tagged with its room. On upload each one is turned
// upright by its EXIF orientation, sized to 1280 px on the long side (like the video's frames), stripped
// of its metadata (a phone photo carries where it was taken) and written as a frame, room by room, so
// each room is one run of frames: Room 1's photos are frames 0–3, Room 2's are 4–7, and so on.
// The scan then reads the frames as it would a video's (server/pipeline.ts photoStage).
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { MAX_ROOMS } from "./rooms";
import { keys, storage } from "./storage";

const run = promisify(execFile);

export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 20;
export const MAX_PHOTO_BYTES = 25 * 1024 * 1024;
// A room needs this many photos for its own 3D; fewer, and its finds still count.
export const MIN_PHOTOS_3D = 3;
const LONG_SIDE = 1280;

// What the scan keeps about a photo take (scans.inputs.photos): the rooms in order, each a run of frames.
export type PhotoRoom = { name: string; from: number; to: number };
export type PhotoTake = { count: number; rooms: PhotoRoom[] };

export type PhotoKind = "jpeg" | "png" | "webp" | "heic";

// What the file is, from its first bytes (a phone's file name and type can't be trusted).
export function sniffPhoto(b: Buffer): PhotoKind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (b.toString("ascii", 4, 8) === "ftyp" && /^(heic|heix|hevc|heim|heis|mif1|msf1|avif)$/.test(b.toString("ascii", 8, 12))) return "heic";
  return null;
}

// A JPEG's EXIF orientation, 1–8 (1 is upright). Read from IFD0 of the APP1 "Exif" block.
export function exifOrientation(jpeg: Buffer): number {
  let o = 2;
  while (o + 4 <= jpeg.length && jpeg[o] === 0xff) {
    const marker = jpeg[o + 1];
    const len = jpeg.readUInt16BE(o + 2);
    if (marker === 0xda || marker === 0xd9) break; // the picture itself starts: no EXIF before it
    if (marker === 0xe1 && jpeg.toString("ascii", o + 4, o + 10) === "Exif\0\0") {
      const tiff = o + 10;
      const le = jpeg.toString("ascii", tiff, tiff + 2) === "II";
      const u16 = (at: number) => (le ? jpeg.readUInt16LE(at) : jpeg.readUInt16BE(at));
      const u32 = (at: number) => (le ? jpeg.readUInt32LE(at) : jpeg.readUInt32BE(at));
      const end = o + 2 + len;
      const ifd = tiff + u32(tiff + 4);
      if (ifd + 2 > end) return 1;
      for (let i = 0, n = u16(ifd); i < n; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 12 > end) break;
        if (u16(e) === 0x0112) {
          const v = u16(e + 8);
          return v >= 1 && v <= 8 ? v : 1;
        }
      }
      return 1;
    }
    o += 2 + len;
  }
  return 1;
}

// The ffmpeg filter that turns a picture stored with this orientation upright (jpegtran's table).
export function uprightFilter(orientation: number): string | null {
  return (
    {
      2: "hflip",
      3: "hflip,vflip",
      4: "vflip",
      5: "transpose=0", // transpose
      6: "transpose=1", // 90° clockwise
      7: "transpose=3", // transverse
      8: "transpose=2", // 90° counter-clockwise
    }[orientation] ?? null
  );
}

// One photo upright, 1280 px on the long side (never enlarged), as a JPEG with no metadata. A JPEG is
// turned by its EXIF here; ffmpeg turns other kinds itself (an iPhone's HEIC keeps its turn in the file).
export async function uprightPhoto(photo: Buffer, kind: PhotoKind): Promise<Buffer> {
  const work = mkdtempSync(join(tmpdir(), "br-photo-in-"));
  try {
    const input = join(work, `in.${kind === "jpeg" ? "jpg" : kind}`);
    writeFileSync(input, photo);
    const turn = kind === "jpeg" ? uprightFilter(exifOrientation(photo)) : null;
    const size = `scale='if(gte(iw,ih),min(${LONG_SIDE},iw),-2)':'if(gte(iw,ih),-2,min(${LONG_SIDE},ih))'`;
    await run("ffmpeg", [
      "-y", "-loglevel", "error",
      ...(kind === "jpeg" ? ["-noautorotate"] : []),
      "-i", input,
      "-vf", [turn, size, "format=yuvj420p"].filter(Boolean).join(","),
      "-frames:v", "1", "-q:v", "2", "-map_metadata", "-1",
      join(work, "out.jpg"),
    ]);
    return readFileSync(join(work, "out.jpg"));
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// A room's tag as typed: trimmed, one space between words, at most 40 characters.
export function cleanRoomTag(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
}

// The photos in room order (rooms in the order they first appear, photos in their own order within
// each room), and each room's run of frames.
export function roomOrder(tags: string[]): { order: number[]; rooms: PhotoRoom[] } {
  const names: string[] = [];
  const roomOf = tags.map((t) => {
    const at = names.findIndex((n) => n.toLowerCase() === t.toLowerCase());
    if (at >= 0) return at;
    names.push(t);
    return names.length - 1;
  });
  const order: number[] = [];
  const rooms: PhotoRoom[] = names.map((name, r) => {
    const from = order.length;
    roomOf.forEach((x, i) => x === r && order.push(i));
    return { name, from, to: order.length };
  });
  return { order, rooms };
}

type Refused = { ok: false; status: 400 | 413 | 415; error: string };
export type PhotoUpload = { ok: true; frames: Buffer[]; take: PhotoTake } | Refused;

const refuse = (status: Refused["status"], error: string): Refused => ({ ok: false, status, error });

type FileLike = { size: number; arrayBuffer(): Promise<ArrayBuffer> };
const isFile = (f: unknown): f is FileLike => typeof f === "object" && f !== null && typeof (f as FileLike).arrayBuffer === "function" && typeof (f as FileLike).size === "number";

// The upload form's `photos[]` and `photoRooms` (a JSON list of room tags, one per photo): checked,
// read and put in room order. Everything is checked before anything is saved, so a refused take costs
// nothing and stays on the start sheet to send again.
export async function readPhotos(rawFiles: unknown, rawRooms: unknown, upright = uprightPhoto): Promise<PhotoUpload> {
  const files = (Array.isArray(rawFiles) ? rawFiles : rawFiles === undefined ? [] : [rawFiles]).filter(isFile);
  if (files.length < MIN_PHOTOS) return refuse(400, `Add at least ${MIN_PHOTOS} photos: one from each corner of each room.`);
  if (files.length > MAX_PHOTOS) return refuse(400, `Up to ${MAX_PHOTOS} photos. Keep the clearest ones.`);
  let list: unknown = rawRooms;
  if (typeof rawRooms === "string") {
    try {
      list = JSON.parse(rawRooms);
    } catch {
      list = null;
    }
  }
  const tags = Array.isArray(list) ? list.map(cleanRoomTag) : null;
  if (!tags || tags.length !== files.length || tags.some((t) => !t)) return refuse(400, "Each photo needs its room.");
  const { order, rooms } = roomOrder(tags);
  if (rooms.length > MAX_ROOMS) return refuse(400, `Up to ${MAX_ROOMS} rooms in one take.`);
  const big = files.findIndex((f) => f.size > MAX_PHOTO_BYTES);
  if (big >= 0) return refuse(413, `Photo ${big + 1} is too large. Keep each photo under 25 MB.`);

  const bytes = await Promise.all(files.map(async (f) => Buffer.from(await f.arrayBuffer())));
  const kinds = bytes.map(sniffPhoto);
  const odd = kinds.findIndex((k) => !k);
  if (odd >= 0) return refuse(415, `Photo ${odd + 1} isn't a photo we can read. Send JPEG, PNG or HEIC photos.`);

  // Four at a time: each is one short ffmpeg run.
  const ready: (Buffer | null)[] = new Array(files.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < bytes.length) {
        const i = next++;
        ready[i] = await upright(bytes[i], kinds[i]!).catch(() => null);
      }
    }),
  );
  const unread = ready.findIndex((b) => !b);
  if (unread >= 0) return refuse(415, `We couldn't open photo ${unread + 1}. Save it as a JPEG and try again.`);
  return { ok: true, frames: order.map((i) => ready[i]!), take: { count: files.length, rooms } };
}

// The frames, in room order, where a video's frames go; the take's own record is the scan's input.
export async function savePhotos(scanId: string, frames: Buffer[], take: PhotoTake): Promise<string> {
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < frames.length) {
        const n = next++;
        await storage.put(keys.frame(scanId, n), frames[n], "image/jpeg");
      }
    }),
  );
  const key = keys.photos(scanId);
  await storage.put(key, Buffer.from(JSON.stringify(take)), "application/json");
  return key;
}
