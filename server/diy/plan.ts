// "Do it yourself": who may do which part of the work in Ontario, the materials list, the permits
// and the pros you must still pay, DIY total against the hired total, and the order to build in,
// lined up with the inspections the city books.
import { cityPermit, ontarioDiy, type CityPermit, type Inspection, type ProItem, type Trade } from "../permit/data";
import { basementGeometry } from "../permit/plans";
import { packFor } from "../rules";
import { permitFee } from "../steps";
import type { StoredState } from "../workspace";
import { loadPrices, takeoff, type Takeoff } from "./takeoff";

export type Cost = { id: string; item: string; lowCAD: number; highCAD: number; source: { title: string; url: string; checked: string } | null; estimate: boolean; only?: string | null };
export type BuildStep = { n: number; title: string; who: string; detail: string; inspection: string | null };

export type DiyPlan = {
  city: string;
  permit: CityPermit | null; // who signs, forms, portal, inspections (the pack's permitPackage)
  needsPro: (ProItem & { live: boolean })[];
  egressNew: boolean;
  electrical: { text: string; verified: boolean; source: { title: string; url: string } };
  ownerBuilder: { allowed: boolean; detail: string; source: { title: string; url: string } } | null;
  trades: Trade[];
  takeoff: Takeoff;
  permits: Cost[];
  hires: Cost[];
  totals: { diyLow: number; diyHigh: number; hiredLow: number | null; hiredHigh: number | null };
  steps: BuildStep[];
};

const svc = (id: string) => loadPrices().services.find((s) => s.id === id) ?? null;
function service(id: string, item: string, only: string | null = null): Cost | null {
  const s = svc(id);
  if (!s) return null;
  return { id, item, lowCAD: s.lowCAD, highCAD: s.highCAD, source: { title: s.publisher, url: s.url, checked: s.checked }, estimate: true, only };
}

// The build in the order inspections need it: nothing gets covered before it's been seen.
export function buildOrder(inspections: Inspection[], o: { egressNew: boolean; city: string }): BuildStep[] {
  const find = (re: RegExp) => inspections.find((i) => re.test(`${i.id} ${i.title}`))?.title ?? null;
  const steps: Omit<BuildStep, "n">[] = [
    { title: "Permits in hand", who: "You", detail: `Building permit from the City of ${o.city}; the electrical permit from ESA before any wiring; keep the approved drawings on site.`, inspection: null },
  ];
  if (o.egressNew) steps.push({ title: "Cut the escape window", who: "Concrete cutter, to the engineer's design", detail: "Opening, lintel, window and well, before the walls go up.", inspection: find(/footing|structur|excavat/i) });
  steps.push(
    { title: "Plumbing under the floor", who: "You, with a plumbing permit, or a plumber", detail: "Break the slab for the toilet and shower drains, lay the pipe, leave it open.", inspection: find(/underground/i) },
    { title: "Frame the walls", who: "You", detail: "Bottom plates on the slab, studs, door openings, the furnace room enclosure.", inspection: find(/fram/i) },
    { title: "Rough-ins", who: "You (plumbing, electrical with permits); a pro for heating and gas", detail: "Supply and drain pipes, wiring and boxes, ducts sealed between the homes or the new heating.", inspection: [find(/rough|above.?ground/i), find(/hvac/i), "ESA rough-in"].filter(Boolean).join(", ") },
    { title: "Insulation and vapour barrier", who: "You", detail: "Outside walls, sound batts in the ceiling joists, poly sealed at the edges.", inspection: find(/insul/i) },
    { title: "Fire separation", who: "You", detail: "5/8\" Type X board on the ceiling and the furnace room, joints taped and sealed, smoke-tight.", inspection: find(/fire/i) },
    { title: "Drywall, paint, floors, doors, trim, kitchen", who: "You", detail: "Finish the rooms; hang the self-closing door between the homes.", inspection: null },
    { title: "Fixtures, devices and alarms", who: "You", detail: "Toilet, sinks, shower, receptacles, lights, interconnected smoke and CO alarms with strobes.", inspection: [find(/plumbing final|final plumbing/i), find(/hvac final/i), "ESA final"].filter(Boolean).join(", ") },
    { title: "Final inspection and occupancy", who: "You and the City", detail: "The final building inspection; then the unit can be lived in.", inspection: [find(/zoning/i), find(/final building|building final|occupancy|^final/i)].filter(Boolean).join(", ") || "Final building inspection" },
  );
  return steps.map((s, i) => ({ n: i + 1, ...s }));
}

export function diyPlan(result: any, state: StoredState, municipality: string): DiyPlan {
  const { city, permit } = cityPermit(municipality);
  const diy = ontarioDiy();
  const geo = basementGeometry(result, state);
  const t: Takeoff = geo ? takeoff(geo) : { lines: [], assumptions: ["No measured plan yet."], materialsCAD: 0, hstCAD: 0, missing: [], wallHeightM: 2.3, checked: loadPrices().compiledAt };
  const { pack } = packFor(municipality);
  const egressNew = Boolean(geo?.egress && !geo.egress.existing);

  const permits: Cost[] = [];
  const fee = permitFee(pack, result?.plan?.areaM2 ?? null);
  if (fee?.amount) permits.push({ id: "building_permit", item: `Building permit, City of ${city}`, lowCAD: fee.amount, highCAD: fee.amount, source: fee.source ? { title: fee.source.title, url: fee.source.url, checked: (fee.source as { retrieved?: string }).retrieved ?? "" } : null, estimate: fee.estimate });
  if (permit?.plumbing?.perFixtureCAD) {
    const fixtures = (geo?.layout?.zones.some((z) => z.kind === "bathroom") ? 3 : 0) + (geo?.layout?.zones.some((z) => z.kind === "kitchen") ? 1 : 0);
    const amount = Math.max(permit.plumbing.minimumCAD ?? 0, fixtures * permit.plumbing.perFixtureCAD);
    if (permit.plumbing.separatePermit && amount) permits.push({ id: "plumbing_permit", item: `Plumbing permit (${fixtures} fixtures)`, lowCAD: amount, highCAD: amount, source: { title: permit.plumbing.source.title, url: permit.plumbing.source.url, checked: permit.plumbing.source.retrieved }, estimate: false });
  }
  // ESA's homeowner rate, by how many outlets (receptacles, switches, lights, alarms) the work adds.
  const fees = diy.electrical.esaHomeownerFees;
  const outlets = t.lines.filter((l) => l.group === "Electrical" && /receptacle|switch|light|fan/i.test(l.item)).reduce((n, l) => n + l.need, 0) + t.lines.filter((l) => l.group === "Alarms").reduce((n, l) => n + l.need, 0);
  if (outlets > 0) {
    const band = fees.bands.find((b) => b.upTo == null || outlets <= b.upTo)!;
    permits.push({ id: "esa_permit", item: `ESA notification, homeowner rate (about ${Math.round(outlets)} outlets)`, lowCAD: band.CAD, highCAD: band.CAD, source: { title: fees.source.title, url: fees.source.url, checked: fees.source.retrieved }, estimate: false });
  }

  const hires = [
    egressNew ? service("engineer_egress", "Engineer: design of the new window opening and lintel") : null,
    egressNew ? service("concrete_cutting", "Concrete cutting for the escape window") : null,
    service("hvac_design", "HVAC designer: heat-loss calculation and design", "Only if the unit gets its own heating"),
    service("gas_fitter", "Licensed gas fitter", "Only if any gas line or appliance is moved or added"),
    service("bin_rental", "Waste bin"),
  ].filter((c): c is Cost => c !== null);

  const live = (c: Cost) => !c.only;
  const tax = t.hstCAD;
  const low = t.materialsCAD + tax + [...permits, ...hires].filter(live).reduce((s, c) => s + c.lowCAD, 0);
  const high = t.materialsCAD + tax + [...permits, ...hires].filter(live).reduce((s, c) => s + c.highCAD, 0);
  return {
    city,
    permit,
    needsPro: diy.needsPro.map((n) => ({ ...n, live: n.when === "always" || (n.when === "egress_cut" && egressNew) })),
    egressNew,
    electrical: { text: diy.electrical.text, verified: diy.electrical.verified, source: diy.electrical.source },
    ownerBuilder: permit ? { allowed: permit.ownerBuilder.allowed, detail: permit.ownerBuilder.detail, source: permit.ownerBuilder.source } : null,
    trades: diy.trades,
    takeoff: t,
    permits,
    hires,
    totals: { diyLow: Math.round(low), diyHigh: Math.round(high), hiredLow: result?.cost?.low ?? null, hiredHigh: result?.cost?.high ?? null },
    steps: buildOrder(permit?.inspections ?? [], { egressNew, city }),
  };
}
