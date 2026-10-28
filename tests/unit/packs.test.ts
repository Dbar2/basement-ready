import { describe, expect, it } from "vitest";
import { buildResult } from "../../server/assess";
import { coreRules, MUNICIPALITIES, packFor } from "../../server/rules";

const waterlooCore = coreRules(packFor("waterloo-on").pack).map((r) => r.id).sort();

describe.each(Object.keys(MUNICIPALITIES))("rules pack %s", (slug) => {
  const coverage = packFor(slug);

  it("loads as a fully researched city", () => {
    expect(coverage.coverage).toBe("full");
    expect(coverage.city).toBe(MUNICIPALITIES[slug]);
  });

  it("has the same core building-code rules as Waterloo", () => {
    const core = coreRules(coverage.pack).map((r) => r.id).sort();
    for (const id of waterlooCore.filter((id) => !id.startsWith("zoning_"))) expect(core).toContain(id);
  });

  it("cites a source for every rule and grant", () => {
    for (const r of coverage.pack.rules) expect(r.source?.url, r.id).toMatch(/^https?:\/\//);
    for (const g of coverage.pack.grants) expect(g.source?.url, g.id).toMatch(/^https?:\/\//);
  });

  it("flags the cancelled federal suite loan", () => {
    expect(coverage.pack.grants.find((g) => g.id === "canada_secondary_suite_loan_program")?.status).toBe("cancelled");
  });

  it("produces an answer", () => {
    const r = buildResult({ household: "relative", municipality: slug }, coverage, { findings: [] }, []);
    expect(r.city).toBe(MUNICIPALITIES[slug]);
    expect(r.findings.length).toBeGreaterThan(5);
    expect(r.process.length).toBeGreaterThan(0);
  });
});
