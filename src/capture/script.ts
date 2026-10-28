// The filming guide: what to say, and which one task is on screen. Pure, so it can be tested
// without a camera. Every line here is also a voice clip (scripts/make-voice.ts reads LINES).

export type LineId =
  | "intro"
  | "stairs_done"
  | "walls"
  | "turn_left"
  | "turn_right"
  | "turn_around"
  | "walls_done"
  | "ceiling"
  | "ceiling_done"
  | "windows"
  | "window_found"
  | "plans"
  | "plans_heard"
  | "new_room"
  | "furnace_room"
  | "furnace_found"
  | "next_room"
  | "enough"
  | "slow_down"
  | "too_dark"
  | "keep_going";

export const LINES: Record<LineId, string> = {
  intro: "Hi! I'll guide you. Start at the bottom of the stairs, and film the stairs as you go.",
  stairs_done: "Got the stairs.",
  walls: "Now walk slowly along the walls of this room, about two metres back.",
  turn_left: "Turn left. This wall isn't filmed yet.",
  turn_right: "Turn right. This wall isn't filmed yet.",
  turn_around: "Turn around. The wall behind you isn't filmed yet.",
  walls_done: "That's every wall in this room.",
  ceiling: "Tilt your phone up and show me the ceiling.",
  ceiling_done: "Got the ceiling.",
  windows: "Point at each window in this room.",
  window_found: "Found a window.",
  plans: "What would you like this room to be? Just say it, or tap an idea.",
  plans_heard: "Got it.",
  new_room: "Looks like a new room.",
  furnace_room: "Looks like the furnace room. Show me the furnace and the electrical panel.",
  furnace_found: "Got the furnace.",
  next_room: "When you're ready, walk into the next room.",
  enough: "That's enough to check it. Film another room, or tap Done.",
  slow_down: "Slow down a little.",
  too_dark: "It's dark here. Turn on a light if you can.",
  keep_going: "Keep going, a few more seconds.",
};

// The six things a check needs, shown as progress dots.
export type Need = "stairs" | "walls" | "ceiling" | "windows" | "furnace" | "plans";
export const NEEDS: { id: Need; label: string }[] = [
  { id: "stairs", label: "Stairs" },
  { id: "walls", label: "Walls" },
  { id: "ceiling", label: "Ceiling" },
  { id: "windows", label: "Windows" },
  { id: "furnace", label: "Furnace" },
  { id: "plans", label: "Your plans" },
];

export const IDEAS = ["Bedroom for a parent", "Rental suite", "Rec room", "Not sure yet"];

export type RoomState = {
  index: number;
  name: string | null; // "Furnace room" once SAM sees a furnace in it
  sec: number; // seconds in this room
  coverage: number; // 0..100, directions filmed
  walls: boolean; // walls covered (coverage, or the live 3D found four walls)
  sawUp: boolean; // phone tilted to the ceiling here
  windowSeen: boolean;
  plans: boolean; // said or tapped what they want here
};

export type GuideState = {
  sec: number; // seconds into the take
  done: Set<Need>;
  room: RoomState;
  tiltSensor: boolean; // the phone reports tilt at all
  compass: boolean; // the phone reports a heading at all
};

export type Task = { id: "stairs" | "walls" | "ceiling" | "windows" | "furnace" | "plans" | "next"; title: string; line: LineId };

// The one thing to do now. Order inside a room: walls, ceiling, windows, plans; then move on.
export function currentTask(s: GuideState): Task {
  const r = s.room;
  if (r.index === 0 && !s.done.has("stairs") && s.sec < 12) return { id: "stairs", title: "Show me the stairs", line: "intro" };
  if (r.name === "Furnace room" && !s.done.has("furnace")) return { id: "furnace", title: "Show me the furnace and the panel", line: "furnace_room" };
  if (!r.walls && (s.compass ? r.sec < 75 : r.sec < 25)) return { id: "walls", title: "Film every wall of this room", line: "walls" };
  if (s.tiltSensor && !r.sawUp && r.sec < 90) return { id: "ceiling", title: "Tilt up: show the ceiling", line: "ceiling" };
  if (!r.windowSeen && !s.done.has("windows") && r.sec < 50) return { id: "windows", title: "Point at each window", line: "windows" };
  if (!r.plans && r.sec < 100) return { id: "plans", title: "What would you like this room to be?", line: "plans" };
  return { id: "next", title: "Walk into the next room", line: s.sec > 45 ? "enough" : "next_room" };
}

// Which way to turn to film the biggest unfilmed stretch, from the compass bins of this room.
export function turnToward(covered: boolean[], heading: number | null): "left" | "right" | "around" | null {
  if (heading == null || covered.every(Boolean) || !covered.some(Boolean)) return null;
  const n = covered.length;
  const bin = 360 / n;
  // The longest run of unfilmed bins (wrapping round), and its middle.
  let best = { len: 0, mid: 0 };
  for (let start = 0; start < n; start++) {
    if (covered[start] || !covered[(start - 1 + n) % n]) continue;
    let len = 0;
    while (len < n && !covered[(start + len) % n]) len++;
    if (len > best.len) best = { len, mid: ((start + len / 2) * bin) % 360 };
  }
  if (best.len * bin < 40) return null; // small gaps fill themselves while walking
  const delta = ((best.mid - heading + 540) % 360) - 180; // -180..180, negative is to the left
  if (Math.abs(delta) < 35) return null; // already facing it
  if (Math.abs(delta) > 135) return "around";
  return delta < 0 ? "left" : "right";
}
