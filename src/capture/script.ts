// The filming guide: what to say, and which one task is on screen. One take walks the whole basement,
// all of it connected; nothing here knows about rooms. Pure, so it can be tested without a camera.
// Every line here is also a voice clip (`pnpm voice` reads LINES).

export type LineId =
  | "intro"
  | "stairs_done"
  | "walls"
  | "turn_left"
  | "turn_right"
  | "turn_around"
  | "tilt_up"
  | "tilt_down"
  | "walls_done"
  | "ceiling"
  | "ceiling_done"
  | "floor"
  | "floor_done"
  | "windows"
  | "window_found"
  | "furnace"
  | "furnace_found"
  | "plans"
  | "plans_heard"
  | "wide"
  | "wide_done"
  | "enough"
  | "slow_down"
  | "too_dark"
  | "keep_going";

// Said the way a friendly contractor would say it, walking beside you.
export const LINES: Record<LineId, string> = {
  intro: "Hi, I'm here to help. Let's start with the stairs. Just film them on your way down.",
  stairs_done: "Nice, got the stairs.",
  walls: "Now walk slowly along the walls. Stay a couple of metres back.",
  turn_left: "Turn a little to your left. That wall's not filmed yet.",
  turn_right: "Turn a little to your right. That wall's not filmed yet.",
  turn_around: "Turn around for me. The wall behind you still needs filming.",
  tilt_up: "Tilt up a little. The ceiling there isn't filmed yet.",
  tilt_down: "Tilt down a little. Show me where the wall meets the floor.",
  walls_done: "Perfect, the walls look good.",
  ceiling: "Now tilt your phone up and show me the ceiling.",
  ceiling_done: "Great, got the ceiling.",
  floor: "Now tilt down and film where the walls meet the floor.",
  floor_done: "Good, got the floor.",
  windows: "Point at each window for a second.",
  window_found: "Found a window.",
  furnace: "Now show me the furnace and the electrical panel.",
  furnace_found: "Got the furnace.",
  plans: "So, what would you like this space to be? Just tell me, or tap an idea.",
  plans_heard: "Love it. Got it.",
  wide: "Last one. Step back into a corner and hold still for two seconds.",
  wide_done: "Perfect, that's the wide shot.",
  enough: "That's everything I need. Tap Done whenever you're ready.",
  slow_down: "Slow down just a little for me.",
  too_dark: "It's a bit dark here. Turn on a light if you can.",
  keep_going: "Keep going, just a few more seconds.",
};

// Which line wins when several want to play: a new task beats praise, which beats a nag.
// A reply answers a tap, so it counts as much as a task.
export type LineKind = "task" | "reply" | "praise" | "nag";
export const LINE_KIND: Record<LineId, LineKind> = {
  intro: "task",
  walls: "task",
  ceiling: "task",
  floor: "task",
  windows: "task",
  furnace: "task",
  plans: "task",
  wide: "task",
  enough: "task",
  keep_going: "reply",
  plans_heard: "reply",
  stairs_done: "praise",
  walls_done: "praise",
  ceiling_done: "praise",
  floor_done: "praise",
  window_found: "praise",
  furnace_found: "praise",
  wide_done: "praise",
  turn_left: "nag",
  turn_right: "nag",
  turn_around: "nag",
  tilt_up: "nag",
  tilt_down: "nag",
  slow_down: "nag",
  too_dark: "nag",
};

// Directions share one allowance between them: a left, then a right, then an up is still one nag.
export const DIRECTION_LINES = new Set<LineId>(["turn_left", "turn_right", "turn_around", "tilt_up", "tilt_down"]);

// What a check needs, shown as progress dots.
export type Need = "stairs" | "walls" | "ceiling" | "floor" | "windows" | "furnace" | "plans" | "wide";
export const NEEDS: { id: Need; label: string }[] = [
  { id: "stairs", label: "Stairs" },
  { id: "walls", label: "Walls" },
  { id: "ceiling", label: "Ceiling" },
  { id: "floor", label: "Floor" },
  { id: "windows", label: "Windows" },
  { id: "furnace", label: "Furnace" },
  { id: "plans", label: "Your plans" },
  { id: "wide", label: "Wide shot" },
];

export const IDEAS = ["Bedroom for a parent", "Rental suite", "Rec room", "Not sure yet"];

export type GuideState = {
  sec: number; // seconds into the take
  done: Set<Need>;
  skipped: Set<Need>; // tapped "Skip": nothing like that here
  since: Partial<Record<Need, number>>; // when each step first came up, seconds into the take
  tiltSensor: boolean; // the phone reports tilt at all
  compass: boolean; // the phone reports a heading at all
};

export type TaskId = Need | "finish";
export type Task = { id: TaskId; title: string; line: LineId };

const TASKS: Record<TaskId, Omit<Task, "id">> = {
  stairs: { title: "Film the stairs on your way down", line: "intro" },
  walls: { title: "Walk along the walls, 2 m back", line: "walls" },
  ceiling: { title: "Tilt up: paint the ceiling", line: "ceiling" },
  floor: { title: "Tilt down: where the walls meet the floor", line: "floor" },
  windows: { title: "Point at each window", line: "windows" },
  furnace: { title: "Show the furnace and the panel", line: "furnace" },
  plans: { title: "What would you like this space to be?", line: "plans" },
  wide: { title: "Step back into a corner and hold still", line: "wide" },
  finish: { title: "That's everything. Tap Done.", line: "enough" },
};

// How long each step may hold the screen, in seconds, so one that can't finish (no window found, a
// furnace behind a locked door) never eats the time the rest need. The coverage view still shows
// what's missed. Without a compass the walls can't be painted, so they get a fixed stretch.
const DWELL: Record<Need, number> = { stairs: 12, walls: 45, ceiling: 15, floor: 12, windows: 15, furnace: 15, plans: 15, wide: 12 };
const WALLS_WITHOUT_COMPASS = 25;
// The wide shot is for the staged photos, so it has to happen: past this, it jumps the queue.
const WIDE_BY = 100;

// The one thing to do now, in walk order: stairs, walls, ceiling, floor, windows, furnace and panel,
// plans, then a wide shot from a corner.
export function currentTask(s: GuideState): Task {
  const dwell = (n: Need) => (n === "walls" && !s.compass ? WALLS_WITHOUT_COMPASS : DWELL[n]);
  // The stairs are only at the start; every other step gets its own time from when it came up.
  const expired = (n: Need) => (n === "stairs" ? s.sec >= DWELL.stairs : s.since[n] != null && s.sec - s.since[n]! >= dwell(n));
  const open = (n: Need) => !s.done.has(n) && !s.skipped.has(n) && !expired(n);
  const task = (id: TaskId): Task => ({ id, ...TASKS[id] });
  // Near the end, the wide shot goes first: the staged photos need it.
  if (open("wide") && s.sec >= WIDE_BY) return task("wide");
  if (open("stairs")) return task("stairs");
  if (open("walls")) return task("walls");
  if (open("ceiling") && s.tiltSensor) return task("ceiling");
  if (open("floor") && s.tiltSensor) return task("floor");
  if (open("windows")) return task("windows");
  if (open("furnace")) return task("furnace");
  if (open("plans")) return task("plans");
  if (open("wide")) return task("wide");
  return task("finish");
}

// Steps someone can skip from the screen: there may be no window, or the furnace is behind a door.
export const SKIPPABLE = new Set<TaskId>(["windows", "furnace"]);
