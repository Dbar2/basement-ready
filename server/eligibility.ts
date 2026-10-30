// Which money a homeowner qualifies for, decided in code from each program's written conditions
// (data/rules/*.json) and what we know: who the suite is for, a few plain answers, public records
// about the house, and the plan's cost. Every open program gets one of three answers:
//   yes: they qualify, with why and what they agree to.
//   no:  they don't, with the reason in one line.
//   ask: one plain question decides it.
// Nothing here is a model call, and a program is never "yes" while one of its conditions is unknown.
import type { Household, Pack } from "./rules";
import type { Property } from "./property";

export type Qualify = "yes" | "no" | "ask";
export type MoneyQuestionId = "household" | "rent" | "lives_there" | "other_home" | "house_value" | "senior" | "work_started";
export type MoneyValue = boolean | number | string;
export type MoneyAnswers = Partial<Record<MoneyQuestionId, MoneyValue | null>>;

export type Link = { label: string; url: string };
export type Apply = {
  when: "before_work" | "at_permit" | "after_occupancy" | "tax_time";
  paidWhen?: string | null;
  detail?: string | null;
  who: string;
  where: Link[];
  bring: string[];
  // The second visit for programs that approve first and pay after occupancy.
  payout?: { title: string; detail?: string | null; where?: Link[]; bring?: string[] } | null;
};

export type Program = {
  id: string;
  name: string;
  shortName: string;
  level: string;
  kind: string;
  status: string;
  amount: string;
  maxCAD: number | null;
  // What this program is worth to this project: cash is counted in the headline, savings and
  // financing are shown but never added up as money you get.
  value: "cash" | "savings" | "financing";
  amountCAD: number | null;
  qualify: Qualify;
  reason: string;
  question: MoneyQuestionId | null;
  commitments: string[];
  note: string | null;
  apply: Apply | null;
  source: { title: string; url: string; section?: string | null; retrieved?: string };
  verified: boolean;
};

export type MoneyQuestion = {
  id: MoneyQuestionId;
  question: string;
  hint: string;
  options: { label: string; value: MoneyValue }[];
  decides: string[]; // short names of the programs this answer settles
  answer: MoneyValue | null;
};

export type MoneyInput = {
  household: Household;
  answers: MoneyAnswers;
  property?: Pick<Property, "unitsRegistered"> | null;
  costHigh?: number | null;
};

export const MONEY_QUESTION_IDS: MoneyQuestionId[] = ["household", "rent", "lives_there", "other_home", "house_value", "senior", "work_started"];
// Answered through the answers route (household has its own route and lives on the basement).
export const STORED_MONEY_QUESTIONS = new Set<string>(MONEY_QUESTION_IDS.filter((id) => id !== "household"));

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const YES_NO = [
  { label: "Yes", value: true },
  { label: "No", value: false },
  { label: "Not sure", value: "unsure" },
];

// Rent and income caps are read for a one-bedroom suite, the layout we suggest for a basement.
type Size = "bachelor" | "1br";
const SIZE: Size = "1br";
const sizeWords = (s: Size) => (s === "bachelor" ? "a bachelor unit" : "a one-bedroom unit");

function capFor(g: any, size: Size): number | null {
  const v = g.conditions?.rentCap?.monthlyCAD?.[size];
  return typeof v === "number" ? v : null;
}
function incomeFor(g: any, size: Size): number | null {
  const v = g.conditions?.tenantIncomeLimit?.householdCAD?.[size];
  return typeof v === "number" ? v : null;
}
// Where official sources disagree on a cap, decide with the stricter one and say so.
function houseValueCaps(g: any): { strict: number; other: number | null } | null {
  const c = g.conditions?.houseValueCapCAD;
  if (!c) return null;
  if (typeof c.value === "number") return { strict: c.value, other: null };
  const values = (c.conflict ?? []).map((x: any) => x.valueCAD).filter((x: unknown): x is number => typeof x === "number");
  if (!values.length) return null;
  const strict = Math.min(...values);
  const other = Math.max(...values);
  return { strict, other: other === strict ? null : other };
}

const open = (v: MoneyValue | null | undefined) => v === undefined || v === null || v === "unsure";

// One condition: a question whose answer passes or fails, or a fact we already know.
type Check =
  | { q: MoneyQuestionId; ok: (v: MoneyValue) => boolean; no: string; ask: string }
  | { fact: boolean; no: string };

function decide(checks: Check[], answers: MoneyAnswers): { qualify: Qualify; reason: string | null; question: MoneyQuestionId | null } {
  let first: { q: MoneyQuestionId; ask: string } | null = null;
  for (const c of checks) {
    if ("fact" in c) {
      if (!c.fact) return { qualify: "no", reason: c.no, question: null };
      continue;
    }
    const v = answers[c.q];
    if (open(v)) {
      first ??= c;
      continue;
    }
    // A definite "no" anywhere settles it, even with other answers still open.
    if (!c.ok(v!)) return { qualify: "no", reason: c.no, question: null };
  }
  if (first) return { qualify: "ask", reason: first.ask, question: first.q };
  return { qualify: "yes", reason: null, question: null };
}

// Rent: "none" (family, no lease), a monthly amount they'll stay at or under, or "market".
const rentUnder = (cap: number) => (v: MoneyValue) => typeof v === "number" && v > 0 && v <= cap;
const lives = (v: MoneyValue) => v === true;
const notStarted = (v: MoneyValue) => v === false;

function rentNo(v: MoneyValue | null | undefined, cap: number, what: string) {
  if (v === "none") return `${what} the suite is rented on a lease, at ${money(cap)} a month or less.`;
  return `${what} rent of ${money(cap)} a month or less; above that doesn't qualify.`;
}

// What a cash program pays toward this project: its own rule, never more than the cost still unpaid
// (`left`, null when the cost isn't known).
type Rated = Omit<Program, "amountCAD"> & { cost: (high: number | null, left: number | null) => number | null };

function program(g: any, rest: Pick<Program, "value" | "qualify" | "reason" | "question" | "commitments" | "note">, cost?: Rated["cost"]): Rated {
  return {
    id: g.id,
    name: g.name,
    shortName: g.shortName ?? g.name,
    level: g.level,
    kind: g.kind,
    status: g.status,
    amount: g.amount,
    maxCAD: typeof g.maxCAD === "number" ? g.maxCAD : null,
    apply: g.apply ?? null,
    source: g.source,
    verified: Boolean(g.verified),
    ...rest,
    cost: cost ?? ((_high, left) => (typeof g.maxCAD === "number" ? Math.min(g.maxCAD, left ?? g.maxCAD) : null)),
  };
}

// Each open program's conditions, in the order a homeowner would settle them.
function evaluateProgram(g: any, f: Required<Pick<MoneyInput, "household" | "answers">> & { homesAfter: number; size: Size }): Rated | null {
  const a = { ...f.answers, household: f.household === "unsure" ? null : f.household };
  const c = g.conditions ?? {};
  const fundsNote = c.firstComeWhileFundsLast ? "Paid in the order applications arrive, while the money lasts." : null;

  if (g.id === "region_ontario_renovates_secondary_suites") {
    const cap = capFor(g, f.size) ?? 0;
    const income = incomeFor(g, f.size);
    const value = houseValueCaps(g);
    const d = decide(
      [
        { q: "rent", ok: rentUnder(cap), no: rentNo(a.rent, cap, "It's only for a suite where"), ask: "Depends on the rent you'll charge." },
        { q: "lives_there", ok: lives, no: "You have to live in the house yourself.", ask: "Depends on whether you live in the house." },
        { q: "other_home", ok: (v) => v === false, no: "It's only for owners whose one home this is.", ask: "Depends on whether you own another home." },
        ...(value
          ? [
              {
                q: "house_value" as const,
                ok: (v: MoneyValue) => v === true,
                no: `Your house is assessed above the ${money(value.strict)} limit.`,
                ask: "Depends on your house's assessed value.",
              },
            ]
          : []),
        { q: "work_started", ok: notStarted, no: "It turns down projects that have already started.", ask: "Depends on whether work has started." },
      ],
      a,
    );
    return program(g, {
      value: "cash",
      ...d,
      reason: d.reason ?? "You live here, it's your only home, it's under the value limit, the rent fits and work hasn't started.",
      commitments: [
        "Live in the house for 15 years, or repay what's left",
        `Rent at ${money(cap)} a month or less, utilities included, for 15 years`,
        income ? `A tenant whose household earns under ${money(income)}, checked by the Region before the lease` : "A tenant the Region checks before the lease",
        `${c.contractorQuotesRequired ?? 3} contractor quotes, from contractors with WSIB and liability insurance`,
        "Your mortgages plus this loan stay under 90% of the assessed value",
      ],
      note: [
        value?.other ? `The Region's fact sheet sets the house limit at ${money(value.strict)}; its web page says ${money(value.other)}. Between the two, ask the Region.` : null,
        "Money is limited each year; once it's gone, approved homes wait for next year.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }

  if (g.id === "city_waterloo_aru_grant_interior") {
    const cap = capFor(g, f.size) ?? 0;
    const income = incomeFor(g, f.size);
    const d = decide(
      [
        { q: "rent", ok: rentUnder(cap), no: rentNo(a.rent, cap, "It pays only when"), ask: "Depends on the rent you'll charge." },
        { q: "work_started", ok: notStarted, no: "It turns down projects that have already started.", ask: "Depends on whether work has started." },
      ],
      a,
    );
    const share = typeof c.costSharePct === "number" ? c.costSharePct / 100 : 1;
    return program(
      g,
      {
        value: "cash",
        ...d,
        reason: d.reason ?? `You'll charge ${money(cap)} or less and work hasn't started.`,
        commitments: [
          `Rent at ${money(cap)} a month or less, utilities included, for ${c.affordabilityYears ?? 5} years`,
          income ? `A tenant whose household earns under ${money(income)} (family counts, not your spouse or a dependent)` : "An eligible tenant",
          `A building permit within ${c.buildingPermitWithinDays ?? 120} days of approval, and the suite finished and lived in within ${c.completeAndOccupyWithinMonths ?? 12} months`,
          "A City rental licence before you rent, and no short-term rentals",
        ],
        note: "First come, first served until the City's budget runs out.",
      },
      (high, left) => {
        const max = typeof g.maxCAD === "number" ? g.maxCAD : null;
        if (max == null) return null;
        const own = high ? Math.min(max, Math.round(high * share)) : max;
        return left == null ? own : Math.min(own, left);
      },
    );
  }

  if (g.id === "federal_mhrtc") {
    const d = decide(
      [
        { q: "household", ok: (v) => v === "relative", no: "It's for family living together, not a rental.", ask: "Depends on who will live there." },
        { q: "senior", ok: (v) => v === true, no: "It needs someone 65 or older, or with the disability tax credit, living with family.", ask: "Depends on whether someone 65+ or with a disability will live there." },
      ],
      a,
    );
    const rate = typeof c.ratePct === "number" ? c.ratePct / 100 : null;
    const cap = typeof c.maxQualifyingExpensesCAD === "number" ? c.maxQualifyingExpensesCAD : null;
    return program(
      g,
      {
        value: "cash",
        ...d,
        reason: d.reason ?? "Someone 65+ or with a disability will live with family in the house.",
        commitments: [
          "Claim it on your tax return for the year the suite is finished",
          "Both of you move in within 12 months of finishing",
          "Keep every receipt; your own labour, appliances and costs a grant paid for don't count",
        ],
        note: null,
      },
      // 14% of up to $50,000 of costs, leaving out what a grant or loan already paid for.
      (_high, left) => {
        const max = typeof g.maxCAD === "number" ? g.maxCAD : null;
        if (max == null || rate == null || cap == null || left == null) return max;
        return Math.min(max, Math.round(rate * Math.min(cap, left)));
      },
    );
  }

  if (g.id === "dc_exemption_aru") {
    const units: number[] = c.unitNumberInHouse ?? [2, 3];
    const d = decide([{ fact: units.includes(f.homesAfter), no: `This suite would be home number ${f.homesAfter} on the lot; the exemption covers the ${units.join(" and ")}.` }], a);
    return program(g, {
      value: "savings",
      ...d,
      reason: d.reason ?? `Your suite is home number ${f.homesAfter} on the lot, so by Ontario law no development charges apply to it.`,
      commitments: [],
      note: "Nothing to apply for. Check the permit bill for any school-board charge.",
    });
  }

  if (g.id === "cmhc_refinance_secondary_suite") {
    const maxUnits = typeof c.maxUnitsIncludingExisting === "number" ? c.maxUnitsIncludingExisting : 4;
    const familyLivesThere = f.household === "relative";
    const d = decide(
      [
        { fact: f.homesAfter <= maxUnits, no: `It covers up to ${maxUnits} homes on the property; this would be ${f.homesAfter}.` },
        ...(familyLivesThere
          ? []
          : [{ q: "lives_there" as const, ok: lives, no: "You or a close relative have to live in the house.", ask: "Depends on whether you live in the house." }]),
        { q: "work_started", ok: notStarted, no: "CMHC has to approve it before construction starts.", ask: "Depends on whether work has started." },
      ],
      a,
    );
    return program(g, {
      value: "financing",
      ...d,
      reason: d.reason ?? `${familyLivesThere ? "Your relative will live" : "You live"} in the house and work hasn't started.`,
      commitments: [
        "Approved by CMHC, through your lender, before building starts",
        "Borrow up to 90% of the finished home's value (under $2 million), over up to 30 years",
        "No short-term rentals: leases of 90 days or more",
      ],
      note: "A loan, not free money: it lets you borrow against the finished value.",
    });
  }

  if (g.id === "city_kitchener_adu_grant") {
    return program(g, {
      value: "savings",
      qualify: "yes",
      question: null,
      reason: "Anyone can live there, with no rent cap. It refunds any school-board charge on your permit bill; a basement unit usually has none.",
      commitments: ["A permit issued on or after January 5, 2026", "No short-term rentals", "No tax or utility arrears"],
      note: fundsNote,
    });
  }

  if (g.id === "city_cambridge_aru_grant") {
    const d = decide([{ q: "work_started", ok: notStarted, no: "It's refused when work starts before the permit is issued.", ask: "Depends on whether work has started." }], a);
    const left = c.remainingFundsCAD?.value;
    return program(g, {
      value: "cash",
      ...d,
      reason: d.reason ?? "Anyone can live there, with no rent cap, and work hasn't started.",
      commitments: ["Don't start any work before the permit is issued", "Keep every paid invoice", "One grant per property, paid after the suite is finished and the permit is closed"],
      note: [fundsNote, typeof left === "number" ? `${money(left)} of ${money(c.programBudgetCAD ?? left)} was left on ${c.remainingFundsCAD.asOf}.` : null].filter(Boolean).join(" ") || null,
    });
  }

  // A program this file doesn't know yet: never claim it, never hide it.
  return program(g, { value: typeof g.maxCAD === "number" ? "cash" : "savings", qualify: "ask", question: null, reason: g.fitsPlansNote ?? "Check this program's conditions.", commitments: [], note: null });
}

// The questions, worded for a homeowner. Options for rent follow the caps in this city's programs.
function questionFor(id: MoneyQuestionId, pack: Pack, f: { household: Household; size: Size }): Omit<MoneyQuestion, "decides" | "answer"> {
  switch (id) {
    case "household":
      return {
        id,
        question: "Who will live down there?",
        hint: "It decides which money fits.",
        options: [
          { label: "A parent or relative", value: "relative" },
          { label: "A renter", value: "renter" },
          { label: "Not sure yet", value: "unsure" },
        ],
      };
    case "rent": {
      const caps = [...new Set(pack.grants.filter((g) => g.status === "open").map((g) => capFor(g, f.size)).filter((x): x is number => x != null))].sort((x, y) => x - y);
      const options: MoneyQuestion["options"] = [];
      if (f.household !== "renter") options.push({ label: "No rent", value: "none" });
      caps.forEach((cap, i) => options.push({ label: i === 0 ? `${money(cap)} or less` : `${money(caps[i - 1] + 1)} to ${money(cap)}`, value: cap }));
      if (caps.length) options.push({ label: `More than ${money(caps[caps.length - 1])}`, value: "market" });
      options.push({ label: "Not sure", value: "unsure" });
      return {
        id,
        question: f.household === "relative" ? "Will they pay rent? How much a month?" : "What rent will you charge a month?",
        hint: `Including utilities, for ${sizeWords(f.size)}. The money that pays you to build caps the rent.`,
        options,
      };
    }
    case "lives_there":
      return { id, question: "Do you live in this house?", hint: "As your main home.", options: YES_NO };
    case "other_home":
      return { id, question: "Do you own any other home or property?", hint: "A cottage or a share in another property counts.", options: YES_NO };
    case "house_value": {
      const region = pack.grants.find((g) => g.id === "region_ontario_renovates_secondary_suites");
      const caps = region ? houseValueCaps(region) : null;
      return {
        id,
        question: `Is your house's assessed value ${caps ? money(caps.strict) : "under the limit"} or less?`,
        hint: "It's on your property tax bill or MPAC notice, and is usually well below what the house would sell for.",
        options: YES_NO,
      };
    }
    case "senior":
      return {
        id,
        question: "Will someone 65 or older, or with a disability, live in the house?",
        hint: "In either home: a parent moving in, or you, with family moving in. A disability means they can get the disability tax credit.",
        options: YES_NO,
      };
    case "work_started":
      return { id, question: "Has any work on the suite started?", hint: "Building, demolition or removing walls. Most programs turn down projects already under way.", options: YES_NO };
  }
}

const PAYS_FIRST: Record<string, number> = { grant: 0, forgivable_loan: 1, refundable_tax_credit: 2 };

export function homesAfter(property?: Pick<Property, "unitsRegistered"> | null) {
  return Math.max(1, property?.unitsRegistered ?? 1) + 1;
}

export function evaluateMoney(pack: Pack, input: MoneyInput) {
  const size = SIZE;
  const answers = Object.fromEntries(Object.entries(input.answers ?? {}).filter(([k]) => MONEY_QUESTION_IDS.includes(k as MoneyQuestionId))) as MoneyAnswers;
  const facts = { household: input.household, answers, homesAfter: homesAfter(input.property), size };
  const rated = pack.grants
    .filter((g) => g.status === "open")
    .map((g) => evaluateProgram(g, facts))
    .filter((p): p is Rated => p !== null);
  const high = input.costHigh && input.costHigh > 0 ? input.costHigh : null;
  // Money can't add up to more than the work costs. Grants pay first, then the loan, and the tax
  // credit counts only costs nobody else paid for. A program one answer away is worth what it would
  // add on its own, on top of what they already qualify for.
  const amounts = new Map<string, number | null>();
  let left = high;
  const byOrder = (x: Rated, y: Rated) => (PAYS_FIRST[x.kind] ?? 9) - (PAYS_FIRST[y.kind] ?? 9);
  for (const p of rated.filter((p) => p.qualify === "yes" && p.value === "cash").sort(byOrder)) {
    const amount = p.cost(high, left);
    amounts.set(p.id, amount);
    if (left != null && amount != null) left = Math.max(0, left - amount);
  }
  for (const p of rated.filter((p) => p.qualify === "ask" && p.value === "cash")) amounts.set(p.id, p.cost(high, left));
  const programs: Program[] = rated.map(({ cost, ...p }) => {
    if (p.value !== "cash") return { ...p, amountCAD: null };
    const amountCAD = amounts.has(p.id) ? amounts.get(p.id)! : cost(high, null);
    const nothingLeft = p.qualify === "yes" && amountCAD === 0;
    return { ...p, amountCAD, reason: nothingLeft ? `${p.reason} The other money already covers the estimated cost, so nothing is left to claim.` : p.reason };
  });
  // Yes first, then one answer away, then no.
  const order: Record<Qualify, number> = { yes: 0, ask: 1, no: 2 };
  programs.sort((x, y) => order[x.qualify] - order[y.qualify] || (y.amountCAD ?? 0) - (x.amountCAD ?? 0));

  const sum = (q: Qualify) => programs.filter((p) => p.qualify === q && p.value === "cash").reduce((s, p) => s + (p.amountCAD ?? 0), 0);
  const total = sum("yes");
  const asked = [...new Set(programs.filter((p) => p.qualify === "ask" && p.question).map((p) => p.question!))];
  const answerOf = (id: MoneyQuestionId) => (id === "household" ? input.household : (answers[id] ?? null));
  const full = (id: MoneyQuestionId): MoneyQuestion => ({
    ...questionFor(id, pack, { household: input.household, size }),
    decides: programs.filter((p) => p.question === id).map((p) => p.shortName),
    answer: answerOf(id),
  });
  return {
    programs,
    // Still deciding a program: unanswered, or answered "Not sure".
    questions: MONEY_QUESTION_IDS.filter((id) => asked.includes(id)).map(full),
    // Everything they've told us, so any answer is one tap to change.
    answered: MONEY_QUESTION_IDS.filter((id) => (id === "household" ? input.household !== "unsure" : answers[id] != null)).map(full),
    // Money you qualify for now, and what the open questions could add (never past the cost).
    total,
    ifYes: left == null ? sum("ask") : Math.min(sum("ask"), left),
  };
}

export type MoneyResult = ReturnType<typeof evaluateMoney>;

// ---- Ask once ------------------------------------------------------------------------------------

// Who it's for, asked once on the start sheet with the rent folded in. Saved as the household plus
// the rent answer, and as "who" itself, so nothing asks it again.
export const WHO_ID = "who";
export type Who = "family" | "rental_capped" | "rental_market" | "unsure";
export const WHO_IDS: Who[] = ["family", "rental_capped", "rental_market", "unsure"];

// The lowest rent cap among this city's open programs: a rent at or under it fits all of them.
export function lowestRentCap(pack: Pack): number | null {
  const caps = pack.grants.filter((g) => g.status === "open").map((g) => capFor(g, SIZE)).filter((x): x is number => x != null);
  return caps.length ? Math.min(...caps) : null;
}

export function fromWho(who: Who, pack: Pack): { household: Household; rent: MoneyValue | null } {
  const cap = lowestRentCap(pack);
  switch (who) {
    case "family":
      return { household: "relative", rent: "none" };
    // No program here caps rent: the rent changes nothing, so none is saved.
    case "rental_capped":
      return { household: "renter", rent: cap };
    case "rental_market":
      return { household: "renter", rent: cap == null ? null : "market" };
    case "unsure":
      return { household: "unsure", rent: "unsure" };
  }
}

export function whoQuestion(): { id: string; question: string; hint: string; options: { label: string; value: MoneyValue }[] } {
  return {
    id: WHO_ID,
    question: "Who's it for?",
    hint: "Who lives there and the rent decide which money fits.",
    options: [
      { label: "Family, no rent", value: "family" },
      { label: "Rental, about $1,200/mo or less", value: "rental_capped" },
      { label: "Rental at market rent", value: "rental_market" },
      { label: "Not sure", value: "unsure" },
    ],
  };
}

export type WaitAsk = {
  id: string;
  kind: "who" | "plans" | "rule" | "money";
  question: string;
  hint: string;
  options: { label: string; value: MoneyValue }[];
  words?: boolean; // their own words are welcome too
  decides?: string[];
};

type RuleAsk = { ruleId: string; question: string; hint?: string | null };
type FindingLike = { ruleId: string; status: string; question?: string | null; hint?: string | null; answer?: unknown; options?: unknown[] | null; check?: { operator: string; value: unknown } };

// What the wait screen still asks, in order, each question at most once. Anything with a saved answer
// is never asked again, "Not sure" included; a money question is asked only while it still decides a
// program. Before the result, the rule questions are the ones only a homeowner can answer; after it,
// the ones the scan left open.
export function waitQuestions(
  pack: Pack,
  input: {
    household: Household;
    answers: Record<string, unknown>;
    property?: Pick<Property, "unitsRegistered"> | null;
    findings?: FindingLike[] | null;
    ruleAsks: RuleAsk[];
    plans: { id: string; question: string; hint: string; options: { label: string; value: MoneyValue }[] };
  },
): WaitAsk[] {
  const said = (id: string) => input.answers[id] !== undefined && input.answers[id] !== null;
  const asks: WaitAsk[] = [];
  const add = (a: WaitAsk) => {
    if (!said(a.id) && !asks.some((x) => x.id === a.id)) asks.push(a);
  };
  // The start sheet asks who it's for. A take from somewhere that didn't ask gets it here, once.
  if (input.household === "unsure" && !said(WHO_ID)) add({ kind: "who", ...whoQuestion() });
  add({ kind: "plans", ...input.plans, words: true });
  const rules = new Set(pack.rules.map((r) => r.id));
  const yesNo = (f: FindingLike) => f.check?.operator === "exists" || typeof f.check?.value === "boolean" || Boolean(f.options?.length);
  const open = input.findings
    ? input.findings.filter((f) => f.status === "needs_answer" && !f.answer && f.question && yesNo(f)).map((f) => ({ ruleId: f.ruleId, question: f.question!, hint: f.hint ?? "" }))
    : input.ruleAsks.filter((r) => rules.has(r.ruleId));
  for (const r of open) add({ id: r.ruleId, kind: "rule", question: r.question, hint: r.hint ?? "", options: YES_NO });
  // Who it's for was asked above or at the start; the rest only while they still decide something.
  const money = evaluateMoney(pack, { household: input.household, answers: input.answers as MoneyAnswers, property: input.property ?? null });
  for (const q of money.questions) if (q.id !== "household") add({ id: q.id, kind: "money", question: q.question, hint: q.hint, options: q.options, decides: q.decides });
  return asks;
}

// Keeps only a value the question offers.
export function cleanMoneyAnswer(id: string, v: unknown, pack: Pack): MoneyValue | null {
  if (!STORED_MONEY_QUESTIONS.has(id)) return null;
  // Any household's options: who it's for may change after the answer.
  const options = (["relative", "renter"] as const).flatMap((household) => questionFor(id as MoneyQuestionId, pack, { household, size: SIZE }).options);
  return options.some((o) => o.value === v) ? (v as MoneyValue) : null;
}
