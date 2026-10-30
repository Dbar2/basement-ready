// The model as the server accepts it: saved on the workspace, sent back for new designs, or proposed
// as edits by muse-spark. Sizes are capped so a bad client or a confused model can't store nonsense.
import { z } from "zod";
import { bounds, wallLength } from "./geometry";
import type { Design, Edit, Existing, Pt } from "./types";

const num = z.number().finite();
const m = num.min(-200).max(200); // metres in the basement frame
const size = num.min(0).max(60);
const id = z.string().trim().max(60);
const pt = z.tuple([m, m]);
const rating = z.enum(["30min", "15min"]).nullable();

const WallSchema = z.object({ id, a: pt, b: pt, thicknessM: size, kind: z.enum(["foundation", "existing", "new"]), rating, guess: z.boolean().optional() });
const OpeningSchema = z.object({
  id,
  wallId: id,
  kind: z.enum(["door", "window"]),
  offsetM: size,
  widthM: num.min(0.1).max(10),
  heightM: num.min(0.1).max(5).nullable(),
  sillM: num.min(0).max(5).nullable().optional(),
  status: z.enum(["existing", "new"]),
  swing: z.enum(["left", "right"]).nullable().optional(),
  rating: z.enum(["20min"]).nullable().optional(),
  detectionId: id.optional(),
});
const RoomKindSchema = z.enum(["bedroom", "bathroom", "kitchen", "living", "mechanical", "stairs", "closet", "storage", "laundry", "hall", "other"]);
const RoomSchema = z.object({
  id,
  polygon: z.array(pt).min(3).max(40),
  kind: RoomKindSchema,
  name: z.string().trim().max(60),
  unit: z.union([z.literal(1), z.literal(2), z.literal("shared")]),
  ceilingM: num.min(0).max(6).nullable().optional(),
  ceilingRating: rating.optional(),
});
const FixtureKindSchema = z.enum(["furnace", "water_heater", "panel", "plumbing", "beam", "duct", "bulkhead", "post", "stairs"]);
const FixtureSchema = z.object({ id, kind: FixtureKindSchema, at: pt, sizeM: z.tuple([size, size]).optional(), heightM: num.min(0).max(6).nullable().optional(), detectionId: id.optional(), guess: z.boolean().optional() });
const AlarmSchema = z.object({ id, kind: z.enum(["smoke", "co", "combo"]), at: pt, why: z.string().max(200) });
const FurnitureKindSchema = z.enum(["bed", "sofa", "armchair", "desk", "dining", "dresser", "tv", "rug", "shelf", "kitchen", "fridge", "vanity", "toilet", "shower", "washer_dryer", "other"]);
const FurnitureSchema = z.object({ id, kind: FurnitureKindSchema, at: pt, rotDeg: num.min(-720).max(720), sizeM: z.tuple([num.min(0.05).max(12), num.min(0.05).max(12)]), colour: z.string().max(40).optional(), roomId: id.optional() });
const FinishesSchema = z.object({ style: z.string().max(40), floor: z.string().max(80), walls: z.string().max(80), kitchen: z.string().max(80).optional(), bath: z.string().max(80).optional() });
const Layer = { walls: z.array(WallSchema).max(200), openings: z.array(OpeningSchema).max(200), rooms: z.array(RoomSchema).max(60), fixtures: z.array(FixtureSchema).max(80) };

export const ExistingSchema = z.object({
  ...Layer,
  ceilingM: num.min(0).max(6).nullable(),
  scale: z.object({
    source: z.enum(["arkit", "model", "user_measurement", "tape"]),
    tapeM: z.array(z.object({ wallId: id, lengthM: num.min(0.1).max(60) })).max(10).optional(),
    factor: num.min(0.2).max(5).optional(),
  }),
  confirmedAt: z.string().max(40).nullable(),
});

export const DesignSchema = z.object({
  id,
  name: z.string().trim().max(60),
  layout: z.enum(["one_bedroom", "studio", "two_bedroom", "custom"]),
  // Designs saved before furniture joined the model have none yet.
  proposed: z.object({ ...Layer, alarms: z.array(AlarmSchema).max(40), furniture: z.array(FurnitureSchema).max(120).default([]) }),
  finishes: FinishesSchema,
  chosen: z.boolean(),
  updatedAt: z.string().max(40),
});

export const ModelSchema = z.object({
  version: z.literal(1),
  existing: ExistingSchema,
  designs: z.array(DesignSchema).max(8),
  mood: z.object({
    liked: z.array(id).max(200),
    disliked: z.array(id).max(200),
    style: z.string().max(40).nullable(),
    finishes: FinishesSchema.partial(),
    colours: z.record(z.string().max(20), z.string().max(40)).optional(),
  }),
});

export const EditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("move_wall"), wallId: id, a: pt, b: pt }),
  z.object({ op: z.literal("add_wall"), wall: WallSchema.extend({ id: id.default("") }) }),
  z.object({ op: z.literal("remove_wall"), wallId: id }),
  z.object({ op: z.literal("set_wall"), wallId: id, rating: rating.optional(), kind: z.enum(["foundation", "existing", "new"]).optional(), thicknessM: num.min(0.05).max(0.5).optional() }),
  z.object({ op: z.literal("add_opening"), opening: OpeningSchema.extend({ id: id.default("") }) }),
  z.object({ op: z.literal("move_opening"), openingId: id, offsetM: size }),
  z.object({
    op: z.literal("set_opening"),
    openingId: id,
    widthM: num.min(0.1).max(10).optional(),
    heightM: num.min(0.1).max(5).nullable().optional(),
    sillM: num.min(0).max(5).nullable().optional(),
    rating: z.enum(["20min"]).nullable().optional(),
    swing: z.enum(["left", "right"]).nullable().optional(),
  }),
  z.object({ op: z.literal("remove_opening"), openingId: id }),
  z.object({ op: z.literal("add_room"), room: RoomSchema.extend({ id: id.default("") }) }),
  z.object({ op: z.literal("set_room"), roomId: id, kind: RoomKindSchema.optional(), name: z.string().trim().max(60).optional(), polygon: z.array(pt).min(3).max(40).optional(), unit: z.union([z.literal(1), z.literal(2), z.literal("shared")]).optional(), ceilingRating: rating.optional() }),
  z.object({ op: z.literal("remove_room"), roomId: id }),
  z.object({ op: z.literal("add_fixture"), fixture: FixtureSchema.extend({ id: id.default("") }) }),
  z.object({ op: z.literal("set_fixture"), fixtureId: id, kind: FixtureKindSchema.optional(), at: pt.optional(), sizeM: z.tuple([size, size]).optional(), heightM: num.min(0).max(6).nullable().optional() }),
  z.object({ op: z.literal("remove_fixture"), fixtureId: id }),
  z.object({ op: z.literal("set_finishes"), finishes: FinishesSchema.partial() }),
  z.object({ op: z.literal("add_furniture"), furniture: FurnitureSchema.extend({ id: id.default("") }) }),
  z.object({ op: z.literal("set_furniture"), furnitureId: id, kind: FurnitureKindSchema.optional(), at: pt.optional(), rotDeg: num.min(-720).max(720).optional(), sizeM: z.tuple([num.min(0.05).max(12), num.min(0.05).max(12)]).optional(), colour: z.string().max(40).optional() }),
  z.object({ op: z.literal("remove_furniture"), furnitureId: id }),
]);

// Edits someone (or something) proposed, kept only where they make sense for this design: the things
// they name exist, new things land inside the basement, walls stay real lengths, doors stay usable,
// and the house's own walls and stair aren't moved or taken out.
export function validateEdits(design: Design, existing: Existing, raw: unknown): { edits: Edit[]; dropped: string[] } {
  const list = Array.isArray(raw) ? raw.slice(0, 20) : [];
  const { walls, openings, rooms, fixtures } = design.proposed;
  const floor = [...existing.rooms, ...rooms].flatMap((r) => r.polygon);
  const b = floor.length ? bounds(floor) : { minX: -50, maxX: 50, minZ: -50, maxZ: 50 };
  const inside = (p: Pt) => p[0] >= b.minX - 0.3 && p[0] <= b.maxX + 0.3 && p[1] >= b.minZ - 0.3 && p[1] <= b.maxZ + 0.3;
  const wallIds = new Set(walls.map((w) => w.id));
  const edits: Edit[] = [];
  const dropped: string[] = [];
  for (const item of list) {
    const parsed = EditSchema.safeParse(item);
    if (!parsed.success) {
      dropped.push(`Not a change we understand (${String((item as { op?: unknown })?.op ?? "no op")}).`);
      continue;
    }
    const e = parsed.data as Edit;
    const why = problem(e);
    if (why) dropped.push(why);
    else {
      edits.push(e);
      if (e.op === "add_wall" && e.wall.id) wallIds.add(e.wall.id);
    }
  }
  return { edits, dropped };

  function problem(e: Edit): string | null {
    const wall = (wid: string) => walls.find((w) => w.id === wid);
    switch (e.op) {
      case "move_wall": {
        const w = wall(e.wallId);
        if (!w) return `There's no wall ${e.wallId}.`;
        if (w.kind !== "new") return "Only new walls move; the house's own walls stay.";
        if (!inside(e.a) || !inside(e.b)) return "That would put a wall outside the basement.";
        return wallLength(e) < 0.3 ? "That wall would be too short." : null;
      }
      case "add_wall":
        if (e.wall.kind !== "new") return "Only new walls can be added.";
        if (!inside(e.wall.a) || !inside(e.wall.b)) return "That would put a wall outside the basement.";
        return wallLength(e.wall) < 0.3 ? "That wall would be too short." : null;
      case "remove_wall":
      case "set_wall": {
        const w = wall(e.wallId);
        if (!w) return `There's no wall ${e.wallId}.`;
        if (e.op === "remove_wall" && w.kind !== "new") return "The house's own walls stay.";
        if (e.op === "set_wall" && e.kind && e.kind !== w.kind) return "A wall's kind doesn't change.";
        return null;
      }
      case "add_opening":
        if (!wallIds.has(e.opening.wallId)) return `There's no wall ${e.opening.wallId}.`;
        if (e.opening.kind === "door" && (e.opening.widthM < 0.6 || e.opening.widthM > 1.9)) return "A door is 60 to 190 cm wide.";
        if (e.opening.kind === "window" && (e.opening.widthM < 0.3 || e.opening.widthM > 3)) return "A window is 30 cm to 3 m wide.";
        return null;
      case "move_opening":
      case "set_opening":
      case "remove_opening": {
        const o = openings.find((x) => x.id === e.openingId);
        if (!o) return `There's no opening ${e.openingId}.`;
        if (e.op === "set_opening" && e.widthM !== undefined && o.kind === "door" && (e.widthM < 0.6 || e.widthM > 1.9)) return "A door is 60 to 190 cm wide.";
        return null;
      }
      case "add_room":
        return e.room.polygon.every(inside) ? null : "That room would be outside the basement.";
      case "set_room":
      case "remove_room": {
        const r = rooms.find((x) => x.id === e.roomId);
        if (!r) return `There's no room ${e.roomId}.`;
        if (r.kind === "stairs" && (e.op === "remove_room" || (e.op === "set_room" && e.kind && e.kind !== "stairs"))) return "The stairs stay.";
        if (e.op === "set_room" && e.polygon && !e.polygon.every(inside)) return "That room would be outside the basement.";
        return null;
      }
      case "add_fixture":
        return inside(e.fixture.at) ? null : "That's outside the basement.";
      case "set_fixture":
      case "remove_fixture": {
        const f = fixtures.find((x) => x.id === e.fixtureId);
        if (!f) return `There's nothing called ${e.fixtureId}.`;
        if (e.op === "remove_fixture" || (e.op === "set_fixture" && e.at)) return "What's already in the basement stays where it is.";
        return null;
      }
      case "set_finishes":
        return null;
      case "add_furniture":
        return inside(e.furniture.at) ? null : "That's outside the basement.";
      case "set_furniture":
      case "remove_furniture": {
        if (!(design.proposed.furniture ?? []).some((f) => f.id === e.furnitureId)) return `There's no furniture ${e.furnitureId}.`;
        return e.op === "set_furniture" && e.at && !inside(e.at) ? "That's outside the basement." : null;
      }
    }
  }
}
