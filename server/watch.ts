// Muse Wonder watches the whole take once, with its sound: the rooms in the order they were filmed,
// which were walked into and which were only seen through a doorway, how they connect, each ceiling and
// what hangs below it, the windows and fixtures, and what the homeowner said about the space. It runs
// beside SAM and the 3D (server/pipeline.ts), and the floor plan reads it for how many rooms there are
// and how they join. It describes, it never measures: its sizes are hints, and whether a window is big
// enough to escape through or a ceiling high enough is decided from measured numbers by the rules in
// code. Wonder is in preview, so Muse Spark 1.3 watches instead when it fails.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataUrl, outputText, responses, tokenCost } from "./meta";
import type { PhotoTake } from "./photoInput";

const run = promisify(execFile);

export const WATCH_MODEL = "muse-wonder-1.0";
export const FALLBACK_MODEL = "muse-spark-1.3";

export const CEILINGS = ["exposed_joists", "drywall", "drop_ceiling", "mixed", "unknown"] as const;
export const LOW_KINDS = ["duct", "beam", "bulkhead", "pipe", "other"] as const;
export const FIXTURE_KINDS = ["stairs", "furnace", "water_heater", "electrical_panel", "laundry", "sink", "toilet", "shower", "floor_drain", "sump_pump", "plumbing_rough_in", "other"] as const;
export const DOOR_KINDS = ["door", "opening", "stairs", "exterior_door"] as const;
// Where a door can lead besides another room.
export const BEYOND = ["upstairs", "outside"] as const;

export type Ceiling = (typeof CEILINGS)[number];
export type LowKind = (typeof LOW_KINDS)[number];
export type FixtureKind = (typeof FIXTURE_KINDS)[number];
export type DoorKind = (typeof DOOR_KINDS)[number];

export type WatchRoom = {
  id: string; // "r1", "r2", … in the order first seen
  name: string; // what the homeowner called it, else what it looks like ("Furnace room")
  spokenName: string | null; // their own words for it, when they named it ("Mom's room")
  kind: "room" | "hall" | "closet";
  // When it's on screen, in seconds of the take; a room walked back into has two. [] for a photo take.
  visits: [number, number][];
  photos: number[]; // a photo take: the photos it's in, from 0. [] for a video.
  entered: boolean; // false: only seen through a doorway, never walked into
  seenFrom: string | null; // the room it was seen from, when it wasn't entered
  ceiling: Ceiling;
  low: { kind: LowKind; atS: number | null; note: string }[]; // ducts, beams, bulkheads below the ceiling
  windows: { atS: number | null; note: string; sizeHintM: { w: number; h: number } | null }[];
  fixtures: { kind: FixtureKind; atS: number | null; note: string }[];
  sizeHintM: { w: number; d: number } | null; // a hint only: the 3D measures
};
// `from` and `to` are room ids, or "upstairs" / "outside".
export type WatchDoor = { from: string; to: string; kind: DoorKind; atS: number | null; note: string };

export type Watch = {
  model: string; // who watched: Wonder, or Spark when Wonder failed
  source: "video" | "photos";
  heard: boolean; // someone talked in it
  rooms: WatchRoom[];
  doors: WatchDoor[];
  spoken: { atS: number | null; quote: string; room: string | null }[];
  unsure: string[];
  costUsd: number;
  tokens: { in: number; out: number };
  ms: number;
};

// What the take is, for the prompt and for cleaning the answer. `durationS` for a video, `photos` for a photo take.
export type Take = { source: "video"; durationS: number; sound: boolean } | { source: "photos"; photos: number; rooms: PhotoTake["rooms"] };

const SHAPE = `{"heard":true,"rooms":[{"id":"r1","name":"Rec room","spokenName":null,"kind":"room","visits":[[0,31.5]],"photos":[],"entered":true,"seenFrom":null,"ceiling":"drywall","low":[{"kind":"bulkhead","atS":20,"note":"boxed duct along the long wall"}],"windows":[{"atS":15,"note":"high on the wall left of the stairs","sizeHintM":null}],"fixtures":[{"kind":"stairs","atS":2,"note":"comes down into this room"}],"sizeHintM":{"w":5,"d":4}}],"doors":[{"from":"r1","to":"r2","kind":"door","atS":34,"note":"far corner"},{"from":"r1","to":"upstairs","kind":"stairs","atS":2,"note":""}],"spoken":[{"atS":40,"quote":"this is Mom's room","room":"r2"}],"unsure":["Couldn't see what is behind the closed door at 50 s."]}`;

export function instructions(take: Take) {
  const what =
    take.source === "video"
      ? `a phone video of a homeowner walking through their basement, ${Math.round(take.durationS)} seconds long, ${take.sound ? "with its sound" : "with no sound"}`
      : `${take.photos} still photos of a homeowner's basement, numbered from 0. The homeowner filed each photo under a room name; trust what the photos show over those names`;
  const when =
    take.source === "video"
      ? `- visits: [start, end] in seconds for each stretch the camera is inside the room, from crossing its doorway to leaving. Walking back into a room later is a second visit. A look into a room from its doorway is not a visit: for a room the camera never enters, give the stretch it is seen through the doorway. Leave "photos" empty.`
      : `- photos: the numbers of the photos the room is in. Leave "visits" empty, and use null for every "atS".`;
  return `You are watching ${what}. Basement Ready draws the basement's floor plan from it and checks whether it can become a legal second unit in Ontario. Separate tools measure every size, so describe what you see; never measure.

Report:
- rooms: every distinct room or area, in the order the ${take.source === "video" ? "camera first shows it" : "photos first show it"}. A room is a space with its own walls and a doorway or opening to the next. The stairs belong to the room they come down into. A hallway joining rooms is its own area (kind "hall"); a closet or storage space you can see into is kind "closet". Include a room you only see through a doorway or past an open door without going in: "entered": false, and "seenFrom" is the id of the room the camera was in. Never merge two rooms because they look alike, and never split one room because the camera turned around in it.
${when}
- name: what the homeowner calls the room if they say, otherwise a plain name of one to three words from what is in it ("Furnace room", "Rec room", "Workshop", "Laundry", "Storage"). spokenName: their exact words for it, or null.
- ceiling: "exposed_joists", "drywall", "drop_ceiling", "mixed" or "unknown".
- low: each duct, beam, bulkhead or pipe running below the ceiling that a person walks under, with the second it is clearest. Never estimate how low it is.
- windows: each window once, with the second it is clearest and a few words on where it is. Count a window only in the room it is in, not one seen through a doorway from another room. "sizeHintM" only if something of known size beside it lets you judge, else null. Never say whether a window is big enough to escape through: that is decided from measurements.
- fixtures: ${FIXTURE_KINDS.map((k) => `"${k}"`).join(", ")}.
- doors: every connection between two rooms, once each. "from" and "to" are room ids, or "upstairs" or "outside". kind: "door", "opening" (no door in it), "stairs", "exterior_door".
- spoken: everything the homeowner says about the space or what they want it to become, with the second and their words${take.source === "video" && take.sound ? "" : " (there is no sound here, so leave it empty and set heard to false)"}. heard is false when nobody talks.
- unsure: short, plain sentences about anything you couldn't tell, such as a closed door you couldn't see past or a room you may have counted twice.
- sizeHintM: rough width and depth in metres, or null. It is only a hint.

Return ONLY a JSON object shaped like this example (the values are made up):
${SHAPE}`;
}

// ---- Cleaning the answer: anything malformed is dropped, never guessed ----

const text = (v: unknown, max = 120) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T => (list.includes(v as T) ? (v as T) : fallback);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const tenth = (n: number) => Math.round(n * 10) / 10;
const list = (v: unknown, max: number): any[] => (Array.isArray(v) ? v.slice(0, max) : []);

function size<K extends string>(v: any, keys: [K, K], lo: number, hi: number): Record<K, number> | null {
  const a = num(v?.[keys[0]]), b = num(v?.[keys[1]]);
  return a != null && b != null && a >= lo && a <= hi && b >= lo && b <= hi ? ({ [keys[0]]: tenth(a), [keys[1]]: tenth(b) } as Record<K, number>) : null;
}

export function parseJson(raw: string): any {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("The watch pass did not return JSON");
  return JSON.parse(raw.slice(start, end + 1));
}

// The model's answer, kept only where it's well-formed: rooms renumbered r1, r2, … in the order first
// seen, times inside the take, doors and notes pointing only at rooms that exist. No rooms is a failure.
export function cleanWatch(raw: any, take: Take): Omit<Watch, "model" | "costUsd" | "tokens" | "ms"> {
  const video = take.source === "video";
  const at = (v: unknown) => {
    const s = num(v);
    return video && s != null && s >= 0 ? tenth(Math.min(s, take.durationS)) : null;
  };
  const rooms = list(raw?.rooms, 12)
    .map((r: any) => {
      const visits = video
        ? list(r?.visits, 6)
            .map((v: any) => [at(v?.[0]), at(v?.[1])])
            .filter((v): v is [number, number] => v[0] != null && v[1] != null && v[1] >= v[0])
            .sort((a, b) => a[0] - b[0])
        : [];
      const photos = video ? [] : [...new Set(list(r?.photos, 40).map(num).filter((n): n is number => n != null && Number.isInteger(n) && n >= 0 && n < take.photos))].sort((a, b) => a - b);
      return {
        oldId: text(r?.id, 20),
        room: {
          id: "",
          name: text(r?.name, 40) || text(r?.spokenName, 40),
          spokenName: text(r?.spokenName, 60) || null,
          kind: oneOf(r?.kind, ["room", "hall", "closet"] as const, "room"),
          visits,
          photos,
          entered: r?.entered !== false,
          seenFrom: text(r?.seenFrom, 20) || null,
          ceiling: oneOf(r?.ceiling, CEILINGS, "unknown"),
          low: list(r?.low, 8).map((x: any) => ({ kind: oneOf(x?.kind, LOW_KINDS, "other"), atS: at(x?.atS), note: text(x?.note) })),
          windows: list(r?.windows, 8).map((x: any) => ({ atS: at(x?.atS), note: text(x?.note), sizeHintM: size(x?.sizeHintM, ["w", "h"], 0.1, 3) })),
          fixtures: list(r?.fixtures, 12).flatMap((x: any) => (FIXTURE_KINDS.includes(x?.kind) ? [{ kind: x.kind as FixtureKind, atS: at(x?.atS), note: text(x?.note) }] : [])),
          sizeHintM: size(r?.sizeHintM, ["w", "d"], 0.5, 30),
        } as WatchRoom,
      };
    })
    .filter((r) => r.room.name && (video ? r.room.visits.length > 0 : r.room.photos.length > 0));
  if (!rooms.length) throw new Error("The watch pass found no rooms");
  // First seen first; the model's own order breaks a tie.
  const first = (r: WatchRoom) => (video ? r.visits[0][0] : r.photos[0]);
  rooms.sort((a, b) => first(a.room) - first(b.room));
  const ids = new Map<string, string>();
  rooms.forEach((r, i) => {
    r.room.id = `r${i + 1}`;
    if (r.oldId && !ids.has(r.oldId)) ids.set(r.oldId, r.room.id);
  });
  const roomId = (v: unknown) => ids.get(text(v, 20)) ?? null;
  const end = (v: unknown) => roomId(v) ?? (BEYOND.includes(v as never) ? (v as string) : null);
  for (const { room } of rooms) {
    room.seenFrom = room.entered ? null : roomId(room.seenFrom);
  }

  const seen = new Set<string>();
  const doors = list(raw?.doors, 24).flatMap((d: any): WatchDoor[] => {
    const from = end(d?.from), to = end(d?.to);
    if (!from || !to || from === to || (!from.startsWith("r") && !to.startsWith("r"))) return [];
    const key = [from, to].sort().join("|");
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ from, to, kind: oneOf(d?.kind, DOOR_KINDS, "door"), atS: at(d?.atS), note: text(d?.note) }];
  });
  const spoken = video ? list(raw?.spoken, 30).flatMap((s: any) => (text(s?.quote, 200) ? [{ atS: at(s?.atS), quote: text(s?.quote, 200), room: roomId(s?.room) }] : [])) : [];
  return {
    source: take.source,
    heard: video && take.sound && (raw?.heard === true || spoken.length > 0),
    rooms: rooms.map((r) => r.room),
    doors,
    spoken,
    unsure: list(raw?.unsure, 8).map((u) => text(u, 200)).filter(Boolean),
  };
}

// ---- Watching ----

// Wonder first; Spark when Wonder errors, times out or answers with nothing usable. Both cost what they
// cost, used or not.
export async function watchWith(content: any[], take: Take, opts: { ask?: typeof responses } = {}): Promise<Watch> {
  const ask = opts.ask ?? responses;
  const started = Date.now();
  let costUsd = 0;
  const tokens = { in: 0, out: 0 };
  let lastErr: unknown;
  for (const model of [WATCH_MODEL, FALLBACK_MODEL]) {
    try {
      const wonder = model === WATCH_MODEL;
      const r = await ask(
        {
          model,
          input: [
            { role: "developer", content: instructions(take) },
            { role: "user", content },
          ],
          ...(wonder ? { reasoning: { effort: "medium" } } : {}),
        },
        AbortSignal.timeout(wonder ? 150_000 : 90_000),
      );
      costUsd += tokenCost(model, r.usage)?.usd ?? 0;
      tokens.in += r.usage?.input_tokens ?? 0;
      tokens.out += r.usage?.output_tokens ?? 0;
      return { model, ...cleanWatch(parseJson(outputText(r)), take), costUsd, tokens, ms: Date.now() - started };
    } catch (err) {
      lastErr = err;
      console.error(`[watch] ${model}: ${err instanceof Error ? err.message : err}`);
    }
  }
  throw lastErr;
}

// The take's video with its sound: the analysis video (5 fps, the frames SAM and the 3D read, so a second
// here is the same moment there) at 960 px on the long side, which Wonder reads as well as 1280 for a
// third less, with the voice laid back on.
export async function watchVideoFile(analysis: string, wav: string | null, out: string): Promise<string> {
  await run("ffmpeg", [
    "-y", "-loglevel", "error", "-i", analysis, ...(wav ? ["-i", wav] : []),
    "-map", "0:v:0", ...(wav ? ["-map", "1:a:0", "-c:a", "aac", "-b:a", "48k"] : []),
    "-vf", "scale='if(gt(iw,ih),960,-2)':'if(gt(iw,ih),-2,960)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
    "-map_metadata", "-1", "-movflags", "+faststart", out,
  ]);
  return out;
}

// A video already uploaded (server/meta.ts uploadFile).
export function watchVideo(fileId: string, durationS: number, sound: boolean, opts?: { ask?: typeof responses }): Promise<Watch> {
  const take: Take = { source: "video", durationS, sound };
  return watchWith(
    [
      { type: "input_text", text: "Watch the whole video, and listen if it has sound." },
      { type: "input_video", file_id: fileId },
    ],
    take,
    opts,
  );
}

// A photo take: every photo, each with the room it was filed under, sized down to 768 px for the model.
export async function watchPhotos(framePath: (n: number) => string, take: PhotoTake, work: string, opts?: { ask?: typeof responses }): Promise<Watch> {
  const content: any[] = [{ type: "input_text", text: `Look at all ${take.count} photos together.` }];
  for (let n = 0; n < take.count; n++) {
    const small = join(work, `watch-${n}.jpg`);
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", framePath(n), "-vf", "scale='min(768,iw)':-2", "-q:v", "4", small]);
    const room = take.rooms.find((r) => n >= r.from && n < r.to);
    content.push({ type: "input_text", text: `Photo ${n}${room ? `, filed under "${room.name}"` : ""}:` });
    content.push({ type: "input_image", image_url: dataUrl(small, "image/jpeg") });
  }
  return watchWith(content, { source: "photos", photos: take.count, rooms: take.rooms }, opts);
}

// "Muse Wonder watched the whole take: 3 rooms, 2 doors, and one seen only from a doorway"
export function watchWords(w: Watch): string {
  const who = w.model === WATCH_MODEL ? "Muse Wonder" : "Muse Spark";
  const n = w.rooms.length;
  const peeked = w.rooms.filter((r) => !r.entered).length;
  const names = w.rooms.map((r) => r.spokenName ?? r.name);
  const parts = [`${n} ${n === 1 ? "room" : "rooms"} (${names.join(", ")})`];
  if (peeked) parts.push(`${peeked === 1 ? "one" : peeked} seen only through a doorway`);
  return `${who} ${w.source === "video" ? "watched the whole take" : "looked at every photo"}: ${parts.join(", ")}`;
}

// Names for the measured areas from what was watched: an area takes the name of the room it spent most of
// its time in, when that room fills at least half of it and no other area took the room first. A video's
// `ranges` are frames at `fps`; a photo take's are photo numbers. Null where nothing clearly matches.
export function watchedNames(ranges: { from: number; to: number }[], watch: Watch | null, fps: number): (string | null)[] {
  const names: (string | null)[] = ranges.map(() => null);
  if (!watch) return names;
  const video = watch.source === "video";
  const overlap = (r: { from: number; to: number }, room: WatchRoom) =>
    video
      ? room.visits.reduce((s, [a, b]) => s + Math.max(0, Math.min(b, r.to / fps) - Math.max(a, r.from / fps)), 0)
      : room.photos.filter((n) => n >= r.from && n < r.to).length;
  const span = (r: { from: number; to: number }) => (video ? (r.to - r.from) / fps : r.to - r.from);
  const pairs = ranges
    .flatMap((r, i) => watch.rooms.filter((room) => room.entered).map((room) => ({ i, room, share: span(r) > 0 ? overlap(r, room) / span(r) : 0 })))
    .filter((p) => p.share >= 0.5)
    .sort((a, b) => b.share - a.share);
  const used = new Set<string>();
  for (const p of pairs) {
    if (names[p.i] != null || used.has(p.room.id)) continue;
    used.add(p.room.id);
    const base = p.room.name.replace(/^the\s+/i, "").replace(/^./, (c) => c.toUpperCase());
    let name = base;
    for (let k = 2; names.includes(name); k++) name = `${base} ${k}`;
    names[p.i] = name;
  }
  return names;
}
