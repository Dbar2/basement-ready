// What a City examiner marks on a basement second-unit set when it's missing, now on ours: the numbered
// notes on the unit 2 plan, the U.P.O. calculation on each window elevation, the zoning parking statement
// on the site plan, and for Kitchener its standard details by number and the water meter option.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { permitModel } from "../../server/permit/model";
import { buildPermitPackage, permitStatus } from "../../server/permit/package";
import type { StoredState } from "../../server/workspace";
import { readPdf } from "../e2e/support/pdf";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const profile = { owners: [{ first: "Sam", last: "Rivera" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2L 2C1" };
const base = { address: "The sample basement", profile, site: null, aerialJpeg: null, favourites: [], today: "2026-10-31", fetchPdf: async () => null };
const W1 = permitModel(sample, {})!.windows.find((w) => w.tag === "W1")!.id;

const set = async (municipality: string, state: StoredState = {}, copy: "review" | "submit" = "review") => {
  const out = await buildPermitPackage({ ...base, municipality, result: { ...sample, municipality }, state, copy });
  const pdf = await readPdf(out.bytes);
  const sheet = (n: string) => pdf.pages[pdf.sheets.find((s) => s.number === n)!.page - 1].text.replace(/\s+/g, " ");
  return { out, pdf, sheet, all: pdf.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ") };
};

// Every number the Permit tab asks for, answered (as tests/unit/permit-set.test.ts does).
function answered(municipality: string, state: StoredState = {}): StoredState {
  const result = { ...sample, municipality };
  const m = permitModel(result, state)!;
  const next: StoredState = {
    ...state,
    tape: { ceilingMm: 2085, beamMm: 1960, ...state.tape },
    permit: {
      ...state.permit,
      walls: m.mainWalls.map((w) => ({ id: w.id, mm: Math.round(w.scanM * 1000) })),
      windows: m.windows.map((w) => ({ id: w.id, widthMm: 610, heightMm: 762, sillMm: 1120 })),
      upstairs: { bedrooms: [{ floor: 1, at: [0.3, 0.7] }] },
      lotLines: m.windows.map((w) => ({ id: w.id, mm: 1800 })),
    },
  };
  const st = permitStatus({ ...base, municipality, result, state: next });
  next.permit!.reviewed = st.sheets.map((s) => ({ sheet: s.number, key: st.reviewKey }));
  return next;
}

describe("the examiner's notes on the unit 2 plan", () => {
  it("numbers each one on A2, in our words with its Code section, the full text on A7", async () => {
    const { sheet } = await set("waterloo-on");
    const a2 = sheet("A2");
    expect(a2).toContain("NOTES (FULL TEXT AND SOURCES ON A7)");
    for (const said of [
      "Smoke alarms in each bedroom and on each storey of both units: hard-wired, interconnected, each with a visual signal (9.10.19.)",
      "CO alarm next to each sleeping area",
      "Laundry hook-ups for both units",
      "Ceiling at least 1.95 m",
      "under beams and ducts",
      "best dropped to the floor",
      "Cooktop clearances",
      "grab bars",
      "Hot water at most 49 °C (7.2.10.7.)",
      "Bedroom escape window",
      "continuous to the underside of the floor above",
      "(7.6.1.3.(5))",
      "Electrical Safety Authority",
      "vapour barrier on the warm side",
      "Clothes dryer vented to the outdoors",
      "50 cfm",
    ])
      expect(a2, said).toContain(said);
    // Numbered, in order.
    const numbers = [...a2.matchAll(/(?:^| )(\d{1,2})\. /g)].map((m) => Number(m[1]));
    expect(numbers).toEqual(expect.arrayContaining([1, 2, 3, 10, 15]));
    expect(sheet("A7")).toContain("COOKTOP CLEARANCES");
    // No other city's details.
    expect(a2).not.toMatch(/9-17a|9-19/);
  });

  it("cites Kitchener's standard details by number in Kitchener", async () => {
    const { sheet } = await set("kitchener-on");
    expect(sheet("A2")).toContain("City standard detail 9-17a");
    expect(sheet("A2")).toContain("City standard detail 9-19 and Building Bulletin BB 2025-03");
    expect(sheet("A7")).toContain("City of Kitchener standard detail 9-17a, Means of Escape Window");
    expect(sheet("A6")).toContain("standard detail 9-17a");
  });
});

describe("U.P.O. on the window elevations", () => {
  it("works the enlarged window's face out from the lot line", async () => {
    const { sheet } = await set("waterloo-on", { permit: { windows: [{ id: W1, widthMm: 450, heightMm: 600, sillMm: 1200 }], lotLines: [{ id: W1, mm: 1800 }] } });
    const a5 = sheet("A5");
    expect(a5).toContain("U.P.O. (UNPROTECTED OPENINGS, 9.10.15.4)");
    expect(a5).toContain("Limiting distance 1.80 m");
    expect(a5).toMatch(/Exposing building face 7\.\d\d x \d\.\d\d m = \d+\.\d m²/);
    expect(a5).toContain("Permitted 1.80² = 3.24 m²");
    expect(a5).toContain("Proposed 0.46 m² (W1)");
    expect(a5).toMatch(/\bOK\b/);
  });

  it("says when the wall is too close for the glazing", async () => {
    const { sheet } = await set("waterloo-on", { permit: { windows: [{ id: W1, widthMm: 450, heightMm: 600, sillMm: 1200 }], lotLines: [{ id: W1, mm: 1100 }] } });
    expect(sheet("A5")).toContain("MORE THAN PERMITTED");
  });

  it("asks for the lot line in the review copy, and needs no sum where no glazing is added", async () => {
    const enlarged = await set("waterloo-on", { permit: { windows: [{ id: W1, widthMm: 450, heightMm: 600, sillMm: 1200 }] } });
    expect(enlarged.sheet("A5")).toContain("enter this wall's distance to the lot line on the Permit tab");
    expect(enlarged.out.readiness.items.some((i) => i.id === `lot:${W1}` && !i.done)).toBe(true);
    const asIs = await set("waterloo-on");
    expect(asIs.sheet("A5")).toContain("No glazing added or enlarged on this face");
  });
});

describe("the site plan's parking statement", () => {
  it("states the city's zoning requirement and by-law", async () => {
    expect((await set("waterloo-on")).sheet("A1")).toContain("Parking required by zoning (City of Waterloo Zoning By-law 2018-050)");
    const kitchener = (await set("kitchener-on")).sheet("A1");
    expect(kitchener).toContain("Parking required by zoning (City of Kitchener Zoning By-law 2019-051, Section 5 Parking)");
    expect(kitchener).not.toContain("PDF created");
  });
});

describe("Kitchener's water meter", () => {
  it("is asked for in Kitchener only, and stated on the site plan and the unit 2 plan", async () => {
    const waterloo = await set("waterloo-on");
    expect(waterloo.out.readiness.items.some((i) => i.id === "water")).toBe(false);
    expect(waterloo.all).not.toContain("Water meter (Kitchener Utilities");
    const asked = await set("kitchener-on");
    expect(asked.out.readiness.items.find((i) => i.id === "water")).toMatchObject({ group: "water", done: false });
    expect(asked.sheet("A1")).toContain("choose one meter for both units, or a meter for each unit in a meter room or an outside compartment, on the Permit tab");
    const chosen = await set("kitchener-on", { permit: { waterMeter: { option: "room", where: "the laundry room off the side entrance" } } });
    expect(chosen.out.readiness.items.find((i) => i.id === "water")?.done).toBe(true);
    for (const n of ["A1", "A2"]) expect(chosen.sheet(n)).toContain("multi-meter option, a meter for each unit in an interior meter room at the laundry room off the side entrance");
  });

  it("leaves nothing to fill in on Kitchener's submit copy", async () => {
    const state = answered("kitchener-on", { permit: { waterMeter: { option: "single", where: "unit 1's furnace room, reached by the shared stair" } } });
    const { out, all } = await set("kitchener-on", state, "submit");
    expect(out.readiness.left).toBe(0);
    for (const bad of ["Permit tab", "choose one meter", "enter this wall", "check it on site", "DRAFT"]) expect(all, bad).not.toContain(bad);
    expect(all).toContain("single meter option, one water meter for both units, at unit 1's furnace room");
  });
});
