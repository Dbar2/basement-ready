// Notices when you walk into another room, so nobody has to tap "Next room". Two signals:
//  - a doorway: a door fills much of the picture, then it's gone and the scene looks different;
//  - a sustained change of scene: the colours and light of the picture move far from this room's.
// Pure and fed one frame at a time, so it runs the same live and on a recorded take.

export type Look = number[]; // a 64-bin colour histogram, sums to 1

// 4×4×4 RGB histogram from raw pixels (RGBA from a canvas, or RGB with step 3).
export function lookOf(px: Uint8ClampedArray | Uint8Array, step = 4): Look {
  const h = new Array(64).fill(0);
  let n = 0;
  for (let i = 0; i + 2 < px.length; i += step) {
    h[(px[i] >> 6) * 16 + (px[i + 1] >> 6) * 4 + (px[i + 2] >> 6)]++;
    n++;
  }
  return n ? h.map((v) => v / n) : h;
}

// 0 = same look, 1 = nothing in common.
export function lookDistance(a: Look, b: Look) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

export type Frame = { sec: number; look: Look; doorWidth: number };

const MIN_ROOM_SEC = 12;
const DOOR_CLOSE = 0.42; // a door this wide in the frame: you're at a doorway
const DOOR_WINDOW_SEC = 6; // ...and through it within this long
const CHANGED = 0.5; // a different room after a doorway
const VERY_CHANGED = 0.62; // a different room without seeing the door
const SUSTAIN = 3; // frames in a row

export class RoomDetector {
  private room: Look | null = null;
  private roomFrames = 0;
  private roomStart = 0;
  private doorAt = -Infinity;
  private streak = 0;

  constructor(startSec = 0) {
    this.roomStart = startSec;
  }

  // Returns true when this frame starts a new room.
  push(f: Frame): boolean {
    if (f.doorWidth >= DOOR_CLOSE) this.doorAt = f.sec;
    if (!this.room || this.roomFrames < 4) {
      // The room's look settles over its first few frames.
      this.room = this.room ? this.room.map((v, i) => (v * this.roomFrames + f.look[i]) / (this.roomFrames + 1)) : [...f.look];
      this.roomFrames++;
      return false;
    }
    const d = lookDistance(this.room, f.look);
    const throughDoor = f.sec - this.doorAt <= DOOR_WINDOW_SEC && f.doorWidth < DOOR_CLOSE * 0.6;
    this.streak = d >= (throughDoor ? CHANGED : VERY_CHANGED) ? this.streak + 1 : 0;
    if (f.sec - this.roomStart >= MIN_ROOM_SEC && this.streak >= (throughDoor ? 2 : SUSTAIN)) {
      this.reset(f.sec, f.look);
      return true;
    }
    // Slowly follow the room as more of it is filmed.
    if (d < CHANGED * 0.6) this.room = this.room.map((v, i) => v * 0.9 + f.look[i] * 0.1);
    return false;
  }

  // A room started some other way (the fallback button, or an undo).
  reset(sec: number, look: Look | null = null) {
    this.room = look ? [...look] : null;
    this.roomFrames = look ? 1 : 0;
    this.roomStart = sec;
    this.streak = 0;
    this.doorAt = -Infinity;
  }
}
