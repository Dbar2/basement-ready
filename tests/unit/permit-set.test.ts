// A permit set you can submit: the readiness count, the clean submit copy, the fire separation
// drawn, every examiner note, plans at 1:50 or larger on 11 x 17, and the designer route.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { designerNeed } from "../../server/permit/designer";
import { drawFixtures, makeView } from "../../server/permit/draw";
import { HOMEOWNER_BASIS } from "../../server/permit/forms";
import { bounds, permitModel } from "../../server/permit/model";
import { EXAMINER_NOTES } from "../../server/permit/notes";
import { buildPermitPackage, NotReady, permitStatus } from "../../server/permit/package";
import { PLAN_SCALES, ptPerMetre, type Sheet, TABLOID } from "../../server/permit/pdf";
import { planLayout } from "../../server/permit/sheets";
import type { StoredState } from "../../server/workspace";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const profile = { owners: [{ first: "Sam", last: "Rivera" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2L 2C1" };
const base = { municipality: "waterloo-on", address: "45 Avondale Ave S", profile, site: null, aerialJpeg: null, favourites: [], today: "2026-10-30", fetchPdf: async () => null };

// The sample with a gas furnace in the basement: CO alarms and the furnace room notes apply.
function withFurnace() {
  const r = structuredClone(sample);
  const f = { kind: "furnace", x: 3.2, z: -2.3, detectionId: "furnace-1" };
  r.plan.fixtures.push(f);
  for (const room of r.rooms) room.plan?.fixtures.push(f);
  return r;
}

// Each page's drawing operators, inflated.
async function pageStreams(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    let body = "";
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const raw = Buffer.from(s.contents);
      body += s.dict.get(PDFName.of("Filter")) ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    }
    return body;
  });
}
const textOf = (body: string) => [...body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)].map((m) => Buffer.from(m[1], "hex").toString("latin1")).join(" ");

// Every readiness item answered: tape, windows, the bedrooms upstairs, lot lines, each sheet looked over.
function answered(result: any, state: StoredState = {}): StoredState {
  const m = permitModel(result, state)!;
  const next: StoredState = {
    ...state,
    tape: { ceilingMm: 2085, beamMm: 1960, ...state.tape },
    permit: {
      ...state.permit,
      walls: m.mainWalls.map((w) => ({ id: w.id, mm: Math.round(w.scanM * 1000) })),
      windows: m.windows.map((w) => ({ id: w.id, widthMm: 610, heightMm: 762, sillMm: 1120 })),
      upstairs: { bedrooms: [{ floor: 1, at: [0.3, 0.7] }] },
      lotLines: m.windows.map((w) => ({ id: w.id, mm: 1800 })),
    },
  };
  const st = permitStatus({ ...base, result, state: next });
  next.permit!.reviewed = st.sheets.map((s) => ({ sheet: s.number, key: st.reviewKey }));
  return next;
}

describe("readiness count", () => {
  it("lists what's left, and goes to 0 with every item answered", () => {
    const first = permitStatus({ ...base, result: sample, state: {} });
    expect(first.readiness.left).toBeGreaterThan(0);
    const groups = new Set(first.readiness.items.filter((i) => !i.done).map((i) => i.group));
    for (const g of ["tape", "windows", "upstairs", "review"]) expect(groups.has(g as never)).toBe(true);
    // The owner's details are already in.
    expect(first.readiness.items.find((i) => i.id === "owner")?.done).toBe(true);
    const done = permitStatus({ ...base, result: sample, state: answered(sample) });
    expect(done.readiness.items.filter((i) => !i.done)).toEqual([]);
    expect(done.readiness.left).toBe(0);
  });

  it("puts a sheet back on the list when what it draws changes", () => {
    const state = answered(sample);
    const changed: StoredState = { ...state, tape: { ...state.tape, ceilingMm: 2200 } };
    const st = permitStatus({ ...base, result: sample, state: changed });
    expect(st.readiness.items.filter((i) => !i.done).every((i) => i.group === "review")).toBe(true);
    expect(st.readiness.left).toBe(8);
  });

  it("asks for the lot line and a designer when the escape window gets bigger", () => {
    const m = permitModel(sample, {})!;
    const escape = m.windows.find((w) => w.escape)!;
    const state: StoredState = { permit: { windows: [{ id: escape.id, widthMm: 450, heightMm: 300, sillMm: 1300 }] } };
    const st = permitStatus({ ...base, result: sample, state });
    expect(st.model!.windows.find((w) => w.escape)!.change).toBe("enlarge");
    expect(st.readiness.items.some((i) => i.id === `lot:${escape.id}`)).toBe(true);
    expect(st.need.needed).toBe(true);
    expect(st.readiness.items.find((i) => i.id === "designer")?.done).toBe(false);
  });

  it("won't make the submit copy while anything is left", async () => {
    await expect(buildPermitPackage({ ...base, result: sample, state: {}, copy: "submit" })).rejects.toBeInstanceOf(NotReady);
  });
});

describe("the submit copy", () => {
  it("has no 'to fill in', nothing to measure, no ± and no app name", async () => {
    const out = await buildPermitPackage({ ...base, result: withFurnace(), state: answered(withFurnace()), copy: "submit" });
    expect(out.readiness.left).toBe(0);
    const text = (await pageStreams(out.bytes)).map(textOf).join(" ").toLowerCase();
    for (const bad of ["to fill in", "fill in yourself", "measure", "±", "+/-", "basement ready", "draft", "confirm"]) expect(text, bad).not.toContain(bad);
    const doc = await PDFDocument.load(out.bytes);
    expect(`${doc.getCreator() ?? ""} ${doc.getProducer() ?? ""}`).not.toMatch(/basement ready/i);
    // Signed by the homeowner, with the Code's exemption.
    expect(text).toContain("designer: homeowner");
    expect(text).toContain("3.2.5.1.(3)(b)");
  });

  it("the review copy is marked Draft and carries the list", async () => {
    const out = await buildPermitPackage({ ...base, result: sample, state: {}, copy: "review" });
    const pages = (await pageStreams(out.bytes)).map(textOf);
    expect(pages[0]).toContain(`${out.readiness.left} THINGS LEFT BEFORE YOU CAN SUBMIT`);
    for (const s of out.sheets) expect(pages[s.page]).toContain("DRAFT");
  });

  it("fills Schedule 1's basis with Homeowner", () => {
    expect(HOMEOWNER_BASIS.startsWith("Homeowner")).toBe(true);
  });
});

describe("fire separation", () => {
  it("draws rated lines around the unit and the stair, with a 20-minute door and a 15-minute ceiling", async () => {
    const m = permitModel(sample, {})!;
    expect(m.design.proposed.walls.filter((w) => w.rating === "30min").length).toBeGreaterThanOrEqual(2);
    expect(m.design.proposed.openings.some((o) => o.kind === "door" && o.rating === "20min")).toBe(true);
    expect(m.design.proposed.rooms.filter((r) => r.unit === 2).every((r) => (r as { ceilingRating?: string }).ceilingRating === "15min")).toBe(true);
    const out = await buildPermitPackage({ ...base, result: sample, state: {}, copy: "review" });
    const a2 = out.sheets.find((s) => s.number === "A2")!;
    const body = (await pageStreams(out.bytes))[a2.page];
    // The 30-minute line's dash pattern, drawn along the rated walls (and once more in the legend).
    expect(body.match(/\[7 2\.2 1\.6 2\.2\] 0 d/g)!.length).toBeGreaterThan(2);
    const text = textOf(body);
    for (const t of ["30-minute fire separation", "15-minute ceiling", "20-minute door", "Interconnected"]) expect(text).toContain(t);
  });
});

describe("examiner notes", () => {
  it("prints every note on A7, each with its citation", async () => {
    const out = await buildPermitPackage({ ...base, result: withFurnace(), state: {}, copy: "review" });
    const a7 = out.sheets.find((s) => s.number === "A7")!;
    const ids = a7.notes.map((n) => n.split(":")[0]);
    expect(ids.sort()).toEqual(EXAMINER_NOTES.map((n) => n.id).sort());
    const text = textOf((await pageStreams(out.bytes))[a7.page]);
    for (const n of EXAMINER_NOTES) {
      expect(text).toContain(n.title.toUpperCase());
      expect(n.cites.length).toBeGreaterThan(0);
    }
    for (const must of ["49 °C", "25 L/s (50 cfm)", "700 mm", "1,800 mm", "3-way", "strobe", "grab bars", "Electrical Safety Authority", "duct smoke detector", "sprinklered", "All structure is existing", "responsible"]) expect(text).toContain(must);
  });
});

describe("scale", () => {
  it("draws the plans at 1:50 or larger on 11 x 17", async () => {
    expect(TABLOID).toEqual([17 * 72, 11 * 72]);
    // 1 m at 1:50 is 20 mm on paper.
    expect(ptPerMetre(50)).toBeCloseTo((20 / 25.4) * 72, 6);
    const out = await buildPermitPackage({ ...base, result: sample, state: {}, copy: "review" });
    for (const n of ["A2", "A4"]) {
      const s = out.sheets.find((x) => x.number === n)!;
      expect(s.scale!.ratio).toBeLessThanOrEqual(50);
    }
  });

  it("cuts a big basement into sheets at match lines rather than shrink it", () => {
    const area = { x: 36, y: 36, w: 938, h: 720 };
    const big = planLayout(area, { minX: 0, maxX: 20, minZ: 0, maxZ: 11 });
    expect(big.tiles.length).toBeGreaterThanOrEqual(2);
    expect(big.scale.ratio).toBeLessThanOrEqual(50);
    const k = ptPerMetre(big.scale.ratio);
    for (const t of big.tiles) {
      expect((t.maxX - t.minX) * k).toBeLessThanOrEqual(big.area.w);
      expect((t.maxZ - t.minZ) * k).toBeLessThanOrEqual(big.area.h);
    }
    // Together the tiles cover the whole basement.
    expect(Math.min(...big.tiles.map((t) => t.minX))).toBe(0);
    expect(Math.max(...big.tiles.map((t) => t.maxX))).toBe(20);
    const small = planLayout(area, { minX: 0, maxX: 8, minZ: 0, maxZ: 6 });
    expect(small.tiles.length).toBe(1);
    expect(PLAN_SCALES.map((s) => s.ratio)).toContain(small.scale.ratio);
  });
});

describe("designer route", () => {
  it("is needed for a third unit, structural changes, or where the city wants one", () => {
    expect(designerNeed({ municipality: "kitchener-on", citySigner: "owner", unitsNow: 2, structural: false }).reasons[0]).toContain("Kitchener");
    expect(designerNeed({ municipality: "waterloo-on", citySigner: "owner", unitsNow: 2, structural: false })).toMatchObject({ needed: true, category: "Small Buildings" });
    expect(designerNeed({ municipality: "waterloo-on", citySigner: "owner", unitsNow: 1, structural: true }).needed).toBe(true);
    expect(designerNeed({ municipality: "waterloo-on", citySigner: "owner", unitsNow: 1, structural: false }).needed).toBe(false);
  });

  it("switches every sheet's statement box to the designer's fields", async () => {
    const state: StoredState = { permit: { signer: "designer", designer: { name: "Alex Moreau", bcin: "123456", firm: "Moreau Design", firmBcin: "654321" } } };
    const out = await buildPermitPackage({ ...base, result: sample, state, copy: "review" });
    expect(out.signer).toBe("brief");
    const pages = (await pageStreams(out.bytes)).map(textOf);
    for (const s of out.sheets) {
      expect(pages[s.page]).toContain("DESIGNER (BCIN)");
      expect(pages[s.page]).toContain("123456");
      expect(pages[s.page]).not.toContain("DESIGNER: HOMEOWNER");
    }
  });
});

describe("the stairs on the plan", () => {
  // The run arrow and "UP" as drawFixtures draws them: the arrow is the 0.6-wide line, start to tip.
  const arrow = (fixtures: Parameters<typeof drawFixtures>[2]) => {
    const lines: number[][] = [];
    const sheet = { fonts: { bold: {}, regular: {} }, line: (x0: number, y0: number, x1: number, y1: number, o: { width?: number }) => o?.width === 0.6 && lines.push([x0, y0, x1, y1]), rect() {}, poly() {}, text() {}, circle() {} } as unknown as Sheet;
    const box = bounds(fixtures.flatMap((f) => [f.at, f.bottom ?? f.at]));
    const v = makeView({ x: 0, y: 0, w: 800, h: 600 }, { minX: box.minX - 1, maxX: box.maxX + 1, minZ: box.minZ - 1, maxZ: box.maxZ + 1 }, { ratio: 50, label: "1:50" } as never);
    drawFixtures(sheet, v, fixtures);
    expect(lines).toHaveLength(1);
    return { line: lines[0], v };
  };

  it("points up the flight, from its foot", () => {
    // The example's stairs climb west: their foot is the east end.
    const stairs = permitModel(sample, {})!.design.proposed.fixtures.find((f) => f.kind === "stairs")!;
    expect(stairs.bottom).toBeTruthy();
    expect(stairs.bottom![0]).toBeGreaterThan(stairs.at[0]);
    const { line, v } = arrow([stairs]);
    expect(line[2]).toBeLessThan(line[0]);
    expect(Math.abs(line[0] - v.X(stairs.bottom![0]))).toBeLessThan(Math.abs(line[2] - v.X(stairs.bottom![0])));
    // A flight along z, its foot at the low end: the arrow runs to high z (up the page).
    const along = { id: "s", kind: "stairs" as const, at: [0, 0] as [number, number], sizeM: [0.9, 2.6] as [number, number], bottom: [0, -1.3] as [number, number] };
    expect(arrow([along]).line[3]).toBeLessThan(arrow([along]).line[1]);
    expect(arrow([{ ...along, bottom: [0, 1.3] }]).line[3]).toBeGreaterThan(arrow([{ ...along, bottom: [0, 1.3] }]).line[1]);
  });

  it("keeps today's arrow when the foot isn't known", () => {
    const { bottom: _, ...stairs } = permitModel(sample, {})!.design.proposed.fixtures.find((f) => f.kind === "stairs")!;
    const { line } = arrow([stairs]);
    expect(line[2]).toBeGreaterThan(line[0]);
  });

  it("keeps its foot when the tape rescales the plan", () => {
    // The example's one main wall runs front to back: taped 10% longer, the plan stretches along z.
    const m = permitModel(sample, {})!;
    const wall = m.mainWalls[0];
    const taped = permitModel(sample, { permit: { walls: [{ id: wall.id, mm: Math.round(wall.scanM * 1100) }] } })!;
    const [a, b] = [m, taped].map((x) => x.design.proposed.fixtures.find((f) => f.kind === "stairs")!);
    expect(b.at[1]).not.toBeCloseTo(a.at[1], 2);
    expect(b.bottom![0] - b.at[0]).toBeCloseTo(a.bottom![0] - a.at[0], 2);
    expect(b.bottom![1] - b.at[1]).toBeCloseTo((a.bottom![1] - a.at[1]) * 1.1, 2);
  });
});
