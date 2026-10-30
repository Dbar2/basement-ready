// The QA reviewer's findings (scripts/qa/schema.ts): what the model must return, how findings rank,
// how boxes map back onto the screenshots, and what a run may spend.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Budget, costOf, estimate, imageTokens } from "../../scripts/qa/cost";
import { toShotBox } from "../../scripts/qa/review";
import { ConsistencyReview, Finding, jsonSchema, rank, Report, ScreenReview } from "../../scripts/qa/schema";

const good = {
  summary: "The verdict and costs read clearly; the plan label overlaps the 3D.",
  verdict: "fail",
  findings: [{ severity: "P1", category: "polish", title: "Label over the 3D", what: "The area label sits on the stairs.", where: "the 3D view, top left", fix: "Anchor the label to the room's centre.", image: 2, box: { x: 10, y: 20, w: 300, h: 80 } }],
};

const finding = (o: Partial<Finding>): Finding => ({
  id: "x",
  source: "opus",
  screen: "studio",
  shot: null,
  shots: [],
  browser: null,
  viewport: null,
  severity: "P2",
  category: "polish",
  title: "t",
  what: "w",
  where: "w",
  fix: "f",
  box: null,
  crop: null,
  screenshot: null,
  cached: false,
  ...o,
});

describe("finding schema", () => {
  it("accepts a well-formed screen review", () => {
    expect(ScreenReview.parse(good).findings[0].severity).toBe("P1");
  });

  it("rejects unknown severities, categories and extra fields", () => {
    expect(ScreenReview.safeParse({ ...good, findings: [{ ...good.findings[0], severity: "P3" }] }).success).toBe(false);
    expect(ScreenReview.safeParse({ ...good, findings: [{ ...good.findings[0], category: "vibes" }] }).success).toBe(false);
    expect(ScreenReview.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(ScreenReview.safeParse({ ...good, findings: [{ ...good.findings[0], box: { x: 1, y: 2, w: 3 } }] }).success).toBe(false);
  });

  it("accepts a clean screen with no findings", () => {
    expect(ScreenReview.parse({ summary: "Clean.", verdict: "pass", findings: [] }).findings).toEqual([]);
  });

  it("gives the API a closed schema with every field required", () => {
    for (const t of [ScreenReview, ConsistencyReview]) {
      const walk = (s: any) => {
        if (s && typeof s === "object") {
          if (s.type === "object") {
            expect(s.additionalProperties).toBe(false);
            expect([...(s.required ?? [])].sort()).toEqual(Object.keys(s.properties ?? {}).sort());
          }
          for (const v of Object.values(s)) walk(v);
        }
      };
      const schema = jsonSchema(t);
      expect(schema.$schema).toBeUndefined();
      expect(JSON.stringify(schema)).not.toMatch(/"(minimum|maximum|pattern|format)"/);
      walk(schema);
    }
  });

  it("ranks P0 first, then what's wrong before how it looks, then the model before the free checks", () => {
    const list = [
      finding({ id: "a", severity: "P2", category: "correctness" }),
      finding({ id: "b", severity: "P1", category: "polish" }),
      finding({ id: "c", severity: "P1", category: "correctness", source: "auto" }),
      finding({ id: "d", severity: "P1", category: "correctness" }),
      finding({ id: "e", severity: "P0", category: "brand" }),
    ].sort(rank);
    expect(list.map((f) => f.id)).toEqual(["e", "d", "c", "b", "a"]);
  });

  it("holds a whole report to its shape", () => {
    const r = {
      run: "r",
      createdAt: new Date().toISOString(),
      commit: null,
      baseURL: "http://localhost",
      scans: ["sample"],
      mode: "capture only",
      reviewer: null,
      model: "claude-opus-5-5",
      budgetUsd: 3,
      costUsd: 0,
      calls: { made: 0, cached: 0, skipped: 0 },
      screens: [{ screen: "studio", title: "Studio", status: "not reviewed", summary: "", counts: { P0: 0, P1: 0, P2: 1 }, shots: ["studio.chromium.desktop"], reviewed: "skipped (no key)" }],
      findings: [finding({})],
      shots: [{ id: "studio.chromium.desktop", screen: "studio", file: "shots/studio.chromium.desktop.png", browser: "chromium", viewport: "desktop", camera: null, notes: [] }],
    };
    expect(Report.parse(r).findings).toHaveLength(1);
    expect(Report.safeParse({ ...r, mode: "maybe" }).success).toBe(false);
  });
});

describe("boxes back onto the screenshot", () => {
  it("undoes the downscale and the tile offset", () => {
    // A phone shot (780 px wide) sent at 0.75 scale, as its second tile (starting 1688 px down).
    expect(toShotBox({ x: 75, y: 150, w: 300, h: 75 }, { scale: 0.75, offsetY: 1688 }, { w: 780, h: 6000 })).toEqual({ x: 100, y: 1888, w: 400, h: 100 });
  });

  it("stays inside the shot", () => {
    const b = toShotBox({ x: -20, y: 900, w: 5000, h: 5000 }, { scale: 1, offsetY: 0 }, { w: 1280, h: 1000 });
    expect(b.x).toBe(0);
    expect(b.x + b.w).toBeLessThanOrEqual(1280);
    expect(b.y + b.h).toBeLessThanOrEqual(1000);
  });
});

describe("cost control", () => {
  it("prices images like the API: about w×h/750 tokens, capped", () => {
    expect(imageTokens(1280, 800)).toBe(1366);
    expect(imageTokens(4000, 4000)).toBe(4784);
  });

  it("prices usage at Opus 5.5 rates, cache reads cheap", () => {
    expect(costOf({ input_tokens: 1_000_000, output_tokens: 0 })).toBeCloseTo(4);
    expect(costOf({ input_tokens: 0, output_tokens: 1_000_000 })).toBeCloseTo(20);
    expect(costOf({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(estimate([{ w: 1280, h: 800 }], "x".repeat(3600), 1000)).toBeCloseTo((1366 + 1000) * 4e-6 + 1000 * 20e-6, 6);
  });

  it("never lets parallel calls pass the cap", () => {
    const b = new Budget(0.2);
    expect(b.hold(0.08)).toBe(true);
    expect(b.hold(0.08)).toBe(true);
    expect(b.hold(0.08)).toBe(false); // 0.24 would pass the cap
    b.settle(0.08, 0.03);
    expect(b.hold(0.08)).toBe(true); // 0.03 spent + 0.16 held
    expect(b.left).toBeCloseTo(0.01);
  });
});

describe("the reviewer stays out of the app", () => {
  // The app may only call Meta models: nothing it ships may import the QA harness or the Anthropic SDK.
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|mjs)$/.test(f) ? [p] : [];
    });

  it("src/ and server/ never import scripts/qa or @anthropic-ai/sdk", () => {
    for (const f of [...files("src"), ...files("server")]) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/["'][^"']*scripts\/qa[^"']*["']|@anthropic-ai\/|api\.anthropic\.com|ANTHROPIC_API_KEY/);
    }
  });

  it("the SDK is a dev dependency only", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(pkg.dependencies["@anthropic-ai/sdk"]).toBeUndefined();
    expect(pkg.devDependencies["@anthropic-ai/sdk"]).toBeDefined();
  });
});

describe("free checks on PDF text", () => {
  it("catches 'you qualify', leaked values and internal statistics", async () => {
    const { lintText } = await import("../../scripts/qa/lint");
    const rules = lintText("Money you may get\nMultigenerational home tax credit   You qualify\nArea NaN m²\n80% confidence").map((i) => i.rule);
    expect(rules).toEqual(expect.arrayContaining(["you-qualify", "leaked-value", "internal-stats"]));
    expect(lintText("Looks eligible if the suite is for your mom.")).toEqual([]);
  });
});
