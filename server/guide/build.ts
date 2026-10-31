// The Build milestone as the guide's list: what it still needs before the permit set can be handed in,
// the money questions still open, and who builds it, one thing at a time, in the order the guide asks.
// Each item carries the guide's line, why it's asking, and the inline card that takes the answer
// (src/guide/cards). The script (server/guide/script.ts) walks this list; the home base and the Build
// visuals read its counts. Pure: the same list for a real scan and for the example, whose workspace
// lives in the browser. Nothing here is a model call.
//
// The cards save through the workspace API as the Permit tab did, then tell the guide what they saved
// (`{ type: "permitItem", itemId, value: { said } }`); the list is worked out again from the workspace.
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import type { CardRef, Choice, StepId, VisualRef } from "../../src/guide/types";
import { savedAnswers } from "../answers";
import { db, schema } from "../db";
import { evaluateMoney, type MoneyAnswers, type MoneyQuestion, type Program } from "../eligibility";
import type { Property } from "../property";
import { packFor, type Household } from "../rules";
import { permitStatus } from "../permit/package";
import type { ReadyItem } from "../permit/readiness";
import { pricedForBasement, pricedSample } from "../priced";
import { loadWorkspace, ProfileSchema, StateSchema, type Profile, type StoredState } from "../workspace";

export type BuildSection = "permit" | "money" | "builders" | "done";
export type BuildItem = {
  step: StepId; // "build.permit:<id>", "build.submit", "build.money:<question>", "build.builders", "done"
  section: BuildSection;
  message: string;
  why: string; // "" where nothing is asked: the submit copy and the last step
  card?: CardRef;
  choices?: Choice[];
  visual: VisualRef;
  done: boolean;
  // About how long it takes them, for the guide's "about N minutes" (permit items only).
  minutes?: number;
};
export type BuildList = {
  items: BuildItem[]; // in the order the guide asks, done ones included; always ends with "done"
  next: BuildItem; // the first one not done ("done" when nothing is left)
  permit: { ready: number; total: number; canSubmit: boolean; city: string; authority: string; portal: { label: string; url: string } | null };
  money: { total: number; ifYes: number; programs: { name: string; amountCAD: number | null; qualify: Program["qualify"]; value: Program["value"] }[] };
  builders: { path: "hire" | "diy" | "mix" | null; quotes: number };
};

export type BuildInput = {
  result: any; // the result priced on their design (server/priced.ts): cost, grants, money, moneyQuestions
  // What the permit routes draw from, when it isn't `result`: a real scan's stored result
  // (server/workspaceRoutes.ts reads it unpriced), so the readiness and the drawings' fingerprint match.
  permitResult?: any;
  // With the answers, the money is worked out here from them (server/eligibility.ts), as the answer
  // does; without, it's read from the priced result.
  household?: Household;
  answers?: Record<string, unknown>;
  property?: Property | null;
  municipality: string;
  state: StoredState;
  profile: Profile | null;
};

const PERMIT: VisualRef = { kind: "permit" };
const MINUTES: Record<string, number> = { design: 3, tape: 5, window: 3, owner: 2, upstairs: 1, lot: 3, water: 2, designer: 10, review: 5 };
const MONEY: VisualRef = { kind: "money" };
const BUILDERS: VisualRef = { kind: "builders" };
const LATER: Choice = { label: "Later", action: { type: "go", to: "home" } };
const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const listOf = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const count = (n: number, one: string, many = `${one}s`) => `${n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : n} ${n === 1 ? one : many}`;

export function buildList(input: BuildInput): BuildList {
  const st = permitStatus({ ...input, result: input.permitResult ?? input.result });
  const all = st.readiness.items;
  const of = (group: ReadyItem["group"]) => all.filter((i) => i.group === group);
  const allDone = (xs: ReadyItem[]) => xs.every((x) => x.done);
  const items: BuildItem[] = [];
  const permitTotal = all.length;
  const permitReady = permitTotal - st.readiness.left;

  // The design itself first: the drawings can't be handed in while it breaks a rule.
  for (const c of of("design")) {
    items.push({
      step: `build.permit:design:${c.id.replace(/^check:/, "")}`,
      section: "permit",
      message: `One change to your design first: ${lower(c.label.replace(/^Design:\s*/i, ""))}. ${c.detail}`,
      why: "The permit set draws your design, so it has to meet the rules before you hand it in.",
      choices: [{ label: "Fix it in the design", action: { type: "go", to: "design" }, primary: true }],
      visual: PERMIT,
      done: c.done,
    });
  }

  // Tape numbers: the main walls and the heights, in one go.
  const tape = of("tape");
  if (tape.length) {
    const walls = tape.filter((t) => t.id.startsWith("wall:")).length;
    const heights = tape.find((t) => t.id === "heights");
    const what = [...(walls ? [count(walls, "wall")] : []), ...(heights ? ["the ceiling height", ...(heights.label.includes("beam") ? ["the lowest beam or duct"] : [])] : [])];
    items.push({
      step: "build.permit:tape",
      section: "permit",
      message: `Grab a tape measure: ${listOf(what)}.`,
      why: "The City's drawings need measured sizes, and every size on them comes from these.",
      card: { kind: "tape", id: "tape" },
      choices: [LATER],
      visual: PERMIT,
      done: allDone(tape),
    });
  }

  for (const w of of("windows")) {
    const id = w.id.replace(/^window:/, "");
    const win = st.model?.windows.find((x) => x.id === id);
    items.push({
      step: `build.permit:window:${id}`,
      section: "permit",
      message: `${win?.tag ? `Window ${win.tag}` : "This window"}${win?.room ? ` in the ${win.room.toLowerCase()}` : ""}: how wide and tall is the opening, and how high is its sill off the floor?`,
      why: win?.escape
        ? "A bedroom needs a window you can climb out of, and the City checks it from these three numbers."
        : "The drawings show every window at its real size.",
      card: { kind: "window", id },
      choices: [LATER],
      visual: PERMIT,
      done: w.done,
    });
  }

  for (const o of of("owner")) {
    items.push({
      step: "build.permit:owner",
      section: "permit",
      message: "Whose names go on the forms? I'll use them on the permit forms, the grant applications and the quote requests, so you type them once.",
      why: "The City's forms ask for every owner on the deed, with a phone and an email.",
      card: { kind: "owner", id: "owner" },
      choices: [LATER],
      visual: PERMIT,
      done: o.done,
    });
  }

  for (const u of of("upstairs")) {
    items.push({
      step: "build.permit:upstairs",
      section: "permit",
      message: "Where are the bedrooms upstairs? Tap each one on the outline of your house, or tell me there are none.",
      why: "Each bedroom upstairs gets a smoke alarm linked to the suite's, and the plan shows where.",
      card: { kind: "upstairs", id: "upstairs" },
      choices: [LATER],
      visual: PERMIT,
      done: u.done,
    });
  }

  const lot = of("lot");
  if (lot.length) {
    items.push({
      step: "build.permit:lot",
      section: "permit",
      message: `How far is the wall with the ${lot.length === 1 ? "new window" : "new windows"} from your property line? Your survey shows it.`,
      why: "A window close to the property line has limits, and the site plan shows the distance.",
      card: { kind: "tape", id: "lot" },
      choices: [LATER],
      visual: PERMIT,
      done: allDone(lot),
    });
  }

  for (const w of of("water")) {
    items.push({
      step: "build.permit:water",
      section: "permit",
      message: "How will the two homes' water be metered: one meter for both, or one each? And where is the meter?",
      why: "Kitchener asks every permit for two units to say which, and where (Kitchener Utilities, Building Bulletin BB 2026-04).",
      card: { kind: "waterMeter", id: "water" },
      choices: [LATER],
      visual: PERMIT,
      done: w.done,
    });
  }

  for (const d of of("designer")) {
    items.push({
      step: "build.permit:designer",
      section: "permit",
      message: st.need.needed
        ? "A registered (BCIN) designer has to sign these drawings. I can write them a short brief with the set attached; then add their name and BCIN."
        : "Add your designer's name and BCIN, and I'll put them in every sheet's statement box.",
      why: st.need.needed ? st.need.reasons.join(" ") : "The City checks who drew the drawings against the province's registry.",
      card: { kind: "designer", id: "designer" },
      choices: [LATER],
      visual: PERMIT,
      done: d.done,
    });
  }

  const review = of("review");
  if (review.length) {
    items.push({
      step: "build.permit:review",
      section: "permit",
      message: `Your permit set is drawn: ${count(review.length, "sheet")}. Open the review copy and check each one matches your basement.`,
      why: "You sign that the drawings are right, so look them over before you hand them in. If anything changes, I'll ask again.",
      card: { kind: "download", id: "review" },
      choices: [LATER],
      visual: PERMIT,
      done: allDone(review),
    });
  }

  // The money: one item per question that still decides a program, then applying for what fits
  // before any work starts. Whichever comes first says how much they may be eligible for.
  const worked = input.answers
    ? evaluateMoney(packFor(input.municipality).pack, {
        household: input.household ?? input.result?.household ?? "unsure",
        answers: input.answers as MoneyAnswers,
        property: input.property ?? input.result?.property ?? null,
        costHigh: input.result?.cost?.high ?? null,
      })
    : null;
  const money = worked ? { total: worked.total, ifYes: worked.ifYes } : (input.result?.money ?? { total: 0, ifYes: 0 });
  const grants = (worked?.programs ?? input.result?.grants ?? []) as Program[];
  const cash = grants.filter((g) => g.qualify === "yes" && g.value === "cash" && (g.amountCAD ?? 0) > 0);
  const lead = money.total > 0 ? `You may be eligible for up to ${dollars(money.total)}${cash.length ? ` (${listOf(cash.map((g) => g.shortName))})` : ""}.` : "";
  const moneyItems: BuildItem[] = [];
  const questions = ((worked?.questions ?? input.result?.moneyQuestions ?? []) as MoneyQuestion[]).filter((q) => q.id !== "household");
  for (const q of questions) {
    moneyItems.push({
      step: `build.money:${q.id}`,
      section: "money",
      message: q.question,
      why: `${q.hint ? `${q.hint.replace(/\.?$/, ".")} ` : ""}It decides ${listOf(q.decides)}.`,
      card: { kind: "moneyQuestion", id: q.id },
      choices: q.options.map((o) => ({ label: o.label, action: { type: "answer", questionId: q.id, value: o.value } })),
      visual: MONEY,
      // "Not sure" counts as answered: the program stays one answer away, and the guide moves on.
      done: q.answer != null,
    });
  }
  // Programs that want an application before the work starts. Each is sent, or "not for me"
  // (state.apply[id] with no date), so a loan they don't want never blocks the list.
  const before = grants.filter((g) => g.qualify === "yes" && g.apply && (g.apply.when === "before_work" || g.apply.when === "at_permit"));
  if (before.length) {
    const said = input.state.apply ?? {};
    moneyItems.push({
      step: "build.money:apply",
      section: "money",
      message: `Apply before any work starts: ${listOf(before.map((g) => (g.value === "financing" ? `${g.shortName}, a loan rather than a grant` : g.shortName)))}. I've filled in what I can.`,
      why: "Most programs turn down projects that have already started, so the applications go in first.",
      card: { kind: "moneyQuestion", id: "apply" },
      choices: [LATER],
      visual: MONEY,
      done: before.every((g) => g.id in said),
    });
  }
  const firstMoney = moneyItems.find((i) => !i.done);
  if (firstMoney && lead) firstMoney.message = `${lead} ${firstMoney.message}`;
  items.push(...moneyItems);

  const build = input.state.build ?? {};
  const pros = build.pros ?? [];
  items.push({
    step: "build.builders",
    section: "builders",
    // With nothing to answer or apply for, the money is said here, on the way past.
    message: `${!moneyItems.length && lead ? `${lead} ` : ""}Who builds it? Hire a contractor to run it, run it yourself with licensed trades for some of it, or do it all yourself.`,
    why: "It changes the cost, who pulls which permit, and who you call. I'll line up the public registries and write the quote requests.",
    card: { kind: "buildPath", id: "path" },
    choices: [LATER],
    visual: BUILDERS,
    done: Boolean(build.path),
  });

  const canSubmit = st.readiness.left === 0;
  const portal = st.permit?.portal ?? null;
  items.push({
    step: "build.submit",
    section: "permit",
    message: canSubmit
      ? `Everything's ready. Download the submit copy, with no draft marks and every form filled, and hand it in ${portal ? `on the ${portal.label}` : `to the ${st.place.authority}`}.`
      : `The submit copy unlocks when nothing is left: ${st.readiness.left} to go.`,
    // Nothing is asked here either.
    why: "",
    card: canSubmit ? { kind: "download", id: "submit" } : undefined,
    visual: PERMIT,
    done: Boolean(input.state.permit?.submittedAt),
  });

  items.push({
    step: "done",
    section: "done",
    message: "That's everything I need from you. Your book has the answer, your design, the permit set and the money in one PDF, to share with a designer or a contractor so they can quote without a first visit.",
    // Nothing is asked here, so there's no "why".
    why: "",
    card: { kind: "download", id: "book" },
    choices: [{ label: "Back to your basement", action: { type: "go", to: "home" }, primary: true }],
    visual: PERMIT,
    done: false,
  });

  // Rough minutes for each permit item, for the guide's "about N minutes" before it starts.
  for (const i of items) if (i.section === "permit") i.minutes = i.step === "build.submit" ? 2 : MINUTES[i.step.split(":")[1]] ?? 2;

  return {
    items,
    next: items.find((i) => !i.done)!,
    permit: { ready: permitReady, total: permitTotal, canSubmit, city: st.city, authority: st.place.authority, portal },
    money: {
      total: money.total ?? 0,
      ifYes: money.ifYes ?? 0,
      programs: grants.filter((g) => g.qualify !== "no").map((g) => ({ name: g.shortName, amountCAD: g.amountCAD, qualify: g.qualify, value: g.value })),
    },
    builders: { path: build.path ?? null, quotes: pros.filter((p) => p.quoteCAD != null).length },
  };
}

// A real scan's list, loaded the way GET /api/scans/:id prices its result.
export async function buildListFor(scanId: string): Promise<BuildList | null> {
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, scanId));
  if (!scan?.result) return null;
  const [basement] = await db.select().from(schema.basements).where(eq(schema.basements.id, scan.basementId));
  if (!basement) return null;
  const answers = await savedAnswers(scan.basementId);
  const result = scan.result as any;
  const priced = result?.findings ? await pricedForBasement(scan.id, scan.basementId, { ...result, household: basement.household ?? result.household }, answers) : result;
  const ws = await loadWorkspace(basement.id);
  return buildList({ result: priced, permitResult: result, municipality: basement.municipality, state: ws.state, profile: ws.profile });
}

// The example's list, from the workspace and money answers its browser keeps. Checked the way the
// example's permit routes check it (server/workspaceRoutes.ts sampleBody): the drawings' fingerprint
// follows the checked shape, so a sheet looked over there counts here too.
export function sampleBuildList(ws: { profile: unknown; state: unknown }, answers: Record<string, unknown> = {}): BuildList {
  const p = ProfileSchema.safeParse(ws.profile);
  const s = StateSchema.safeParse(ws.state ?? {});
  const state: StoredState = s.success ? s.data : {};
  const result = pricedSample(JSON.parse(readFileSync("public/samples/sample/result.json", "utf8")), state, answers as never);
  return buildList({ result, municipality: "waterloo-on", state, profile: p.success ? p.data : null });
}
