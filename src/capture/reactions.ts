// What the guide says about what's happening in the video: a find, a new space, the map, the clock.
// Each rule only picks a line; the voice queue decides when, or whether, it plays. Pure, for tests.
import type { FindKey } from "./live";
import type { MapGap } from "./map";
import type { LineId } from "./script";

// A find SAM just made, given what it found before in this take. Every kind of thing gets one remark,
// except windows, where each new one gets a word.
export function findLine(key: FindKey, before: readonly FindKey[]): LineId | null {
  const had = (...keys: FindKey[]) => keys.some((k) => before.includes(k));
  switch (key) {
    case "window":
      return had("window") ? "window_more" : "window_found";
    case "heater":
      return had("heater") ? null : "heater_found";
    case "panel":
      return had("panel") ? null : "panel_found";
    case "drain":
      return had("drain") ? null : "plumbing_found";
    case "door":
      return had("door") ? null : "door_found";
    case "duct":
      return had("duct") ? null : "duct_found";
    default:
      return null; // the stairs step praises the stairs itself
  }
}

// The clock, paced to the length of the take: halfway (only on a long take, and not once everything's
// filmed), a minute left, thirty seconds left. Each is said once; a later one replaces an earlier one
// that hasn't been said.
export function timeLine(sec: number, maxSec: number, finished: boolean): LineId | null {
  if (sec >= maxSec - 30) return "time_end";
  if (sec >= maxSec - 60) return "time_minute";
  if (maxSec >= 240 && sec >= maxSec / 2 && !finished) return "time_half";
  return null;
}

// Turn toward the side of the map that's still open, when it's out of the picture.
export function sideLine(gap: MapGap | null): LineId | null {
  if (!gap || gap.where === "ahead") return null;
  return gap.where === "behind" ? "turn_around" : gap.where === "left" ? "turn_left" : "turn_right";
}

// A word of encouragement: only while the map or the paint is still growing, after a quiet stretch,
// and not often. Silence is fine; chatter isn't.
export const CHEER_QUIET_MS = 15_000;
export const CHEER_EVERY_MS = 40_000;
export const CHEER_GROWING_MS = 10_000;
export function cheerDue(now: number, o: { lastSpoke: number; lastCheer: number; grewAt: number; trouble: boolean }): boolean {
  if (o.trouble) return false; // too dark or too fast: that's what to say, not "looking good"
  return now - o.grewAt <= CHEER_GROWING_MS && now - o.lastSpoke >= CHEER_QUIET_MS && now - o.lastCheer >= CHEER_EVERY_MS;
}

// Things said once per space: they come back after the phone notices another part of the basement.
export class OncePerSpace {
  private said = new Set<LineId>();

  // True the first time in this space.
  take(id: LineId): boolean {
    if (this.said.has(id)) return false;
    this.said.add(id);
    return true;
  }

  newSpace() {
    this.said.clear();
  }
}
