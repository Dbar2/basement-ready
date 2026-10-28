// Muse Spark reads the evidence; code decides what may be claimed and does the maths.
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { dataUrl, outputText, responses } from "./meta";
import type { Detection } from "./pipeline";
import { coreRules, grantsFor, packFor, rulesForModel, type Coverage, type Household, type Rule } from "./rules";

const run = promisify(execFile);

type Status = "likely_ok" | "likely_fix" | "needs_measurement" | "needs_answer";
type ModelFinding = { ruleId: string; status: Status; evidence?: string[]; why?: string; question?: string };

export type AssessContext = { dir: string; household: Household; municipality: string };

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

Return ONLY a JSON object:
{"route":"second_unit"|"basement_finish","wants":"what they said they want, one sentence, or empty","summary":"two short sentences","findings":[{"ruleId":"...","status":"likely_ok"|"likely_fix"|"needs_measurement"|"needs_answer","evidence":["detection ids"],"why":"one sentence","question":"only for needs_*"}]}
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

async function askSpark(ctx: AssessContext, city: string, rules: Rule[], detections: Detection[], transcript: string) {
  const proofs = await proofFrames(ctx.dir, detections);
  const content: any[] = [
    {
      type: "input_text",
      text: JSON.stringify({
        unitIsFor: ctx.household,
        city,
        homeownerSaid: transcript || "(no speech)",
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

export async function assess(ctx: AssessContext, detections: Detection[], transcript: string) {
  const coverage = packFor(ctx.municipality);
  const { model, costUsd } = await askSpark(ctx, coverage.city, coreRules(coverage.pack), detections, transcript);
  return { result: buildResult(ctx, coverage, model, detections), costUsd };
}

// Pure: turns Spark's reading into the answer. The trust rule, grouping and money all live here.
export function buildResult(
  ctx: Pick<AssessContext, "household" | "municipality">,
  { pack, city, coverage }: Coverage,
  model: { route?: string; wants?: string; summary?: string; findings?: ModelFinding[] },
  detections: Pick<Detection, "id">[],
) {
  const rules = coreRules(pack);
  const ids = new Set(detections.map((d) => d.id));
  const byRule = new Map<string, ModelFinding>((model.findings ?? []).map((f: ModelFinding) => [f.ruleId, f]));

  let heldBack = 0;
  const findings = rules.map((rule) => {
    const f = byRule.get(rule.id);
    let status: Status = f?.status ?? (rule.evidence.type === "ask_user" ? "needs_answer" : "needs_measurement");
    const evidence = (f?.evidence ?? []).filter((id) => ids.has(id));
    // The trust rule, enforced in code: no proof in the video, no claim.
    if ((status === "likely_ok" || status === "likely_fix") && evidence.length === 0) {
      heldBack++;
      status = rule.evidence.type === "scan_measurement" || rule.evidence.type === "video_object" ? "needs_measurement" : "needs_answer";
    }
    const question = status.startsWith("needs") ? f?.question || rule.evidence.question || null : null;
    return {
      ruleId: rule.id,
      title: rule.title,
      plain: rule.plain,
      category: rule.category,
      status,
      why: f?.why ?? null,
      question,
      evidence,
      fix: status === "likely_fix" ? rule.fix : null,
      check: rule.check,
      source: rule.source,
      verified: rule.verified,
    };
  });

  // One "thing to fix" per category: the egress area and egress size rules are one new window,
  // and the fire ceiling and beam boxing are one drywall job. Group cost = the largest item, not the sum.
  const fixGroups = [...Map.groupBy(findings.filter((f) => f.status === "likely_fix"), (f) => f.category)].map(([category, items]) => {
    const priced = items.filter((f) => f.fix?.costLowCAD != null && f.fix?.costHighCAD != null);
    return {
      category,
      title: items[0].title,
      description: items[0].fix?.description ?? "",
      ruleIds: items.map((f) => f.ruleId),
      evidence: [...new Set(items.flatMap((f) => f.evidence))],
      why: items.map((f) => f.why).filter(Boolean),
      costLow: priced.length ? Math.max(...priced.map((f) => f.fix!.costLowCAD!)) : null,
      costHigh: priced.length ? Math.max(...priced.map((f) => f.fix!.costHighCAD!)) : null,
      costSource: priced[0]?.fix?.costSource ?? null,
      sources: items.map((f) => f.source),
    };
  });
  const priced = fixGroups.filter((g) => g.costLow != null);
  const costLow = priced.reduce((s, g) => s + g.costLow!, 0);
  const costHigh = priced.reduce((s, g) => s + g.costHigh!, 0);
  const verdict = fixGroups.length > 0 ? "fix" : "yes";
  const headline =
    fixGroups.length > 0 ? `Yes, if you fix ${fixGroups.length} thing${fixGroups.length === 1 ? "" : "s"}.` : "Looks possible. A few things to confirm.";

  return {
    municipality: ctx.municipality,
    city,
    coverage,
    verdict,
    headline,
    route: model.route === "basement_finish" ? "basement_finish" : "second_unit",
    wants: model.wants ?? "",
    summary: model.summary ?? "",
    findings,
    fixGroups,
    heldBack,
    cost: { low: costLow, high: costHigh, pricedFixes: priced.length, unpricedFixes: fixGroups.length - priced.length },
    grants: grantsFor(pack, ctx.household),
    process: pack.process,
    pros: pack.pros,
    compiledAt: pack.compiledAt,
    disclaimer: pack.disclaimer ?? null,
  };
}
