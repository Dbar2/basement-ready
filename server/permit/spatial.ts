// Spatial separation for a house's windows (unprotected openings, "U.P.O."): how much glazing a wall may
// have, from its limiting distance (the wall to the lot line) and the area of its exposing building face
// (the wall from finished ground to the top storey's ceiling). The 2024 Building Code, Div. B
// Table 9.10.15.4, as printed in the 2024 Building Code Compendium (checked 2026-10-31); its 100 m² row
// carries no label in the web text and is the 100 m² row by its place in the table.
import type { Cite } from "./data";

export const UPO_SOURCE: Cite = {
  title: "2024 Building Code (O. Reg. 163/24), Div. B Part 9",
  url: "https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings",
  section: "9.10.15.4. and Table 9.10.15.4.",
  retrieved: "2026-10-31",
};

// Limiting distance columns (m); under 1.2 m no glazing is permitted without a rated closure.
const DISTANCES = [1.2, 1.5, 2, 2.5, 3, 4, 6, 8, 10, 12, 16, 20, 25];
// Maximum total area of exposing building face (m²) for each row; the last row is "over 100".
const AREAS = [10, 15, 20, 25, 30, 40, 50, 100, Infinity];
// Maximum aggregate area of glazed openings, % of the exposing building face, by row and column.
const PERCENT = [
  [8, 12, 21, 33, 55, 96, 100, 100, 100, 100, 100, 100, 100],
  [8, 10, 17, 25, 37, 67, 100, 100, 100, 100, 100, 100, 100],
  [8, 10, 15, 21, 30, 53, 100, 100, 100, 100, 100, 100, 100],
  [8, 9, 13, 19, 26, 45, 100, 100, 100, 100, 100, 100, 100],
  [7, 9, 12, 17, 23, 39, 88, 100, 100, 100, 100, 100, 100],
  [7, 8, 11, 15, 20, 32, 69, 100, 100, 100, 100, 100, 100],
  [7, 8, 10, 14, 18, 28, 57, 100, 100, 100, 100, 100, 100],
  [7, 8, 9, 11, 13, 18, 34, 56, 84, 100, 100, 100, 100],
  [7, 7, 8, 9, 10, 12, 19, 28, 40, 55, 92, 100, 100],
];

// The permitted percentage: the row for the face's area or the next larger (never interpolated down),
// and straight-line between the limiting distances either side of the wall's.
export function permittedPercent(faceM2: number, distanceM: number) {
  if (distanceM < DISTANCES[0]) return 0;
  const row = PERCENT[AREAS.findIndex((a) => faceM2 <= a + 1e-9)];
  if (distanceM >= DISTANCES[DISTANCES.length - 1]) return row[row.length - 1];
  const j = DISTANCES.findIndex((d, i) => distanceM >= d && distanceM < DISTANCES[i + 1]);
  const t = (distanceM - DISTANCES[j]) / (DISTANCES[j + 1] - DISTANCES[j]);
  return Math.round((row[j] + t * (row[j + 1] - row[j])) * 10) / 10;
}

export type Upo = {
  distanceM: number;
  faceM2: number;
  percent: number; // from the table
  permittedM2: number; // the larger of the table's and, from 1.2 m out, the limiting distance squared
  bySquare: boolean; // the limiting distance squared allowed more than the table
  proposedM2: number;
  ok: boolean;
};

// 9.10.15.4.(1): the table's area, or where the limiting distance is at least 1.2 m, glazing up to the
// limiting distance squared; never more than the face itself.
export function upo(faceM2: number, distanceM: number, proposedM2: number): Upo {
  const percent = permittedPercent(faceM2, distanceM);
  const byTable = (percent / 100) * faceM2;
  const square = distanceM >= DISTANCES[0] ? distanceM * distanceM : 0;
  const permittedM2 = Math.min(faceM2, Math.max(byTable, square));
  return { distanceM, faceM2, percent, permittedM2, bySquare: square > byTable, proposedM2, ok: proposedM2 <= permittedM2 + 1e-9 };
}

// The face of a wall: its length by the height from finished ground to the top storey's ceiling. A
// storey is taken as 2.7 m floor to floor with a 2.44 m ceiling on the top one; the house's walls above
// the basement aren't scanned, so the sheet says so.
export const STOREY_M = 2.7;
export const TOP_CEILING_M = 2.44;
export const faceHeightM = (aboveGradeM: number, storeys: number) => Math.max(0, aboveGradeM) + Math.max(0, storeys - 1) * STOREY_M + TOP_CEILING_M;
