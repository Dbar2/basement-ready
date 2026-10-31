// Spatial separation for windows (server/permit/spatial.ts): Table 9.10.15.4's percentages, read the safe
// way for the face's area and straight-line between limiting distances, and the limiting distance
// squared where that allows more.
import { describe, expect, it } from "vitest";
import { faceHeightM, permittedPercent, upo } from "../../server/permit/spatial";

describe("Table 9.10.15.4", () => {
  it("reads the table's own values", () => {
    expect(permittedPercent(10, 1.2)).toBe(8);
    expect(permittedPercent(30, 6)).toBe(88);
    expect(permittedPercent(100, 10)).toBe(84);
    expect(permittedPercent(500, 16)).toBe(92);
    expect(permittedPercent(500, 25)).toBe(100);
    expect(permittedPercent(500, 40)).toBe(100);
  });

  it("allows nothing under 1.2 m", () => {
    expect(permittedPercent(20, 1.19)).toBe(0);
    expect(upo(20, 1.0, 0.3)).toMatchObject({ permittedM2: 0, ok: false });
  });

  it("takes the next larger face row, and interpolates between distances", () => {
    // A 22.4 m² face reads on the 25 m² row; 2.6 m is a fifth of the way from 2.5 m (19%) to 3 m (26%).
    expect(permittedPercent(22.4, 2.6)).toBe(20.4);
    // Exactly on a row and a column.
    expect(permittedPercent(25, 3)).toBe(26);
    // Over 100 m².
    expect(permittedPercent(120, 7)).toBe(23.5);
  });

  it("allows the limiting distance squared where that's more, but never more than the face", () => {
    // 3 m out, a 40 m² face: the table gives 20% (8 m²); 3 m squared is 9 m².
    expect(upo(40, 3, 1)).toMatchObject({ percent: 20, permittedM2: 9, bySquare: true, ok: true });
    // A small face 6 m out: 100% of 12 m², not 36 m².
    expect(upo(12, 6, 2).permittedM2).toBe(12);
    // Too much glazing.
    expect(upo(22.4, 1.5, 3).ok).toBe(false);
  });

  it("measures a face from finished ground to the top storey's ceiling", () => {
    expect(faceHeightM(0.6, 1)).toBeCloseTo(3.04, 6);
    expect(faceHeightM(0.6, 2)).toBeCloseTo(5.74, 6);
  });
});
