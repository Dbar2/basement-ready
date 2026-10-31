// The second unit's floor area and its building-permit fee: one answer for every screen and the permit
// set. The answer's steps, Money, the brief, the book, the quote, the materials plan and the drawings
// all read these, so a suite is never 30.9 m² in one place and 32 m² in another, or its fee worked on
// another floor. Pure, so the studio's live quote uses them too.
import { polygonArea } from "./geometry";
import type { Design } from "./types";

export const SQFT_PER_M2 = 10.7639;

// Unit 2's rooms, less the stairs and the furnace room: the floor that's finished and lived in, to the
// nearest 0.1 m² (what every page prints).
export function suiteAreaM2(design: Pick<Design, "proposed"> | null | undefined): number | null {
  const rooms = (design?.proposed.rooms ?? []).filter((r) => r.unit === 2 && r.kind !== "stairs" && r.kind !== "mechanical");
  if (!rooms.length) return null;
  return Math.round(rooms.reduce((s, r) => s + polygonArea(r.polygon), 0) * 10) / 10;
}

export const sqftOf = (m2: number) => Math.round(m2 * SQFT_PER_M2);

// "31.8 m² (342 sq ft)".
export const areaText = (m2: number) => `${m2.toFixed(1)} m² (${sqftOf(m2).toLocaleString("en-CA")} sq ft)`;

// A city's permit rate (data/rules/*.json permitFee, mirrored in the quote's catalog).
export type FeeRate = { perUnitCAD?: number; perSqftCAD: number; minimumCAD?: number; extrasCAD?: number };

// The fee on that floor: the same square feet the page prints, the same rounding everywhere.
export function feeFor(rate: FeeRate, areaM2: number) {
  const sqft = sqftOf(areaM2);
  return { sqft, amount: Math.max(rate.minimumCAD ?? 0, Math.round((rate.perUnitCAD ?? 0) + rate.perSqftCAD * sqft + (rate.extrasCAD ?? 0))) };
}
