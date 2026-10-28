// A sample basement used before real scans exist, and for the "Try a sample
// basement" button. Units are metres; origin is the floor's centre, y is up.

export type FindKind = "window" | "exit" | "stairs" | "duct" | "beam" | "mechanical";

export type Box = {
  id: string;
  kind: FindKind | "wall" | "floor" | "ceiling" | "joists";
  label: string;
  center: [number, number, number];
  size: [number, number, number];
};

export type Finding = {
  id: string;
  kind: FindKind;
  label: string;
  // What the scan says about it, shown as it's found.
  measure: string;
  // Seconds into the reveal when it lights up.
  at: number;
  status: "ok" | "fix" | "check";
};

export const room = {
  width: 9.2, // x
  depth: 7.4, // z
  height: 2.1, // floor to joists
};

const W = room.width / 2;
const D = room.depth / 2;
const H = room.height;

export const objects: Box[] = [
  { id: "win-1", kind: "window", label: "Window", center: [-2.2, 1.78, -D], size: [0.8, 0.36, 0.06] },
  { id: "win-2", kind: "window", label: "Window", center: [1.9, 1.78, -D], size: [0.8, 0.36, 0.06] },
  { id: "win-3", kind: "window", label: "Window", center: [W, 1.78, 1.6], size: [0.06, 0.36, 0.8] },
  { id: "stairs", kind: "stairs", label: "Stairs", center: [-W + 0.5, H / 2, 1.9], size: [0.9, H, 3.0] },
  { id: "duct", kind: "duct", label: "Duct", center: [0.6, H - 0.11, 0.2], size: [7.4, 0.22, 0.5] },
  { id: "beam", kind: "beam", label: "Beam", center: [0, H - 0.08, -0.9], size: [room.width, 0.16, 0.2] },
  { id: "furnace", kind: "mechanical", label: "Furnace", center: [W - 0.6, 0.85, -D + 0.6], size: [0.7, 1.7, 0.8] },
  { id: "panel", kind: "mechanical", label: "Electrical panel", center: [W - 0.04, 1.4, -1.4], size: [0.08, 0.7, 0.5] },
  { id: "door", kind: "exit", label: "Side door", center: [-W, 1.0, -2.4], size: [0.06, 2.0, 0.9] },
];

export const findings: Finding[] = [
  { id: "stairs", kind: "stairs", label: "Stairs down", measure: "headroom 1.96 m", at: 1.4, status: "ok" },
  { id: "win-1", kind: "window", label: "Window, east wall", measure: "0.28 m² opening", at: 2.2, status: "fix" },
  { id: "win-2", kind: "window", label: "Window, east wall", measure: "0.28 m² opening", at: 2.6, status: "fix" },
  { id: "win-3", kind: "window", label: "Window, south wall", measure: "0.28 m² opening", at: 3.0, status: "fix" },
  { id: "duct", kind: "duct", label: "Duct, hallway", measure: "1.88 m clear below", at: 3.8, status: "check" },
  { id: "beam", kind: "beam", label: "Beam", measure: "1.94 m clear below", at: 4.4, status: "ok" },
  { id: "furnace", kind: "mechanical", label: "Furnace", measure: "shared with upstairs", at: 5.0, status: "fix" },
  { id: "panel", kind: "mechanical", label: "Electrical panel", measure: "100 A", at: 5.5, status: "check" },
  { id: "door", kind: "exit", label: "Side door", measure: "0.86 m wide", at: 6.0, status: "ok" },
];

export const scanLog = [
  { at: 0.2, text: "Reading 74 frames from your video" },
  { at: 1.0, text: "Building the room in 3D" },
  { at: 1.4, text: "Found the stairs" },
  { at: 2.2, text: "Found 3 windows, measuring the openings" },
  { at: 3.8, text: "Low duct in the hallway" },
  { at: 5.0, text: "Furnace room, shared with upstairs" },
  { at: 6.4, text: "Ceiling 2.10 m to the joists" },
  { at: 7.2, text: "Checking Waterloo's second-unit rules" },
];

export const REVEAL_SECONDS = 8;
