// The permit set's numbers, checked against themselves and against every other page (the Fable QA
// review, Oct 30, findings 2, 3, 5 and 6): one escape window on A5 and A6, judged on its own size; the
// homes after the work; dimensions as long as their labels at the sheet's scale; one unit area and one
// fee everywhere; and the City form's filled-in values inside their cells.
import { readdirSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { decodePDFRawStream, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFTextField } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { buildBook } from "../../server/book/book";
import { diyPlan } from "../../server/diy/plan";
import { suggestLayout } from "../../server/layout";
import { currentModel } from "../../server/model/current";
import { chosenDesign } from "../../server/model/legacy";
import { areaText, sqftOf, suiteAreaM2 } from "../../server/model/suite";
import { FIELD_MAPS, fillAcroForm } from "../../server/permit/forms";
import { permitModel } from "../../server/permit/model";
import { buildPermitPackage } from "../../server/permit/package";
import { ptPerMetre } from "../../server/permit/pdf";
import { pricedSample } from "../../server/priced";
import { quote } from "../../server/quote/quote";
import { packFor } from "../../server/rules";
import { permitFee } from "../../server/steps";
import type { StoredState } from "../../server/workspace";
import { readPdf } from "../e2e/support/pdf";
import { chainMismatches, pageDrawing } from "./pdf-geometry";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const base = { municipality: "waterloo-on", address: "45 Avondale Ave S", profile: null, site: null, aerialJpeg: null, favourites: [], today: "2026-10-30", fetchPdf: async () => null };

const pdfOf = async (result: any, state: StoredState = {}) => readPdf((await buildPermitPackage({ ...base, result, state, copy: "review" })).bytes);
const sheet = (pdf: Awaited<ReturnType<typeof readPdf>>, n: string) => pdf.pages[pdf.sheets.find((s) => s.number === n)!.page - 1].text.replace(/\s+/g, " ");

// Every plan length times k: the example as a basement too big for one sheet, so A2 is cut into several.
function scaled(r: any, k: number) {
  const out = structuredClone(r);
  const plan = (p: any) => {
    if (!p) return;
    for (const key of ["minX", "maxX", "minZ", "maxZ"]) if (p.box?.[key] != null) p.box[key] *= k;
    for (const key of ["widthM", "depthM"]) if (p[key] != null) p[key] *= k;
    if (p.areaM2 != null) p.areaM2 *= k * k;
    for (const o of p.openings ?? []) o.atM *= k;
    for (const s of p.stairs ?? []) for (const key of ["x0", "z0", "x1", "z1"]) s[key] *= k;
    for (const f of p.fixtures ?? []) {
      f.x *= k;
      f.z *= k;
    }
  };
  plan(out.plan);
  for (const room of out.rooms ?? []) plan(room.plan);
  return out;
}

describe("the escape window", () => {
  it("is the same window on A5 and A6, and isn't called an escape window before its height is known", async () => {
    // The example's bedroom window: the scan saw it 450 mm wide, and nothing knows its height.
    const w1 = permitModel(sample, {})!.windows.find((w) => w.escape)!;
    expect(w1).toMatchObject({ widthM: 0.45, heightM: null, meets: null, change: "keep" });
    const pdf = await pdfOf(sample);
    const a5 = sheet(pdf, "A5"), a6 = sheet(pdf, "A6");
    expect(a5).toContain("W1: EXISTING WINDOW: ESCAPE SIZE TO BE TAPED");
    expect(a5).toContain('18" (450) wide, height to be taped');
    expect(a6).toContain('Clear opening 18" (450) wide; its height is to be taped');
    expect(a6).toContain("778 mm");
    // No invented height on either sheet (A5 drew 18"x24", A6 18"x30"), and no tick.
    for (const t of [a5, a6]) {
      expect(t).not.toMatch(/18"x\d+"/);
      expect(t).not.toContain("ESCAPE WINDOW 18");
      expect(t).not.toMatch(/\bmeets\b/);
    }
  });

  it("is enlarged on both sheets when its taped size is too small, and meets the rule at its new size", async () => {
    const id = permitModel(sample, {})!.windows.find((w) => w.escape)!.id;
    const pdf = await pdfOf(sample, { permit: { windows: [{ id, widthMm: 450, heightMm: 600, sillMm: 1200 }] } });
    const a5 = sheet(pdf, "A5"), a6 = sheet(pdf, "A6");
    expect(a5).toContain("W1: ENLARGED ESCAPE WINDOW");
    expect(a5).toContain('Existing 18"x24" (450x600) enlarged');
    expect(a6).toContain('Clear opening 24"x30" (610x760) = 0.46 m², at least 0.35 m²: meets');
  });

  it("is an existing escape window when its taped size meets the rule", async () => {
    const id = permitModel(sample, {})!.windows.find((w) => w.escape)!.id;
    const pdf = await pdfOf(sample, { permit: { windows: [{ id, widthMm: 610, heightMm: 762, sillMm: 1120 }] } });
    expect(sheet(pdf, "A5")).toContain("W1: EXISTING ESCAPE WINDOW");
    expect(sheet(pdf, "A6")).toContain("at least 0.35 m²: meets");
  });

  it("isn't ticked on the answer for sitting on the biggest window's wall", () => {
    const layout = suggestLayout(sample.plan);
    const check = layout.checks.find((c) => /escape window/i.test(c.label))!;
    expect(check.ok).toBeNull();
    expect(check.detail).toContain("45 cm wide");
    expect(check.detail).toContain("at least 78 cm tall");
    expect(check.detail).toContain("measure it");
    // The bedroom still keeps the window (it isn't priced as a new one).
    expect(layout.window?.inBedroom).toBe(true);
    const narrow = structuredClone(sample.plan);
    for (const o of narrow.openings) if (o.kind === "window") o.widthM = 0.3;
    expect(suggestLayout(narrow).checks.find((c) => /escape window/i.test(c.label))!.ok).toBe(false);
    // An answer saved with the old tick (the example's own) reads back without it, on both check lists.
    expect(sample.layout.checks.find((c: { label: string }) => /escape window/i.test(c.label)).ok).toBe(true);
    const priced = pricedSample(sample, {}) as typeof sample;
    for (const checks of [priced.layout.checks, priced.design.layout.checks]) {
      const c = checks.find((c: { label: string }) => /escape window/i.test(c.label));
      expect(c.ok).toBeNull();
      expect(c.detail).toContain("78 cm tall");
    }
  });
});

describe("the cover", () => {
  it("counts the homes after the work: the house and the basement unit", async () => {
    for (const [registered, line] of [
      [undefined, "2: the house (unit 1) and the basement unit (unit 2)"],
      [0, "2: the house (unit 1) and the basement unit (unit 2)"],
      [2, "3: the 2 homes there now and the basement unit (unit 3)"],
    ] as const) {
      const r = structuredClone(sample);
      r.property = { ...(r.property ?? {}), unitsRegistered: registered };
      expect(sheet(await pdfOf(r), "A0")).toContain(line);
    }
  });
});

describe("the plan's dimensions", () => {
  it("are as long as their labels at the sheet's scale, on one sheet and cut into several", async () => {
    for (const result of [sample, scaled(sample, 2.5)]) {
      const out = await buildPermitPackage({ ...base, result, state: {}, copy: "review" });
      const text = await readPdf(out.bytes);
      const drawing = await pageDrawing(out.bytes);
      const plans = out.sheets.filter((s) => /^A2/.test(s.number));
      if (result !== sample) expect(plans.length).toBeGreaterThan(1);
      let checked = 0;
      for (const s of plans) {
        const ratio = Number(/Scale 1:(\d+) on 11 x 17/.exec(text.pages[s.page].text)![1]);
        expect(ratio).toBeLessThanOrEqual(50);
        const r = chainMismatches(drawing[s.page], ptPerMetre(ratio));
        expect(r.out, `${s.number}`).toEqual([]);
        checked += r.checked;
      }
      expect(checked).toBeGreaterThan(5);
    }
  });
});

describe("one unit area and one fee", () => {
  it("is the same on the cover, the forms, the fee, the steps, the quote, the book and the materials", async () => {
    const model = currentModel(sample, {}, "sample")!.model;
    const design = chosenDesign(model)!;
    const area = suiteAreaM2(design)!;
    expect(area).toBeGreaterThan(20);
    const fee = permitFee(packFor("waterloo-on").pack, area)!;
    expect(fee.note).toContain(`for about ${sqftOf(area)} sq ft`);

    // The permit set: the cover's unit 2 floor, and the fee on the submit page.
    const pdf = await pdfOf(sample);
    expect(sheet(pdf, "A0")).toContain(areaText(area));
    const all = pdf.pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ");
    expect(all).toContain(`About $${fee.amount!.toLocaleString("en-CA")}.`);
    expect(all).toContain(`for about ${sqftOf(area)} sq ft`);
    // Nothing on another floor: not the scan's plan (449 sq ft for the example), not a sampled outline.
    expect(all).not.toContain(`about ${sqftOf(sample.plan.areaM2)} sq ft`);

    // The steps the answer, Money and the brief show.
    const priced = pricedSample(sample, {});
    const step = priced.steps.find((s: { id: string }) => s.id === "permit");
    expect(step).toMatchObject({ costLow: fee.amount, costHigh: fee.amount });
    expect(step.costNote).toContain(`for about ${sqftOf(area)} sq ft`);

    // The quote (the book prices from it), and the book's cover.
    const q = quote(model, design, { municipality: "waterloo-on" });
    const permitLine = q.byTrade.flatMap((t) => t.lines).find((l) => l.id === "permit_building")!;
    expect(permitLine.low).toBe(fee.amount);
    expect(permitLine.qty).toBe(sqftOf(area));
    expect(permitLine.basis).toContain(areaText(area));
    const book = await readPdf((await buildBook({ address: "The sample basement", municipality: "waterloo-on", result: priced, model, pictures: [], mood: [], today: "2026-10-30" })).bytes);
    expect(book.pages[0].text.replace(/\s+/g, " ")).toContain(areaText(area));

    // The materials plan's building permit.
    const diy = diyPlan(sample, {}, "waterloo-on");
    expect(diy.permits.find((p) => p.id === "building_permit")?.lowCAD).toBe(fee.amount);
  });
});

describe("the City's form", () => {
  it("draws every filled-in value inside its cell", async () => {
    // The City of Waterloo's permit application with Schedule 1 (a committed copy, tests/fixtures/replay).
    const dir = "tests/fixtures/replay";
    const saved = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`${dir}/${f}`, "utf8"))).find((e) => /permit-application/.test(e.route));
    const form = new Uint8Array(gunzipSync(readFileSync(`${dir}/${saved.bodyFile}`)));
    const values = { street: "The sample basement", municipality: "Waterloo", postalCode: "N2L 2C1", legal: "PLAN 1234 LOT 56", ownerNames: "Sam Rivera", email: "sam@example.com", phone: "519-555-0100", date: "2026-10-30" };
    const filled = await fillAcroForm(form, FIELD_MAPS.schedule_1, values as never);
    const doc = await PDFDocument.load(filled.bytes);
    let checked = 0;
    for (const name of Object.keys(filled.set)) {
      const field = doc.getForm().getField(name);
      if (!(field instanceof PDFTextField)) continue;
      for (const w of field.acroField.getWidgets()) {
        const ap = w.dict.lookup(PDFName.of("AP"), PDFDict)?.lookup(PDFName.of("N"));
        if (!(ap instanceof PDFRawStream)) continue;
        const ops = Buffer.from(decodePDFRawStream(ap).decode()).toString("latin1");
        const size = Number(/([\d.]+) Tf/.exec(ops)![1]);
        const baselines = [...ops.matchAll(/1 0 0 1 [\d.-]+ ([\d.-]+) Tm/g)].map((m) => Number(m[1]));
        const clip = /([\d.-]+) ([\d.-]+) m\n[\d.-]+ ([\d.-]+) l\n[\d.-]+ [\d.-]+ l\n[\d.-]+ [\d.-]+ l\nh\nW/.exec(ops)!;
        const [bottom, top] = [Number(clip[2]), Number(clip[3])].sort((a, b) => a - b);
        // Helvetica's capitals rise 0.72 of the size and its descenders drop 0.21.
        for (const y of baselines) {
          expect(y - 0.21 * size, `${name}: bottom of its text`).toBeGreaterThanOrEqual(bottom - 0.75);
          expect(y + 0.72 * size, `${name}: top of its text`).toBeLessThanOrEqual(top + 0.25);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});
