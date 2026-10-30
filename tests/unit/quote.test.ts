// Session 4: prices, the quote and the book. The quote is checked on the sample basement: every line
// has a source or says what's missing, the totals add up, an edit moves the right lines, and it's fast
// enough to rerun on every drag in the 3D studio. The catalog is checked against the rules packs it
// mirrors, the price refresh's filters against made-up actor rows, and the book against the pages it
// should have. Nothing here touches the network or spends money.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { buildBook } from "../../server/book/book";
import { renderIndex, renderKey, renderPrompt, reserveRender, restyleRender, type RenderWork } from "../../server/book/renders";
import type { Design, Model, Wall } from "../../server/model/types";
import { packFor } from "../../server/rules";
import { permitFee } from "../../server/steps";
import { storage } from "../../server/storage";
import { catalog } from "../../server/quote/catalog";
import { chosenDesign, modelFor } from "../../server/quote/fromScan";
import { quote, type Quote } from "../../server/quote/quote";
import { apply, keep, pick, TARGETS } from "../../scripts/refresh-prices";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const model = modelFor(sample, {})!;
const design = chosenDesign(model)!;
const lines = (q: Quote) => q.byTrade.flatMap((t) => t.lines);
const line = (q: Quote, id: string) => lines(q).find((l) => l.id === id)!;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe("the sample's model", () => {
  it("has a design with the suite, the stair enclosure and the alarms", () => {
    expect(design.proposed.rooms.some((r) => r.unit === 2 && r.kind === "bathroom")).toBe(true);
    expect(design.proposed.walls.some((w) => w.rating === "30min")).toBe(true);
    expect(design.proposed.openings.some((o) => o.rating === "20min")).toBe(true);
    expect(design.proposed.alarms.length).toBeGreaterThan(0);
  });
});

describe("quote", () => {
  const q = quote(model, design);

  it("prices every trade the suite needs", () => {
    const trades = q.byTrade.map((t) => t.trade);
    for (const t of ["framing", "insulation", "drywall", "electrical", "plumbing", "hvac", "doors_windows", "flooring_trim", "paint", "kitchen", "bathroom", "permits", "pros"]) expect(trades).toContain(t);
  });

  it("gives every line a source, or says what has no price", () => {
    for (const l of lines(q)) {
      for (const p of l.parts) {
        if (p.price) expect(p.source?.url, `${l.id}: ${p.name}`).toMatch(/^https:\/\//);
        else expect(l.missing, `${l.id}: ${p.name}`).toContain(p.name);
      }
      if (l.labour === null) expect(l.missing.some((m) => m === "labour" || m === "the fee")).toBe(true);
      else if (l.labour.high > 0) expect(l.labourSource?.url, l.id).toMatch(/^https:\/\//);
      expect(l.sources.length + l.missing.length, l.id).toBeGreaterThan(0);
      expect(l.basis.length, l.id).toBeGreaterThan(10);
    }
  });

  it("adds up: lines to trades to the subtotal, then contingency and HST to the totals", () => {
    for (const l of lines(q)) {
      expect(l.low).toBe(l.material.low + (l.labour?.low ?? 0));
      expect(l.high).toBe(l.material.high + (l.labour?.high ?? 0));
      expect(l.low).toBeLessThanOrEqual(l.high);
      // Building it yourself never costs more, except ESA's homeowner rate, which is above a contractor's.
      if (l.id !== "permit_esa") expect(l.diy.low).toBeLessThanOrEqual(l.low);
    }
    for (const t of q.byTrade) {
      expect(t.low).toBe(t.lines.reduce((s, l) => s + l.low, 0));
      expect(t.high).toBe(t.lines.reduce((s, l) => s + l.high, 0));
    }
    expect(q.subtotal.low).toBe(q.byTrade.reduce((s, t) => s + t.low, 0));
    expect(q.subtotal.high).toBe(q.byTrade.reduce((s, t) => s + t.high, 0));
    expect(q.hired.low).toBe(q.subtotal.low + q.contingency.low + q.hst.low);
    expect(q.hired.high).toBe(q.subtotal.high + q.contingency.high + q.hst.high);
    expect([q.totalLow, q.totalHigh]).toEqual([q.hired.low, q.hired.high]);
    const diySub = { low: q.byTrade.reduce((s, t) => s + t.diyLow, 0), high: q.byTrade.reduce((s, t) => s + t.diyHigh, 0) };
    expect(q.diy.low).toBe(diySub.low + q.diy.contingency.low + q.diy.hst.low);
    expect(q.diy.high).toBe(diySub.high + q.diy.contingency.high + q.diy.hst.high);
    // HST is 13% of the taxed lines and the contingency; permit fees carry none.
    const taxedLow = lines(q).filter((l) => l.taxed).reduce((s, l) => s + l.low, 0) + q.contingency.low;
    expect(Math.abs(q.hst.low - taxedLow * 0.13)).toBeLessThanOrEqual(1);
    expect(lines(q).filter((l) => l.trade === "permits").every((l) => !l.taxed)).toBe(true);
    // Building it yourself costs less than hiring it out.
    expect(q.diy.high).toBeLessThan(q.hired.high);
  });

  it("lists what has no price instead of guessing it", () => {
    for (const l of lines(q)) if (l.missing.includes("labour")) expect(l.labour).toBeNull();
    expect(q.missing.length).toBe(lines(q).reduce((n, l) => n + l.missing.length, 0));
  });

  it("a longer wall changes framing, insulation and drywall, and not the kitchen or the permit fee", () => {
    const d = clone(design);
    const w = d.proposed.walls.find((x) => x.id === "w_new_0")! as Wall;
    w.b = [w.b[0] + 1, w.b[1]]; // one metre longer
    const after = quote(model, d);
    expect(line(after, "framing").qty).toBeGreaterThan(line(q, "framing").qty);
    expect(line(after, "framing").high).toBeGreaterThan(line(q, "framing").high);
    expect(line(after, "drywall_board").qty).toBeGreaterThan(line(q, "drywall_board").qty);
    expect(line(after, "paint_walls").qty).toBeGreaterThan(line(q, "paint_walls").qty);
    expect(line(after, "insul_sound").qty).toBeGreaterThan(line(q, "insul_sound").qty); // a bathroom wall
    expect(line(after, "kitchen_r_kitchen_3")).toEqual(line(q, "kitchen_r_kitchen_3"));
    expect(line(after, "permit_building")).toEqual(line(q, "permit_building"));
    expect(after.totalHigh).toBeGreaterThan(q.totalHigh);
  });

  it("an extra door adds a door and its trim, and nothing to the plumbing", () => {
    const d = clone(design);
    d.proposed.openings.push({ id: "o_extra", wallId: "w_new_1", kind: "door", offsetM: 0.6, widthM: 0.76, heightM: 2.03, status: "new", swing: "left" });
    const after = quote(model, d);
    expect(line(after, "doors").qty).toBe(line(q, "doors").qty + 1);
    expect(line(after, "doors").labour!.low).toBeGreaterThan(line(q, "doors").labour!.low);
    expect(line(after, "trim").qty).toBeGreaterThan(line(q, "trim").qty);
    expect(line(after, "drywall_board").qty).toBeLessThan(line(q, "drywall_board").qty); // the hole
    expect(line(after, "rough_r_bathroom_2")).toEqual(line(q, "rough_r_bathroom_2"));
  });

  it("a new escape window brings the cut, the well and the engineer", () => {
    expect(lines(q).some((l) => l.id.startsWith("egress_"))).toBe(false);
    const d = clone(design);
    d.proposed.openings.push({ id: "o_new_window", wallId: "w_maxZ", kind: "window", offsetM: 2, widthM: 0.9, heightM: 1, sillM: 0.9, status: "new" });
    const after = quote(model, d);
    const egress = line(after, "egress_o_new_window");
    expect(egress.trade).toBe("doors_windows");
    expect(egress.high).toBeGreaterThanOrEqual(6000); // Caliber's installed range for Kitchener-Waterloo
    expect(line(after, "pro_engineer").pro).toBe(true);
    expect(egress.diy.low).toBeGreaterThan(egress.material.low); // the concrete cutter is still paid
  });

  it("uses the city's own permit fee", () => {
    const w = line(quote(model, design, { municipality: "waterloo-on" }), "permit_building");
    const k = line(quote(model, design, { municipality: "kitchener-on" }), "permit_building");
    expect(w.low).not.toBe(k.low);
    const unknown = line(quote(model, design, { municipality: "somewhere-on" }), "permit_building");
    expect(unknown.labour).toBeNull();
    expect(unknown.missing).toContain("the fee");
  });

  it("runs in well under 50 ms on the example", () => {
    quote(model, design);
    const t = performance.now();
    for (let i = 0; i < 20; i++) quote(model, design);
    expect((performance.now() - t) / 20).toBeLessThan(50);
  });

  it("runs in the browser: the quote reads its catalog as JSON, never from disk", () => {
    for (const f of ["server/quote/quote.ts", "server/quote/catalog.ts", "server/model/types.ts"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "node:|require\(|readFileSync/);
    }
  });
});

describe("price catalog", () => {
  it("dates and links every shelf price, and never prices what's missing", () => {
    for (const i of catalog.items) {
      expect(i.priceCAD, i.id).toBeGreaterThan(0);
      expect(i.url, i.id).toMatch(/^https:\/\//);
      expect(i.checked, i.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      for (const o of i.offers ?? []) {
        expect(o.priceCAD).toBeGreaterThan(0);
        if (o.retailer === "Home Depot Canada") {
          expect(o.sku, i.id).toMatch(/^\d{10}$/);
          expect(o.url, i.id).toMatch(/^https:\/\/www\.homedepot\.ca\//);
        }
      }
    }
    const ids = new Set(catalog.items.map((i) => i.id));
    for (const m of catalog.missing ?? []) expect(ids.has(m.id), m.id).toBe(false);
  });

  it("cites every labour and pro rate", () => {
    for (const r of [...catalog.services, ...(catalog.labour ?? [])]) {
      expect(r.url, r.id).toMatch(/^https:\/\//);
      expect(r.lowCAD, r.id).toBeLessThanOrEqual(r.highCAD);
      expect(r.checked, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("mirrors the rules packs' costs and permit fees exactly", () => {
    const costs = packFor("waterloo-on").pack.costs;
    for (const r of (catalog.labour ?? []).filter((x) => x.fromPack)) {
      const c = costs.find((x: any) => x.item === r.fromPack);
      expect(c, r.id).toBeTruthy();
      expect([r.lowCAD, r.highCAD, r.url]).toEqual([c.lowCAD, c.highCAD, c.source.url]);
    }
    for (const slug of ["waterloo-on", "kitchener-on", "cambridge-on"]) {
      const fee = catalog.fees!.permit[slug];
      const sqft = 400;
      const mine = Math.round(Math.max(fee.minimumCAD ?? 0, (fee.perUnitCAD ?? 0) + fee.perSqftCAD * sqft + (fee.extrasCAD ?? 0)));
      expect(mine, slug).toBe(permitFee(packFor(slug).pack, sqft / 10.7639)!.amount);
    }
    const esa = JSON.parse(readFileSync("data/rules/ontario-diy.json", "utf8")).electrical.esaHomeownerFees.bands;
    expect(catalog.fees!.esa.homeowner).toEqual(esa);
  });
});

describe("price refresh", () => {
  const row = (o: Record<string, unknown>) => ({ query: "5/8 type x drywall 4x8", name: "5/8-inch x 4 ft. x 8 ft. Type X Fire Rated Drywall", brand: "CGC", sku: "1000123456", price: 24.98, currency: "CAD", storeId: "7105", storeName: "Waterloo", storeProvince: "ON", url: "https://www.homedepot.ca/product/x/1000123456", position: 1, ...o });

  it("keeps only CAD rows at Ontario stores with a 10-digit SKU and a homedepot.ca link", () => {
    expect(keep(row({}))).toBe(true);
    expect(keep(row({ currency: "USD" }))).toBe(false);
    expect(keep(row({ storeProvince: "QC" }))).toBe(false);
    expect(keep(row({ sku: "123456789" }))).toBe(false);
    expect(keep(row({ url: "http://www.homedepot.ca/product/x/1000123456" }))).toBe(false);
    expect(keep(row({ url: "https://www.homedepot.com/p/x/1000123456" }))).toBe(false);
  });

  it("picks the matching product, prices it at each store, keeps the old entry and lists what wasn't found", () => {
    const rows = [
      row({ name: "1/2-inch x 4 ft. x 8 ft. Regular Drywall", sku: "1000000001", url: "https://www.homedepot.ca/product/a/1000000001", position: 1 }),
      row({ position: 2 }),
      row({ position: 2, storeId: "7011", storeName: "Kitchener", price: 25.48 }),
    ];
    const picks = pick(rows as any);
    const typeX = picks.find((p) => p.target.id === "drywall_typex_58")!;
    expect(typeX.best?.sku).toBe("1000123456");
    expect(typeX.offers.map((o) => o.storeId).sort()).toEqual(["7011", "7105"]);
    const cat = clone(catalog) as any;
    cat.items = cat.items.filter((i: any) => i.id !== "mixing_valve"); // as it was before the first refresh
    const before = cat.items.find((i: any) => i.id === "drywall_typex_58");
    apply(cat, picks, "2026-10-30");
    const after = cat.items.find((i: any) => i.id === "drywall_typex_58");
    expect([after.priceCAD, after.url, after.retailer]).toEqual([before.priceCAD, before.url, before.retailer]);
    expect(after.offers.filter((o: any) => o.retailer === "Home Depot Canada").map((o: any) => o.priceCAD).sort()).toEqual([24.98, 25.48]);
    // A new item with no match goes on the missing list, unpriced.
    expect(cat.missing.some((m: any) => m.id === "mixing_valve")).toBe(true);
    expect(cat.items.some((i: any) => i.id === "mixing_valve")).toBe(false);
    expect(TARGETS.length).toBeGreaterThanOrEqual(40);
  });
});

describe("pictures of the design", () => {
  const scanId = `test-renders-${process.pid}`;
  afterAll(() => storage.removePrefix(`scans/${scanId}`));
  const png = Buffer.from("89504e470d0a1a0a0000000d494844520000050000000002d0", "hex"); // a 1280 x 720 PNG header
  const box = { x: 0.4, y: 0.3, w: 0.2, h: 0.3 };
  const fake = (moved: boolean): RenderWork & { saved: Buffer[] } => {
    const saved: Buffer[] = [];
    return {
      saved,
      edit: async () => Buffer.from("restyled"),
      boxes: async (img, _m, concept) => (concept === "basement window" ? [img.toString() === "restyled" && moved ? { ...box, x: 0.0 } : box] : []),
      save: async (_k, img) => void saved.push(img),
    };
  };

  it("keeps Muse Image's photo when SAM finds the window where the render had it", async () => {
    const e = (await reserveRender(scanId, { title: "Living room", spot: 12, designId: design.id, at: "" }))!;
    const work = fake(false);
    const done = await restyleRender(scanId, e, png, "image/png", design.finishes, work);
    expect(done.kept).toBe(true);
    expect(work.saved[0].toString()).toBe("restyled");
    expect((await renderIndex(scanId)).find((r) => r.n === e.n)?.status).toBe("done");
  });

  it("keeps the plain render when the photo moves a window", async () => {
    const e = (await reserveRender(scanId, { title: "Bedroom", spot: 3, designId: design.id, at: "" }))!;
    const work = fake(true);
    const done = await restyleRender(scanId, e, png, "image/png", design.finishes, work);
    expect(done.kept).toBe(false);
    expect(work.saved[0]).toBe(png);
    expect(renderKey(scanId, e.n)).toContain(`/renders/${e.n}`);
    expect(renderPrompt(design.finishes)).toMatch(/exactly where they are/);
  });
});

describe("the book", () => {
  it("builds for the example with the pages it should have", async () => {
    const pics = sample.concepts.items.map((c: any) => ({ title: c.title, jpeg: readFileSync(`public/samples/sample/concepts/${c.n}.jpg`), kind: "concept" as const }));
    const alt: Design = { ...clone(design), id: "d_alt", name: "One bedroom", chosen: false };
    const m: Model = { ...model, designs: [...model.designs, alt] };
    const out = await buildBook({ address: "The sample basement", municipality: "waterloo-on", result: sample, model: m, pictures: pics, mood: [], today: "2026-10-30" });
    for (const p of ["Cover", "Your design", "Pictures", "Mood board", "Quote", "Quote by line", "Permit readiness", "Money", "Timeline", "Next steps", "Sources"]) expect(out.pages).toContain(p);
    const doc = await PDFDocument.load(out.bytes);
    expect(doc.getPageCount()).toBe(out.pages.length);
    expect(doc.getTitle()).toContain("The sample basement");
    expect(out.quote?.totalLow).toBeGreaterThan(0);
  });
});
