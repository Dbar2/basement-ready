// Session 4: prices, the quote and the book. The quote is checked on the sample basement: every line
// has a source or says what's missing, the totals add up, an edit moves the right lines, and it's fast
// enough to rerun on every drag in the 3D studio. The catalog is checked against the rules packs it
// mirrors, the price refresh's filters against made-up actor rows, and the book against the pages it
// should have. Nothing here touches the network or spends money.
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { buildBook } from "../../server/book/book";
import { picturesFor } from "../../server/book/pictures";
import type { Design, Model, Wall } from "../../server/model/types";
import { packFor } from "../../server/rules";
import { permitFee } from "../../server/steps";
import { catalog } from "../../server/quote/catalog";
import { chosenDesign, modelFor } from "../../server/quote/fromScan";
import { quote, type Quote } from "../../server/quote/quote";
import { apply, keep, pick, TARGETS } from "../../scripts/refresh-prices";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
// The model every page works from (server/model/current.ts): seeded from the sample's scan.
const model = modelFor(sample, {})!;
// Furniture is priced on its own (the last test); the build is quoted without it.
const design: Design = { ...chosenDesign(model)!, proposed: { ...chosenDesign(model)!.proposed, furniture: [] } };
const lines = (q: Quote) => q.byTrade.flatMap((t) => t.lines);
const line = (q: Quote, id: string) => lines(q).find((l) => l.id === id)!;
const lineLike = (q: Quote, prefix: string) => lines(q).filter((l) => l.id.startsWith(prefix));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const len = (w: Wall) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
// A new wall of the bathroom's (the sound insulation goes in those).
const onEdge = (w: Wall, poly: [number, number][]) => {
  const m: [number, number] = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  return poly.some((p, i) => {
    const q = poly[(i + 1) % poly.length];
    const d = Math.abs((q[0] - p[0]) * (p[1] - m[1]) - (p[0] - m[0]) * (q[1] - p[1])) / Math.hypot(q[0] - p[0], q[1] - p[1]);
    return d < 0.05 && m[0] >= Math.min(p[0], q[0]) - 0.05 && m[0] <= Math.max(p[0], q[0]) + 0.05 && m[1] >= Math.min(p[1], q[1]) - 0.05 && m[1] <= Math.max(p[1], q[1]) + 0.05;
  });
};
const bathWall = (d: Design) => {
  const bath = d.proposed.rooms.find((r) => r.unit === 2 && r.kind === "bathroom")!;
  return d.proposed.walls.find((w) => w.kind === "new" && onEdge(w, bath.polygon))!;
};

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
    const w = bathWall(d);
    const L = len(w);
    w.b = [w.b[0] + (w.b[0] - w.a[0]) / L, w.b[1] + (w.b[1] - w.a[1]) / L]; // one metre longer
    const after = quote(model, d);
    expect(line(after, "framing").qty).toBeGreaterThan(line(q, "framing").qty);
    expect(line(after, "framing").high).toBeGreaterThan(line(q, "framing").high);
    expect(line(after, "drywall_board").qty).toBeGreaterThan(line(q, "drywall_board").qty);
    expect(line(after, "paint_walls").qty).toBeGreaterThan(line(q, "paint_walls").qty);
    expect(line(after, "insul_sound").qty).toBeGreaterThan(line(q, "insul_sound").qty); // a bathroom wall
    expect(lineLike(after, "kitchen_")).toEqual(lineLike(q, "kitchen_"));
    expect(line(after, "permit_building")).toEqual(line(q, "permit_building"));
    expect(after.totalHigh).toBeGreaterThan(q.totalHigh);
  });

  it("an extra door adds a door and its trim, and nothing to the plumbing", () => {
    const d = clone(design);
    const w = d.proposed.walls.find((x) => x.kind === "new" && !x.rating && len(x) > 2 && !d.proposed.openings.some((o) => o.wallId === x.id))!;
    d.proposed.openings.push({ id: "o_extra", wallId: w.id, kind: "door", offsetM: len(w) / 2, widthM: 0.76, heightM: 2.03, status: "new", swing: "left" });
    const after = quote(model, d);
    expect(line(after, "doors").qty).toBe(line(q, "doors").qty + 1);
    expect(line(after, "doors").labour!.low).toBeGreaterThan(line(q, "doors").labour!.low);
    expect(line(after, "trim").qty).toBeGreaterThan(line(q, "trim").qty);
    expect(line(after, "drywall_board").qty).toBeLessThan(line(q, "drywall_board").qty); // the hole
    expect(lineLike(after, "rough_")).toEqual(lineLike(q, "rough_"));
  });

  it("a new escape window brings the cut, the well and the engineer", () => {
    expect(lines(q).some((l) => l.id.startsWith("egress_"))).toBe(false);
    const d = clone(design);
    const wall = d.proposed.walls.filter((x) => x.kind === "foundation").sort((a, b) => len(b) - len(a))[0];
    d.proposed.openings.push({ id: "o_new_window", wallId: wall.id, kind: "window", offsetM: len(wall) / 2, widthM: 0.9, heightM: 1, sillM: 0.9, status: "new" });
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

  it("prices furniture on its own: optional, sourced, and never in the build, DIY or permit totals", () => {
    const d = clone(design);
    const at = (x: number, z: number): [number, number] => [x, z];
    d.proposed.furniture = [
      { id: "f-bed", kind: "bed", at: at(1.4, 1.6), rotDeg: 0, sizeM: [1.42, 2.02] },
      { id: "f-sofa", kind: "sofa", at: at(0, -1), rotDeg: 0, sizeM: [2.2, 0.95] },
      { id: "f-coffee-table", kind: "other", at: at(0, -0.2), rotDeg: 0, sizeM: [1.2, 0.6] },
      { id: "f-nightstand-1", kind: "other", at: at(0.4, 2.4), rotDeg: 0, sizeM: [0.5, 0.42] },
      { id: "f-nightstand-2", kind: "other", at: at(2.5, 2.4), rotDeg: 0, sizeM: [0.5, 0.42] },
      { id: "f-kitchen", kind: "kitchen", at: at(1.2, -2.4), rotDeg: 0, sizeM: [3, 0.62] },
      { id: "f-vanity", kind: "vanity", at: at(-1.4, 2.5), rotDeg: 0, sizeM: [0.6, 0.46] },
      { id: "f-mystery", kind: "other", at: at(-3, 0), rotDeg: 0, sizeM: [0.6, 0.6] },
    ];
    const withFurniture = quote(model, d);
    // The build, the DIY total and the permit fees are exactly as they were without it.
    expect([withFurniture.totalLow, withFurniture.totalHigh, withFurniture.diy.low, withFurniture.diy.high]).toEqual([q.totalLow, q.totalHigh, q.diy.low, q.diy.high]);
    expect(withFurniture.byTrade).toEqual(q.byTrade);
    expect(q.furniture.lines).toEqual([]);
    const f = withFurniture.furniture;
    const ids = f.lines.map((l) => l.id);
    expect(ids).toEqual(expect.arrayContaining(["bed", "sofa", "coffee_table", "nightstand"]));
    expect(f.lines.find((l) => l.id === "nightstand")?.count).toBe(2);
    // Fixtures stay with the trades, not here.
    expect(ids).not.toContain("kitchen");
    expect(ids).not.toContain("vanity");
    expect(f.inBuild).toEqual(expect.arrayContaining(["Kitchen cabinets and counter", "Vanity"]));
    // A piece nobody has a price for says so and adds nothing.
    const mystery = f.lines.find((l) => l.id === "other")!;
    expect(mystery.price).toBeNull();
    expect(f.missing).toContain(mystery.label);
    for (const l of f.lines) {
      if (l.price) {
        expect(l.sources.length, l.id).toBeGreaterThan(0);
        for (const s of l.sources) expect(s.url).toMatch(/^https:\/\//);
        expect([l.low, l.high]).toEqual([Math.round(l.count * l.price.low), Math.round(l.count * l.price.high)]);
      } else expect([l.low, l.high]).toEqual([0, 0]);
    }
    expect(f.subtotal.low).toBe(f.lines.reduce((s, l) => s + l.low, 0));
    expect(f.total.high).toBe(f.subtotal.high + f.hst.high);
    expect(Math.abs(f.hst.low - f.subtotal.low * 0.13)).toBeLessThanOrEqual(1);
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

  it("gives every furniture range its listings, read on the retailers' own pages", () => {
    expect((catalog.furniture ?? []).length).toBeGreaterThan(0);
    for (const f of catalog.furniture ?? []) {
      expect(f.lowCAD, f.id).toBeLessThanOrEqual(f.highCAD);
      expect(f.listings.some((l) => l.role === "low"), f.id).toBe(true);
      expect(f.listings.some((l) => l.role === "high"), f.id).toBe(true);
      for (const l of f.listings) {
        expect(l.url, f.id).toMatch(/^https:\/\//);
        expect(l.priceCAD, f.id).toBeGreaterThan(0);
        expect(l.checked, f.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
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

describe("the book's pictures", () => {
  it("are an input: the design's own pictures lead, then the example's committed looks and photos", async () => {
    const design = [{ title: "Living room", kind: "design" as const, caption: "Checked by SAM 3.1", url: "/api/scans/sample/views/a1/x.jpg", load: async () => null }];
    const { pictures } = await picturesFor("sample", sample, {}, model, design);
    expect(pictures[0]).toMatchObject({ kind: "design", title: "Living room" });
    const looks = pictures.filter((p) => p.kind === "look");
    expect(looks.length).toBe(Object.keys(JSON.parse(readFileSync("public/samples/sample/looks/looks.json", "utf8"))).length);
    for (const l of looks) expect(await l.load()).toBeInstanceOf(Buffer);
    expect(pictures.at(-1)?.kind).toBe("concept");
    expect(new Set(pictures.map((p) => p.url)).size).toBe(pictures.length);
  });

  it("each say what they show: the room, what changed, and where in the video", async () => {
    // Five looks and the scan's own idea, all of one corner from one moment of the video: six titles.
    const { pictures } = await picturesFor("sample", sample, {}, model, []);
    expect(new Set(pictures.map((p) => p.title)).size).toBe(pictures.length);
    const looks = pictures.filter((p) => p.kind === "look");
    expect(looks.map((p) => p.title)).toContain("A bedroom for your parent · Warm wood look · from 0:00 in your video");
    expect(pictures.find((p) => p.kind === "concept")!.title).toMatch(/the first idea from your scan · from \d+:\d\d in your video$/);
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
