// Room by room: the phone marks where each room starts, and each room gets its own 3D scan and plan.
// A whole basement in one 3D scan comes out with walls placed twice; one room at a time doesn't.
import type { Measurements } from "./scan3d";
import type { Plan } from "./plan";

export type RoomMark = { startS: number };

export type Room = {
  index: number;
  name: string;
  startS: number;
  endS: number;
  has3d: boolean;
  plan: Plan | null;
  measurements: Measurements | null;
};

export const MAX_ROOMS = 8;
// Under this, a room is a doorway walked through, not a room filmed.
export const MIN_ROOM_FRAMES = 25;

// From the upload form: room start times in seconds, ascending, first one at 0.
export function cleanRooms(raw: unknown, maxSec = 120): RoomMark[] | null {
  let list: unknown = raw;
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(list)) return null;
  const starts = list
    .map((r) => Number((r as RoomMark)?.startS))
    .filter((s) => Number.isFinite(s) && s >= 0 && s < maxSec)
    .map((s) => Math.round(s * 10) / 10)
    .sort((a, b) => a - b);
  const marks = [...new Set([0, ...starts])].slice(0, MAX_ROOMS).map((startS) => ({ startS }));
  return marks.length > 1 ? marks : null;
}

// What they tapped when the guide asked what a room should be.
export type Idea = { room: number; idea: string; sec: number };
export function cleanIdeas(raw: unknown): Idea[] | null {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return null;
    const ideas = list
      .map((x) => ({ room: Number(x?.room), idea: String(x?.idea ?? "").slice(0, 40), sec: Number(x?.sec) }))
      .filter((x) => Number.isInteger(x.room) && x.room >= 0 && x.room < MAX_ROOMS && x.idea && Number.isFinite(x.sec))
      .slice(0, 16);
    return ideas.length ? ideas : null;
  } catch {
    return null;
  }
}

// When the guide was talking, so its voice can be cut out of the transcript.
export type Span = { startMs: number; endMs: number };
export function cleanSpoken(raw: unknown): Span[] | null {
  try {
    const list = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(list)) return null;
    const spans = list
      .map((x) => ({ startMs: Number(x?.startMs), endMs: Number(x?.endMs) }))
      .filter((x) => Number.isFinite(x.startMs) && Number.isFinite(x.endMs) && x.endMs > x.startMs && x.startMs >= 0 && x.endMs < 130_000)
      .slice(0, 200);
    return spans.length ? spans : null;
  } catch {
    return null;
  }
}

// Speech turns that overlap the guide's own voice are the guide, not the homeowner.
export function withoutGuide<T extends { startMs: number; endMs: number }>(turns: T[], spoken: Span[] | null | undefined, padMs = 300) {
  if (!spoken?.length) return turns;
  return turns.filter((t) => !spoken.some((s) => t.startMs < s.endMs + padMs && t.endMs > s.startMs - padMs));
}

// Ideas tapped while filming join what they said, in the room they were filmed in.
type VisionRoom = { room: string; where: string; atSeconds: number | null; quote: string };
export function withIdeas<V extends { rooms: VisionRoom[] }>(vision: V, ideas: Idea[] | undefined, rooms: { index: number; name: string }[]): V {
  const tapped = (ideas ?? [])
    .filter((i) => !/not sure/i.test(i.idea))
    .filter((i) => !vision.rooms.some((r) => r.room.toLowerCase() === i.idea.toLowerCase()))
    .map((i) => ({ room: i.idea, where: rooms.find((r) => r.index === i.room)?.name ?? `Room ${i.room + 1}`, atSeconds: i.sec, quote: "" }));
  return tapped.length ? { ...vision, rooms: [...vision.rooms, ...tapped] } : vision;
}

// Frame ranges [from, to) for each room, at the analysis frame rate.
export function roomRanges(marks: RoomMark[] | null, frameCount: number, fps: number) {
  const starts = (marks ?? [{ startS: 0 }]).map((m) => Math.min(frameCount, Math.round(m.startS * fps)));
  return starts
    .map((from, i) => ({ index: i, from, to: i + 1 < starts.length ? starts[i + 1] : frameCount }))
    .filter((r) => r.to > r.from);
}

// The room whose numbers the rules use: a trusted scan first, then the biggest floor.
export function mainRoom(rooms: Room[]): Room | null {
  const scanned = rooms.filter((r) => r.has3d && r.plan);
  if (!scanned.length) return null;
  return [...scanned].sort((a, b) => Number(Boolean(b.plan!.trusted)) - Number(Boolean(a.plan!.trusted)) || b.plan!.areaM2 - a.plan!.areaM2)[0];
}

// "Furnace room" where the furnace was seen; otherwise its number. An electrical panel alone doesn't
// make a furnace room.
export function roomName(index: number, from: number, to: number, furnaceFrames: number[], named: Set<string>) {
  if (!named.has("Furnace room") && furnaceFrames.some((f) => f >= from && f < to)) {
    named.add("Furnace room");
    return "Furnace room";
  }
  return `Room ${index + 1}`;
}
