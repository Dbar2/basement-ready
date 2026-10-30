// Track E: the permit package, the filled forms, the materials takeoff, the one-click applications and
// who may open a workspace. Nothing here touches the network: official forms are stood in for by
// PDFs made here with the same field names.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, StandardFonts } from "pdf-lib";
import { beforeAll, describe, expect, it } from "vitest";
import { applications, planAndLot } from "../../server/apply/applications";
import { fillRegionForm, regionMarks } from "../../server/apply/regionForm";
import { db, migrateDb, schema } from "../../server/db";
import { buildOrder, diyPlan } from "../../server/diy/plan";
import { loadPrices, takeoff } from "../../server/diy/takeoff";
import { evaluateMoney } from "../../server/eligibility";
import { suggestLayout } from "../../server/layout";
import { cityPermit, ontarioDiy } from "../../server/permit/data";
import { FIELD_MAPS, fillAcroForm, type FormValues } from "../../server/permit/forms";
import { buildPermitPackage, formsNeeded } from "../../server/permit/package";
import { safe } from "../../server/permit/pdf";
import { basementGeometry, placeAlarms } from "../../server/permit/plans";
import type { Plan } from "../../server/plan";
import { packFor } from "../../server/rules";
import { basementFor, cleanPatch, loadWorkspace, saveWorkspace } from "../../server/workspace";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));

const profile = { owners: [{ first: "Sam", last: "Rivera" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2L 2C1", legalDescription: "PLAN 364 LOT 31", pin: "224100046" };

// The text drawn on each page: pdf-lib writes it as hex strings in the (deflated) content streams.
async function pageTexts(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((page) => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
    let text = "";
    for (const s of streams) {
      if (!(s instanceof PDFRawStream)) continue;
      const raw = Buffer.from(s.contents);
      const body = s.dict.get(PDFName.of("Filter")) ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
      for (const m of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) text += Buffer.from(m[1], "hex").toString("latin1") + " ";
    }
    return text;
  });
}

// A stand-in for an official fillable PDF: one page with text fields under the given names.
async function fakeForm(names: string[], extra?: (doc: PDFDocument) => void) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const form = doc.getForm();
  names.forEach((n, i) => form.createTextField(n).addToPage(page, { x: 20, y: 760 - (i % 60) * 12, width: 200, height: 10 }));
  extra?.(doc);
  return doc.save();
}

const values: FormValues = {
  ownerNames: "Sam Rivera",
  owners: profile.owners,
  phone: profile.phone,
  email: profile.email,
  street: "45 Avondale Ave S",
  municipality: "Waterloo",
  postalCode: "N2L 2C1",
  mailing: null,
  legal: "PLAN 364 LOT 31",
  pin: "224100046",
  roll: null,
  date: "2026-10-29",
  permitNumber: null,
  scope: "Create a second unit in the basement.",
  areaM2: 33,
  bedrooms: 1,
  city: "City of Waterloo",
  valueCAD: 60000,
  ownerBuilds: true,
  ownerDraws: true,
};

describe("permit package", () => {
  it("builds the eight drawing sheets, the filled forms and the submit page, with the required notes", async () => {
    const owner = await fakeForm(Object.keys(FIELD_MAPS.waterloo_owner_declaration));
    const textNames = Object.keys(FIELD_MAPS.on_application).filter((n) => !["Purpose of application", "Applicant is", "Design Activities", "Declaration of Designer"].includes(n));
    const app = await fakeForm(textNames);
    const fetched: string[] = [];
    const out = await buildPermitPackage({
      result: sample,
      municipality: "waterloo-on",
      address: "45 Avondale Ave S",
      profile,
      state: { tape: { ceilingMm: 2150, egressWidthMm: 600, egressHeightMm: 700, egressSillMm: 1100 } },
      site: null,
      aerialJpeg: null,
      favourites: [],
      share: false,
      today: "2026-10-29",
      fetchPdf: async (url) => {
        fetched.push(url);
        return url.includes("owner-declaration") ? owner : app;
      },
    });
    expect(out.sheets.map((s) => s.number)).toEqual(["A0", "A1", "A2", "A3", "A4", "A5", "A6", "A7"]);
    // Waterloo, owner-drawn: the provincial application and the Owner Declaration (one page each
    // here), the submit page; Schedule 1 is only for a designer.
    expect(out.forms.map((f) => [f.id, f.status])).toEqual([
      ["on_application", "filled"],
      ["waterloo_owner_declaration", "filled"],
    ]);
    expect(out.pages).toBe(8 + 2 + 1);
    expect(out.signer).toBe("owner");
    const notes = out.sheets.find((s) => s.number === "A6")!.notes.join(" ");
    for (const n of ["Fire separation between the homes", "Smoke alarms", "Bedroom escape window", "Heating and air", "Sound between the homes", "Ceiling heights"]) expect(notes).toContain(n);
    const text = (await pageTexts(out.bytes)).join(" ");
    expect(text).toContain("FIRE SEPARATION BETWEEN THE HOMES");
    expect(text).toContain("15.9 mm (5/8\") Type X");
    expect(text).toContain("SMOKE ALARMS");
    expect(text).toContain("PROPOSED BASEMENT PLAN");
    expect(text).toContain("Sam Rivera");
    expect(text).toContain("3.2.5.1.(3)(b)");
    expect(text).toContain("How to submit".toUpperCase());
  });

  it("leaves out the forms and the owner's contact details in the copy shared with builders", async () => {
    const out = await buildPermitPackage({ result: sample, municipality: "waterloo-on", address: "45 Avondale Ave S", profile, state: {}, site: null, aerialJpeg: null, favourites: [], share: true, today: "2026-10-29", fetchPdf: async () => null });
    expect(out.forms).toEqual([]);
    expect(out.pages).toBe(8 + 1);
    const text = (await pageTexts(out.bytes)).join(" ");
    expect(text).not.toContain("519-555-0100");
    expect(text).not.toContain("sam@example.com");
  });

  it("asks for the right forms per city and who draws", () => {
    const k = cityPermit("kitchener-on").permit!;
    expect(formsNeeded(k.forms, { ownerDraws: true, ownerBuilds: true }).map((f) => f.id)).toEqual(["on_application", "kitchener_project_info", "kitchener_water_capacity"]);
    const c = cityPermit("cambridge-on").permit!;
    expect(formsNeeded(c.forms, { ownerDraws: true, ownerBuilds: true }).map((f) => f.id)).toContain("cambridge_owner_acknowledgement");
    expect(formsNeeded(c.forms, { ownerDraws: true, ownerBuilds: false }).map((f) => f.id)).not.toContain("cambridge_owner_acknowledgement");
    const w = cityPermit("waterloo-on").permit!;
    expect(formsNeeded(w.forms, { ownerDraws: false, ownerBuilds: false }).map((f) => f.id)).toEqual(["on_application", "schedule_1"]);
  });

  it("places smoke alarms in the bedroom and outside it, and CO with a furnace", () => {
    const plan = sample.plan as Plan;
    // A one-bedroom: the sample's depth sits near where the layout switches to a studio.
    const layout = suggestLayout(plan, { kind: "one_bedroom" }) as any;
    expect(placeAlarms(layout, plan as any, false).map((a) => a.kind)).toEqual(["smoke", "smoke"]);
    // A studio has one, in the sleeping area.
    expect(placeAlarms(suggestLayout(plan, { kind: "studio" }) as any, plan as any, false).map((a) => a.kind)).toEqual(["smoke"]);
    const fuel = placeAlarms(layout, plan as any, true).map((a) => a.kind);
    expect(fuel).toContain("combo");
  });

  it("only draws text the PDF fonts can show", () => {
    expect(safe("≥ 0.35 m² → OK ✓")).toBe(">= 0.35 m² -> OK OK");
  });
});

describe("form filling", () => {
  it("sets the Owner Declaration's fields from the profile", async () => {
    const out = await fillAcroForm(await fakeForm(["Text1", "Text2", "Text3", "Text4", "Signature1"]), FIELD_MAPS.waterloo_owner_declaration, values);
    expect(out.set).toEqual({ Text1: "Sam Rivera", Text2: "2026-10-29", Text3: "45 Avondale Ave S, Waterloo" });
    const form = (await PDFDocument.load(out.bytes)).getForm();
    expect(form.getTextField("Text1").getText()).toBe("Sam Rivera");
    expect(form.getTextField("Text3").getText()).toBe("45 Avondale Ave S, Waterloo");
  });

  it("fills the provincial application: owner as applicant and builder, exempt designer, choices ticked", async () => {
    const textNames = Object.keys(FIELD_MAPS.on_application).filter((n) => !["Purpose of application", "Applicant is", "Design Activities", "Declaration of Designer"].includes(n));
    const bytes = await fakeForm(textNames, (doc) => {
      const page = doc.getPage(0);
      const form = doc.getForm();
      const purpose = form.createRadioGroup("Purpose of application");
      for (const [i, o] of ["New construction", "Alteration/repair ", "Demolition"].entries()) purpose.addOptionToPage(o, page, { x: 300 + i * 20, y: 40, width: 10, height: 10 });
      const applicant = form.createRadioGroup("Applicant is");
      for (const [i, o] of ["Owner", "Authorized agent of owner"].entries()) applicant.addOptionToPage(o, page, { x: 300 + i * 20, y: 60, width: 10, height: 10 });
      form.createCheckBox("Design Activities").addToPage(page, { x: 300, y: 80, width: 10, height: 10 });
    });
    const out = await fillAcroForm(bytes, FIELD_MAPS.on_application, values);
    expect(out.missing).toEqual(["Declaration of Designer"]);
    const form = (await PDFDocument.load(out.bytes)).getForm();
    expect(form.getTextField("Applicant last name").getText()).toBe("Rivera");
    expect(form.getTextField("Builder First name").getText()).toBe("Sam");
    expect(form.getTextField("Project plan number/other description").getText()).toBe("PLAN 364 LOT 31");
    expect(form.getTextField("Project area of work (in square metres)").getText()).toBe("33.0");
    expect(form.getTextField("For design work, Basis for exemption from registration and qualification").getText()).toContain("3.2.5.1.(3)(b)");
    expect(form.getRadioGroup("Purpose of application").getSelected()).toBe("Alteration/repair ");
    expect(form.getRadioGroup("Applicant is").getSelected()).toBe("Owner");
    expect(form.getCheckBox("Design Activities").isChecked()).toBe(true);
  });

  it("fills Kitchener's Project Information, both copies of each field", async () => {
    const names = Object.keys(FIELD_MAPS.kitchener_project_info);
    const out = await fillAcroForm(await fakeForm(names), FIELD_MAPS.kitchener_project_info, values);
    expect(out.set["New  of units"]).toBe("2");
    expect(out.set["New  of units_3"]).toBe("2");
    expect(out.set["Basement area of alteration ft²"]).toBe("355");
  });

  it("prints the Region's application answers onto its blanks", async () => {
    const v = { owners: profile.owners, contactName: "Sam Rivera", phone: profile.phone, email: profile.email, street: "45 Avondale Ave S", cityProvince: "Waterloo, Ontario", postalCode: "N2L 2C1", bedrooms: 1 as const, areaText: "about 33 m²", livesThere: true, mailing: null, otherProperty: false, rent: 1198 };
    const marks = regionMarks(v);
    expect(marks.filter((m) => m.page === 3).map((m) => m.text)).toEqual(expect.arrayContaining(["Rivera", "Sam", "Sam Rivera", "45 Avondale Ave S", "N2L 2C1"]));
    expect(marks.find((m) => m.page === 6)?.text).toBe("$1,198 a month, utilities included");
    expect(marks.find((m) => m.page === 9)?.text).toBe("Sam Rivera");
    const nine = await PDFDocument.create();
    for (let i = 0; i < 9; i++) nine.addPage([612, 792]);
    await nine.embedFont(StandardFonts.Helvetica);
    const filled = await fillRegionForm(await nine.save(), v);
    expect((await PDFDocument.load(filled.bytes)).getPageCount()).toBe(9);
    expect((await pageTexts(filled.bytes))[2]).toContain("45 Avondale Ave S");
  });
});

describe("materials takeoff", () => {
  // A 7 x 6 m room, walls on all four sides, a window on the long wall, no stairs or furnace.
  const plan: Plan = {
    version: 1,
    box: { minX: 0, maxX: 7, minZ: 0, maxZ: 6 },
    sides: { minX: "wall", maxX: "wall", minZ: "wall", maxZ: "wall" },
    widthM: 7,
    depthM: 6,
    areaM2: 42,
    ceilingHeightM: 2.4,
    openings: [{ kind: "window", side: "maxZ", atM: 3, widthM: 0.9, detectionId: "w1" }],
    stairs: [],
    fixtures: [],
    scaleSource: "user_measurement",
    trusted: true,
  };
  const result = { plan, layout: suggestLayout(plan), rooms: [], measurements: { ceilingHeightM: 2.4, clearances: [] }, detections: [], cost: { low: 17000, high: 33000 } };
  const geo = basementGeometry(result, { tape: { ceilingMm: 2400 } })!;
  const t = takeoff(geo);
  const line = (id: string) => t.lines.find((l) => l.id === id)!;

  it("counts from the plan: studs, sheets, batts, flooring", () => {
    expect(geo.layout?.kind).toBe("one_bedroom");
    const walls = (geo.layout!.walls ?? []).reduce((s, w) => s + Math.hypot(w.x1 - w.x0, w.z1 - w.z0), 0);
    // One stud every 406 mm along 26 m of outside wall and the new walls, plus corners, ends and openings.
    const doors = geo.layout!.doors.length;
    const expected = Math.ceil(26 / 0.406) + Math.ceil(walls / 0.406) + (4 + geo.layout!.walls.length) + 8 + 2 * geo.layout!.walls.length + 3 * doors + 2;
    expect(line("stud_2x4_8").need).toBe(expected);
    expect(line("stud_2x4_8").buy).toBe(Math.ceil(expected * 1.1));
    // The whole 42 m² ceiling in 5/8" Type X: 42 x 1.12 / 2.973 = 15.8 -> 16 sheets.
    expect(line("drywall_typex_58").need).toBe(42);
    expect(line("drywall_typex_58").buy).toBe(16);
    // Outside walls 26 m x 2.4 m less the window: 61.8 m² = 665 sq ft, 5% waste, 59.7 sq ft a bundle -> 12.
    expect(line("insul_r14_comfortbatt").buy).toBe(12);
    // Floor: every zone but stairs and mechanical, 10% waste, 18.91 sq ft a box.
    const floor = geo.layout!.zones.filter((z) => z.kind !== "stairs" && z.kind !== "mechanical").reduce((s, z) => s + z.areaM2, 0);
    expect(line("lvp_flooring").buy).toBe(Math.ceil((floor * 10.7639 * 1.1) / 18.91 - 1e-9));
    expect(t.wallHeightM).toBe(2.4);
  });

  it("prices every line from a dated local source, or says it has none", () => {
    const P = loadPrices();
    for (const l of t.lines) {
      if (l.price) {
        expect(l.price.url).toMatch(/^https:\/\//);
        expect(l.price.checked).toMatch(/^2026-\d\d-\d\d$/);
        expect(l.totalCAD).toBeCloseTo(l.buy * l.unitPriceCAD!, 2);
      } else expect(t.missing).toContain(l.item);
    }
    expect(P.items.every((i) => i.url && i.checked && i.priceCAD > 0)).toBe(true);
    expect(t.hstCAD).toBe(Math.round(t.materialsCAD * 0.13));
  });

  it("puts the build in inspection order and totals DIY against hired", () => {
    const d = diyPlan(result, { tape: { ceilingMm: 2400 } }, "kitchener-on");
    expect(d.steps[0].title).toBe("Permits in hand");
    const titles = d.steps.map((s) => s.title);
    expect(titles.indexOf("Plumbing under the floor")).toBeLessThan(titles.indexOf("Frame the walls"));
    expect(titles.indexOf("Insulation and vapour barrier")).toBeLessThan(titles.indexOf("Fire separation"));
    expect(d.steps.find((s) => s.title === "Plumbing under the floor")?.inspection).toBe("Underground plumbing");
    expect(d.totals.hiredLow).toBe(17000);
    expect(d.totals.diyLow).toBeGreaterThan(t.materialsCAD);
    expect(d.trades.find((x) => x.id === "gas")?.owner).toBe("no");
    expect(d.trades.find((x) => x.id === "electrical")?.owner).toBe("with_permit");
    expect(buildOrder([], { egressNew: true, authority: "City of Waterloo" })[1].title).toBe("Cut the escape window");
  });
});

describe("eligibility to applications", () => {
  const { pack } = packFor("waterloo-on");
  const money = evaluateMoney(pack, { household: "renter", answers: { rent: 1198, lives_there: true, other_home: false, house_value: true, work_started: false }, property: null, costHigh: 33000 });
  const result = { ...sample, household: "renter", grants: money.programs, moneyAnswered: [{ id: "rent", answer: 1198 }, { id: "lives_there", answer: true }, { id: "other_home", answer: false }] };
  const base = { scanId: "00000000-0000-0000-0000-000000000000", result, profile, address: "45 Avondale Ave S", municipality: "Waterloo", site: null, areaM2: 33, bedrooms: 1 as const, scope: "Create a second unit in the basement." };

  it("maps each program they qualify for to its way of applying", () => {
    const yes = money.programs.filter((p) => p.qualify === "yes").map((p) => p.id);
    expect(yes).toEqual(expect.arrayContaining(["region_ontario_renovates_secondary_suites", "city_waterloo_aru_grant_interior"]));
    const apps = applications({ ...base, state: {} });
    const region = apps.find((a) => a.id === "region_ontario_renovates_secondary_suites")!;
    expect(region.kind).toBe("pdf");
    expect(region.pdf?.path).toContain("/apply/region_ontario_renovates_secondary_suites.pdf");
    expect(region.email?.to).toBe("OntarioRenovates@regionofwaterloo.ca");
    expect(region.email?.body).toContain("45 Avondale Ave S");
    const city = apps.find((a) => a.id === "city_waterloo_aru_grant_interior")!;
    expect(city.kind).toBe("online_form");
    const fields = Object.fromEntries(city.form!.sections.flatMap((s) => s.fields.map((f) => [f.label, f.value])));
    expect(fields["Owner full name"]).toBe("Sam Rivera");
    expect(fields["Registered plan number"]).toBe("364");
    expect(fields["Lot no"]).toBe("31");
    expect(fields["How many bedrooms will the ARU contain?"]).toBe("1-bedroom");
    expect(fields["Is there an additional owner of the property?"]).toBe("No");
    // A renter's household gets no family tax credit, so there's nothing to apply for there.
    expect(apps.some((a) => a.id === "federal_mhrtc")).toBe(false);
  });

  it("never re-asks: the rent and who lives there come from the saved answers", () => {
    const city = applications({ ...base, state: {} }).find((a) => a.id === "city_waterloo_aru_grant_interior")!;
    expect(city.warnings.join(" ")).toContain("$1,198");
  });

  it("warns a do-it-yourselfer that the City's grant asks for a qualified professional", () => {
    const city = applications({ ...base, state: { build: { path: "diy" } } }).find((a) => a.id === "city_waterloo_aru_grant_interior")!;
    expect(city.warnings.join(" ")).toContain("qualified professional");
  });

  it("ticks off documents the workspace holds", () => {
    const city = applications({ ...base, state: {} }).find((a) => a.id === "city_waterloo_aru_grant_interior")!;
    expect(city.documents.find((d) => /legal description/i.test(d.label))?.have).toBe(true);
    expect(planAndLot("PLAN 1234 LOT 56 PT LT 57")).toEqual({ plan: "1234", lot: "56" });
  });
});

describe("workspace", () => {
  beforeAll(async () => {
    await migrateDb();
  });

  it("opens only for the owner or this browser's claim token, and saves the profile once", async () => {
    const [b] = await db.insert(schema.basements).values({ claimToken: "claim-token-e-123", household: "renter" }).returning();
    const [s] = await db.insert(schema.scans).values({ basementId: b.id, status: "done", result: { headline: "Yes" } }).returning();
    expect((await basementFor(s.id, { userId: null, claims: [] })).allowed).toBe(false);
    expect((await basementFor(s.id, { userId: null, claims: [{ basementId: b.id, claimToken: "wrong-token-1234" }] })).allowed).toBe(false);
    expect((await basementFor(s.id, { userId: null, claims: [{ basementId: b.id, claimToken: "claim-token-e-123" }] })).allowed).toBe(true);
    const patch = cleanPatch({ profile, state: { tape: { ceilingMm: 2150 }, looks: { bright: {} } } });
    expect("error" in patch).toBe(false);
    await saveWorkspace(b.id, patch as Exclude<typeof patch, { error: string }>);
    const w = await loadWorkspace(b.id);
    expect(w.profile?.owners[0].last).toBe("Rivera");
    expect(w.state.tape?.ceilingMm).toBe(2150);
    // `looks` is written by the server only.
    expect((w.state as any).looks).toBeUndefined();
    expect("error" in cleanPatch({ profile: { owners: [], phone: "", email: "" } })).toBe(true);
  });

  it("cites a source for every Ontario do-it-yourself fact", () => {
    const d = ontarioDiy();
    for (const x of [...d.notes, ...d.needsPro, ...d.trades]) {
      expect(x.source.url, x.id).toMatch(/^https:\/\//);
      expect(x.source.retrieved, x.id).toMatch(/^2026-/);
    }
  });
});
