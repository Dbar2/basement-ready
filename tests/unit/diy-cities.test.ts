// What needs a licensed pro, and who may do which work, for the house's own city only (the Fable QA
// review, Oct 30, #10: a Waterloo house was shown Kitchener's and Cambridge's rules).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diyPlan } from "../../server/diy/plan";
import { ontarioDiy } from "../../server/permit/data";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const CITIES = ["Waterloo", "Kitchener", "Cambridge"];
// Everything a person reads about an item: its words, its caveat and the pages it cites.
const said = (x: { detail: string; notes?: string; source: { title: string; section?: string | null; url: string }; citySource: { title: string; section?: string | null; url: string } | null }) =>
  [x.detail, x.notes ?? "", x.source.title, x.source.section ?? "", x.source.url, x.citySource?.title ?? "", x.citySource?.section ?? "", x.citySource?.url ?? ""].join(" ");
const others = (city: string | null) => CITIES.filter((c) => c !== city);

function shown(municipality: string) {
  const plan = diyPlan(sample, {}, municipality);
  return { plan, items: [...plan.needsPro, ...plan.trades] };
}

describe("what needs a licensed pro, by city", () => {
  it("keeps every city's rules out of the Ontario-wide wording", () => {
    const d = ontarioDiy();
    for (const x of [...d.needsPro, ...d.trades]) {
      const { cities: _c, ...base } = x;
      expect(JSON.stringify(base), x.id).not.toMatch(/Waterloo|Kitchener|Cambridge/);
    }
  });

  it("shows a Waterloo house Waterloo's rules, and no other city's", () => {
    const { plan, items } = shown("waterloo-on");
    for (const x of items) for (const c of others("Waterloo")) expect(said(x), `${x.id} names ${c}`).not.toContain(c);
    expect(plan.needsPro.find((n) => n.id === "plumbing")!.detail).toContain("Waterloo's guides don't say, so ask the City first.");
    expect(plan.needsPro.find((n) => n.id === "egress_cut")!.detail).not.toContain(`3'-11"`);
  });

  it("shows a Kitchener house Kitchener's rules, and no other city's", () => {
    const { plan, items } = shown("kitchener-on");
    for (const x of items) for (const c of others("Kitchener")) expect(said(x), `${x.id} names ${c}`).not.toContain(c);
    const cut = plan.needsPro.find((n) => n.id === "egress_cut")!;
    expect(cut.detail).toContain(`Kitchener puts the line at a 3'-11" cut.`);
    expect(cut.citySource).toMatchObject({ url: "https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf", section: "p. 18" });
    expect(plan.needsPro.find((n) => n.id === "separate_heating")!.detail).toContain("Kitchener asks for a BCIN HVAC designer's Schedule 1");
    expect(plan.needsPro.find((n) => n.id === "plumbing")!.detail).toContain("Kitchener lets an owner who lives at the house do it.");
  });

  it("shows a Cambridge house Cambridge's rules, and no other city's", () => {
    const { plan, items } = shown("cambridge-on");
    for (const x of items) for (const c of others("Cambridge")) expect(said(x), `${x.id} names ${c}`).not.toContain(c);
    const heat = plan.needsPro.find((n) => n.id === "separate_heating")!;
    expect(heat.detail).toContain("Cambridge lists heat loss/gain calculations");
    expect(heat.citySource?.url).toBe("https://www.cambridge.ca/business-building-development/building-planning/building-permits/");
  });

  it("shows a house elsewhere in Ontario only the province's wording", () => {
    for (const municipality of ["ontario", "Guelph"]) {
      const { plan, items } = shown(municipality);
      for (const x of items) {
        for (const c of CITIES) expect(said(x), `${municipality}: ${x.id} names ${c}`).not.toContain(c);
        expect(x.citySource, `${municipality}: ${x.id}`).toBeNull();
      }
      expect(plan.needsPro.find((n) => n.id === "plumbing")!.detail).toBe("Plumbing is a compulsory trade and the regulation lists no homeowner exemption: hire a licensed plumber unless your City says you may do it yourself.");
    }
  });
});
