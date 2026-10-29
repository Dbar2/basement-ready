// "How to apply": the whole road from here to a legal second home, in the order it happens. Built
// from the rules pack's own process (where to go, what to bring, who does it) and the timing of
// the money this homeowner qualifies for. Where the pack has no figure, the step doesn't show one.
//   1. Before any work: zoning in writing, then the programs that refuse started projects.
//   2. Drawings: draw them yourself, or hire a registered designer.
//   3. The permit, inside any grant's permit window.
//   4. Build and inspections.
//   5. After occupancy: the payouts that need the occupancy permit.
//   6. At tax time: the tax credit.
import type { Link, Program } from "./eligibility";
import type { Household, Pack } from "./rules";

export type Task = {
  title: string;
  detail?: string | null;
  links: Link[];
  bring?: string[];
  // Set when the task is a money program's: "ask" ones are shown as "if you qualify".
  program?: { id: string; qualify: "yes" | "ask" } | null;
};

export type Step = {
  id: "before" | "drawings" | "permit" | "build" | "after" | "tax";
  when: string;
  title: string;
  who: string;
  time: string | null;
  costLow: number | null;
  costHigh: number | null;
  costNote?: string | null;
  detail: string;
  tasks: Task[];
  source?: { title: string; url: string; section?: string | null } | null;
};

type Input = {
  city: string;
  household: Household;
  programs: Pick<Program, "id" | "shortName" | "qualify" | "apply">[];
  fixGroups: { title: string; costLow: number | null; costHigh: number | null }[];
  standard: { title: string }[];
  cost: { low: number; high: number };
  // The floor being finished: the scan's plan when there is one, else the house's footprint.
  areaM2?: number | null;
};

const SQFT_PER_M2 = 10.7639;
const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

type ProcessStep = {
  step: number;
  title: string;
  detail: string;
  phase?: Step["id"] | null;
  task?: string;
  who?: string;
  time?: string;
  where?: Link[];
  bring?: string[];
  source?: Step["source"];
};

const firstSentence = (text: string) => (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim();

function processTasks(pack: Pack, phase: Step["id"]): { steps: ProcessStep[]; tasks: Task[] } {
  const steps = (pack.process as ProcessStep[]).filter((p) => p.phase === phase);
  return {
    steps,
    tasks: steps.filter((p) => p.task).map((p) => ({ title: p.task!, detail: firstSentence(p.detail), links: p.where ?? [], bring: p.bring ?? [] })),
  };
}

// The permit fee from the pack's own rates and the floor area being finished.
export function permitFee(pack: Pack, areaM2: number | null | undefined) {
  const f = (pack as any).permitFee as
    | { perUnitCAD?: number; perSqftCAD?: number; minimumCAD?: number; extras?: { label: string; CAD: number; refundable?: boolean }[]; estimate?: boolean; note?: string; source?: Step["source"] }
    | undefined;
  if (!f?.perSqftCAD) return null;
  const extras = f.extras ?? [];
  const kept = extras.filter((e) => !e.refundable).reduce((s, e) => s + e.CAD, 0);
  const refundable = extras.filter((e) => e.refundable);
  const rate = [f.perUnitCAD ? `${money(f.perUnitCAD)} per new home` : null, `$${f.perSqftCAD.toFixed(2)} per sq ft`, ...extras.filter((e) => !e.refundable).map((e) => `${money(e.CAD)} ${e.label}`)]
    .filter(Boolean)
    .join(" + ");
  const deposit = refundable.map((e) => `plus a ${money(e.CAD)} ${e.label}`).join(", ");
  if (!areaM2 || areaM2 <= 0) return { amount: null, note: [rate, deposit].filter(Boolean).join(", "), estimate: Boolean(f.estimate), source: f.source ?? null };
  const sqft = Math.round(areaM2 * SQFT_PER_M2);
  const amount = Math.max(f.minimumCAD ?? 0, Math.round((f.perUnitCAD ?? 0) + f.perSqftCAD * sqft + kept));
  return {
    amount,
    note: [`${rate}, for about ${sqft.toLocaleString("en-CA")} sq ft`, deposit, f.note].filter(Boolean).join(". "),
    estimate: Boolean(f.estimate),
    source: f.source ?? null,
  };
}

// A money program's own task for one phase: applying, or collecting the payout.
function programTask(p: Input["programs"][number], kind: "apply" | "payout"): Task | null {
  const a = p.apply;
  if (!a || p.qualify === "no") return null;
  const program = { id: p.id, qualify: p.qualify };
  if (kind === "payout") {
    if (!a.payout) return null;
    return { title: `${p.shortName}: ${a.payout.title}`, detail: a.payout.detail ?? null, links: a.payout.where ?? [], bring: a.payout.bring ?? [], program };
  }
  return { title: p.shortName, detail: a.detail ?? (a.paidWhen ? `Apply now; it's paid ${a.paidWhen}.` : null), links: a.where, bring: a.bring, program };
}

export function planSteps(r: Input, pack: Pack): Step[] {
  const steps: Step[] = [];
  const live = r.programs.filter((p) => p.qualify !== "no");
  const has = (id: string) => live.some((p) => p.id === id);

  // 1. Before any work.
  const before = processTasks(pack, "before");
  const applyFirst = live.filter((p) => p.apply?.when === "before_work").map((p) => programTask(p, "apply")).filter((t): t is Task => t !== null);
  const moneyFirst = (pack.process as ProcessStep[]).find((p) => /money/i.test(p.title));
  steps.push({
    id: "before",
    when: "Before any work",
    title: applyFirst.length ? "Confirm zoning, then apply for the money" : "Confirm zoning",
    who: "You",
    time: null,
    costLow: null,
    costHigh: null,
    detail: applyFirst.length
      ? "These programs turn down projects that have already started, so apply before anyone picks up a tool."
      : "Get the City to confirm your lot allows a second unit before you pay for drawings.",
    tasks: [...before.tasks, ...applyFirst],
    source: moneyFirst?.source ?? before.steps[0]?.source ?? null,
  });

  // 2. Drawings: the owner may draw their own; otherwise a registered designer.
  const drawings = processTasks(pack, "drawings");
  const pros = pack.pros ?? {};
  const designerCost = pros.designerCost as { lowCAD: number; highCAD: number; note?: string; source?: Step["source"] } | undefined;
  const drawTasks: Task[] = [];
  if (pros.selfDraw) {
    drawTasks.push({
      title: "Draw them yourself",
      detail: [pros.selfDraw.detail, pros.selfDraw.note].filter(Boolean).join(" "),
      links: [pros.selfDraw.checklist, pros.selfDraw.rule].filter(Boolean),
    });
  }
  if (pros.registry) {
    drawTasks.push({
      title: "Or hire a registered (BCIN) designer",
      detail: [pros.registry.howToSearch, pros.cityNote].filter(Boolean).join(" "),
      links: pros.registry.searchLinks ?? [{ label: "Ontario's designer registry (QuARTS)", url: pros.registry.url }],
    });
  }
  steps.push({
    id: "drawings",
    when: "Next",
    title: "Get permit drawings",
    who: pros.selfDraw ? "You, or a BCIN designer" : "A BCIN designer",
    time: null,
    costLow: designerCost?.lowCAD ?? null,
    costHigh: designerCost?.highCAD ?? null,
    costNote: designerCost?.note ?? null,
    detail: `Plans of the suite for the permit, drawn to the City's checklist${pros.selfDraw ? ": by you, or by a registered designer" : ""}.`,
    tasks: [...drawTasks, ...drawings.tasks],
    source: drawings.steps.find((p) => /drawings/i.test(p.title))?.source ?? null,
  });

  // 3. The permit, inside any grant's window.
  const permit = processTasks(pack, "permit");
  const fee = permitFee(pack, r.areaM2);
  const apply = permit.steps.find((p) => /apply/i.test(p.title));
  const permitTasks = [...permit.tasks, ...live.filter((p) => p.apply?.when === "at_permit").map((p) => programTask(p, "apply")).filter((t): t is Task => t !== null)];
  if (has("region_ontario_renovates_secondary_suites")) {
    const region = r.programs.find((p) => p.id === "region_ontario_renovates_secondary_suites")!;
    permitTasks.push({
      title: `${region.shortName}: send the permit and 3 quotes`,
      detail: "Once the Region approves you in principle, send it a copy of the permit and 3 contractor quotes (with WSIB and liability insurance), then sign the loan agreement before work starts.",
      links: region.apply?.where ?? [],
      program: { id: region.id, qualify: region.qualify as "yes" | "ask" },
    });
  }
  const deadline = has("city_waterloo_aru_grant_interior") ? "Within 120 days of the City grant's approval." : null;
  steps.push({
    id: "permit",
    when: deadline ? "Within 120 days of grant approval" : "Once the drawings are done",
    title: "Get the building permit",
    who: apply?.who ?? "You or your designer",
    time: apply?.time ?? null,
    costLow: fee?.amount ?? null,
    costHigh: fee?.amount ?? null,
    costNote: fee ? `${fee.estimate ? "Estimate: " : ""}${fee.note}` : null,
    detail: [deadline, "Review starts once the fee is paid. Don't start work until the permit is issued."].filter(Boolean).join(" "),
    tasks: permitTasks,
    source: apply?.source ?? null,
  });

  // 4. Build and inspections.
  const build = processTasks(pack, "build");
  // A trade rule that belongs to one program shows only while that program is in play.
  const trades = ((pros.trades ?? []) as { title: string; detail: string; url: string; label: string; program?: string }[]).filter((t) => !t.program || has(t.program));
  steps.push({
    id: "build",
    when: "After the permit",
    title: "Build it, with inspections",
    who: "Licensed trades, and the City's inspector",
    time: null,
    costLow: r.cost.low || null,
    costHigh: r.cost.high || null,
    detail: r.fixGroups.length ? "The fixes for your basement, plus the work every basement suite needs." : "The work every basement suite needs.",
    tasks: [...trades.map((t) => ({ title: t.title, detail: t.detail, links: [{ label: t.label, url: t.url }] })), ...build.tasks],
    source: build.steps[0]?.source ?? null,
  });

  // 5. After occupancy: the payouts.
  const after = processTasks(pack, "after");
  const renting = r.household !== "relative";
  const afterTasks = [
    ...after.tasks.filter((t) => renting || !/rental licen/i.test(t.title)),
    ...live.map((p) => programTask(p, "payout")).filter((t): t is Task => t !== null),
    ...live.filter((p) => p.apply?.when === "after_occupancy").map((p) => programTask(p, "apply")).filter((t): t is Task => t !== null),
  ];
  const payouts = afterTasks.some((t) => t.program);
  steps.push({
    id: "after",
    when: "After occupancy",
    title: payouts ? "Move in, then collect the money" : "Move in",
    who: "You",
    time: null,
    costLow: null,
    costHigh: null,
    detail: `The City approves occupancy after the final inspection.${payouts ? " The money pays out after that, against your paid invoices." : ""}`,
    tasks: afterTasks,
    source: after.steps[0]?.source ?? null,
  });

  // 6. At tax time.
  const tax = live.filter((p) => p.apply?.when === "tax_time").map((p) => programTask(p, "apply")).filter((t): t is Task => t !== null);
  if (tax.length) {
    steps.push({
      id: "tax",
      when: "At tax time",
      title: "Claim the tax credit",
      who: "You",
      time: null,
      costLow: null,
      costHigh: null,
      detail: "Claim it for the year the suite is finished. Keep every receipt.",
      tasks: tax,
      source: null,
    });
  }
  return steps;
}
