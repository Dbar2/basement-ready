// The one model of a basement that every view reads: the plan-confirm screen, the 3D studio, the
// permit sheets, the quote and the book. Measured in metres on the floor, as (x, z) in the basement
// frame (the frame of server/basement.ts placements and the merged 3D files). Pure types, so the
// browser imports this too.

export type Pt = [number, number];

// Fire separation between the two units: 30 minutes for walls, 15 for floors and ceilings.
export type Rating = "30min" | "15min" | null;

export type Wall = {
  id: string;
  a: Pt;
  b: Pt;
  thicknessM: number;
  kind: "foundation" | "existing" | "new";
  rating: Rating;
};

export type Opening = {
  id: string;
  wallId: string;
  kind: "door" | "window";
  offsetM: number; // along the wall from `a` to the opening's centre
  widthM: number;
  heightM: number | null;
  sillM?: number | null; // windows: floor to the bottom of the opening
  status: "existing" | "new";
  swing?: "left" | "right" | null; // doors: the hinge side, looking from `a` to `b`
  rating?: "20min" | null; // a door in a fire separation: closer, positive latch
  detectionId?: string; // the SAM find it came from
};

export type RoomKind = "bedroom" | "bathroom" | "kitchen" | "living" | "mechanical" | "stairs" | "closet" | "storage" | "laundry" | "hall" | "other";

export type Room = {
  id: string;
  polygon: Pt[];
  kind: RoomKind;
  name: string;
  unit: 1 | 2 | "shared";
  ceilingM?: number | null;
};

export type FixtureKind = "furnace" | "water_heater" | "panel" | "plumbing" | "beam" | "duct" | "bulkhead" | "post" | "stairs";

export type Fixture = {
  id: string;
  kind: FixtureKind;
  at: Pt; // centre
  sizeM?: Pt; // footprint, along x and z
  heightM?: number | null; // beams, ducts, bulkheads: floor to their underside
  detectionId?: string;
};

export type Alarm = { id: string; kind: "smoke" | "co" | "combo"; at: Pt; why: string };

export type Finishes = { style: string; floor: string; walls: string; kitchen?: string; bath?: string };

// The basement as it is, from the scan and the homeowner's corrections on "Is this your basement?".
export type Existing = {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  fixtures: Fixture[];
  ceilingM: number | null;
  scale: { source: "arkit" | "model" | "user_measurement" | "tape"; tapeM?: { wallId: string; lengthM: number }[] };
  confirmedAt: string | null; // when they said yes, this is my basement
};

// One design for the suite. `proposed` is the whole design as built: existing walls it keeps are in it too.
export type Design = {
  id: string;
  name: string;
  layout: "one_bedroom" | "studio" | "two_bedroom" | "custom";
  proposed: { walls: Wall[]; openings: Opening[]; rooms: Room[]; fixtures: Fixture[]; alarms: Alarm[] };
  finishes: Finishes;
  chosen: boolean;
  updatedAt: string;
};

// What they swiped: card ids, and the style and finishes those cards point to.
export type Mood = { liked: string[]; disliked: string[]; style: string | null; finishes: Partial<Finishes> };

export type Model = { version: 1; existing: Existing; designs: Design[]; mood: Mood };

// A change to a design: what the editor's drags, the one-tap fixes and muse-spark's proposals produce.
export type Edit =
  | { op: "move_wall"; wallId: string; a: Pt; b: Pt }
  | { op: "add_wall"; wall: Wall }
  | { op: "remove_wall"; wallId: string }
  | { op: "add_opening"; opening: Opening }
  | { op: "move_opening"; openingId: string; offsetM: number }
  | { op: "remove_opening"; openingId: string }
  | { op: "set_room"; roomId: string; kind?: RoomKind; name?: string; polygon?: Pt[] }
  | { op: "set_finishes"; finishes: Partial<Finishes> };

// A rule checked on a design: shown live in the studio, counted on the permit's readiness list.
export type Check = {
  id: string;
  label: string;
  ok: boolean | null; // null: needs a person to confirm
  detail: string;
  ruleId?: string; // the rule pack's id, for the citation
  fix?: { label: string; edits: Edit[] };
};
