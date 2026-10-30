// The filming guide: what to say, and which one task is on screen. One take walks the whole basement,
// all of it connected; nothing here knows about rooms. Nothing is ever asked that needs an answer on
// screen: the homeowner's hands are on the phone. Pure, so it can be tested without a camera.
// Every line is also a set of voice clips (`pnpm voice` reads CLIPS).
import { MAX_SEC } from "./checklist";

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
  | "window_more"
  | "furnace"
  | "furnace_found"
  | "furnace_too"
  | "heater_found"
  | "heater_too"
  | "panel_found"
  | "plumbing_found"
  | "door_found"
  | "duct_found"
  | "low_ceiling"
  | "new_space"
  | "map_ready"
  | "walls_all"
  | "encourage"
  | "time_half"
  | "time_minute"
  | "time_end"
  | "wide"
  | "wide_done"
  | "enough"
  | "slow_down"
  | "too_dark"
  | "keep_going";

// Said the way a friendly contractor would say it, walking beside you. Lines that come up more than
// once have two or three ways of saying them, taken in turn, so the guide never sounds like a loop.
export const LINES: Record<LineId, readonly string[]> = {
  intro: ["Hi, I'm here to help. Let's start with the stairs. Just film them on your way down."],
  stairs_done: ["Nice, got the stairs.", "Stairs are in. Now let's look around."],
  walls: ["Now walk slowly along the walls. Stay a couple of metres back."],
  turn_left: ["Turn a little to your left. That wall's not filmed yet.", "There's a wall to your left I haven't seen yet.", "Look left for a moment. That side's still missing."],
  turn_right: ["Turn a little to your right. That wall's not filmed yet.", "There's a wall to your right I haven't seen yet.", "Look right for a moment. That side's still missing."],
  turn_around: ["Turn around for me. The wall behind you still needs filming.", "We haven't seen the wall behind you yet.", "Turn around for a second. That side's not on the map yet."],
  tilt_up: ["Tilt up a little. The ceiling there isn't filmed yet.", "Point up a little. I need more of the ceiling.", "The ceiling's not on the map yet. Tilt up as you walk."],
  tilt_down: ["Tilt down a little. Show me where the wall meets the floor.", "Point down a bit, where the wall meets the floor."],
  walls_done: ["Perfect, the walls look good.", "That's the walls. Nice work."],
  ceiling: ["Now tilt your phone up and show me the ceiling."],
  ceiling_done: ["Great, got the ceiling.", "Ceiling's in. Good."],
  floor: ["Now tilt down and film where the walls meet the floor."],
  floor_done: ["Good, got the floor.", "Floor's in too."],
  windows: ["Point at each window for a second."],
  window_found: ["There's a window. Hold on it for a second.", "Found a window. That's light, and a way out.", "Found a window."],
  window_more: ["Another window. Nice.", "One more window. Good."],
  furnace: ["Now show me the furnace and the electrical panel."],
  furnace_found: [
    "Oh, there's the furnace. Is the water heater right next to it?",
    "There's the furnace. Is the water heater close by?",
    "Found the furnace. Show me the water heater too, if it's near.",
  ],
  furnace_too: ["And there's the furnace. Good.", "Furnace too. That's the utility area."],
  heater_found: ["That's the water heater. Is the furnace close by?", "There's the water heater. The furnace is usually nearby."],
  heater_too: ["And the water heater. Perfect.", "There's the water heater too. Got both."],
  panel_found: ["That's the electrical panel. Hold on it for a second.", "There's the panel. Good to have that on video.", "Found the electrical panel."],
  plumbing_found: [
    "That looks like the plumbing for a toilet. Nice, that's where a bathroom goes.",
    "Pipes in the floor. That's a good spot for a bathroom.",
    "Is that a drain? Plumbing here makes a bathroom much easier.",
  ],
  door_found: ["There's a door. Show me where it goes when you're ready.", "That's a door. We'll want to see what's through there."],
  duct_found: ["Ductwork up there. That matters for the ceiling height.", "There's a duct. Follow it with the camera for a second."],
  low_ceiling: ["Mind your head in here.", "It's low in here. Show me the ceiling for a second.", "Watch your head. This part looks low."],
  new_space: ["New space. Take it slow.", "Somewhere new. Walk the walls again, nice and slow.", "New area. Same as before, slowly along the walls."],
  map_ready: ["There's your map. Dashed lines are sides I haven't seen yet.", "Here's the map. Dashed means not filmed yet."],
  walls_all: ["That's all four sides of this space. Nice.", "All the walls here are on the map. Good."],
  encourage: ["That's looking good.", "Nice and steady. Keep going.", "Good, the map's filling in."],
  time_half: ["Halfway. There's still plenty of time.", "That's half your time. No rush."],
  time_minute: ["About a minute left. Catch anything we missed.", "One minute to go. Check any corners you skipped."],
  time_end: ["Thirty seconds left. Start wrapping up.", "Almost out of time. Finish where you are."],
  wide: ["Last one. Step back into a corner and hold still for two seconds."],
  wide_done: ["Perfect, that's the wide shot.", "Got it. That's the wide shot."],
  enough: ["That's everything I need. Tap Done whenever you're ready."],
  slow_down: ["Slow down just a little for me.", "Slower, please. The picture's blurring.", "Easy does it. Nice and slow."],
  too_dark: ["It's a bit dark here. Turn on a light if you can.", "It's dark here. Any light helps.", "More light would help here, if there's a switch."],
  keep_going: ["Keep going, just a few more seconds."],
};

// The clip for each way of saying a line: public/voice/<line>.mp3, then <line>_2.mp3, <line>_3.mp3.
export const clipId = (id: LineId, variant: number) => (variant === 0 ? id : `${id}_${variant + 1}`);
export const CLIPS: Record<string, string> = Object.fromEntries(
  (Object.keys(LINES) as LineId[]).flatMap((id) => LINES[id].map((text, i) => [clipId(id, i), text] as const)),
);

// Which line wins when several want to play: a new task (or the clock) beats a reaction to what the
// camera sees, which beats a nag, which beats a word of encouragement.
// A reply answers a tap, so it counts as much as a task.
export type LineKind = "task" | "reply" | "time" | "react" | "praise" | "nag" | "cheer";
export const LINE_KIND: Record<LineId, LineKind> = {
  intro: "task",
  walls: "task",
  ceiling: "task",
  floor: "task",
  windows: "task",
  furnace: "task",
  wide: "task",
  enough: "task",
  keep_going: "reply",
  time_half: "time",
  time_minute: "time",
  time_end: "time",
  window_found: "react",
  window_more: "react",
  furnace_found: "react",
  furnace_too: "react",
  heater_found: "react",
  heater_too: "react",
  panel_found: "react",
  plumbing_found: "react",
  door_found: "react",
  duct_found: "react",
  low_ceiling: "react",
  new_space: "react",
  map_ready: "react",
  walls_all: "react",
  stairs_done: "praise",
  walls_done: "praise",
  ceiling_done: "praise",
  floor_done: "praise",
  wide_done: "praise",
  turn_left: "nag",
  turn_right: "nag",
  turn_around: "nag",
  tilt_up: "nag",
  tilt_down: "nag",
  slow_down: "nag",
  too_dark: "nag",
  encourage: "cheer",
};

// Directions share one allowance between them: a left, then a right, then an up is still one nag.
export const DIRECTION_LINES = new Set<LineId>(["turn_left", "turn_right", "turn_around", "tilt_up", "tilt_down"]);

// What a check needs, shown as progress.
export type Need = "stairs" | "walls" | "ceiling" | "floor" | "windows" | "furnace" | "wide";
export const NEEDS: { id: Need; label: string }[] = [
  { id: "stairs", label: "Stairs" },
  { id: "walls", label: "Walls" },
  { id: "ceiling", label: "Ceiling" },
  { id: "floor", label: "Floor" },
  { id: "windows", label: "Windows" },
  { id: "furnace", label: "Furnace" },
  { id: "wide", label: "Wide shot" },
];

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
  ceiling: { title: "Tilt up: film the ceiling", line: "ceiling" },
  floor: { title: "Tilt down: where the walls meet the floor", line: "floor" },
  windows: { title: "Point at each window", line: "windows" },
  furnace: { title: "Show the furnace and the panel", line: "furnace" },
  wide: { title: "Step back into a corner and hold still", line: "wide" },
  finish: { title: "That's everything. Tap Done.", line: "enough" },
};

// How long each step may hold the screen, in seconds, so one that can't finish (no window found, a
// furnace behind a locked door) never eats the time the rest need. The map still shows what's
// missed. Without a compass the walls can't be measured, so they get a fixed stretch.
const DWELL: Record<Need, number> = { stairs: 12, walls: 60, ceiling: 15, floor: 12, windows: 15, furnace: 15, wide: 12 };
const WALLS_WITHOUT_COMPASS = 30;
// The wide shot is for the staged photos, so it has to happen: a little past halfway through the
// longest take, it jumps the queue.
export const WIDE_BY = Math.round(MAX_SEC * 0.55);

// The one thing to do now, in walk order: stairs, walls, ceiling, floor, windows, furnace and panel,
// then a wide shot from a corner.
export function currentTask(s: GuideState): Task {
  const dwell = (n: Need) => (n === "walls" && !s.compass ? WALLS_WITHOUT_COMPASS : DWELL[n]);
  // The stairs are only at the start; every other step gets its own time from when it came up.
  const expired = (n: Need) => (n === "stairs" ? s.sec >= DWELL.stairs : s.since[n] != null && s.sec - s.since[n]! >= dwell(n));
  const open = (n: Need) => !s.done.has(n) && !s.skipped.has(n) && !expired(n);
  const task = (id: TaskId): Task => ({ id, ...TASKS[id] });
  // Late in the take, the wide shot goes first: the staged photos need it.
  if (open("wide") && s.sec >= WIDE_BY) return task("wide");
  if (open("stairs")) return task("stairs");
  if (open("walls")) return task("walls");
  if (open("ceiling") && s.tiltSensor) return task("ceiling");
  if (open("floor") && s.tiltSensor) return task("floor");
  if (open("windows")) return task("windows");
  if (open("furnace")) return task("furnace");
  if (open("wide")) return task("wide");
  return task("finish");
}

// Steps someone can skip from the screen: there may be no window, or the furnace is behind a door.
export const SKIPPABLE = new Set<TaskId>(["windows", "furnace"]);
