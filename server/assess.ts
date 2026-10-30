// Muse Spark reads the evidence; code decides what may be claimed and does the maths.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataUrl, readReply, responses, tokenCost } from "./meta";
import type { Detection } from "./pipeline";
import type { Measurements } from "./scan3d";
import type { Property } from "./property";
import type { Watch } from "./watch";
import { evaluate, moneyAndSteps } from "./recheck";
import { coreRules, packFor, rulesForModel, type Coverage, type Household, type Rule } from "./rules";
import { ASK_OPTIONS, fromRecords, TRIAGE } from "./triage";

const run = promisify(execFile);

// "standard": work nearly every suite needs, budgeted without asking. "designer_checks": a size or
// detail the video couldn't settle; the designer confirms it, the homeowner is never sent for a tape.
export type Status = "likely_ok" | "likely_fix" | "needs_measurement" | "needs_answer" | "standard" | "designer_checks";
type ModelFinding = { ruleId: string; status: Status; evidence?: string[]; why?: string; question?: string };

// `photos`: a photo take of that many photos, not a video (server/photoInput.ts). `model`: who reads the
// evidence, for comparing models; the app uses ASSESS_MODEL. `watch`: what Muse Wonder saw in the whole
// take (server/watch.ts), which settles the fire rules in code (fireRules).
export type AssessContext = { dir: string; household: Household; municipality: string; property?: Property | null; photos?: number; model?: string; watch?: Pick<Watch, "rooms" | "doors"> | null };

// The verdict agent's model: Muse Spark 1.3 unless ASSESS_MODEL says otherwise (scripts/eval/assess-ab.ts compares).
export const ASSESS_MODEL = process.env.ASSESS_MODEL || "muse-spark-1.3";

// Where the house is, for the model: "Toronto, Ontario", or "Ontario" when we don't know.
const where = (c: Pick<Coverage, "city" | "coverage" | "authority">) => (c.city === "Ontario" ? "Ontario" : `${c.city}, Ontario`);
const rulesName = (c: Pick<Coverage, "city" | "coverage">) => (c.coverage === "full" ? `compiled ${c.city} rules` : "compiled Ontario rules that apply across the province");

export const instructions = (c: Pick<Coverage, "city" | "coverage" | "authority">) => `You are the assessment agent for Basement Ready. It helps homeowners in ${where(c)} learn whether their basement can become a legal second unit.

You get: what SAM 3.1 detected in their basement video (each detection has an id, a kind and the frame where it is clearest), proof frames with each detection boxed in green, what the homeowner said while filming, who the unit is for, and the ${rulesName(c)} (core rules only).

Trust rules, follow them exactly:
1. Only claim something about the basement if a detection supports it, and cite the detection ids in "evidence".
2. Never invent measurements. If a rule needs a number (ceiling height, window opening size, headroom), use "needs_measurement" and write one short tape-measure question.
3. If a rule depends on facts a video can't show (zoning, parking, how many units exist), use "needs_answer" with a plain question.
4. Use "likely_fix" only when the proof frames clearly show a problem, for example exposed joists with no fire-rated ceiling, or a furnace open to the space. Never judge by eye whether a window is big enough to escape through: that comes from its measured size, so use "needs_measurement".
5. Use "likely_ok" only when the frames clearly show it complies.
Write plain, short sentences a homeowner understands. Never say "you qualify" or "approved".

Also capture what the homeowner wants the space to become, ONLY from what they actually said (never invent): each room or feature they named, where they said it goes, the second they said it (from the timed speech), and their exact words. Note any look and feel ("bright", "simple", "cozy") and must-haves ("separate entrance", "laundry"). Leave lists empty if they said nothing.

Return ONLY a JSON object:
{"route":"second_unit"|"basement_finish","wants":"what they said they want, one sentence, or empty","summary":"two short sentences","vision":{"rooms":[{"room":"kitchen","where":"by the stairs","atSeconds":12.5,"quote":"their words"}],"style":"look and feel, or empty","mustHaves":["..."],"forWhom":"who it is for, or empty"},"findings":[{"ruleId":"...","status":"likely_ok"|"likely_fix"|"needs_measurement"|"needs_answer","evidence":["detection ids"],"why":"one sentence","question":"only for needs_*"}]}
Include every rule you were given exactly once.`;

// Draws each detection's box on its best frame so Spark sees exactly what SAM found.
async function proofFrames(work: string, detections: Detection[]) {
  const dir = join(work, "proof");
  mkdirSync(dir, { recursive: true });
  // One clear shot per kind, plus every window (windows decide egress).
  const picked: Detection[] = [];
  for (const d of detections) {
    if (d.kind === "window" || !picked.some((p) => p.kind === d.kind && p.label === d.label)) picked.push(d);
  }
  const out: { detection: Detection; path: string }[] = [];
  for (const d of picked.slice(0, 8)) {
    const src = join(work, "frames", `${String(d.frame).padStart(4, "0")}.jpg`);
    const dst = join(dir, `${d.id}.jpg`);
    const box = `drawbox=x=iw*${d.box.x.toFixed(4)}:y=ih*${d.box.y.toFixed(4)}:w=iw*${d.box.w.toFixed(4)}:h=ih*${d.box.h.toFixed(4)}:color=0x4BE38A@0.95:t=5`;
    await run("ffmpeg", ["-y", "-loglevel", "error", "-i", src, "-vf", `${box},scale='min(768,iw)':-2`, "-q:v", "4", dst]);
    out.push({ detection: d, path: dst });
  }
  return out;
}

function parseJson(text: string): any {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Spark did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export type SpeechTurn = { startMs: number; endMs: number; transcript: string };

async function askSpark(ctx: AssessContext, place: Coverage, rules: Rule[], detections: Detection[], transcript: string, turns: SpeechTurn[]) {
  const proofs = await proofFrames(ctx.dir, detections);
  const content: any[] = [
    {
      type: "input_text",
      text: JSON.stringify({
        unitIsFor: ctx.household,
        municipality: place.authority === "your municipality" ? "somewhere in Ontario" : `${place.authority}, Ontario`,
        homeownerSaid: transcript || "(no speech)",
        timedSpeech: turns.map((t) => ({ atSeconds: Math.round(t.startMs / 100) / 10, text: t.transcript })),
        detections: detections.map((d) => ({ id: d.id, kind: d.kind, label: d.label, seconds: d.seconds, framesSeen: d.framesSeen })),
        rules: rulesForModel(rules),
      }),
    },
  ];
  // A photo take: the "video" is still photos, one look each, with no sound. Say so in its words too.
  if (ctx.photos) {
    content.push({ type: "input_text", text: `This take is ${ctx.photos} still photos of the basement, not a video: each detection's frame is one photo, and there is no speech. When you describe it, say "the photos", never "the video".` });
  }
  for (const p of proofs) {
    content.push({ type: "input_text", text: `Proof frame for detection ${p.detection.id}:` });
    content.push({ type: "input_image", image_url: dataUrl(p.path, "image/jpeg") });
  }
  let lastErr: unknown;
  let costUsd = 0;
  const model = ctx.model ?? ASSESS_MODEL;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await responses({
        model,
        input: [
          { role: "developer", content: instructions(place) },
          { role: "user", content },
        ],
        ...(/wonder/.test(model) ? { reasoning: { effort: "medium" } } : {}),
      });
      costUsd += tokenCost(model, r.usage)?.usd ?? 0;
      // A reply cut off partway and then sent again whole is read from the whole one.
      return { model: readReply(r, parseJson), costUsd };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function assess(
  ctx: AssessContext,
  detections: Detection[],
  transcript: string,
  measurements?: Measurements | null,
  turns: SpeechTurn[] = [],
) {
  return finishAssessment(ctx, await readWithSpark(ctx, detections, transcript, turns), detections, measurements);
}

// Spark reads the video's finds and what they said; it never sees the 3D's numbers, so it can run while
// the 3D is still measuring. finishAssessment then applies the measurements in code.
export async function readWithSpark(ctx: AssessContext, detections: Detection[], transcript: string, turns: SpeechTurn[] = []) {
  const coverage = packFor(ctx.municipality);
  return { coverage, ...(await askSpark(ctx, coverage, coreRules(coverage.pack), detections, transcript, turns)) };
}

export function finishAssessment(
  ctx: AssessContext,
  read: Awaited<ReturnType<typeof readWithSpark>>,
  detections: Detection[],
  measurements?: Measurements | null,
) {
  return { result: { ...buildResult(ctx, read.coverage, read.model, detections, measurements), measurements: measurements ?? null }, costUsd: read.costUsd };
}

// 5/8" drywall under joists, ducts and beams: the finished height is this much lower than the scan.
const FINISH_ALLOWANCE_M = 0.016;

// Metrics the 3D scan can read directly.
const MEASURED: Record<string, (m: Measurements) => number | null> = {
  minFinishedCeilingHeightInSuite: (m) => (m.ceilingHeightM == null ? null : m.ceilingHeightM - FINISH_ALLOWANCE_M),
  minClearHeightUnderBeamsAndDucts: (m) =>
    m.clearances.length ? Math.min(...m.clearances.map((c) => c.clearanceM)) - FINISH_ALLOWANCE_M : null,
};

// Decides a rule from the scan only when the reading clears the limit by more than its error margin.
export function measuredCheck(rule: Rule, m: Measurements | null | undefined) {
  if (!m || !m.trusted || rule.check.operator !== ">=" || typeof rule.check.value !== "number" || rule.check.unit !== "m") return null;
  const read = MEASURED[rule.check.metric]?.(m);
  if (read == null) return null;
  const margin = m.scaleSource === "user_measurement" ? 0.05 : (read * m.expectedErrorPct) / 100;
  const limit = rule.check.value;
  const status: Status = read - margin >= limit ? "likely_ok" : read + margin < limit ? "likely_fix" : "needs_measurement";
  return {
    status,
    measured: { value: Math.round(read * 100) / 100, unit: "m", marginM: Math.round(margin * 100) / 100, limit, source: m.scaleSource },
  };
}

export type Vision = {
  rooms: { room: string; where: string; atSeconds: number | null; quote: string }[];
  style: string;
  mustHaves: string[];
  forWhom: string;
};

const text = (v: unknown, max = 140) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// What the homeowner said they want, kept only if it's well-formed; the concepts are planned around it.
export function cleanVision(v: any): Vision {
  const rooms = (Array.isArray(v?.rooms) ? v.rooms : [])
    .map((r: any) => ({
      room: text(r?.room, 60),
      where: text(r?.where, 120),
      atSeconds: typeof r?.atSeconds === "number" && Number.isFinite(r.atSeconds) && r.atSeconds >= 0 ? Math.round(r.atSeconds * 10) / 10 : null,
      quote: text(r?.quote, 200),
    }))
    .filter((r: { room: string }) => r.room)
    .slice(0, 8);
  return {
    rooms,
    style: text(v?.style),
    mustHaves: (Array.isArray(v?.mustHaves) ? v.mustHaves : []).map((m: unknown) => text(m, 80)).filter(Boolean).slice(0, 8),
    forWhom: text(v?.forWhom, 80),
  };
}

type VerdictFinding = {
  ruleId: string;
  title: string;
  category: string;
  status: Status;
  why: string | null;
  evidence: string[];
  source: Rule["source"];
  fix: Rule["fix"] | null;
};

export type FixGroup = {
  category: string;
  title: string;
  description: string;
  ruleIds: string[];
  evidence: string[];
  why: string[];
  costLow: number | null;
  costHigh: number | null;
  costSource: any;
  sources: Rule["source"][];
  priced?: boolean; // false: a fix the quote can't price yet (the design has no place for it)
};

// The design they picked, once there is one (server/priced.ts): its quote is the cost, a fix it needs
// that the rules didn't name joins the list, and each fix's cost is the quote's own line for it.
export type DesignPricing = {
  name: string;
  cost: { low: number; high: number };
  fixes: FixGroup[];
  lineCost: Record<string, { low: number; high: number }>;
};

// Pure: the verdict, the fix list and the cost, from the findings as they stand (and the design, when
// there is one). Used for the first answer and again every time the homeowner answers a question, so
// the headline, What has to change and every cost on screen count the same fixes.
export function verdictFrom(findings: VerdictFinding[], design: DesignPricing | null = null) {
  // Zoning can't be fixed with a renovation: if it fails, this lot can't take a second unit.
  const blockers = findings.filter((f) => f.status === "likely_fix" && f.category === "zoning");
  // One "thing to fix" per category: the egress area and egress size rules are one new window,
  // and the fire ceiling and beam boxing are one drywall job. Group cost = the largest item, not the sum.
  const ruleGroups: FixGroup[] = [...Map.groupBy(findings.filter((f) => f.status === "likely_fix" && f.category !== "zoning"), (f) => f.category)].map(
    ([category, items]) => {
      const priced = items.filter((f) => f.fix?.costLowCAD != null && f.fix?.costHighCAD != null);
      return {
        category,
        title: items[0].title,
        description: items[0].fix?.description ?? "",
        ruleIds: items.map((f) => f.ruleId),
        evidence: [...new Set(items.flatMap((f) => f.evidence))],
        why: items.map((f) => f.why).filter(Boolean) as string[],
        costLow: priced.length ? Math.max(...priced.map((f) => f.fix!.costLowCAD!)) : null,
        costHigh: priced.length ? Math.max(...priced.map((f) => f.fix!.costHighCAD!)) : null,
        costSource: priced[0]?.fix?.costSource ?? null,
        sources: items.map((f) => f.source),
      };
    },
  );
  // With a design, its own fixes join, and every cost is the quote's.
  const have = new Set(ruleGroups.map((g) => g.category));
  const fixGroups = design
    ? [...ruleGroups, ...design.fixes.filter((f) => !have.has(f.category))].map((g) => {
        const line = design.lineCost[g.category];
        return { ...g, costLow: line?.low ?? null, costHigh: line?.high ?? null, costSource: line ? "quote" : null, priced: g.priced ?? true };
      })
    : ruleGroups;
  // Standard suite work: stated and priced, but not a "fix" against this basement.
  const standard = findings
    .filter((f) => f.status === "standard")
    .map((f) => ({ ruleId: f.ruleId, title: f.title, text: f.why ?? "", costLow: design ? null : (f.fix?.costLowCAD ?? null), costHigh: design ? null : (f.fix?.costHighCAD ?? null) }));
  const priced = fixGroups.filter((g) => g.costLow != null);
  const pricedStandard = standard.filter((s) => s.costLow != null && s.costHigh != null);
  const fixesLow = priced.reduce((s, g) => s + g.costLow!, 0);
  const fixesHigh = priced.reduce((s, g) => s + g.costHigh!, 0);
  const standardLow = pricedStandard.reduce((s, x) => s + x.costLow!, 0);
  const standardHigh = pricedStandard.reduce((s, x) => s + x.costHigh!, 0);
  const cost = {
    low: design ? design.cost.low : fixesLow + standardLow,
    high: design ? design.cost.high : fixesHigh + standardHigh,
    fixesLow,
    fixesHigh,
    standardLow,
    standardHigh,
    pricedFixes: priced.length,
    unpricedFixes: fixGroups.length - priced.length,
    // Where the total comes from: the quote for their design, or the rules' rough sum before there's one.
    design: design?.name ?? null,
  };
  const n = fixGroups.length;
  const open = findings.filter((f) => f.status === "needs_answer" || f.status === "needs_measurement" || f.status === "designer_checks").length;
  const verdict: "yes" | "fix" | "no" = blockers.length ? "no" : n > 0 ? "fix" : "yes";
  const headline = blockers.length
    ? "Not as a second unit here. You could still finish it as part of your home."
    : n > 0
      ? `Yes, your basement can be a second home after ${n} fix${n === 1 ? "" : "es"}.`
      : open
        ? "Looks like yes. Your designer confirms a few details."
        : "Yes, your basement can be a second home.";
  return { fixGroups, standard, cost, verdict, headline, blockers: blockers.map((b) => b.ruleId) };
}

type Triageable = { ruleId: string; check: Rule["check"]; status: Status; why: string | null; question: string | null; evidence: string[]; fix: Rule["fix"] | null };

// Who answers each rule (server/triage.ts). Public records first, then what the video proved; what's
// left becomes standard work, a designer check, or one of the few plain questions.
export function triage<F extends Triageable>(f: F, rule: Rule, property?: Property | null, confirms = "The City") {
  const t = TRIAGE[f.ruleId];
  if (t?.who === "records") {
    const r = fromRecords(f.ruleId, f.check, property);
    const outcome = r ? evaluate(f.check, r.value) : "unknown";
    if (r && outcome !== "unknown") {
      return {
        ...f,
        status: (outcome === "pass" ? "likely_ok" : "likely_fix") as Status,
        why: r.why,
        question: null,
        evidence: [...f.evidence, "records"],
        fix: outcome === "fail" ? rule.fix : null,
        records: { value: r.value },
      };
    }
    return { ...f, status: "designer_checks" as Status, question: null, why: `${confirms} confirms this for your lot.` };
  }
  // Proof in the video beats any default.
  if (f.status === "likely_ok" || f.status === "likely_fix") return f;
  if (t?.who === "standard") return { ...f, status: "standard" as Status, question: null, why: t.text, fix: rule.fix };
  if (t?.who === "ask") return { ...f, status: "needs_answer" as Status, question: t.question!, hint: t.hint ?? null, options: ASK_OPTIONS };
  // A size the scan couldn't settle: show what it read, and the designer confirms it.
  return { ...f, status: "designer_checks" as Status, question: null, why: f.why ?? t?.text ?? rule.plain };
}

// Pure: turns Spark's reading into the answer. The trust rule, grouping and money all live here.
// The two fire rules, decided in code from what the scan found, the same way on every take of a basement:
// open joists or exposed ducts over the suite mean a fire-rated ceiling is a fix; a furnace with no door to
// close means fire-rated walls and a door around it. A finished ceiling, or a furnace room with a door, is
// the designer's to confirm. Spark's reading doesn't decide them: whether it was handed a frame of the
// ceiling to cite changes from take to take. Read from the watch pass (each room's ceiling, what hangs
// below it, its fixtures and doors) and SAM's finds (an exposed ceiling duct, a furnace).
type Decided = { status: Status; why: string; evidence: string[] };
export function fireRules(watch: AssessContext["watch"], detections: { id: string; label?: string }[]): Record<string, Decided> {
  const rooms = watch?.rooms ?? [];
  const inside = rooms.filter((r) => r.entered);
  const named = (rs: typeof rooms) => rs.map((r) => r.name).join(" and ");
  const open = inside.filter((r) => r.ceiling === "exposed_joists" || r.ceiling === "mixed");
  const ducted = inside.filter((r) => r.low.some((l) => l.kind === "duct"));
  const ducts = detections.filter((d) => d.label === "Duct").map((d) => d.id);
  const fire: Decided = open.length
    ? { status: "likely_fix", why: `Open joists over the ${named(open)}: the ceiling between the two homes needs fire-rated drywall.`, evidence: ["watch"] }
    : ducted.length || ducts.length
      ? { status: "likely_fix", why: `Exposed ductwork${ducted.length ? ` in the ${named(ducted)}` : ""}: it gets boxed in with fire-rated drywall to separate the two homes.`, evidence: ducts.length ? ducts : ["watch"] }
      : inside.length && inside.every((r) => r.ceiling === "drywall")
        ? { status: "designer_checks", why: "The ceiling is finished drywall. Your designer confirms it's fire-rated between the two homes.", evidence: ["watch"] }
        : { status: "designer_checks", why: "Your designer confirms the ceiling between the two homes is fire-rated.", evidence: [] };

  const furnaceRooms = rooms.filter((r) => r.fixtures.some((f) => f.kind === "furnace"));
  const hasDoor = (id: string) => (watch?.doors ?? []).some((d) => (d.from === id || d.to === id) && (d.kind === "door" || d.kind === "exterior_door"));
  const openFurnace = furnaceRooms.filter((r) => !hasDoor(r.id));
  const furnaceFound = detections.some((d) => d.label === "Furnace");
  const service: Decided = openFurnace.length
    ? { status: "likely_fix", why: `The furnace in the ${named(openFurnace)} has no door to close: it needs fire-rated walls and a door around it.`, evidence: ["watch"] }
    : furnaceRooms.length || furnaceFound
      ? { status: "designer_checks", why: "The furnace room has a door. Your designer confirms its walls and door are fire-rated.", evidence: furnaceRooms.length ? ["watch"] : [] }
      : { status: "standard", why: TRIAGE.service_room_separation.text, evidence: [] };
  return { fire_separation_between_units: fire, service_room_separation: service };
}

export function buildResult(
  ctx: Pick<AssessContext, "household" | "municipality" | "property" | "watch">,
  { pack, city, coverage, authority, note }: Coverage,
  model: { route?: string; wants?: string; summary?: string; vision?: any; findings?: ModelFinding[] },
  detections: (Pick<Detection, "id"> & Partial<Pick<Detection, "label">>)[],
  measurements?: Measurements | null,
) {
  const rules = coreRules(pack);
  const ids = new Set(detections.map((d) => d.id));
  const byRule = new Map<string, ModelFinding>((model.findings ?? []).map((f: ModelFinding) => [f.ruleId, f]));

  let heldBack = 0;
  const findings = rules.map((rule) => {
    const f = byRule.get(rule.id);
    let status: Status = f?.status ?? (rule.evidence.type === "ask_user" ? "needs_answer" : "needs_measurement");
    const evidence = (f?.evidence ?? []).filter((id) => ids.has(id));
    if (measuredCheck(rule, measurements)) evidence.push("scan3d");
    // The trust rule, enforced in code: no proof in the video, no claim.
    if ((status === "likely_ok" || status === "likely_fix") && evidence.length === 0) {
      heldBack++;
      status = rule.evidence.type === "scan_measurement" || rule.evidence.type === "video_object" ? "needs_measurement" : "needs_answer";
    }
    // The 3D scan overrides Spark where it measured the thing directly.
    const m = measuredCheck(rule, measurements);
    let why = f?.why ?? null;
    if (m) {
      status = m.status;
      const reading = `The scan reads about ${m.measured.value.toFixed(2)} m finished (±${Math.round(m.measured.marginM * 100)} cm); the rule needs ${m.measured.limit} m.`;
      why = reading;
    }
    const measuredQuestion = m?.status === "needs_measurement" ? `${why} Measure the lowest point with a tape to confirm.` : null;
    const question = status.startsWith("needs") ? measuredQuestion || f?.question || rule.evidence.question || null : null;
    return {
      measured: m?.measured ?? null,
      ruleId: rule.id,
      title: rule.title,
      plain: rule.plain,
      category: rule.category,
      status,
      why,
      question,
      evidence,
      fix: status === "likely_fix" ? rule.fix : null,
      check: rule.check,
      source: rule.source,
      verified: rule.verified,
    };
  });

  // Who confirms what public records couldn't: "The City", or "The Township of Woolwich".
  const confirms = coverage === "full" ? "The City" : authority === "your municipality" ? "Your municipality" : `The ${authority}`;
  const decided = fireRules(ctx.watch, detections);
  const triaged = findings.map((f) => {
    const rule = rules.find((r) => r.id === f.ruleId)!;
    const d = decided[f.ruleId];
    return d ? { ...f, ...d, question: null, fix: d.status === "likely_fix" || d.status === "standard" ? rule.fix : null } : triage(f, rule, ctx.property, confirms);
  });
  const { fixGroups, standard, cost, verdict, headline } = verdictFrom(triaged);

  return {
    vision: cleanVision(model.vision),
    municipality: ctx.municipality,
    city,
    authority,
    coverage,
    coverageNote: note,
    verdict,
    headline,
    route: model.route === "basement_finish" ? "basement_finish" : "second_unit",
    wants: model.wants ?? "",
    summary: model.summary ?? "",
    findings: triaged,
    fixGroups,
    standard,
    property: ctx.property ?? null,
    heldBack,
    cost,
    // Money and the road to it. Answers arrive later through recheck, which redoes this part.
    ...moneyAndSteps({ household: ctx.household, property: ctx.property, city, authority, plan: null }, { fixGroups, standard, cost }, {}, pack),
    process: pack.process,
    pros: pack.pros,
    compiledAt: pack.compiledAt,
    disclaimer: pack.disclaimer ?? null,
  };
}
