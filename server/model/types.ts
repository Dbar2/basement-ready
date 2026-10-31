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
  guess?: boolean; // the camera never saw it: its place is a guess until they confirm the plan
  why?: string; // a new wall's reason, in words they can read ("Closes off the bedroom")
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
  guess?: boolean; // its width (or for a window only seen on video, its place) is a guess until they check it
};

export type RoomKind = "bedroom" | "bathroom" | "kitchen" | "living" | "mechanical" | "stairs" | "closet" | "storage" | "laundry" | "hall" | "other";

export type Room = {
  id: string;
  polygon: Pt[];
  kind: RoomKind;
  name: string;
  unit: 1 | 2 | "shared";
  ceilingM?: number | null;
  ceilingRating?: Rating; // the floor above, as a fire separation: 15 minutes over the suite
  kept?: boolean; // finished as the scan found it (a bathroom already there): kept, not built new
};

export type FixtureKind = "furnace" | "water_heater" | "panel" | "plumbing" | "beam" | "duct" | "bulkhead" | "post" | "stairs";

export type Fixture = {
  id: string;
  kind: FixtureKind;
  at: Pt; // centre
  sizeM?: Pt; // footprint, along x and z
  heightM?: number | null; // beams, ducts, bulkheads: floor to their underside
  detectionId?: string;
  guess?: boolean; // seen on video but not placed by the 3D: they drag it where it is
  bottom?: Pt; // stairs: the foot of the flight, where you step off it
};

export type Alarm = { id: string; kind: "smoke" | "co" | "combo"; at: Pt; why: string };

// Furniture lives in the model, so every picture of the design shows it in the same place, and
// swapping a sofa for a desk (or its colour) changes every angle at once.
export type FurnitureKind =
  | "bed"
  | "sofa"
  | "armchair"
  | "desk"
  | "dining"
  | "dresser"
  | "tv"
  | "rug"
  | "shelf"
  | "kitchen"
  | "fridge"
  | "vanity"
  | "toilet"
  | "shower"
  | "washer_dryer"
  | "other";

export type Furniture = {
  id: string;
  kind: FurnitureKind;
  at: Pt; // centre of its footprint
  rotDeg: number; // about +Y, 0 = facing +z
  sizeM: Pt; // footprint before rotation
  colour?: string; // a named finish or a hex, from the mood board
  roomId?: string;
};

export type Finishes = { style: string; floor: string; walls: string; kitchen?: string; bath?: string };

// The basement as it is, from the scan and the homeowner's corrections on "Is this your basement?".
export type Existing = {
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  fixtures: Fixture[];
  ceilingM: number | null;
  // factor: how much the scan's own sizes were multiplied by to match their tape (1 untouched), so the
  // 3D is drawn at the same scale as the plan.
  scale: { source: "arkit" | "model" | "user_measurement" | "tape"; tapeM?: { wallId: string; lengthM: number }[]; factor?: number };
  confirmedAt: string | null; // when they said yes, this is my basement
  // Whether it has its own way in (server/model/entrance.ts): from the scan and what they told us, read
  // fresh from the answer every time (server/model/current.ts).
  entrance?: { status: "own" | "needed" | "unknown"; why: string };
};

// One design for the suite. `proposed` is the whole design as built: existing walls it keeps are in it too.
export type Design = {
  id: string;
  name: string;
  layout: "one_bedroom" | "studio" | "two_bedroom" | "custom";
  proposed: { walls: Wall[]; openings: Opening[]; rooms: Room[]; fixtures: Fixture[]; alarms: Alarm[]; furniture: Furniture[] };
  finishes: Finishes;
  chosen: boolean;
  updatedAt: string;
  why?: string; // one plain sentence on why it's laid out so (server/model/seed.ts whyOf)
};

// What they swiped: card ids, and the style and finishes those cards point to. `colours`: each piece of
// furniture's colour, from the style the board loved most for its room (server/ideas/deck.ts).
export type Mood = { liked: string[]; disliked: string[]; style: string | null; finishes: Partial<Finishes>; colours?: Partial<Record<FurnitureKind, string>> };

// `recommended`: the design the guide puts first, and why in one plain line (server/model/seed.ts).
export type Model = { version: 1; existing: Existing; designs: Design[]; mood: Mood; recommended?: { designId: string; reason: string } };

// A change to a design: what the editor's drags, the one-tap fixes and muse-spark's proposals produce.
export type Edit =
  | { op: "move_wall"; wallId: string; a: Pt; b: Pt }
  | { op: "add_wall"; wall: Wall }
  | { op: "remove_wall"; wallId: string }
  | { op: "set_wall"; wallId: string; rating?: Rating; kind?: Wall["kind"]; thicknessM?: number; guess?: false } // guess false: they say a guessed wall is right
  | { op: "add_opening"; opening: Opening }
  | { op: "move_opening"; openingId: string; offsetM: number }
  | { op: "set_opening"; openingId: string; widthM?: number; heightM?: number | null; sillM?: number | null; rating?: "20min" | null; swing?: "left" | "right" | null }
  | { op: "remove_opening"; openingId: string }
  | { op: "add_room"; room: Room }
  | { op: "set_room"; roomId: string; kind?: RoomKind; name?: string; polygon?: Pt[]; unit?: Room["unit"]; ceilingRating?: Rating }
  | { op: "remove_room"; roomId: string }
  | { op: "add_fixture"; fixture: Fixture }
  | { op: "set_fixture"; fixtureId: string; kind?: FixtureKind; at?: Pt; sizeM?: Pt; heightM?: number | null }
  | { op: "remove_fixture"; fixtureId: string }
  | { op: "set_finishes"; finishes: Partial<Finishes> }
  | { op: "add_furniture"; furniture: Furniture }
  | { op: "set_furniture"; furnitureId: string; kind?: FurnitureKind; at?: Pt; rotDeg?: number; sizeM?: Pt; colour?: string }
  | { op: "remove_furniture"; furnitureId: string };

// A rule checked on a design: shown live in the studio, counted on the permit's readiness list.
export type Check = {
  id: string;
  label: string;
  ok: boolean | null; // null: needs a person to confirm
  detail: string;
  ruleId?: string; // the rule pack's id, for the citation
  fix?: { label: string; edits: Edit[] };
  at?: Pt; // where on the plan it is, to point at it
};
