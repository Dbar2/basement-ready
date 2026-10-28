import { describe, expect, it } from "vitest";
import { buildResult } from "../../server/assess";
import type { Property } from "../../server/property";
import { isResidentialZone } from "../../server/property";
import { packFor } from "../../server/rules";

const waterloo = packFor("waterloo-on");
const cambridge = packFor("cambridge-on");

const house = (over: Partial<Property> = {}): Property => ({
  address: "120 Avondale Ave S",
  municipality: "Waterloo",
  city: "waterloo-on",
  lon: -80.52,
  lat: 43.45,
  zone: { code: "R1", label: "Residential One", bylaw: "By-law 2018-050" },
  residential: true,
  lotAreaM2: 389,
  building: { storeys: 1, footprintM2: 123, floorAreaM2: 123 },
  unitsRegistered: 0,
  sources: [],
  fetchedAt: "2026-10-28",
  ...over,
});

const find = (r: ReturnType<typeof buildResult>, id: string) => r.findings.find((f) => f.ruleId === id)!;

describe("public records answer the zoning questions", () => {
  it("a single house in a residential zone can add a suite, and is on City services", () => {
    const r = buildResult({ household: "relative", municipality: "waterloo-on", property: house() }, waterloo, { findings: [] }, []);
    expect(find(r, "zoning_max_units").status).toBe("likely_ok");
    expect(find(r, "zoning_max_units").why).toMatch(/R1.*one home.*makes 2.*up to 4/);
    expect(find(r, "zoning_municipal_services").status).toBe("likely_ok");
    expect(r.findings.filter((f) => f.status === "needs_answer")).toHaveLength(2);
  });

  it("Cambridge's limit of 3 homes counts the units already registered", () => {
    const full = house({ municipality: "Cambridge", city: "cambridge-on", zone: { code: "R2", label: "RESIDENTIAL 2", bylaw: null }, unitsRegistered: 3 });
    const r = buildResult({ household: "renter", municipality: "cambridge-on", property: full }, cambridge, { findings: [] }, []);
    expect(find(r, "zoning_max_units").status).toBe("likely_fix");
    expect(r.verdict).toBe("no");
  });

  it("without records, the City confirms zoning instead of asking the homeowner", () => {
    const r = buildResult({ household: "unsure", municipality: "waterloo-on", property: null }, waterloo, { findings: [] }, []);
    expect(find(r, "zoning_max_units").status).toBe("designer_checks");
    expect(find(r, "zoning_max_units").question).toBeNull();
  });

  it("a commercial zone is never treated as a house lot", () => {
    const r = buildResult({ household: "unsure", municipality: "waterloo-on", property: house({ zone: { code: "C2", label: null, bylaw: null }, residential: false }) }, waterloo, { findings: [] }, []);
    expect(find(r, "zoning_max_units").status).toBe("designer_checks");
  });
});

describe("residential zones", () => {
  it("knows the three cities' house zones", () => {
    for (const z of ["R1", "RN-6", "(H) RN-6", "RES-4", "R2", "RS1"]) expect(isResidentialZone(z)).toBe(true);
    for (const z of ["C2", "RMU-20", "RC1", "I1"]) expect(isResidentialZone(z)).toBe(false);
  });
});
