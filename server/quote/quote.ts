// The quote for one design, by trade, the way a contractor writes it: each line's quantity counted
// from the design's own walls, doors, windows, rooms and alarms; materials at the dated shelf prices
// in data/rules/prices-on.json; labour at published rates; then contingency, HST, and what it comes
// to if you hire it all out or build it yourself. A price or rate nobody published stays missing:
// the line says so and adds nothing. Pure and fast, so the 3D studio reruns it on every edit.
import { areaText, feeFor, sqftOf, suiteAreaM2 } from "../model/suite";
import type { Design, Furniture, Model, Opening, Pt, Room, Wall } from "../model/types";
import { catalog, furniturePrice, rate, shelf, type Rate } from "./catalog";

export type Trade = "demolition" | "framing" | "insulation" | "drywall" | "electrical" | "plumbing" | "hvac" | "doors_windows" | "flooring_trim" | "paint" | "kitchen" | "bathroom" | "permits" | "pros";

export const TRADES: { id: Trade; label: string }[] = [
  { id: "demolition", label: "Demolition" },
  { id: "framing", label: "Framing" },
  { id: "insulation", label: "Insulation and sound" },
  { id: "drywall", label: "Drywall and taping" },
  { id: "electrical", label: "Electrical and alarms" },
  { id: "plumbing", label: "Plumbing" },
  { id: "hvac", label: "Heating, fans and vents" },
  { id: "doors_windows", label: "Doors and windows" },
  { id: "flooring_trim", label: "Flooring and trim" },
  { id: "paint", label: "Paint" },
  { id: "kitchen", label: "Kitchen" },
  { id: "bathroom", label: "Bathroom" },
  { id: "permits", label: "Permits and fees" },
  { id: "pros", label: "Designer and engineer" },
];

export type Range = { low: number; high: number };
export type Source = { kind: "material" | "labour" | "fee"; title: string; url: string; checked: string; store?: string; sku?: string | null };

// One thing bought for a line, in store units after waste.
export type Part = { id: string; name: string; buy: number; unit: string; price: Range | null; source: Source | null };

export type QuoteLine = {
  id: string;
  trade: Trade;
  item: string;
  qty: number; // from the design's geometry
  unit: string;
  basis: string; // how it was counted, in plain words
  parts: Part[];
  material: Range; // the parts that have a price
  labour: Range | null; // null: no published rate found
  labourSource: Source | null;
  low: number; // hired: materials + labour
  high: number;
  diy: Range; // building it yourself: materials, plus the labour only a pro may do
  pro: boolean; // the labour is a pro's even when you build it yourself
  taxed: boolean; // HST applies (permit fees don't carry it)
  missing: string[]; // what on this line has no price
  sources: Source[];
};

export type TradeTotal = { trade: Trade; label: string; low: number; high: number; diyLow: number; diyHigh: number; lines: QuoteLine[] };

export type Quote = {
  totalLow: number; // hired out, with contingency and HST
  totalHigh: number;
  byTrade: TradeTotal[];
  subtotal: Range; // every line, before contingency and tax
  contingency: Range & { pctLow: number; pctHigh: number }; // on the building work, not fees or pros
  hst: Range & { pct: number };
  hired: Range;
  diy: Range & { contingency: Range; hst: Range };
  missing: string[]; // "Trade: what" for everything that has no price
  assumptions: string[];
  checked: string; // the catalog's date
  furniture: FurnitureQuote; // optional, and never in any total above
};

// Furniture in the design, priced on its own: what they'd buy to live there, not what the permit or a
// builder covers. The kitchen, vanity, toilet and shower are fixtures, already in the build above.
export type FurnitureLine = { id: string; label: string; count: number; price: Range | null; low: number; high: number; basis: string; sources: Source[] };
export type FurnitureQuote = { lines: FurnitureLine[]; subtotal: Range; hst: Range; total: Range; missing: string[]; inBuild: string[] };

export type QuoteOptions = { municipality?: string };

const CONTINGENCY = { low: 0.1, high: 0.15 };
const FT = 3.28084;
const FT2 = 10.7639;
const SHEET_FT2 = 32; // a 4 x 8 sheet
const STUD_O_C = 0.406; // 16" on centre
const PLATE_M = 2.44; // 8 ft lengths
const DOOR_H = 2.03;
const WASTE = { lumber: 0.1, drywall: 0.12, flooring: 0.1, insulation: 0.05, poly: 0.15, trim: 0.1, paint: 0.1 };

// ---- Geometry --------------------------------------------------------------------------------

const wallLen = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
function polyArea(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, z0] = p[i], [x1, z1] = p[(i + 1) % p.length];
    s += x0 * z1 - x1 * z0;
  }
  return Math.abs(s) / 2;
}
function perimeter(p: Pt[]) {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += Math.hypot(p[(i + 1) % p.length][0] - p[i][0], p[(i + 1) % p.length][1] - p[i][1]);
  return s;
}
function segDist(p: Pt, a: Pt, b: Pt) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
}
function inside(p: Pt, poly: Pt[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi || 1e-9) + xi) hit = !hit;
  }
  return hit;
}
const nearRoom = (p: Pt, r: Room, tol = 0.25) => inside(p, r.polygon) || r.polygon.some((a, i) => segDist(p, a, r.polygon[(i + 1) % r.polygon.length]) <= tol);
const mid = (w: Wall): Pt => [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
const along = (w: Wall, o: Opening): Pt => {
  const L = wallLen(w) || 1;
  return [w.a[0] + ((w.b[0] - w.a[0]) * o.offsetM) / L, w.a[1] + ((w.b[1] - w.a[1]) * o.offsetM) / L];
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const ceil = (n: number) => Math.max(0, Math.ceil(n - 1e-9));
const money = (n: number) => Math.round(n);

// ---- Lines -------------------------------------------------------------------------------------

const src = (r: Rate, kind: Source["kind"] = "labour"): Source => ({ kind, title: r.publisher + (r.region ? ` (${r.region})` : ""), url: r.url, checked: r.checked });

function part(id: string, name: string, need: number, waste: number, per?: number): Part {
  const s = shelf(id);
  const cover = per ?? s?.item.per ?? 1;
  const buy = ceil((need * (1 + waste)) / (cover || 1));
  if (!s) return { id, name, buy, unit: "each", price: null, source: null };
  return {
    id,
    name,
    buy,
    unit: s.item.unit,
    price: { low: buy * s.low, high: buy * s.high },
    source: { kind: "material", title: s.item.product, url: s.item.url, checked: s.item.checked, store: s.item.store, sku: s.item.sku ?? null },
  };
}

type Spec = {
  id: string;
  trade: Trade;
  item: string;
  qty: number;
  unit: string;
  basis: string;
  parts?: Part[];
  // Labour: a rate times a quantity in the rate's own unit, or "none". When the published figure is an
  // installed price (it includes the parts), the labour is what's left of it over the parts.
  labour?: { rate: string; qty: number } | "none";
  pro?: boolean;
  taxed?: boolean;
};

function line(s: Spec): QuoteLine {
  const parts = s.parts ?? [];
  const priced = parts.filter((p) => p.price);
  let material = { low: priced.reduce((t, p) => t + p.price!.low, 0), high: priced.reduce((t, p) => t + p.price!.high, 0) };
  const missing = parts.filter((p) => !p.price).map((p) => p.name);
  let labour: Range | null = { low: 0, high: 0 };
  let labourSource: Source | null = null;
  if (s.labour && s.labour !== "none") {
    const r = rate(s.labour.rate);
    if (!r) {
      labour = null;
      missing.push("labour");
    } else {
      labourSource = src(r, s.trade === "permits" ? "fee" : "labour");
      const all = { low: r.lowCAD * s.labour.qty, high: r.highCAD * s.labour.qty };
      labour = r.installed ? { low: Math.max(0, all.low - material.low), high: Math.max(0, all.high - material.high) } : all;
    }
  }
  material = { low: money(material.low), high: money(material.high) };
  if (labour) labour = { low: money(labour.low), high: money(labour.high) };
  const lab = labour ?? { low: 0, high: 0 };
  const pro = Boolean(s.pro);
  // Hourly trades: say how many hours, and that the hours are ours, not the publisher's.
  const hourly = s.labour && s.labour !== "none" && rate(s.labour.rate)?.unit === "hour" ? ` About ${r1(s.labour.qty)} hours of labour (our estimate) at the published hourly rate.` : "";
  return {
    id: s.id,
    trade: s.trade,
    item: s.item,
    qty: r1(s.qty),
    unit: s.unit,
    basis: s.basis + hourly,
    parts,
    material,
    labour,
    labourSource,
    low: material.low + lab.low,
    high: material.high + lab.high,
    diy: pro ? { low: material.low + lab.low, high: material.high + lab.high } : material,
    pro,
    taxed: s.taxed ?? true,
    missing,
    sources: [...priced.map((p) => p.source!), ...(labourSource ? [labourSource] : [])],
  };
}

// ---- The quote ---------------------------------------------------------------------------------

export function quote(model: Model, design: Design, opts: QuoteOptions = {}): Quote {
  const P = design.proposed;
  const lines: QuoteLine[] = [];
  const assumptions: string[] = [];
  const add = (s: Spec) => {
    if (s.qty > 0) lines.push(line(s));
  };

  const suite = P.rooms.filter((r) => r.unit === 2);
  const ceilingM = suite.find((r) => r.ceilingM)?.ceilingM ?? model.existing.ceilingM;
  const H = Math.min(2.44, ceilingM ?? 2.3);
  if (ceilingM == null) assumptions.push("Wall height taken as 2.3 m until the ceiling is measured.");
  if (model.existing.scale.source === "model") assumptions.push("Sizes come from the video (about ±5–20%); tape the main walls before you order.");

  const area = (rs: Room[]) => rs.reduce((s, r) => s + polyArea(r.polygon), 0);
  const ceilingArea = area(suite.filter((r) => r.kind !== "stairs"));
  const floorRooms = suite.filter((r) => !["stairs", "mechanical", "storage"].includes(r.kind));
  const floorArea = area(floorRooms);
  const baths = suite.filter((r) => r.kind === "bathroom");
  const kitchens = suite.filter((r) => r.kind === "kitchen");
  const laundry = P.rooms.filter((r) => r.kind === "laundry" && r.unit !== 1);
  const inSuite = (p: Pt) => suite.some((r) => nearRoom(p, r));

  // Walls: what's new, what's kept, what the suite finishes, and what comes out.
  const walls = new Map(P.walls.map((w) => [w.id, w]));
  const foundation = P.walls.filter((w) => w.kind === "foundation" && inSuite(mid(w)));
  const fresh = P.walls.filter((w) => w.kind === "new");
  const keptRated = P.walls.filter((w) => w.kind === "existing" && w.rating);
  const removed = model.existing.walls.filter((w) => w.kind === "existing" && !walls.has(w.id));
  const L = (ws: Wall[]) => ws.reduce((s, w) => s + wallLen(w), 0);
  const ratedNew = fresh.filter((w) => w.rating);
  const plainNew = fresh.filter((w) => !w.rating);
  const bathWalls = fresh.filter((w) => baths.some((b) => nearRoom(mid(w), b, 0.15)) && !w.rating);

  // Openings, with the wall they sit in.
  const opens = P.openings.map((o) => ({ o, w: walls.get(o.wallId) ?? null })).filter((x) => x.w);
  const doors = opens.filter((x) => x.o.kind === "door");
  const windows = opens.filter((x) => x.o.kind === "window");
  const ratedDoors = doors.filter((x) => x.o.rating === "20min");
  const newDoors = doors.filter((x) => x.o.status === "new" && !x.o.rating);
  const newWindows = windows.filter((x) => x.o.status === "new");
  const holeArea = (xs: typeof opens) => xs.reduce((s, x) => s + x.o.widthM * (x.o.heightM ?? (x.o.kind === "door" ? DOOR_H : 0.6)), 0);
  const holesIn = (ws: Wall[]) => opens.filter((x) => ws.includes(x.w!));

  // ---- Demolition ----
  const demoM2 = L(removed) * H;
  add({ id: "demo_walls", trade: "demolition", item: "Take out walls the design removes", qty: demoM2 * FT2, unit: "sq ft", basis: `${removed.length} wall${removed.length === 1 ? "" : "s"}, ${r1(L(removed))} m long, ${r1(H)} m high.`, labour: { rate: "lab_demo", qty: demoM2 * FT2 } });
  add({ id: "bin", trade: "demolition", item: "Waste bin, 7 days", qty: 1, unit: "bin", basis: "Offcuts, packaging and anything taken out.", labour: { rate: "bin_rental", qty: 1 }, pro: true });

  // ---- Framing ----
  const frameLen = L(fresh) + L(foundation);
  if (frameLen > 0) {
    const runs = fresh.length + foundation.length;
    const studs = ceil(frameLen / STUD_O_C) + runs * 2 + 2 * holesIn([...fresh, ...foundation]).length;
    add({
      id: "framing",
      trade: "framing",
      item: "Frame the new walls and fur the foundation walls",
      qty: frameLen * FT,
      unit: "lf",
      basis: `${r1(L(fresh))} m of new walls and ${r1(L(foundation))} m along the foundation, studs every 406 mm (16"), a pressure-treated bottom plate on the slab and one top plate.`,
      parts: [
        part("stud_2x4_8", "2x4 x 8 ft studs", studs, WASTE.lumber, 1),
        part("pt_2x4_8", "Pressure-treated 2x4 bottom plates", frameLen, WASTE.lumber, PLATE_M),
        part("stud_2x4_8", "2x4 top plates", frameLen, WASTE.lumber, PLATE_M),
        part("concrete_fasteners", "Concrete screws for the bottom plates", frameLen / 0.6, WASTE.lumber),
        part("framing_screws", "Framing screws", studs * 6, WASTE.lumber),
        part("sill_gasket", "Sill gasket under the bottom plates", frameLen * FT, WASTE.lumber),
      ],
      labour: { rate: "lab_framing", qty: frameLen * FT },
    });
  }

  // ---- Insulation and sound ----
  const foundWallM2 = Math.max(0, L(foundation) * H - holeArea(holesIn(foundation)));
  add({
    id: "insul_walls",
    trade: "insulation",
    item: "Mineral wool and vapour barrier on the foundation walls",
    qty: foundWallM2 * FT2,
    unit: "sq ft",
    basis: "R14 mineral wool between the furring studs, 6 mil poly over it, seams taped.",
    parts: [
      part("insul_r14_comfortbatt", "R14 mineral wool batts", foundWallM2 * FT2, WASTE.insulation),
      part("poly_6mil", "6 mil poly vapour barrier", foundWallM2 * FT2, WASTE.poly),
      part("sheathing_tape", "Sheathing tape for the poly seams", foundWallM2, WASTE.poly, 50),
    ],
    labour: { rate: "lab_insulation", qty: foundWallM2 * FT2 },
  });
  const soundWallM2 = (L(ratedNew) + L(bathWalls)) * H;
  add({
    id: "insul_sound",
    trade: "insulation",
    item: "Sound batts in the suite's ceiling and its separation walls",
    qty: (2 * ceilingArea + soundWallM2) * FT2,
    unit: "sq ft",
    basis: `Two 3" layers in the ceiling joists (${r1(ceilingArea)} m²) and one in ${r1(L(ratedNew) + L(bathWalls))} m of fire-separation and bathroom walls; acoustic sealant at every edge (9.11.1.1).`,
    parts: [
      part("insul_safe_n_sound", "3\" sound batts", (2 * ceilingArea + soundWallM2) * FT2, WASTE.insulation),
      part("acoustic_sealant", "Acoustic sealant", 2 * (L(fresh) + L(foundation)), WASTE.insulation, 7.5),
    ],
    labour: { rate: "lab_insulation", qty: (2 * ceilingArea + soundWallM2) * FT2 },
  });

  // ---- Drywall and taping ----
  const ratedM2 = Math.max(0, 2 * L(ratedNew) * H + L(keptRated) * H - holeArea(holesIn([...ratedNew, ...keptRated])));
  const typeX = ceilingArea + ratedM2;
  const mr = Math.max(0, L(bathWalls) * H - holeArea(holesIn(bathWalls)));
  const regular = Math.max(0, 2 * L(plainNew) * H + foundWallM2 - holeArea(holesIn(plainNew)) * 2 - mr);
  const board = typeX + mr + regular;
  add({
    id: "drywall_board",
    trade: "drywall",
    item: "Hang the drywall",
    qty: board * FT2,
    unit: "sq ft",
    basis: `5/8" Type X on the whole suite ceiling (${r1(ceilingArea)} m², the 15-minute floor separation) and both sides of the rated walls (${r1(ratedM2)} m²); moisture-resistant board in the bathroom; 1/2" everywhere else (9.10.9).`,
    parts: [
      part("drywall_typex_58", "5/8\" Type X drywall", typeX * FT2, WASTE.drywall, SHEET_FT2),
      part("drywall_mr_12", "1/2\" moisture-resistant drywall", mr * FT2, WASTE.drywall, SHEET_FT2),
      part("drywall_regular_12", "1/2\" drywall", regular * FT2, WASTE.drywall, SHEET_FT2),
      part("resilient_channel", "Resilient channel on the ceiling", ceilingArea / 0.6, WASTE.drywall, 3.66),
      part("drywall_screws", "Drywall screws", (board * FT2 * 32) / SHEET_FT2, WASTE.drywall),
    ].filter((p) => p.buy > 0),
    labour: { rate: "lab_drywall_hang", qty: board * FT2 },
  });
  add({
    id: "drywall_finish",
    trade: "drywall",
    item: "Tape, mud and sand to Level 4",
    qty: board * FT2,
    unit: "sq ft",
    basis: "Every joint taped and three coats, ready for paint; joints in the Type X kept continuous (fire-taped).",
    parts: [part("joint_compound", "Joint compound", board * FT2, WASTE.drywall), part("drywall_tape", "Paper joint tape", board * FT2 * 0.37, WASTE.drywall)],
    labour: { rate: "drywall_finishing", qty: board * FT2 },
  });

  // ---- Electrical and alarms ----
  const habitable = suite.filter((r) => ["bedroom", "living", "kitchen", "other"].includes(r.kind));
  const spacing = 1.8; // no point along a wall more than 1.8 m from a receptacle (CEC 26-722 as adopted; data/rules/ontario-diy.json)
  const receptacles = habitable.reduce((s, r) => s + Math.max(2, ceil(perimeter(r.polygon) / (2 * spacing))), 0);
  const counters = kitchens.reduce((s, k) => s + Math.max(2, ceil(counterRun(k) / 1.8)), 0);
  const lights = Math.max(suite.length ? 2 : 0, ceil((floorArea + area(suite.filter((r) => r.kind === "stairs"))) / 3));
  const switches = suite.filter((r) => r.kind !== "closet").length;
  const gfci = baths.length + (kitchens.length ? 1 : 0);
  const circuits = ceil(receptacles / 8) + 2 * kitchens.length + baths.length + 1 + (laundry.length ? 1 : 0);
  const devices = receptacles + counters + switches + gfci;
  add({
    id: "elec_wiring",
    trade: "electrical",
    item: "Wire the suite: receptacles, switches and lights",
    qty: devices + lights,
    unit: "devices",
    basis: `${receptacles} receptacles (none more than ${spacing} m from any point along a wall), ${counters} on the kitchen counter, ${gfci} GFCI, ${switches} switches, ${lights} pot lights (about one per 3 m²), on ${circuits} AFCI circuits.`,
    parts: [
      part("receptacle_tr_15a", "15 A tamper-resistant receptacles", receptacles, 0.05),
      part("receptacle_tr_20a", "20 A counter receptacles", counters, 0, 1),
      part("receptacle_gfci", "GFCI receptacles", gfci, 0, 1),
      part("switch_single", "Switches", switches, 0, 1),
      part("pot_light_4in", "4\" LED pot lights", lights, 0),
      part("device_box", "Device boxes", devices + P.alarms.length, 0.1, 1),
      part("wire_14_2", "14/2 NMD90 cable", (devices + lights + P.alarms.length) * 4 + circuits * 12, 0.15, 75),
      part("wire_12_2", "12/2 NMD90 cable (counter circuits)", kitchens.length ? counters * 4 + 24 : 0, 0.15, 75),
      part("breaker_afci_15", "15 A AFCI breakers", circuits, 0, 1),
    ].filter((p) => p.buy > 0),
    labour: { rate: "lab_electrician", qty: devices * 0.5 + lights * 0.75 + circuits * 1.5 },
  });
  const smoke = P.alarms.filter((a) => a.kind === "smoke").length;
  const combo = P.alarms.filter((a) => a.kind === "combo").length;
  const co = P.alarms.filter((a) => a.kind === "co").length;
  add({
    id: "alarms",
    trade: "electrical",
    item: "Interconnected smoke and CO alarms with strobes",
    qty: P.alarms.length,
    unit: "alarms",
    basis: `${smoke} smoke, ${combo} smoke and CO, ${co} CO, where the design places them; hard-wired, interconnected with the house's, a visual signal in each sleeping area (9.10.19, 9.32.3.9).`,
    parts: [
      part("alarm_smoke_hardwired", "Hard-wired smoke alarms with strobe", smoke, 0, 1),
      part("alarm_combo_strobe", "Hard-wired smoke and CO alarms with strobe", combo, 0, 1),
      part("alarm_co_hardwired", "Hard-wired CO alarms", co, 0, 1),
    ].filter((p) => p.buy > 0),
    labour: { rate: "lab_electrician", qty: P.alarms.length * 1 },
  });

  // ---- Plumbing ----
  const roughIn = (r: Room) => [...P.fixtures, ...model.existing.fixtures].some((f) => f.kind === "plumbing" && nearRoom(f.at, r, 0.5));
  for (const b of baths) {
    const has = roughIn(b);
    add({
      id: `rough_${b.id}`,
      trade: "plumbing",
      item: has ? `${b.name}: connect to the existing rough-in` : `${b.name}: new drains under the slab`,
      qty: 1,
      unit: "bathroom",
      basis: has ? "The scan found plumbing rough-ins here: supply lines and drains run to them, no slab cut." : "No rough-in found here: the slab is cut for the toilet and shower drains, then patched.",
      parts: [part("pex_12", "1/2\" PEX", 15, 0.1, 30.48), part("abs_3", "3\" ABS pipe", has ? 2 : 6, 0.1, 3.66), part("abs_1_5", "1-1/2\" ABS pipe", has ? 4 : 10, 0.1, 3.66), part("shutoff_valve", "Angle stop valves", 3, 0)],
      labour: has ? { rate: "lab_plumber", qty: 8 } : { rate: "pack_rough_in", qty: 1 },
    });
  }
  if (kitchens.length) {
    add({
      id: "plumb_kitchen",
      trade: "plumbing",
      item: "Kitchen sink supply and drain",
      qty: kitchens.length,
      unit: "kitchen",
      basis: "Hot and cold to the sink, a trap and vent to the nearest stack.",
      parts: [part("pex_12", "1/2\" PEX", 10 * kitchens.length, 0.1, 30.48), part("abs_1_5", "1-1/2\" ABS pipe", 4 * kitchens.length, 0.1, 3.66), part("shutoff_valve", "Angle stop valves", 2 * kitchens.length, 0)],
      labour: { rate: "lab_plumber", qty: 4 * kitchens.length },
    });
  }
  add({
    id: "plumb_unit",
    trade: "plumbing",
    item: "The suite's own shut-off, and hot water held to 49 °C",
    qty: 1,
    unit: "suite",
    basis: "A shut-off valve the suite can reach, and a thermostatic mixing valve so its hot water is no more than 49 °C (examiner's note; 9.31.4).",
    parts: [part("shutoff_main", "3/4\" ball valve (the suite's shut-off)", 1, 0, 1), part("mixing_valve", "Thermostatic mixing valve", 1, 0, 1)],
    labour: { rate: "lab_plumber", qty: 3 },
  });
  if (laundry.length) {
    add({
      id: "plumb_laundry",
      trade: "plumbing",
      item: "Washer box and drain",
      qty: laundry.length,
      unit: "laundry",
      basis: "A recessed washer box with its valves and drain.",
      parts: [part("laundry_box", "Washer outlet box", laundry.length, 0, 1), part("pex_12", "1/2\" PEX", 6 * laundry.length, 0.1, 30.48), part("abs_1_5", "1-1/2\" ABS pipe", 3 * laundry.length, 0.1, 3.66)],
      labour: { rate: "lab_plumber", qty: 4 * laundry.length },
    });
  } else assumptions.push("No laundry room in this design: the examiner asks for laundry for both units, so add one or say where it's shared.");

  // ---- Heating, fans and vents ----
  add({
    id: "bath_fans",
    trade: "hvac",
    item: "Bathroom fan, vented outside",
    qty: baths.length,
    unit: "fans",
    basis: "At least 50 CFM, ducted to the outside (examiner's note; 9.32.3).",
    parts: [part("bath_fan", "Bathroom exhaust fan (50+ CFM)", baths.length, 0, 1)],
    labour: { rate: "lab_fan", qty: baths.length },
  });
  add({
    id: "dryer_vent",
    trade: "hvac",
    item: "Dryer vent to the outside",
    qty: laundry.length,
    unit: "vents",
    basis: "A rigid dryer vent through the rim joist.",
    parts: [part("dryer_vent_kit", "Dryer vent kit", laundry.length, 0, 1)],
    labour: { rate: "lab_dryer_vent", qty: laundry.length },
  });
  add({
    id: "firestop",
    trade: "hvac",
    item: "Firestopping, and dampers where ducts cross the separation",
    qty: 1,
    unit: "job",
    basis: "The separation must be continuous: every pipe, duct and wire through it sealed (9.10.9.6).",
    labour: { rate: "pack_firestopping", qty: 1 },
  });

  // ---- Doors and windows ----
  const doorTo = (x: (typeof doors)[number], kinds: string[]) => P.rooms.some((r) => kinds.includes(r.kind) && nearRoom(along(x.w!, x.o), r, 0.3));
  const privacy = newDoors.filter((x) => doorTo(x, ["bedroom", "bathroom"])).length;
  add({
    id: "doors",
    trade: "doors_windows",
    item: "Hang the new inside doors",
    qty: newDoors.length,
    unit: "doors",
    basis: "Pre-hung doors: at least 760 mm to a bedroom or bathroom, 810 mm to the furnace room (Table 9.5.5.1).",
    parts: [
      part("door_prehung_30", "30\" pre-hung doors", newDoors.filter((x) => x.o.widthM < 0.79).length, 0, 1),
      part("door_prehung_32", "32\" pre-hung doors", newDoors.filter((x) => x.o.widthM >= 0.79).length, 0, 1),
      part("lever_privacy", "Privacy levers", privacy, 0, 1),
      part("lever_passage", "Passage levers", newDoors.length - privacy, 0, 1),
    ].filter((p) => p.buy > 0),
    labour: { rate: "lab_door", qty: newDoors.length },
  });
  add({
    id: "doors_rated",
    trade: "doors_windows",
    item: "20-minute doors with closers in the separation",
    qty: ratedDoors.length,
    unit: "doors",
    basis: "Every door between the two homes: 20-minute rated (or 45 mm solid core), self-closing on three spring hinges, latching (9.10.13).",
    parts: [part("door_fire_20min", "20-minute rated door", ratedDoors.length, 0, 1), part("door_closer", "Spring (self-closing) hinges", 3 * ratedDoors.length, 0, 1), part("lever_passage", "Passage levers", ratedDoors.length, 0, 1)],
    labour: { rate: "lab_door", qty: ratedDoors.length },
  });
  for (const x of newWindows) {
    add({
      id: `egress_${x.o.id}`,
      trade: "doors_windows",
      item: "Cut the foundation for an escape window, with its well",
      qty: 1,
      unit: "window",
      basis: `A new ${Math.round(x.o.widthM * 1000)} mm opening: at least 0.35 m² clear, no side under 380 mm, a well 550 mm deep (9.9.10.1). Installed price for Kitchener-Waterloo, which includes digging and cutting.`,
      parts: [part("egress_window", "Egress-size window", 1, 0, 1), part("window_well", "Window well", 1, 0, 1)],
      labour: { rate: "pack_egress", qty: 1 },
    });
  }

  // ---- Flooring and trim ----
  add({
    id: "flooring",
    trade: "flooring_trim",
    item: "Vinyl plank floor with underlay",
    qty: floorArea * FT2,
    unit: "sq ft",
    basis: `Every suite room but the stairs and furnace room (${r1(floorArea)} m²), 10% for cuts.`,
    parts: [part("lvp_flooring", "Vinyl plank flooring", floorArea * FT2, WASTE.flooring), part("underlay", "Underlay", floorArea * FT2, WASTE.flooring)],
    labour: { rate: "lab_flooring", qty: floorArea * FT2 },
  });
  const allDoors = doors.filter((x) => inSuite(along(x.w!, x.o)));
  const base = Math.max(0, floorRooms.reduce((s, r) => s + perimeter(r.polygon), 0) - allDoors.reduce((s, x) => s + 2 * x.o.widthM, 0));
  const casing = allDoors.length * 2 * (2 * DOOR_H + 0.9);
  add({
    id: "trim",
    trade: "flooring_trim",
    item: "Baseboard and door casing",
    qty: (base + casing) * FT,
    unit: "lf",
    basis: `${r1(base)} m of baseboard around the rooms, less doorways; casing on both sides of ${allDoors.length} doors.`,
    parts: [part("baseboard_mdf", "MDF baseboard", base, WASTE.trim), part("casing_mdf", "MDF casing", casing, WASTE.trim)],
    labour: { rate: "lab_trim", qty: (base + casing) * FT },
  });

  // ---- Paint ----
  const wallsPaint = Math.max(0, board - ceilingArea);
  add({
    id: "paint_walls",
    trade: "paint",
    item: "Prime and paint the walls",
    qty: wallsPaint * FT2,
    unit: "sq ft",
    basis: "A primer coat on the new board, then two coats.",
    parts: [part("primer", "Drywall primer", wallsPaint * FT2, WASTE.paint), part("paint_walls", "Wall paint", 2 * wallsPaint * FT2, WASTE.paint)],
    labour: { rate: "lab_paint_walls", qty: wallsPaint * FT2 },
  });
  add({
    id: "paint_ceiling",
    trade: "paint",
    item: "Prime and paint the ceilings",
    qty: ceilingArea * FT2,
    unit: "sq ft",
    basis: "A primer coat on the new board, then two coats of flat ceiling white.",
    parts: [part("primer", "Drywall primer", ceilingArea * FT2, WASTE.paint), part("paint_ceiling", "Ceiling paint", 2 * ceilingArea * FT2, WASTE.paint)],
    labour: { rate: "lab_paint_ceiling", qty: ceilingArea * FT2 },
  });

  // ---- Kitchen ----
  for (const k of kitchens) {
    const run = counterRun(k);
    const units = Math.max(2, Math.round(run / 0.762));
    add({
      id: `kitchen_${k.id}`,
      trade: "kitchen",
      item: `${k.name}: cabinets, counter, sink and faucet`,
      qty: run * FT,
      unit: "lf of counter",
      basis: `${r1(run)} m of counter along the kitchen's longest wall: ${units} base and ${units} wall cabinets.`,
      parts: [
        part("cabinet_base_30", "30\" base cabinets", units, 0, 1),
        part("cabinet_wall_30", "30\" wall cabinets", units, 0, 1),
        part("countertop_8ft", "Laminate countertop, 8 ft", run, 0.05, 2.44),
        part("kitchen_sink", "Kitchen sink", 1, 0, 1),
        part("kitchen_faucet", "Kitchen faucet", 1, 0, 1),
      ],
      labour: { rate: "lab_cabinets", qty: 2 * units },
    });
  }

  // ---- Bathroom ----
  for (const b of baths) {
    add({
      id: `bath_${b.id}`,
      trade: "bathroom",
      item: `${b.name}: toilet, vanity, tub and surround`,
      qty: 1,
      unit: "bathroom",
      basis: "A toilet, a basin and a tub or shower (9.31.4.1), set and connected.",
      parts: [part("toilet", "Toilet", 1, 0, 1), part("vanity", "Vanity with top", 1, 0, 1), part("bath_faucet", "Bathroom faucet", 1, 0, 1), part("tub", "Alcove tub", 1, 0, 1), part("tub_walls", "Tub surround", 1, 0, 1)],
      labour: { rate: "lab_plumber", qty: 12 },
    });
  }

  // ---- Permits and fees ----
  const slug = opts.municipality ?? "waterloo-on";
  const fee = catalog.fees?.permit[slug] ?? null;
  // The suite's floor and its fee, as every other page prints them (server/model/suite.ts).
  const suiteM2 = suiteAreaM2(design) ?? 0;
  const permit = fee ? feeFor(fee, suiteM2) : null;
  const suiteFt2 = permit?.sqft ?? sqftOf(suiteM2);
  lines.push(
    feeLine("permit_building", "Building permit", suiteFt2, "sq ft", permit == null ? null : { low: money(permit.amount), high: money(permit.amount) }, fee ? { kind: "fee", title: fee.title, url: fee.url, checked: fee.checked } : null, fee ? `${fee.perUnitCAD ? `$${fee.perUnitCAD} for the new unit plus ` : ""}$${fee.perSqftCAD.toFixed(2)} per sq ft of the suite (${areaText(suiteM2)})${fee.minimumCAD ? `, $${fee.minimumCAD} minimum` : ""}${fee.estimate ? "; the City confirms the exact fee" : ""}.` : "This municipality's permit fee isn't in our data yet: ask its building department."),
  );
  const esa = catalog.fees?.esa ?? null;
  const outlets = devices + lights + P.alarms.length + baths.length;
  const band = esa?.homeowner.find((b) => b.upTo == null || outlets <= b.upTo) ?? null;
  const contractor = esa?.contractor ?? null;
  const esaLine = feeLine(
    "permit_esa",
    "Electrical permit (ESA notification)",
    outlets,
    "outlets",
    contractor ? { low: contractor.lowCAD, high: contractor.highCAD } : null,
    contractor ? { kind: "fee", title: contractor.publisher, url: contractor.url, checked: contractor.checked } : null,
    `About ${outlets} outlets. A contractor pulls it at the contractor rate; you pay the homeowner rate${band ? ` ($${band.CAD})` : ""} if you wire it yourself.`,
  );
  if (band && esa) esaLine.diy = { low: band.CAD, high: band.CAD };
  lines.push(esaLine);

  // ---- Designer and engineer ----
  const beamMoved = model.existing.fixtures.filter((f) => f.kind === "beam").some((f) => {
    const now = P.fixtures.find((g) => g.id === f.id);
    return !now || Math.hypot(now.at[0] - f.at[0], now.at[1] - f.at[1]) > 0.05;
  });
  const designer = line({ id: "pro_design", trade: "pros", item: "Drawings: a designer, or a BCIN designer's review of yours", qty: 1, unit: "job", basis: "You may draw your own house's permit set (owner-exempt, Schedule 1 \"Homeowner\"); cities strongly recommend a designer.", labour: { rate: "pack_designer", qty: 1 } });
  designer.diy = { low: 0, high: designer.high };
  lines.push(designer);
  add({ id: "pro_hvac", trade: "pros", item: "HVAC heat-loss calculation and design (BCIN)", qty: 1, unit: "job", basis: "Sizes the heating and ventilation for the second unit (CSA F280).", labour: { rate: "hvac_design", qty: 1 }, pro: true });
  if (newWindows.length || beamMoved)
    add({ id: "pro_engineer", trade: "pros", item: "Structural engineer's letter and lintel detail", qty: 1, unit: "job", basis: newWindows.length ? "A new opening in the foundation wall needs a lintel the engineer designs." : "A beam or post moves.", labour: { rate: "engineer_egress", qty: 1 }, pro: true });

  // Building it yourself, the escape window still needs a concrete cutter (the installed price has one).
  const cut = rate("concrete_cutting");
  for (const l of lines)
    if (l.id.startsWith("egress_") && cut) {
      l.diy = { low: l.material.low + cut.lowCAD, high: l.material.high + cut.highCAD };
      l.sources.push(src(cut));
    }

  return { ...total(lines, assumptions), furniture: furnish(P.furniture ?? []) };
}

const FURNITURE_LABEL: Record<string, string> = {
  bed: "Bed (frame and mattress)",
  sofa: "Sofa",
  armchair: "Armchair",
  desk: "Desk",
  dining: "Dining table and 4 chairs",
  dresser: "Dresser",
  tv: "TV and console",
  rug: "Rug",
  shelf: "Bookshelf",
  fridge: "Fridge",
  washer_dryer: "Washer and dryer",
  coffee_table: "Coffee table",
  nightstand: "Nightstand",
  other: "Other furniture",
};
// Built in, so priced with the trades: the kitchen with its cabinets, the bathroom with its fixtures.
const IN_BUILD: Record<string, string> = { kitchen: "Kitchen cabinets and counter", vanity: "Vanity", toilet: "Toilet", shower: "Tub and shower" };
// Two small pieces are "other" in the model, told apart by their id (as server/model/furniture.ts does).
const pieceOf = (f: Pick<Furniture, "kind" | "id">) => (f.kind !== "other" ? f.kind : /coffee-table/.test(f.id) ? "coffee_table" : /nightstand/.test(f.id) ? "nightstand" : "other");

function furnish(pieces: Furniture[]): FurnitureQuote {
  const counts = new Map<string, number>();
  const inBuild = new Set<string>();
  for (const f of pieces) {
    const k = pieceOf(f);
    if (IN_BUILD[k]) inBuild.add(IN_BUILD[k]);
    else counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const lines: FurnitureLine[] = [...counts].map(([k, n]) => {
    const p = furniturePrice(k);
    const label = FURNITURE_LABEL[k] ?? FURNITURE_LABEL.other;
    if (!p) return { id: k, label, count: n, price: null, low: 0, high: 0, basis: "No shelf price found for this piece.", sources: [] };
    return {
      id: k,
      label,
      count: n,
      price: { low: p.lowCAD, high: p.highCAD },
      low: money(n * p.lowCAD),
      high: money(n * p.highCAD),
      basis: p.basis,
      sources: p.listings.map((l) => ({ kind: "material" as const, title: `${l.product} (${l.retailer})`, url: l.url, checked: l.checked, store: l.retailer })),
    };
  });
  const subtotal = { low: sum(lines, (l) => l.low), high: sum(lines, (l) => l.high) };
  const hst = { low: money((subtotal.low * catalog.hstPct) / 100), high: money((subtotal.high * catalog.hstPct) / 100) };
  return { lines, subtotal, hst, total: { low: subtotal.low + hst.low, high: subtotal.high + hst.high }, missing: lines.filter((l) => !l.price).map((l) => l.label), inBuild: [...inBuild] };
}

// The kitchen counter runs along the kitchen's longest side.
function counterRun(k: Room) {
  let best = 0;
  for (let i = 0; i < k.polygon.length; i++) best = Math.max(best, Math.hypot(k.polygon[(i + 1) % k.polygon.length][0] - k.polygon[i][0], k.polygon[(i + 1) % k.polygon.length][1] - k.polygon[i][1]));
  return Math.min(best, 4.2);
}

function feeLine(id: string, item: string, qty: number, unit: string, amount: Range | null, source: Source | null, basis: string): QuoteLine {
  const a = amount ?? { low: 0, high: 0 };
  return { id, trade: "permits", item, qty: r1(qty), unit, basis, parts: [], material: { low: 0, high: 0 }, labour: amount, labourSource: source, low: a.low, high: a.high, diy: { ...a }, pro: true, taxed: false, missing: amount ? [] : ["the fee"], sources: source ? [source] : [] };
}

function total(lines: QuoteLine[], assumptions: string[]): Omit<Quote, "furniture"> {
  const byTrade: TradeTotal[] = TRADES.map((t) => {
    const ls = lines.filter((l) => l.trade === t.id);
    return { trade: t.id, label: t.label, low: sum(ls, (l) => l.low), high: sum(ls, (l) => l.high), diyLow: sum(ls, (l) => l.diy.low), diyHigh: sum(ls, (l) => l.diy.high), lines: ls };
  }).filter((t) => t.lines.length);
  const all = byTrade.flatMap((t) => t.lines);
  const building = all.filter((l) => l.trade !== "permits" && l.trade !== "pros");
  const taxed = all.filter((l) => l.taxed);
  const pct = catalog.hstPct;
  const subtotal = { low: sum(all, (l) => l.low), high: sum(all, (l) => l.high) };
  const contingency = { low: money(sum(building, (l) => l.low) * CONTINGENCY.low), high: money(sum(building, (l) => l.high) * CONTINGENCY.high) };
  const hst = { low: money(((sum(taxed, (l) => l.low) + contingency.low) * pct) / 100), high: money(((sum(taxed, (l) => l.high) + contingency.high) * pct) / 100) };
  const diySub = { low: sum(all, (l) => l.diy.low), high: sum(all, (l) => l.diy.high) };
  const diyCont = { low: money(sum(building, (l) => l.diy.low) * CONTINGENCY.low), high: money(sum(building, (l) => l.diy.high) * CONTINGENCY.high) };
  const diyHst = { low: money(((sum(taxed, (l) => l.diy.low) + diyCont.low) * pct) / 100), high: money(((sum(taxed, (l) => l.diy.high) + diyCont.high) * pct) / 100) };
  const hired = { low: subtotal.low + contingency.low + hst.low, high: subtotal.high + contingency.high + hst.high };
  const label = new Map(TRADES.map((t) => [t.id, t.label]));
  return {
    totalLow: hired.low,
    totalHigh: hired.high,
    byTrade,
    subtotal,
    contingency: { ...contingency, pctLow: CONTINGENCY.low * 100, pctHigh: CONTINGENCY.high * 100 },
    hst: { ...hst, pct },
    hired,
    diy: { low: diySub.low + diyCont.low + diyHst.low, high: diySub.high + diyCont.high + diyHst.high, contingency: diyCont, hst: diyHst },
    missing: all.flatMap((l) => l.missing.map((m) => `${label.get(l.trade)}: ${m}`)),
    assumptions,
    checked: catalog.compiledAt,
  };
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
