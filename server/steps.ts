// "Your plan": the few steps from here to a legal second home, each with who does it and what it
// costs. Built from the rules pack's own process, costs and grants; nothing here is a guess. Where
// the pack has no figure (how long building takes), the step simply doesn't show one.
import type { Pack } from "./rules";

export type Step = {
  id: "money" | "drawings" | "permit" | "build" | "inspect";
  title: string;
  who: string;
  time: string | null;
  costLow: number | null;
  costHigh: number | null;
  detail: string;
  items?: string[];
  source?: { title: string; url: string } | null;
};

type Input = {
  city: string;
  fixGroups: { title: string; costLow: number | null; costHigh: number | null }[];
  standard: { title: string }[];
  cost: { low: number; high: number };
  grants: { name: string; fit: string; maxCAD: number | null }[];
  plan?: { areaM2: number } | null;
};

const SQFT_PER_M2 = 10.7639;

function cost(pack: Pack, item: RegExp) {
  return pack.costs.find((c) => item.test(c.item)) ?? null;
}

function processStep(pack: Pack, title: RegExp) {
  return pack.process.find((p) => title.test(p.title)) ?? null;
}

const firstSentence = (text: string) => (text.match(/^.*?[.!?](\s|$)/)?.[0] ?? text).trim();

export function planSteps(r: Input, pack: Pack): Step[] {
  const steps: Step[] = [];
  const money = r.grants.filter((g) => (g.fit === "fits" || g.fit === "depends") && g.maxCAD);
  if (money.length) {
    const p = processStep(pack, /money/i);
    steps.push({
      id: "money",
      title: "Apply for the money first",
      who: "You",
      time: null,
      costLow: null,
      costHigh: null,
      detail: p ? firstSentence(p.detail) : "Grants and loans turn down projects that have already started.",
      items: money.map((g) => g.name),
      source: p?.source ?? null,
    });
  }
  const design = cost(pack, /designer drawings/i);
  const drawings = processStep(pack, /drawings/i);
  steps.push({
    id: "drawings",
    title: "Get permit drawings",
    who: "A BCIN-registered designer",
    time: null,
    costLow: design?.lowCAD ?? null,
    costHigh: design?.highCAD ?? null,
    detail: drawings ? firstSentence(drawings.detail) : "A registered designer draws the suite for the permit.",
    source: drawings?.source ?? null,
  });
  // The permit fee where the pack prices it: per unit, plus per square foot renovated.
  const perUnit = pack.costs.find((c) => /permit: creation of a dwelling unit/i.test(c.item));
  const perSqft = pack.costs.find((c) => /permit: residential renovation area/i.test(c.item));
  const fee = perUnit && perSqft && r.plan?.areaM2 ? Math.round(perUnit.lowCAD + perSqft.lowCAD * r.plan.areaM2 * SQFT_PER_M2) : null;
  const apply = processStep(pack, /apply and pay|apply/i);
  const days = apply?.detail.match(/(\d+)\s+business days/i)?.[1];
  steps.push({
    id: "permit",
    title: "Apply for the building permit",
    who: `City of ${r.city}`,
    time: days ? `about ${days} business days` : null,
    costLow: fee,
    costHigh: fee,
    detail: "Your designer usually files it with you; review starts once the fee is paid.",
    source: apply?.source ?? null,
  });
  steps.push({
    id: "build",
    title: "Build it",
    who: "A licensed contractor",
    time: null,
    costLow: r.cost.low || null,
    costHigh: r.cost.high || null,
    detail: r.fixGroups.length ? "The fixes for your basement, plus the work every basement suite needs." : "The work every basement suite needs.",
    items: [...r.fixGroups.map((g) => g.title), ...r.standard.map((s) => s.title)],
  });
  const inspect = processStep(pack, /inspections/i);
  steps.push({
    id: "inspect",
    title: "Inspections, then move in",
    who: `City of ${r.city} inspector`,
    time: null,
    costLow: null,
    costHigh: null,
    detail: inspect ? firstSentence(inspect.detail) : "The City inspects the work before anyone moves in.",
    source: inspect?.source ?? null,
  });
  return steps;
}
