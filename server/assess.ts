// Muse Spark reads the evidence; code decides what may be claimed and does the maths.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataUrl, outputText, responses } from "./meta";
import type { Detection } from "./pipeline";
import type { Measurements } from "./scan3d";
import type { Property } from "./property";
import { evaluate } from "./recheck";
import { coreRules, grantsFor, moneyFor, packFor, rulesForModel, type Coverage, type Household, type Rule } from "./rules";
import { planSteps } from "./steps";
import { ASK_OPTIONS, fromRecords, TRIAGE } from "./triage";

const run = promisify(execFile);

// "standard": work nearly every suite needs, budgeted without asking. "designer_checks": a size or
// detail the video couldn't settle; the designer confirms it, the homeowner is never sent for a tape.
export type Status = "likely_ok" | "likely_fix" | "needs_measurement" | "needs_answer" | "standard" | "designer_checks";
type ModelFinding = { ruleId: string; status: Status; evidence?: string[]; why?: string; question?: string };

export type AssessContext = { dir: string; household: Household; municipality: string; property?: Property | null };

// Meta pricing for Muse Spark (USD per token).
const SPARK_IN = 1.25 / 1e6;
const SPARK_OUT = 4.25 / 1e6;

const instructions = (city: string) => `You are the assessment agent for Basement Ready. It helps homeowners in ${city}, Ontario learn whether their basement can become a legal second unit.

You get: what SAM 3.1 detected in their basement video (each detection has an id, a kind and the frame where it is clearest), proof frames with each detection boxed in green, what the homeowner said while filming, who the unit is for, and the compiled ${city} rules (core rules only).

Trust rules, follow them exactly:
1. Only claim something about the basement if a detection supports it, and cite the detection ids in "evidence".
2. Never invent measurements. If a rule needs a number (ceiling height, window opening size, headroom), use "needs_measurement" and write one short tape-measure question.
3. If a rule depends on facts a video can't show (zoning, parking, how many units exist), use "needs_answer" with a plain question.
4. Use "likely_fix" only when the proof frames clearly show a problem, for example a small high basement window, exposed joists with no fire-rated ceiling, or a furnace open to the space.
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

async function askSpark(ctx: AssessContext, city: string, rules: Rule[], detections: Detection[], transcript: string, turns: SpeechTurn[]) {
  const proofs = await proofFrames(ctx.dir, detections);
  const content: any[] = [
    {
      type: "input_text",
      text: JSON.stringify({
        unitIsFor: ctx.household,
        city,
        homeownerSaid: transcript || "(no speech)",
        timedSpeech: turns.map((t) => ({ atSeconds: Math.round(t.startMs / 100) / 10, text: t.transcript })),
        detections: detections.map((d) => ({ id: d.id, kind: d.kind, label: d.label, seconds: d.seconds, framesSeen: d.framesSeen })),
        rules: rulesForModel(rules),
      }),
    },
  ];
  for (const p of proofs) {
    content.push({ type: "input_text", text: `Proof frame for detection ${p.detection.id}:` });
    content.push({ type: "input_image", image_url: dataUrl(p.path, "image/jpeg") });
  }
  let lastErr: unknown;
  let costUsd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await responses({
        model: "muse-spark-1.3",
        input: [
          { role: "developer", content: instructions(city) },
          { role: "user", content },
        ],
      });
      costUsd += (r.usage?.input_tokens ?? 0) * SPARK_IN + (r.usage?.output_tokens ?? 0) * SPARK_OUT;
      return { model: parseJson(outputText(r)), costUsd };
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
  const coverage = packFor(ctx.municipality);
  const { model, costUsd } = await askSpark(ctx, coverage.city, coreRules(coverage.pack), detections, transcript, turns);
  return { result: { ...buildResult(ctx, coverage, model, detections, measurements), measurements: measurements ?? null }, costUsd };
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

// Pure: the verdict, the fix list and the rough cost, from the findings as they stand.
// Used for the first answer and again every time the homeowner answers a question.
export function verdictFrom(findings: VerdictFinding[]) {
  // Zoning can't be fixed with a renovation: if it fails, this lot can't take a second unit.
  const blockers = findings.filter((f) => f.status === "likely_fix" && f.category === "zoning");
  // One "thing to fix" per category: the egress area and egress size rules are one new window,
  // and the fire ceiling and beam boxing are one drywall job. Group cost = the largest item, not the sum.
  const fixGroups = [...Map.groupBy(findings.filter((f) => f.status === "likely_fix" && f.category !== "zoning"), (f) => f.category)].map(
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
  // Standard suite work: stated and priced, but not a "fix" against this basement.
  const standard = findings
    .filter((f) => f.status === "standard")
    .map((f) => ({ ruleId: f.ruleId, title: f.title, text: f.why ?? "", costLow: f.fix?.costLowCAD ?? null, costHigh: f.fix?.costHighCAD ?? null }));
  const priced = fixGroups.filter((g) => g.costLow != null);
  const pricedStandard = standard.filter((s) => s.costLow != null && s.costHigh != null);
  const fixesLow = priced.reduce((s, g) => s + g.costLow!, 0);
  const fixesHigh = priced.reduce((s, g) => s + g.costHigh!, 0);
  const standardLow = pricedStandard.reduce((s, x) => s + x.costLow!, 0);
  const standardHigh = pricedStandard.reduce((s, x) => s + x.costHigh!, 0);
  const cost = {
    low: fixesLow + standardLow,
    high: fixesHigh + standardHigh,
    fixesLow,
    fixesHigh,
    standardLow,
    standardHigh,
    pricedFixes: priced.length,
    unpricedFixes: fixGroups.length - priced.length,
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
export function triage<F extends Triageable>(f: F, rule: Rule, property?: Property | null) {
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
    return { ...f, status: "designer_checks" as Status, question: null, why: "The City confirms this for your lot." };
  }
  // Proof in the video beats any default.
  if (f.status === "likely_ok" || f.status === "likely_fix") return f;
  if (t?.who === "standard") return { ...f, status: "standard" as Status, question: null, why: t.text, fix: rule.fix };
  if (t?.who === "ask") return { ...f, status: "needs_answer" as Status, question: t.question!, hint: t.hint ?? null, options: ASK_OPTIONS };
  // A size the scan couldn't settle: show what it read, and the designer confirms it.
  return { ...f, status: "designer_checks" as Status, question: null, why: f.why ?? t?.text ?? rule.plain };
}

// Pure: turns Spark's reading into the answer. The trust rule, grouping and money all live here.
export function buildResult(
  ctx: Pick<AssessContext, "household" | "municipality" | "property">,
  { pack, city, coverage }: Coverage,
  model: { route?: string; wants?: string; summary?: string; vision?: any; findings?: ModelFinding[] },
  detections: Pick<Detection, "id">[],
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

  const triaged = findings.map((f) => triage(f, rules.find((r) => r.id === f.ruleId)!, ctx.property));
  const { fixGroups, standard, cost, verdict, headline } = verdictFrom(triaged);

  return {
    vision: cleanVision(model.vision),
    municipality: ctx.municipality,
    city,
    coverage,
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
    grants: grantsFor(pack, ctx.household),
    money: moneyFor(grantsFor(pack, ctx.household)),
    steps: planSteps({ city, fixGroups, standard, cost, grants: grantsFor(pack, ctx.household), plan: null }, pack),
    process: pack.process,
    pros: pack.pros,
    compiledAt: pack.compiledAt,
    disclaimer: pack.disclaimer ?? null,
  };
}
