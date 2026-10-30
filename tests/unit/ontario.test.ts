// All of Ontario, honestly: any Ontario address gets Ontario's own rules under its real name, the
// Region's townships get the Region's loan too, Kitchener's zoning map is never queried, an address
// outside Ontario is told so, and every map layer the code still calls has an open licence on file.
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fromLocate, outsideOntario, resolveAddress, searchAddresses, searchOntario } from "../../server/address";
import { buildResult, instructions } from "../../server/assess";
import { diyPlan } from "../../server/diy/plan";
import { evaluateMoney } from "../../server/eligibility";
import { applications } from "../../server/apply/applications";
import { cityPermit, DEMO_ADDRESS } from "../../server/permit/data";
import { buildPermitPackage, formValues } from "../../server/permit/package";
import { LAYERS, lookupProperty, lookupSiteGeometry } from "../../server/property";
import { cleanAuthority, cleanMunicipality, packFor, shortName } from "../../server/rules";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));

// What NRCan's Geolocator answers for a Toronto address (shape copied from a real response, 2026-10-30).
const TORONTO = [
  { key: "locate", name: "100 Queen Street West, City Of Toronto, Ontario", province: "Ontario", category: "Street", lat: 43.6517543, lng: -79.382412, bbox: null, tag: ["INTERPOLATED_POSITION"] },
  { key: "locate", name: "Queen Street West, City Of Toronto, Ontario", province: "Ontario", category: "Street", lat: 43.65, lng: -79.39, bbox: null, tag: ["INTERPOLATED_CENTROID"] },
];
function geolocator(hits: unknown[]) {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify(hits), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("a Toronto address", () => {
  it("is found through NRCan and named Toronto", async () => {
    const { fetcher, calls } = geolocator(TORONTO);
    const r = await searchOntario("100 Queen St W, Toronto", 6, fetcher);
    expect(r.notCovered).toBeNull();
    expect(r.results).toEqual([
      { address: "100 Queen Street West", municipality: "Toronto", city: "on:City of Toronto", lon: -79.382412, lat: 43.651754, units: 0, source: "ontario" },
    ]);
    // Only NRCan's own source, never OpenStreetMap's.
    expect(calls[0]).toMatch(/^https:\/\/geolocator\.api\.geo\.ca\/\?q=.*&keys=locate&lang=en$/);
    // The picked address resolves to the same point, without another request.
    expect(await resolveAddress("100 Queen Street West", "Toronto", fetcher)).toMatchObject({ city: "on:City of Toronto", source: "ontario" });
    expect(calls).toHaveLength(1);
  });

  it("gets Ontario's rules under Toronto's name, with no Waterloo fee, designer list or grants", () => {
    const toronto = packFor("on:City of Toronto");
    expect(toronto).toMatchObject({ city: "Toronto", authority: "City of Toronto", coverage: "provincial" });
    expect(toronto.note).toMatch(/Toronto's own zoning/);
    const r = buildResult({ household: "renter", municipality: "on:City of Toronto" }, toronto, { findings: [] }, []);
    expect(r.city).toBe("Toronto");
    expect(r.authority).toBe("City of Toronto");
    // No permit fee: Ontario has no province-wide fee, and Waterloo's $392 + $0.62/sq ft never leaks in.
    const permit = r.steps.find((s) => s.id === "permit")!;
    expect(permit.costLow).toBeNull();
    expect(JSON.stringify(permit)).not.toMatch(/392|0\.62|waterloo/i);
    // Designers and gas fitters are searched near Toronto, not Waterloo.
    const drawings = r.steps.find((s) => s.id === "drawings")!;
    const links = drawings.tasks.flatMap((t) => t.links.map((l) => `${l.label} ${l.url}`)).join(" ");
    expect(links).toMatch(/Toronto/);
    expect(links).not.toMatch(/Waterloo/);
    expect(JSON.stringify(r.pros)).not.toMatch(/Waterloo/);
    // Only money anyone in Ontario can get.
    expect(r.grants.every((g) => g.level === "federal" || g.level === "provincial")).toBe(true);
    expect(JSON.stringify(r.steps)).not.toMatch(/the City(?! of Toronto)|Waterloo|your city/);
    expect(r.steps.find((s) => s.id === "before")!.tasks[0].title).toBe("Ask the City of Toronto to confirm zoning");
  });

  it("tells the model where the house is", () => {
    const prompt = instructions(packFor("on:City of Toronto"));
    expect(prompt).toContain("homeowners in Toronto, Ontario");
    expect(prompt).not.toMatch(/your city|Waterloo/);
    expect(instructions(packFor("ontario"))).toContain("homeowners in Ontario learn");
  });

  it("builds a permit package on Ontario's own form, as a draft brief for a designer", async () => {
    const urls: string[] = [];
    const out = await buildPermitPackage({
      result: { ...sample, property: { ...sample.property, address: "100 Queen Street West", municipality: "Toronto" } },
      municipality: "on:City of Toronto",
      address: "100 Queen Street West",
      profile: null,
      state: {},
      site: null,
      aerialJpeg: null,
      favourites: [],
      share: false,
      today: "2026-10-30",
      fetchPdf: async (url) => {
        urls.push(url);
        return null;
      },
    });
    // No owner-design statement where the city's own pages haven't said owners may draw.
    expect(out.signer).toBe("brief");
    expect(out.forms.map((f) => f.id)).toEqual(["on_application"]);
    expect(urls).toEqual([expect.stringMatching(/^https:\/\/www\.ontario\.ca\/files\/.*permit-to-construct/)]);
    // A review copy, with a designer still to choose before it can be submitted.
    expect(out.copy).toBe("review");
    expect(out.readiness.items.find((i) => i.id === "designer")?.done).toBe(false);
  });

  it("plans the do-it-yourself route with the City of Toronto's permit and the Code's inspections", () => {
    const plan = diyPlan(sample, {}, "on:City of Toronto");
    expect(plan.city).toBe("Toronto");
    expect(plan.permits.some((p) => p.id === "building_permit")).toBe(false);
    expect(plan.steps[0].detail).toMatch(/City of Toronto/);
    expect(plan.permit?.inspections.map((i) => i.id)).toContain("fire_separation");
    expect(cityPermit("on:City of Toronto").permit?.forms.map((f) => f.id)).toEqual(["on_application"]);
  });
});

describe("Kitchener", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is looked up without any call to the City's GIS, and points to its zoning map", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ features: [] }), { headers: { "content-type": "application/json" } });
    });
    const [a] = searchAddresses("1 Benninger Dr");
    expect(a).toMatchObject({ municipality: "Kitchener", city: "kitchener-on", source: "region" });
    const p = await lookupProperty(a);
    const site = await lookupSiteGeometry(a);
    expect(urls.length).toBeGreaterThan(0);
    // Only the Region's open building footprints; nothing from Kitchener's servers.
    for (const u of urls) expect(u.startsWith(LAYERS.footprints)).toBe(true);
    expect(urls.join(" ")).not.toMatch(/kitchener|OnPoint|cf51b9b72889410cb9ed4a6017ed0433/i);
    expect(p).toMatchObject({ zone: null, lotAreaM2: null, residential: null, inRegion: true });
    expect(p.zoningMap?.label).toBe("City of Kitchener zoning map");
    expect(site).toMatchObject({ parcel: null });
    expect(JSON.stringify(site)).not.toMatch(/legal|roll|pin/i);
  });
});

describe("outside Ontario", () => {
  it("a US address gets the not-covered answer without asking anyone", async () => {
    const { fetcher, calls } = geolocator([]);
    for (const q of ["1600 Pennsylvania Ave NW, Washington, DC 20500", "742 Evergreen Terrace, Springfield, IL", "350 Fifth Avenue, New York"]) {
      const r = await searchOntario(q, 6, fetcher);
      expect(r.results).toEqual([]);
      expect(r.notCovered).toMatchObject({ where: "the United States" });
      expect(r.notCovered!.message).toMatch(/covers Ontario.*demo house/);
    }
    expect(calls).toEqual([]);
  });

  it("another province's postal code, or only an out-of-province match, is said plainly", async () => {
    expect(outsideOntario("22 Rue Principale, Gatineau, QC J9H 3L5")?.where).toBe("Quebec");
    expect(outsideOntario("45 Elm Crescent, Ottawa K2H 7Z8")).toBeNull();
    const { fetcher } = geolocator([{ key: "locate", name: "120 King Street East, Saint John, New Brunswick", province: "New Brunswick", category: "Street", lat: 45.27, lng: -66.05, tag: ["INTERPOLATED_POSITION"] }]);
    const r = await searchOntario("120 King St E Saint John", 6, fetcher);
    expect(r.results).toEqual([]);
    expect(r.notCovered?.where).toBe("New Brunswick");
  });

  it("nothing found anywhere is an empty list, for the field to flag", async () => {
    const { fetcher } = geolocator([]);
    expect(await searchOntario("9999 Nowhere Rd", 6, fetcher)).toEqual({ results: [], notCovered: null });
  });
});

describe("Waterloo Region's townships", () => {
  it("get Ontario's rules plus the Region's loan, and no zoning promise", () => {
    const [a] = searchAddresses("1 Alpen Grove");
    expect(a).toMatchObject({ municipality: "Woolwich", city: "on:Township of Woolwich", source: "region" });
    const woolwich = packFor(a.city!);
    expect(woolwich).toMatchObject({ city: "Woolwich", authority: "Township of Woolwich", coverage: "provincial" });
    expect(woolwich.note).toMatch(/Region of Waterloo's own programs.*ask the Township/);
    const loan = woolwich.pack.grants.find((g) => g.id === "region_ontario_renovates_secondary_suites");
    expect(loan?.status).toBe("open");
    expect(loan.conditions.tenantIncomeLimit.householdCAD["1br"]).toBe(50500);
    expect(loan.conditions.stackableWith).toEqual([]);
    expect(woolwich.pack.grants.some((g) => g.level === "city")).toBe(false);
    // The zoning rules are the province's floor; no township by-law is claimed.
    for (const r of woolwich.pack.rules.filter((r) => r.category === "zoning")) expect(r.source.url).toMatch(/ontario\.ca\/laws/);
    const r = buildResult({ household: "renter", municipality: a.city! }, woolwich, { findings: [] }, [], null);
    expect(r.findings.find((f) => f.ruleId === "zoning_max_units")?.why).toBe("The Township of Woolwich confirms this for your lot.");
    const money = evaluateMoney(woolwich.pack, { household: "renter", answers: { rent: 1100, lives_there: true, other_home: false, house_value: true, work_started: false } });
    expect(money.programs.find((p) => p.id === "region_ontario_renovates_secondary_suites")?.qualify).toBe("yes");
  });

  it("Wellesley and Wilmot use the Region's lower income limits", () => {
    const wellesley = packFor("on:Township of Wellesley").pack.grants.find((g) => g.id === "region_ontario_renovates_secondary_suites");
    expect(wellesley.conditions.tenantIncomeLimit.householdCAD).toEqual({ bachelor: 31000, "1br": 41000, "2br": 52000, "3br": 42000 });
    expect(wellesley.conditions.tenantIncomeLimit.source.url).toMatch(/secondary-suite-fact-sheet\.pdf$/);
  });

  it("a city elsewhere never gets the Region's loan", () => {
    expect(packFor("on:City of Toronto").pack.grants.some((g) => g.level === "region")).toBe(false);
  });
});

describe("municipality names", () => {
  it("reads NRCan's capitals the way the municipality writes its name", () => {
    expect(cleanAuthority("City Of Greater Sudbury")).toBe("City of Greater Sudbury");
    expect(cleanAuthority("Town Of Niagara-On-The-Lake")).toBe("Town of Niagara-on-the-Lake");
    expect(cleanAuthority("Municipality Of Chatham-Kent")).toBe("Municipality of Chatham-Kent");
    expect(shortName("County of Prince Edward County")).toBe("Prince Edward County");
    expect(shortName("Norfolk County")).toBe("Norfolk County");
    expect(fromLocate({ key: "locate", name: "1 Queen Street, Town Of Niagara-On-The-Lake, Ontario", province: "Ontario", category: "Street", lat: 43.25, lng: -79.07, tag: ["INTERPOLATED_POSITION"] })).toMatchObject({
      municipality: "Niagara-on-the-Lake",
      city: "on:Town of Niagara-on-the-Lake",
    });
  });

  it("stores only a known pack, an Ontario place, or 'ontario'", () => {
    expect(cleanMunicipality("kitchener-on")).toBe("kitchener-on");
    expect(cleanMunicipality("on:city of toronto")).toBe("on:City of Toronto");
    expect(cleanMunicipality("other-on")).toBe("ontario");
    expect(cleanMunicipality("prices-on")).toBe("ontario");
    expect(cleanMunicipality("on:<script>")).toBe("on:Script");
    expect(packFor("ontario")).toMatchObject({ city: "Ontario", authority: "your municipality", coverage: "provincial" });
  });
});

describe("data licences", () => {
  const sources = readFileSync("data/rules/SOURCES.md", "utf8");
  const licences = sources.slice(sources.indexOf("## Data licences"), sources.indexOf("### Removed on 2026-10-30"));

  it("lists every map layer the code calls, with its licence", () => {
    const code = ["server/property.ts", "server/address.ts", "scripts/fetch-addresses.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    const called = [...code.matchAll(/https:\/\/[^\s"'`]*(arcgis|gis\.regionofwaterloo|geolocator)[^\s"'`]*/g)]
      .map((m) => m[0].replace(/\$\{AERIAL_YEAR\}/g, "2024").replace(/\/query$/, "").split("?")[0])
      .filter((u) => !u.includes("experience.arcgis.com"));
    expect(called.length).toBeGreaterThanOrEqual(5);
    for (const url of called) expect(licences, url).toContain(url);
    expect(licences).toMatch(/Region of Waterloo Open Data Licence v2\.0/);
    expect(licences).toMatch(/City of Cambridge Open Data License v2\.1/);
  });

  it("calls none of the removed layers", () => {
    const code = ["server/property.ts", "server/address.ts", "server/index.ts", "server/workspaceRoutes.ts"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(code).not.toMatch(/OnPoint_Int_Ext|Public_Operations|Property_Fabric|arcgispub03|Imagery_2026|PROPERTY_KITCHENER/);
  });
});

describe("the demo house", () => {
  it("says so on the papers instead of printing a blank address", async () => {
    const demo = { ...sample, demo: true };
    const out = await buildPermitPackage({ result: demo, municipality: "waterloo-on", address: "", profile: null, state: {}, site: null, aerialJpeg: null, favourites: [], share: true, today: "2026-10-30" });
    // The share copy: the eight drawing sheets, no forms.
    expect(out.pages).toBe(8);
    const values = formValues({ profile: null, address: "", result: demo, site: null, state: {} }, "Waterloo", "scope", 30, 1, "2026-10-30");
    expect(values.street).toBe(DEMO_ADDRESS);
    const apps = applications({ scanId: "x", result: { ...demo, grants: [{ id: "cmhc_refinance_secondary_suite", shortName: "CMHC refinance", qualify: "ask", status: "open", value: "financing", source: { title: "CMHC", url: "https://example.org" } }] }, profile: null, state: {}, address: "", municipality: "Waterloo", site: null, areaM2: 30, bedrooms: 1, scope: "scope" });
    expect(apps[0].email?.subject).toContain(DEMO_ADDRESS);
  });
});
