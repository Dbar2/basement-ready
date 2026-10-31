// The materials list for building it yourself: quantities counted from the measured plan and the
// chosen layout (wall lengths, areas, doors, alarms, fixtures), a waste factor per line, and a real
// local shelf price with its store, link and the date it was checked (data/rules/prices-on.json).
// A line with no price found says so; nothing is priced by guess.
import { readFileSync } from "node:fs";
import type { Layout, LayoutZone, Plan } from "../../src/api";
import { ontarioDiy } from "../permit/data";
import type { Geometry } from "../permit/plans";

export type PriceItem = {
  id: string;
  item: string;
  product: string;
  unit: string;
  coverage?: string;
  per?: number; // how much one unit covers, in the line's own unit (sq ft, m, pieces)
  priceCAD: number;
  retailer: string;
  store: string;
  url: string;
  checked: string;
  note?: string;
};
export type ServicePrice = { id: string; item: string; lowCAD: number; highCAD: number; unit: string; publisher: string; url: string; pageDate?: string | null; checked: string; note?: string };
export type Prices = { compiledAt: string; hstPct: number; shelfPricesExcludeHst: boolean; items: PriceItem[]; services: ServicePrice[] };

let prices: Prices | null = null;
export function loadPrices(): Prices {
  prices ??= JSON.parse(readFileSync(new URL("../../data/rules/prices-on.json", import.meta.url), "utf8")) as Prices;
  return prices;
}

export type Group = "Framing" | "Drywall" | "Insulation and air barrier" | "Flooring" | "Doors and trim" | "Alarms" | "Escape window" | "Electrical" | "Plumbing" | "Kitchen" | "Paint";

export type Line = {
  id: string;
  group: Group;
  item: string;
  need: number; // the quantity the plan needs, before waste
  needUnit: string;
  waste: number; // fraction added for cuts and mistakes
  buy: number; // what to buy, in store units
  buyUnit: string;
  unitPriceCAD: number | null;
  totalCAD: number | null;
  price: Pick<PriceItem, "product" | "retailer" | "store" | "url" | "checked"> | null;
  basis: string; // how it was counted, in plain words
  only?: string | null; // a condition: "only if your window fails A5"
};

export type Takeoff = {
  lines: Line[];
  assumptions: string[];
  materialsCAD: number; // before tax
  hstCAD: number;
  missing: string[]; // lines with no price found
  wallHeightM: number;
  checked: string;
};

const FT2 = 10.7639;
const SHEET_M2 = 32 / FT2; // a 4 x 8 ft sheet
const STUD_SPACING = 0.406; // 16" on centre, within Table 9.23.10.1
const PLATE_M = 2.44; // 8 ft lengths

const len = (w: { x0: number; z0: number; x1: number; z1: number }) => Math.hypot(w.x1 - w.x0, w.z1 - w.z0);
const perim = (z: { x0: number; z0: number; x1: number; z1: number }) => 2 * (Math.abs(z.x1 - z.x0) + Math.abs(z.z1 - z.z0));
const zoneArea = (zs: LayoutZone[]) => zs.reduce((s, z) => s + z.areaM2, 0);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function takeoff(geo: Geometry, opts: { egressNeeded?: boolean | null } = {}): Takeoff {
  const P = loadPrices();
  const byId = new Map(P.items.map((i) => [i.id, i]));
  const lines: Line[] = [];
  const assumptions: string[] = [];
  const main: Plan | null = geo.main?.plan ?? null;
  const L: Layout | null = geo.layout;
  const H = Math.min(2.44, geo.ceilingM ?? 2.3);
  if (geo.ceilingM == null) assumptions.push("Wall height taken as 2.3 m: tape your ceiling height on the Permit tab to sharpen the counts.");
  if (geo.estimated) assumptions.push("Sizes come from the phone video until taped. Buy against taped measurements before you order.");

  // One line: `need` in `needUnit`, divided by what one store unit covers (`per`), rounded up after waste.
  const add = (id: string, group: Group, item: string, need: number, needUnit: string, waste: number, basis: string, o: { per?: number; only?: string | null; buyUnit?: string } = {}) => {
    if (need <= 0) return;
    const p = byId.get(id) ?? null;
    const per = o.per ?? p?.per ?? 1;
    const buy = Math.ceil((need * (1 + waste)) / per - 1e-9);
    lines.push({
      id,
      group,
      item,
      need: r1(need),
      needUnit,
      waste,
      buy,
      buyUnit: o.buyUnit ?? p?.unit ?? needUnit,
      unitPriceCAD: p?.priceCAD ?? null,
      totalCAD: p ? Math.round(buy * p.priceCAD * 100) / 100 : null,
      price: p ? { product: p.product, retailer: p.retailer, store: p.store, url: p.url, checked: p.checked } : null,
      basis,
      only: o.only ?? null,
    });
  };

  if (!main) return { lines, assumptions: ["No measured plan yet."], materialsCAD: 0, hstCAD: 0, missing: [], wallHeightM: H, checked: P.compiledAt };
  const b = main.box;
  const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
  const zones = L?.zones ?? [];
  const stairs = zones.filter((z) => z.kind === "stairs");
  const mech = zones.find((z) => z.kind === "mechanical") ?? null;
  const bath = zones.find((z) => z.kind === "bathroom") ?? null;
  const kitchen = zones.find((z) => z.kind === "kitchen") ?? null;
  const habitable = zones.filter((z) => z.kind === "bedroom" || z.kind === "living");

  // ---- Framing ----
  // Furring walls along the foundation, and the new partitions; the furnace room's two inside walls.
  const outside = 2 * (w + d);
  const mechWalls = mech ? perim(mech) / 2 : 0;
  const partitions = (L?.walls ?? []).reduce((s, x) => s + len(x), 0) + mechWalls;
  const doors = (L?.doors.length ?? 0) + (mech ? 1 : 0);
  const windows = main.openings.filter((o) => o.kind === "window").length;
  const wallRuns = 4 + (L?.walls.length ?? 0) + (mech ? 2 : 0);
  const studs = Math.ceil(outside / STUD_SPACING) + Math.ceil(partitions / STUD_SPACING) + wallRuns + 2 * 4 + 2 * (L?.walls.length ?? 0) + 3 * doors + 2 * windows;
  add("stud_2x4_8", "Framing", "2x4 x 8 ft studs", studs, "studs", 0.1, `One every 406 mm (16") along ${r1(outside)} m of outside wall and ${r1(partitions)} m of new walls, plus corners, wall ends and ${doors} door openings.`, { per: 1, buyUnit: "each" });
  add("pt_2x4_8", "Framing", "Pressure-treated 2x4 x 8 ft (bottom plates on the concrete)", outside + partitions, "m", 0.1, "A bottom plate on every wall; pressure-treated because it sits on the slab (9.23.2.3).", { per: PLATE_M, buyUnit: "each" });
  add("stud_2x4_8", "Framing", "2x4 x 8 ft (top plates)", outside + partitions, "m", 0.1, "One top plate: non-loadbearing walls don't need two (9.23.11.3).", { per: PLATE_M, buyUnit: "each" });
  add("concrete_fasteners", "Framing", "Concrete fasteners for bottom plates", (outside + partitions) / 0.6, "fasteners", 0.1, "One every 600 mm along the bottom plates.");
  add("framing_screws", "Framing", "3\" framing screws or nails", studs * 6, "fasteners", 0.1, "About six per stud, top and bottom.");

  // ---- Drywall ----
  const ceiling = Math.max(0, w * d - zoneArea(stairs));
  const openings = doors * 2 * 0.8 * 2.0 + windows * 0.6;
  const wallArea = Math.max(0, outside * H + 2 * partitions * H - openings);
  const bathWalls = bath ? perim(bath) * H : 0;
  const mechWallsArea = mech ? 2 * mechWalls * H : 0;
  const regularWalls = Math.max(0, wallArea - bathWalls - mechWallsArea);
  add("drywall_typex_58", "Drywall", "5/8\" Type X drywall, 4 x 8 (suite ceiling, furnace room)", ceiling + mechWallsArea, "m²", 0.12, `The whole suite ceiling (${r1(ceiling)} m²) is the fire separation${mech ? ", plus both sides of the furnace room walls" : ""} (9.10.9.16, 9.10.10.4).`, { per: SHEET_M2, buyUnit: "sheet" });
  add("drywall_regular_12", "Drywall", "1/2\" drywall, 4 x 8 (walls)", regularWalls, "m²", 0.12, "Outside walls and both sides of new walls, less doors and windows.", { per: SHEET_M2, buyUnit: "sheet" });
  if (bath) add("drywall_mr_12", "Drywall", "1/2\" moisture-resistant drywall, 4 x 8 (bathroom)", bathWalls, "m²", 0.12, "Bathroom walls.", { per: SHEET_M2, buyUnit: "sheet" });
  const board = ceiling + mechWallsArea + regularWalls + bathWalls;
  add("joint_compound", "Drywall", "Joint compound", board * FT2, "sq ft", 0.1, "For taping and three coats over every board.");
  add("drywall_tape", "Drywall", "Paper drywall tape", board * FT2 * 0.37, "ft", 0.1, "About 0.37 ft of joint per sq ft of board (estimate).");
  add("drywall_screws", "Drywall", "Drywall screws", (board / SHEET_M2) * 32, "screws", 0.1, "About 32 per sheet.");
  add("resilient_channel", "Drywall", "Resilient channel, 12 ft", ceiling / 0.6, "m", 0.1, "Rows 600 mm apart across the ceiling: the sound option for a house 5+ years old (9.11.1.1).", { per: 3.66, buyUnit: "piece" });

  // ---- Insulation and air barrier ----
  const outsideWall = Math.max(0, outside * H - windows * 0.6 - (main.openings.filter((o) => o.kind === "door").length * 0.8 * 2.0));
  add("insul_r14_comfortbatt", "Insulation and air barrier", "R14 mineral wool batts for 2x4 walls (outside walls)", outsideWall * FT2, "sq ft", 0.05, "Every outside wall, floor to ceiling.");
  add("insul_safe_n_sound", "Insulation and air barrier", "3\" sound batts, two layers in the ceiling joists", 2 * ceiling * FT2, "sq ft", 0.05, "150 mm of sound-absorbing insulation in the joist spaces: two 3\" layers (9.11.1.1).");
  add("poly_6mil", "Insulation and air barrier", "6 mil polyethylene vapour barrier", outsideWall * FT2, "sq ft", 0.15, "Over the outside wall insulation, with laps.");
  add("acoustic_sealant", "Insulation and air barrier", "Acoustic sealant", 2 * (outside + partitions), "m", 0.1, "Top and bottom of every wall and the ceiling edge, about 7.5 m a tube (estimate).", { per: 7.5, buyUnit: "tube" });
  add("sheathing_tape", "Insulation and air barrier", "Sheathing tape for poly seams", outsideWall, "m²", 0.1, "About one roll per 50 m² of poly (estimate).", { per: 50, buyUnit: "roll" });

  // ---- Flooring ----
  const floor = zoneArea(zones.filter((z) => z.kind !== "stairs" && z.kind !== "mechanical")) || main.areaM2;
  add("lvp_flooring", "Flooring", "Vinyl plank flooring", floor * FT2, "sq ft", 0.1, `Every room but the furnace room and stairs (${r1(floor)} m²), 10% for cuts.`);

  // ---- Doors and trim ----
  const inside = L?.doors.length ?? 0;
  add("door_prehung_30", "Doors and trim", "30\" pre-hung interior door (bedroom, bathroom)", inside, "doors", 0, "One per door in the layout; 760 mm minimum for a bedroom (Table 9.5.5.1).", { per: 1, buyUnit: "each" });
  if (mech) add("door_prehung_32", "Doors and trim", "32\" pre-hung door (furnace room)", 1, "doors", 0, "A utility room door is at least 810 mm (Table 9.5.5.1).", { per: 1, buyUnit: "each" });
  add("door_solid_core", "Doors and trim", "Solid-core door for the doorway between the homes", 1, "doors", 0, "The door in the fire separation between the two homes, self-closing (9.10.9.16).", { per: 1, buyUnit: "each" });
  add("door_closer", "Doors and trim", "Spring (self-closing) hinges", 3, "hinges", 0, "Three on the door between the homes, so it closes itself (9.10.13.10).", { per: 1, buyUnit: "each" });
  add("lever_privacy", "Doors and trim", "Privacy lever sets (bedroom, bathroom)", inside, "doors", 0, "One per bedroom and bathroom door.", { per: 1, buyUnit: "each" });
  add("lever_passage", "Doors and trim", "Passage lever sets", 1 + (mech ? 1 : 0), "doors", 0, "Door between the homes and the furnace room.", { per: 1, buyUnit: "each" });
  const base = habitable.reduce((s, z) => s + perim(z), 0) + (bath ? perim(bath) : 0) - (inside + 1) * 0.8;
  add("baseboard_mdf", "Doors and trim", "MDF baseboard", base, "m", 0.1, "Around each room, less the doorways.");
  add("casing_mdf", "Doors and trim", "MDF door casing", (inside + 2 + (mech ? 1 : 0)) * 2 * (2 * 2.03 + 0.9), "m", 0.1, "Both sides of every door.");

  // ---- Alarms ----
  const smoke = geo.alarms.filter((a) => a.kind === "smoke").length;
  const combo = geo.alarms.filter((a) => a.kind === "combo").length;
  const co = geo.alarms.filter((a) => a.kind === "co").length;
  add("alarm_smoke_hardwired", "Alarms", "Hard-wired smoke alarms with a built-in strobe", smoke, "alarms", 0, "Placed by the code on A3: each bedroom and between the bedrooms and the rest of the unit, each with a visual signal of at least 175 cd in bedrooms (9.10.19.3).", { per: 1, buyUnit: "each" });
  add("alarm_combo_hardwired", "Alarms", "Hard-wired smoke and CO combination alarms", combo, "alarms", 0, "Where both are needed: outside the bedroom when the house burns fuel (9.32.3.9A).", { per: 1, buyUnit: "each" });
  add("alarm_strobe", "Alarms", "Strobe smoke alarm beside each combination alarm", combo, "alarms", 0, "Gives the visual signal the code asks for (9.10.19.3.(4)); interconnect it with the others.", { per: 1, buyUnit: "each" });
  add("alarm_co_hardwired", "Alarms", "Hard-wired CO alarm for the furnace room", co, "alarms", 0, "In the service room with the fuel-burning furnace, permanently wired (9.32.3.9B, 9.32.3.9C).", { per: 1, buyUnit: "each" });

  // ---- Escape window ----
  const egressNew = Boolean(geo.egress && !geo.egress.existing);
  const egressOnly = egressNew ? null : "Only if your bedroom window fails the A5 checks";
  if (egressNew || opts.egressNeeded !== false) {
    add("egress_window", "Escape window", "Egress-size basement window", 1, "window", 0, "Clear opening at least 0.35 m², no side under 380 mm (9.9.10.1).", { per: 1, buyUnit: "each", only: egressOnly });
    add("window_well", "Escape window", "Window well", 1, "well", 0, "550 mm clear in front of the window (9.9.10.1.(3)).", { per: 1, buyUnit: "each", only: egressOnly });
  }

  // ---- Electrical ----
  const e = ontarioDiy().electrical;
  const receptacles = habitable.reduce((s, z) => s + Math.max(4, Math.ceil((perim(z) - 0.8) / (2 * e.receptacleSpacingM))), 0);
  const counter = kitchen ? Math.max(Math.abs(kitchen.x1 - kitchen.x0), Math.abs(kitchen.z1 - kitchen.z0)) : 0;
  const counterRecepts = kitchen ? Math.max(2, Math.ceil(counter / (2 * e.counterSpacingM))) : 0;
  const lights = Math.max(4, Math.ceil(floor / 3));
  const switches = habitable.length + (bath ? 1 : 0) + (kitchen ? 1 : 0) + (mech ? 1 : 0);
  const circuits = Math.max(2, Math.ceil(receptacles / 10)) + (kitchen ? 3 : 0) + (bath ? 1 : 0) + 1;
  add("receptacle_tr_15a", "Electrical", "15 A tamper-resistant receptacles", receptacles + (kitchen ? 1 : 0), "receptacles", 0.05, `So no spot along a wall is more than ${e.receptacleSpacingM} m from one, in each bedroom and living space, plus the fridge.`);
  if (kitchen) add("receptacle_tr_20a", "Electrical", "20 A receptacles (kitchen counter)", counterRecepts, "receptacles", 0, `Along ${r1(counter)} m of counter, no spot more than ${e.counterSpacingM} m from one.`, { per: 1, buyUnit: "each" });
  if (bath) add("receptacle_gfci", "Electrical", "GFCI receptacle (bathroom)", 1, "receptacles", 0, "One within 1 m of the basin.", { per: 1, buyUnit: "each" });
  add("switch_single", "Electrical", "Light switches", switches, "switches", 0, "One per room.", { per: 1, buyUnit: "each" });
  add("pot_light_4in", "Electrical", "4\" LED slim recessed lights", lights, "lights", 0, "About one per 3 m² of floor (a typical layout, not a code rule).");
  if (bath) add("bath_fan", "Electrical", "Bathroom exhaust fan", 1, "fans", 0, "Vented to the outside.", { per: 1, buyUnit: "each" });
  add("device_box", "Electrical", "Device boxes", receptacles + counterRecepts + switches + (bath ? 1 : 0) + geo.alarms.length, "boxes", 0.1, "One per receptacle, switch and alarm.", { per: 1, buyUnit: "each" });
  add("wire_14_2", "Electrical", "14/2 NMD90 cable, 75 m", (receptacles + switches + lights + geo.alarms.length) * 4 + circuits * 12, "m", 0.15, "About 4 m per device plus a 12 m run back to the panel per circuit (estimate).", { per: 75, buyUnit: "roll" });
  if (kitchen) add("wire_12_2", "Electrical", "12/2 NMD90 cable, 75 m", counterRecepts * 4 + 2 * 12, "m", 0.15, "Two 20 A counter circuits (estimate).", { per: 75, buyUnit: "roll" });
  add("breaker_afci_15", "Electrical", "15 A AFCI breakers", circuits, "breakers", 0, `${circuits} circuits: receptacles, lights, kitchen and bathroom. Match your panel's brand.`, { per: 1, buyUnit: "each" });

  // ---- Plumbing ----
  if (bath) {
    add("toilet", "Plumbing", "Toilet", 1, "fixtures", 0, "The bathroom in the layout.", { per: 1, buyUnit: "each" });
    add("vanity", "Plumbing", "Vanity with top", 1, "fixtures", 0, "The bathroom in the layout.", { per: 1, buyUnit: "each" });
    add("bath_faucet", "Plumbing", "Bathroom faucet", 1, "fixtures", 0, "For the vanity.", { per: 1, buyUnit: "each" });
    add("tub", "Plumbing", "Alcove tub, 60 x 30 in", 1, "fixtures", 0, "A tub or shower is required (9.31.4.1).", { per: 1, buyUnit: "each" });
    add("tub_walls", "Plumbing", "Tub and shower wall kit", 1, "kits", 0, "Walls around the tub.", { per: 1, buyUnit: "each" });
  }
  if (kitchen) {
    add("kitchen_sink", "Plumbing", "Kitchen sink", 1, "fixtures", 0, "The kitchen in the layout.", { per: 1, buyUnit: "each" });
    add("kitchen_faucet", "Plumbing", "Kitchen faucet", 1, "fixtures", 0, "The kitchen in the layout.", { per: 1, buyUnit: "each" });
  }
  add("pex_12", "Plumbing", "1/2\" PEX pipe, 100 ft", 30, "m", 0.1, "Hot and cold to each fixture (estimate: about 30 m).", { per: 30.48, buyUnit: "roll" });
  add("abs_3", "Plumbing", "3\" ABS pipe", 6, "m", 0.1, "Toilet drain to the stack (estimate).", { per: 3.66, buyUnit: "length" });
  add("abs_1_5", "Plumbing", "1-1/2\" ABS pipe", 10, "m", 0.1, "Sinks and shower drains and vents (estimate).", { per: 3.66, buyUnit: "length" });
  add("shutoff_main", "Plumbing", "Main shut-off valve for the unit", 1, "valves", 0, "The unit's own shut-off where the supply enters it (9.31.4.1).", { per: 1, buyUnit: "each" });
  add("shutoff_valve", "Plumbing", "Angle stop valves for the fixtures", (bath ? 3 : 0) + (kitchen ? 2 : 0), "valves", 0, "Hot and cold to each sink, cold to the toilet.");

  // ---- Kitchen ----
  if (kitchen) {
    const units = Math.max(2, Math.round(counter / 0.762));
    add("cabinet_base_30", "Kitchen", "30\" base cabinets", units, "cabinets", 0, `Along ${r1(counter)} m of counter.`, { per: 1, buyUnit: "each" });
    add("cabinet_wall_30", "Kitchen", "30\" wall cabinets", units, "cabinets", 0, "Over the counter.", { per: 1, buyUnit: "each" });
    add("countertop_8ft", "Kitchen", "Laminate countertop, 8 ft", counter, "m", 0.05, "One run.", { per: 2.44, buyUnit: "length" });
  }

  // ---- Paint ----
  add("primer", "Paint", "Drywall primer, 3.78 L", board * FT2, "sq ft", 0.1, "One coat on all new board.");
  add("paint_walls", "Paint", "Wall paint, 3.78 L", 2 * (board - ceiling) * FT2, "sq ft", 0.1, "Two coats on the walls.");
  add("paint_ceiling", "Paint", "Ceiling paint, 3.78 L", 2 * ceiling * FT2, "sq ft", 0.1, "Two coats on the ceiling.");

  const priced = lines.filter((l) => l.totalCAD != null && !l.only);
  const materialsCAD = Math.round(priced.reduce((s, l) => s + l.totalCAD!, 0));
  const missing = lines.filter((l) => l.totalCAD == null).map((l) => l.item);
  return { lines, assumptions, materialsCAD, hstCAD: Math.round((materialsCAD * P.hstPct) / 100), missing, wallHeightM: H, checked: P.compiledAt };
}
