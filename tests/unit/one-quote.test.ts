// One quote, one list of fixes, one voice. Every cost the homeowner sees (the answer, the layout
// cards, the studio, the brief, the book and its PDF) is the quote for the design they picked; the tax
// credit is worked from it; the headline, What has to change and the answer's checks count the same
// fixes; and nothing tells them they "qualify" or are "approved".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountBook } from "../../server/book/routes";
import { evaluateMoney } from "../../server/eligibility";
import { checkDesign } from "../../server/model/checks";
import { currentModel } from "../../server/model/current";
import { applyEdits } from "../../server/model/edit";
import { chosenDesign } from "../../server/model/legacy";
import type { Design, Model } from "../../server/model/types";
import { CHECK_CATEGORY, fixCount } from "../../server/model/fixes";
import { answersIn, pricedSample } from "../../server/priced";
import { quote } from "../../server/quote/quote";
import { packFor } from "../../server/rules";
import { mountWorkspace } from "../../server/workspaceRoutes";
import { quoteFor } from "../../src/studio/cost";
import { readPdf } from "../e2e/support/pdf";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const seeded = currentModel(sample, {})!.model;
const pick = (m: Model, layout: Design["layout"]): Model => ({ ...m, designs: m.designs.map((d) => ({ ...d, chosen: d.layout === layout })) });

const app = new Hono();
mountBook(app, async () => null);
mountWorkspace(app, async () => null);
const post = async (path: string, body: unknown) => (await app.request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

describe("one quote on every screen", () => {
  for (const layout of ["one_bedroom", "studio"] as const) {
    it(`the answer, the layouts, the studio, the book, its PDF and the money agree (${layout})`, async () => {
      const model = pick(seeded, layout);
      const design = chosenDesign(model)!;
      const q = quote(model, design, { municipality: sample.municipality });
      const totals = [q.totalLow, q.totalHigh];

      // The answer (and so the brief and the layouts' side panel): /api/scans/:id and /api/recheck.
      const answer = pricedSample(sample, { model });
      expect([answer.cost.low, answer.cost.high]).toEqual(totals);
      expect(answer.cost.design).toBe(design.name);
      // The layout card and the studio work the same quote in the browser, for the answer's city.
      const studio = quoteFor(model, design, answer.municipality);
      expect([studio.totalLow, studio.totalHigh]).toEqual(totals);
      // The book on screen, and its PDF.
      const book = await post("/api/sample/book", { state: { model } });
      expect([book.quote.totalLow, book.quote.totalHigh]).toEqual(totals);
      expect(book.municipality).toBe(answer.municipality);

      // The tax credit is worked from that quote, not the rules' rough sum.
      const { pack } = packFor(answer.municipality);
      const money = evaluateMoney(pack, { household: answer.household, answers: answersIn(answer) as never, property: answer.property ?? null, costHigh: q.totalHigh });
      const credit = (gs: { id: string; amountCAD: number | null }[]) => gs.find((g) => g.id === "federal_mhrtc")?.amountCAD;
      expect(credit(answer.grants)).toBe(credit(money.programs));
      expect(credit(answer.grants)).not.toBe(credit(sample.grants));
      expect(answer.money.total).toBe(money.total);
      // The book's money list is the answer's.
      expect(book.money.map((g: { id: string }) => g.id)).toEqual(answer.grants.filter((g: { qualify: string }) => g.qualify !== "no").map((g: { id: string }) => g.id));
    });
  }

  it("the permit form's value of work and the build step are the same quote", async () => {
    const model = pick(seeded, "studio");
    const q = quote(model, chosenDesign(model)!, { municipality: sample.municipality });
    const status = await post("/api/sample/diy", { state: { model } });
    expect([status.totals.hiredLow, status.totals.hiredHigh]).toEqual([q.totalLow, q.totalHigh]);
    // Built yourself: the Build tab's total is the book's, the quote's own (not the shopping list's sum).
    const book = await post("/api/sample/book", { state: { model } });
    expect([status.totals.diyLow, status.totals.diyHigh]).toEqual([q.diy.low, q.diy.high]);
    expect([book.quote.diy.low, book.quote.diy.high]).toEqual([q.diy.low, q.diy.high]);
    expect(q.diy.high - q.diy.low).toBeGreaterThan(1000);
    const build = pricedSample(sample, { model }).steps.find((s: { id: string }) => s.id === "build");
    expect([build.costLow, build.costHigh]).toEqual([q.totalLow, q.totalHigh]);
  });
});

describe("one list of fixes", () => {
  // The example's one-bedroom with its bedroom window gone: the design puts a new escape window in.
  const withNewWindow = (): Model => {
    const d = chosenDesign(seeded)!;
    const bed = d.proposed.rooms.find((r) => r.kind === "bedroom" && r.unit === 2)!;
    const windows = d.proposed.openings.filter((o) => o.kind === "window");
    let next = applyEdits(d, windows.map((o) => ({ op: "remove_opening" as const, openingId: o.id })));
    const escape = checkDesign(next, seeded.existing).find((c) => c.id === `escape:${bed.id}`)!;
    next = applyEdits(next, escape.fix!.edits);
    return { ...seeded, designs: seeded.designs.map((x) => (x.id === d.id ? next : x)) };
  };

  it("the example as it is: the rules' fixes and the design's (the duct under 1.85 m), counted the same in the headline", () => {
    const answer = pricedSample(sample, {});
    expect(answer.fixGroups.filter((g) => !g.fromDesign).map((g) => g.category)).toEqual(sample.fixGroups.map((g: { category: string }) => g.category));
    // The duct the scan measured at 1.62 m clear is a fix, in the rules' words, not priced yet.
    const duct = answer.fixGroups.find((g) => g.fromDesign && g.category === "height")!;
    expect(duct).toMatchObject({ ruleIds: ["clearance_beams_ducts_suite"], priced: false });
    expect(duct.why.join(" ")).toMatch(/1\.6\d m/);
    expect(answer.headline).toMatch(new RegExp(`after ${answer.fixGroups.length} fixes`));
  });

  // Every screen that counts fixes: the headline (the answer, layouts, brief and book carry it), What has
  // to change (answer and brief list r.fixGroups), the layout cards and the studio (fixCount in the
  // browser), and the book and its PDF.
  for (const [name, make] of [
    ["the example, one bedroom", () => pick(seeded, "one_bedroom")],
    ["the example, studio", () => pick(seeded, "studio")],
    ["a design that adds an escape window", () => withNewWindow()],
  ] as const) {
    it(`one count on every screen: ${name}`, async () => {
      const model = make();
      const answer = pricedSample(sample, { model });
      const n = answer.fixGroups.length;
      expect(answer.headline).toMatch(new RegExp(`after ${n} fix(es)?\\.`));
      const base = answer.fixGroups.filter((g) => !g.fromDesign);
      for (const d of model.designs) {
        // What a card shows is what the headline would say with that design picked.
        const other = pricedSample(sample, { model: { ...model, designs: model.designs.map((x) => ({ ...x, chosen: x.id === d.id })) } });
        expect(fixCount(base, d, model.existing)).toBe(other.fixGroups.length);
      }
      expect(fixCount(base, chosenDesign(model)!, model.existing)).toBe(n);
      const book = await post("/api/sample/book", { state: { model } });
      expect(book.headline).toBe(answer.headline);
      const res = await app.request("/api/sample/book.pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { model } }) });
      const pdf = await readPdf(new Uint8Array(await res.arrayBuffer()));
      expect(pdf.pages.map((p) => p.text).join("\n").replace(/\s+/g, " ")).toContain(`after ${n} fix`);
    });
  }

  it("the design checks' rule categories are the packs'", () => {
    for (const city of ["waterloo-on", "kitchener-on", "cambridge-on", "ontario-on"]) {
      const { pack } = packFor(city);
      for (const [ruleId, category] of Object.entries(CHECK_CATEGORY)) expect(pack.rules.find((r) => r.id === ruleId)?.category, `${city} ${ruleId}`).toBe(category);
    }
  });

  it("a new escape window in the design is a fix: listed once, counted in the headline, priced from the quote", () => {
    const model = withNewWindow();
    const answer = pricedSample(sample, { model });
    const egress = answer.fixGroups.filter((g) => g.category === "egress");
    expect(egress).toHaveLength(1);
    // The rules' fixes, the new window and the duct.
    expect(answer.fixGroups.length).toBe(sample.fixGroups.length + 2);
    expect(answer.headline).toBe(`Yes, your basement can be a second home after ${answer.fixGroups.length} fixes.`);
    const q = quote(model, chosenDesign(model)!, { municipality: sample.municipality });
    const lines = q.byTrade.flatMap((t) => t.lines).filter((l) => l.id.startsWith("egress_"));
    expect([egress[0].costLow, egress[0].costHigh]).toEqual([lines.reduce((s, l) => s + l.low, 0), lines.reduce((s, l) => s + l.high, 0)]);
    // The answer's checks are the design's: its escape window, met. No "(in your fixes)" from an old layout.
    const checks = (answer as { design?: { layout: { checks: { label: string; ok: boolean | null; detail: string }[] } } }).design!.layout.checks;
    expect(checks.find((c) => /escape window/.test(c.label))?.ok).toBe(true);
    expect(JSON.stringify(checks)).not.toMatch(/in your fixes/);
  });

  it("a design whose sleeping place has no way out yet lists the escape window as a fix, not priced", () => {
    const d = chosenDesign(seeded)!;
    const noWindow = applyEdits(d, d.proposed.openings.filter((o) => o.kind === "window").map((o) => ({ op: "remove_opening" as const, openingId: o.id })));
    const model = { ...seeded, designs: seeded.designs.map((x) => (x.id === d.id ? noWindow : x)) };
    const answer = pricedSample(sample, { model });
    const egress = answer.fixGroups.find((g) => g.category === "egress")!;
    expect(egress.priced).toBe(false);
    expect(egress.why.join(" ")).toMatch(/escape window/);
    expect(answer.headline).toMatch(new RegExp(`after ${answer.fixGroups.length} fixes`));
  });

  it("the rules' own escape-window fix isn't listed twice", () => {
    const model = withNewWindow();
    const egressRule = sample.findings.find((f: { ruleId: string }) => f.ruleId === "egress_window_bedroom_area");
    const failing = { ...sample, findings: sample.findings.map((f: { ruleId: string }) => (f === egressRule ? { ...f, status: "likely_fix", fix: { description: "Enlarge it", costLowCAD: 3000, costHighCAD: 6000, costSource: null } } : f)), baseFindings: undefined };
    const answer = pricedSample(failing, { model });
    expect(answer.fixGroups.filter((g) => g.category === "egress")).toHaveLength(1);
  });
});

// ---- The voice: "looks eligible if…", "a designer will confirm"; never "qualify" or "approved" ----

const BANNED = /\b(qualify|qualifies|approved)\b/i;
// Facts about someone else, not about the homeowner: the lenders CMHC approves, a product's own name
// ("CGSB Approved Vapour Barrier"), and links.
const THIRD_PARTY = [/CMHC[- ]approved lenders?/gi, /Approved Lenders/g, /CGSB Approved/gi, /https?:\/\/\S+/g];
const offending = (text: string) =>
  text
    .split(/\n|(?<=[.!?])\s+/)
    .filter((line) => BANNED.test(THIRD_PARTY.reduce((t, re) => t.replace(re, ""), line)));
// Every text a response carries (its values, not its field names, such as `qualify: "yes"`).
const textsIn = (v: unknown): string[] => (typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap(textsIn) : v && typeof v === "object" ? Object.values(v).flatMap(textsIn) : []);

// The words on the screens: string literals and JSX text in the app's screens and components.
function screenCopy(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...screenCopy(path));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    const src = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const literals = [...src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`|>([^<>{}]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4] ?? "");
    for (const l of literals) for (const bad of offending(l)) out.push(`${path}: ${bad.trim()}`);
  }
  return out;
}

describe("nothing says they qualify or are approved", () => {
  it("in the screens' copy", () => {
    // The legal pages explain that we never say it; the rest of the app mustn't.
    const found = ["src/screens", "src/flow", "src/book", "src/components", "src/studio", "src/views", "src/ideas"].flatMap(screenCopy);
    expect(found).toEqual([]);
  });

  it("in what the server says on the answer, the money tab, the permit tab, the build tab and the book", async () => {
    const state = { model: pick(seeded, "one_bedroom") };
    const answer = pricedSample(sample, state);
    const texts = textsIn([
      { findings: answer.findings, fixGroups: answer.fixGroups, standard: answer.standard, grants: answer.grants, steps: answer.steps, moneyQuestions: answer.moneyQuestions },
      await post("/api/sample/apply", { state }),
      await post("/api/sample/permit/status", { state }),
      await post("/api/sample/diy", { state }),
      await post("/api/sample/book", { state }),
    ]);
    expect(texts.flatMap(offending)).toEqual([]);
  });

  it("in the book's PDF", async () => {
    const res = await app.request("/api/sample/book.pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state: { model: pick(seeded, "one_bedroom") } }) });
    expect(res.status).toBe(200);
    const pdf = await readPdf(new Uint8Array(await res.arrayBuffer()));
    expect(pdf.pageCount).toBeGreaterThan(5);
    expect(pdf.pages.flatMap((p) => offending(p.text))).toEqual([]);
    // And it says what we do say.
    expect(pdf.pages.map((p) => p.text).join("\n")).toMatch(/Looks eligible|Could be eligible/);
  });
});
