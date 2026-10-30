// "Describe a change": the homeowner says what they want in their own words, muse-spark proposes the
// change as typed edits to the design, and only edits that make sense for this design come back
// (server/model/schema.ts validateEdits). Nothing is applied here: the studio shows the proposal with
// its checks and cost, and they tap Apply.
import { outputText, responses } from "../meta";
import { checkDesign } from "./checks";
import { bounds, r2, roomArea, wallLength } from "./geometry";
import { validateEdits } from "./schema";
import type { Design, Edit, Existing } from "./types";

export type Proposal = { summary: string; edits: Edit[]; dropped: string[] };

const INSTRUCTIONS = `You change a design for a legal basement apartment (a secondary suite) in Ontario.
You get the design as JSON and what the homeowner asked for. Reply with JSON only:
{"summary": "<one short plain sentence saying what you changed, or why you can't>", "edits": [<edits>]}

Sizes are metres on the floor plan. x runs left to right, z runs top to bottom on the plan.
Edits, exactly these shapes:
- {"op":"move_wall","wallId":"...","a":[x,z],"b":[x,z]}  slide a wall: give both new ends. Only walls of kind "new" move.
  To make a room bigger, slide its wall away from the room by the same amount at both ends.
- {"op":"add_wall","wall":{"id":"","a":[x,z],"b":[x,z],"thicknessM":0.12,"kind":"new","rating":null}}
- {"op":"remove_wall","wallId":"..."}  only walls of kind "new".
- {"op":"set_wall","wallId":"...","rating":"30min"|null}
- {"op":"add_opening","opening":{"id":"","wallId":"...","kind":"door"|"window","offsetM":<metres from the wall's a end to the centre>,"widthM":0.81,"heightM":2.03,"status":"new","swing":"left","rating":null}}
- {"op":"move_opening","openingId":"...","offsetM":<metres from the wall's a end>}
- {"op":"set_opening","openingId":"...","widthM":<metres>}
- {"op":"remove_opening","openingId":"..."}
- {"op":"add_room","room":{"id":"","polygon":[[x,z],...],"kind":"closet"|"storage"|"laundry"|"bedroom"|"bathroom"|"kitchen"|"living"|"hall"|"other","name":"...","unit":2,"ceilingRating":"15min"}}
- {"op":"set_room","roomId":"...","kind":"...","name":"...","polygon":[[x,z],...]}
- {"op":"remove_room","roomId":"..."}
- {"op":"set_fixture","fixtureId":"...","heightM":<metres to its underside>}  only for raising a duct or bulkhead.
- {"op":"set_finishes","finishes":{"style":"...","floor":"...","walls":"..."}}
- {"op":"add_furniture","furniture":{"id":"","kind":"bed"|"sofa"|"armchair"|"desk"|"dining"|"dresser"|"tv"|"rug"|"shelf"|"kitchen"|"fridge"|"vanity"|"toilet"|"shower"|"washer_dryer"|"other","at":[x,z],"rotDeg":0,"sizeM":[width,depth],"colour":"...","roomId":"..."}}
- {"op":"set_furniture","furnitureId":"...","kind":"...","at":[x,z],"rotDeg":<degrees, 0 faces +z>,"colour":"..."}  swap a piece by changing its kind and size.
- {"op":"remove_furniture","furnitureId":"..."}

Rules:
- Keep it legal: doors at least 0.81 m wide, bedrooms at least 7 m² with their escape window, halls at least 0.86 m.
- Never move or remove the house's own walls (kind "foundation" or "existing") or the stairs.
- A wall between the suite and the stairs or furnace room stays rated "30min", and a door in it stays "20min".
- When a room's wall moves, the room's outline moves with it on its own: don't also send set_room for that.
- Use as few edits as you can. If you can't do what they asked, send no edits and say why in the summary.`;

// The design as the model reads it: short ids, rounded numbers, the rooms' boxes and what fails.
function brief(design: Design, existing: Existing) {
  const { walls, openings, rooms, fixtures } = design.proposed;
  return {
    layout: design.layout,
    rooms: rooms.map((r) => {
      const b = bounds(r.polygon);
      return { id: r.id, kind: r.kind, name: r.name, unit: r.unit, x0: r2(b.minX), z0: r2(b.minZ), x1: r2(b.maxX), z1: r2(b.maxZ), areaM2: r2(roomArea(r)) };
    }),
    walls: walls.map((w) => ({ id: w.id, kind: w.kind, rating: w.rating, a: w.a.map(r2), b: w.b.map(r2), lengthM: r2(wallLength(w)) })),
    openings: openings.map((o) => ({ id: o.id, wallId: o.wallId, kind: o.kind, offsetM: r2(o.offsetM), widthM: r2(o.widthM), rating: o.rating ?? null })),
    overhead: fixtures.filter((f) => f.heightM != null).map((f) => ({ id: f.id, kind: f.kind, at: f.at.map(r2), heightM: f.heightM })),
    furniture: (design.proposed.furniture ?? []).map((f) => ({ id: f.id, kind: f.kind, at: f.at.map(r2), rotDeg: f.rotDeg, sizeM: f.sizeM, colour: f.colour ?? null, roomId: f.roomId ?? null })),
    finishes: design.finishes,
    failing: checkDesign(design, existing).filter((c) => c.ok === false).map((c) => c.label),
  };
}

function parseJson(text: string): any {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("muse-spark did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export async function describeChange(design: Design, existing: Existing, ask: string): Promise<Proposal> {
  const r = await responses({
    model: "muse-spark-1.3",
    input: [
      { role: "developer", content: INSTRUCTIONS },
      { role: "user", content: JSON.stringify({ design: brief(design, existing), homeownerAsked: ask }) },
    ],
  });
  const json = parseJson(outputText(r));
  const { edits, dropped } = validateEdits(design, existing, json?.edits);
  const summary = typeof json?.summary === "string" && json.summary.trim() ? json.summary.trim().slice(0, 300) : edits.length ? "Here's that change." : "That change didn't work for this design.";
  return { summary, edits, dropped };
}
