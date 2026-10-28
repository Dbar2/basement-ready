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

// "Furnace room" when the furnace was seen best there; otherwise its number.
export function roomName(index: number, from: number, to: number, mechanicalFrames: number[], named: Set<string>) {
  if (!named.has("Furnace room") && mechanicalFrames.some((f) => f >= from && f < to)) {
    named.add("Furnace room");
    return "Furnace room";
  }
  return `Room ${index + 1}`;
}
