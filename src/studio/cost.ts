// Live cost in the studio. Session 4 is writing the real quote, a pure `quote(model, design)` in
// server/quote/ (labour and materials by trade, ranges, contingency, HST, a source per line). The
// studio only knows this shape, so swapping it in is one import in `quoteFor` below.
//
// Until then: materials only, counted from the design and priced from the dated shelf prices in
// data/rules/prices-on.json. Nothing is priced by guess; a line with no price is left out and named.
import prices from "../../data/rules/prices-on.json";
import { bounds, polygonArea, wallLength } from "../../server/model/geometry";
import type { Design, Model } from "../../server/model/types";

export type TradeCost = { trade: string; low: number; high: number };
export type Quote = { totalLow: number; totalHigh: number; byTrade: TradeCost[]; basis: string; missing: string[] };
export type QuoteFn = (model: Model, design: Design) => Quote;

type Item = { id: string; priceCAD: number; per?: number };
const ITEMS = new Map((prices.items as Item[]).map((i) => [i.id, i]));
const SERVICES = new Map((prices.services as { id: string; lowCAD: number; highCAD: number }[]).map((s) => [s.id, s]));
const SHEET_M2 = 2.973; // a 4 × 8 ft drywall sheet
const SQFT_M2 = 0.0929;

// Materials at the shelf price, plus up to 15% for waste and price changes.
const materialsOnly: QuoteFn = (model, design) => {
  const lines = new Map<string, number>();
  const missing: string[] = [];
  const add = (trade: string, id: string, qty: number) => {
    const item = ITEMS.get(id);
    if (!item) return void (missing.includes(id) || missing.push(id));
    lines.set(trade, (lines.get(trade) ?? 0) + Math.ceil(qty) * item.priceCAD);
  };
  const { walls, openings, rooms, alarms } = design.proposed;
  const h = model.existing.ceilingM ?? 2.3;
  const suite = rooms.filter((r) => r.unit === 2);
  const floor = suite.reduce((s, r) => s + polygonArea(r.polygon), 0);
  const fresh = walls.filter((w) => w.kind === "new");
  const freshM = fresh.reduce((s, w) => s + wallLength(w), 0);
  const ratedM = fresh.filter((w) => w.rating).reduce((s, w) => s + wallLength(w), 0);

  // Framing: studs at 16" plus top and bottom plates.
  add("Framing", "stud_2x4_8", freshM / 0.406 + (freshM * 2) / 2.44 + fresh.length);
  // Drywall: both faces of new walls, Type X where rated; the suite's ceiling in Type X.
  add("Drywall", "drywall_regular_12", ((freshM - ratedM) * h * 2) / SHEET_M2);
  add("Drywall", "drywall_typex_58", (ratedM * h * 2 + floor) / SHEET_M2);
  // The foundation walls around the suite: insulation behind the drywall.
  const b = suite.length ? bounds(suite.flatMap((r) => r.polygon)) : null;
  const perimeter = b ? 2 * (b.maxX - b.minX + (b.maxZ - b.minZ)) : 0;
  add("Insulation", "insul_r14_comfortbatt", (perimeter * h) / (59.7 * SQFT_M2));
  add("Drywall", "drywall_regular_12", (perimeter * h) / SHEET_M2);
  add("Flooring", "lvp_flooring", floor / (18.91 * SQFT_M2));
  const doors = openings.filter((o) => o.kind === "door" && o.status === "new");
  for (const d of doors) {
    if (d.rating) {
      add("Doors and trim", "door_solid_core", 1);
      add("Doors and trim", "door_closer", 1);
    } else add("Doors and trim", d.widthM > 0.78 ? "door_prehung_32" : "door_prehung_30", 1);
  }
  for (const a of alarms) add("Alarms", a.kind === "smoke" ? "alarm_smoke_hardwired" : a.kind === "co" ? "alarm_co_hardwired" : "alarm_combo_hardwired", 1);
  const newWindows = openings.filter((o) => o.kind === "window" && o.status === "new");
  for (let i = 0; i < newWindows.length; i++) {
    add("Escape window", "egress_window", 1);
    add("Escape window", "window_well", 1);
  }
  if (suite.some((r) => r.kind === "bathroom")) for (const id of ["toilet", "vanity", "bath_faucet", "tub", "tub_walls", "bath_fan"]) add("Bathroom", id, 1);
  const kitchen = suite.find((r) => r.kind === "kitchen");
  if (kitchen) {
    const kb = bounds(kitchen.polygon);
    const run = Math.max(kb.maxX - kb.minX, kb.maxZ - kb.minZ);
    add("Kitchen", "kitchen_sink", 1);
    add("Kitchen", "kitchen_faucet", 1);
    add("Kitchen", "cabinet_base_30", run / 0.762);
    add("Kitchen", "cabinet_wall_30", run / 0.762);
    add("Kitchen", "countertop_8ft", run / 2.44);
  }
  add("Paint", "paint_walls", ((freshM * 2 + perimeter) * h) / 37);
  add("Paint", "paint_ceiling", floor / 50);
  // Cutting a new escape window into the foundation: priced services with their own ranges.
  const extra = newWindows.length
    ? (["engineer_egress", "concrete_cutting"] as const).flatMap((id) => {
        const s = SERVICES.get(id);
        return s ? [{ low: s.lowCAD * newWindows.length, high: s.highCAD * newWindows.length }] : [];
      })
    : [];
  const byTrade: TradeCost[] = [...lines].map(([trade, v]) => ({ trade, low: Math.round(v), high: Math.round(v * 1.15) }));
  if (extra.length) {
    const ew = byTrade.find((t) => t.trade === "Escape window") ?? (byTrade.push({ trade: "Escape window", low: 0, high: 0 }), byTrade.at(-1)!);
    for (const x of extra) {
      ew.low += x.low;
      ew.high += x.high;
    }
  }
  return {
    totalLow: byTrade.reduce((s, t) => s + t.low, 0),
    totalHigh: byTrade.reduce((s, t) => s + t.high, 0),
    byTrade: byTrade.sort((a, b) => b.high - a.high),
    basis: `Materials only, at shelf prices checked ${prices.compiledAt}. Labour comes with the full quote.`,
    missing,
  };
};

export const quoteFor: QuoteFn = materialsOnly;

export const cad = (n: number) => `$${Math.round(n / 100) * 100 >= 1000 ? `${(Math.round(n / 100) / 10).toFixed(1)}k` : Math.round(n).toLocaleString("en-CA")}`;
