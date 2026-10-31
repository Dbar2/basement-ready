// Kitchener's water-meter question (Building Bulletin BB 2026-04): asked only for a Kitchener house, a
// readiness item until it's answered, and the answer printed on the submit copy's A1 and A2.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { permitModel } from "../../server/permit/model";
import { buildPermitPackage, NotReady, permitStatus } from "../../server/permit/package";
import type { StoredState } from "../../server/workspace";
import { readPdf } from "../e2e/support/pdf";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const profile = { owners: [{ first: "Sam", last: "Rivera" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2G 1A1" };
const base = { address: "45 Avondale Ave S", profile, site: null, aerialJpeg: null, favourites: [], today: "2026-10-31", fetchPdf: async () => null };
const SINGLE = "Water meter (Kitchener Utilities; City of Kitchener Building Bulletin BB 2026-04): single meter option, one water meter for both units, at unit 1's furnace room.";

// Every other item answered and each sheet looked over, for this city.
function answered(municipality: string, permit: StoredState["permit"] = {}): StoredState {
  const m = permitModel(sample, {})!;
  const next: StoredState = {
    tape: { ceilingMm: 2085, beamMm: 1960 },
    permit: {
      walls: m.mainWalls.map((w) => ({ id: w.id, mm: Math.round(w.scanM * 1000) })),
      windows: m.windows.map((w) => ({ id: w.id, widthMm: 610, heightMm: 762, sillMm: 1120 })),
      upstairs: { bedrooms: [{ floor: 1, at: [0.3, 0.7] }] },
      lotLines: m.windows.map((w) => ({ id: w.id, mm: 1800 })),
      ...permit,
    },
  };
  const st = permitStatus({ municipality, result: sample, state: next, profile });
  next.permit!.reviewed = st.sheets.map((s) => ({ sheet: s.number, key: st.reviewKey }));
  return next;
}

const sheetText = (pdf: Awaited<ReturnType<typeof readPdf>>, n: string) =>
  pdf.sheets
    .filter((s) => s.number === n || s.number.startsWith(`${n}.`))
    .map((s) => pdf.pages[s.page - 1].text.replace(/\s+/g, " "))
    .join(" ");

describe("Kitchener's water meter", () => {
  it("is asked of a Kitchener house, and holds back the submit copy until it's answered", async () => {
    const state = answered("kitchener-on");
    const st = permitStatus({ municipality: "kitchener-on", result: sample, state, profile });
    expect(st.readiness.items.filter((i) => !i.done).map((i) => i.id)).toEqual(["water"]);
    await expect(buildPermitPackage({ ...base, municipality: "kitchener-on", result: sample, state, copy: "submit" })).rejects.toBeInstanceOf(NotReady);
  });

  it("prints the answer on the submit copy's site plan and unit plan", async () => {
    const state = answered("kitchener-on", { waterMeter: { option: "single", where: "unit 1's furnace room" } });
    expect(permitStatus({ municipality: "kitchener-on", result: sample, state, profile }).readiness.left).toBe(0);
    const pdf = await readPdf((await buildPermitPackage({ ...base, municipality: "kitchener-on", result: sample, state, copy: "submit" })).bytes);
    expect(sheetText(pdf, "A1")).toContain(SINGLE);
    expect(sheetText(pdf, "A2")).toContain(SINGLE);
  });

  it("isn't asked of a Waterloo house, and isn't printed on its set", async () => {
    const state = answered("waterloo-on");
    const st = permitStatus({ municipality: "waterloo-on", result: sample, state, profile });
    expect(st.readiness.items.some((i) => i.id === "water")).toBe(false);
    expect(st.readiness.left).toBe(0);
    const pdf = await readPdf((await buildPermitPackage({ ...base, municipality: "waterloo-on", result: sample, state, copy: "submit" })).bytes);
    for (const n of ["A1", "A2"]) expect(sheetText(pdf, n)).not.toContain("Water meter");
  });
});
