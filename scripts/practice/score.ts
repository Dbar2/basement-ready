// Scores single basement photos through the app's own photo path: each photo made upright and 1280 px
// the way an upload is (server/photoInput.ts), SAM 3.1 reading it for every concept with the app's own
// confidence bars (server/photoFinds.ts), the same thing seen twice made one (mergePhotoFinds), and,
// for the photos asked for, Muse Spark's reading (server/assess.ts). Then it compares all of that with
// labels written by looking at each photo (scripts/practice/scoring.ts). Works on real photos too.
//
//   tsx --env-file=.env scripts/practice/score.ts --dir <photos> [options]
//     --labels <file>     labels (default <dir>/labels.json)
//     --split train|holdout|all     which labelled photos (default all)
//     --ids a,b           only these photos
//     --spark none|all|labelled|<id,id>   which photos the reader reads (default none). labelled: those
//                         whose label says what Spark should find
//     --model <id>        the reader (default the app's, server/assess.ts): e.g. muse-wonder-1.0
//     --concepts <file>   a JSON list of { concept, kind, label } to try instead of the app's
//     --out <file>        every photo's finds, SAM's raw boxes and Spark's reading (JSON)
//     --report <file>     the scores (Markdown)
//     --budget <usd>      stop before new Meta calls would take the ledger past this (default 10)
//     --ledger <file>     what new calls have cost so far (default <first REPLAY_DIR>/practice-spend.jsonl)
//     --dry               only count the calls that aren't saved yet, and what they'd cost
//
// Every Meta call is saved and replayed (server/replay.ts): set REPLAY_DIR to a private folder. A first
// pass replays only, to count what isn't saved yet; new calls are made only if they fit the budget.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWithSpark } from "../../server/assess";
import { dataUrl, samImage, tokenCost } from "../../server/meta";
import { findInPhotos, mergePhotoFinds } from "../../server/photoFinds";
import { sniffPhoto, uprightPhoto } from "../../server/photoInput";
import { CONCEPTS, type Detection } from "../../server/pipeline";
import { ReplayMiss } from "../../server/replay";
import { PRICES } from "../../server/spend";
import { addTally, emptyTally, KEYS, pct, scoreKey, SPARK_RULES, sparkGrade, type Expect, type Find, type Grade, type Label, type Tally } from "./scoring";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const DIR = arg("dir");
if (!DIR) throw new Error("--dir <folder of photos> is required");
const LABELS = arg("labels", join(DIR, "labels.json"));
const SPLIT = arg("split", "all");
const IDS = arg("ids").split(",").filter(Boolean);
const SPARK = arg("spark", "none");
const MODEL = arg("model") || undefined;
const BUDGET = Number(arg("budget", "10"));
const DRY = process.argv.includes("--dry");
const replayDirs = (process.env.REPLAY_DIR ?? "").split(":").filter(Boolean);
if (!replayDirs.length) throw new Error("Set REPLAY_DIR to a private folder, so every call is saved and reruns are free");
const LEDGER = arg("ledger", join(replayDirs[0], "practice-spend.jsonl"));
const concepts: typeof CONCEPTS = arg("concepts") ? JSON.parse(readFileSync(arg("concepts"), "utf8")) : CONCEPTS;
// Estimates for calls not saved yet. A Spark read of one photo has cost $0.01–0.04, a Wonder read about $0.06.
const SPARK_ESTIMATE = MODEL && /wonder/.test(MODEL) ? 0.08 : 0.045;

const all: Record<string, Label> = JSON.parse(readFileSync(LABELS, "utf8")).photos;
const ids = Object.keys(all)
  .filter((id) => all[id].keep)
  .filter((id) => SPLIT === "all" || (all[id].split ?? "train") === SPLIT)
  .filter((id) => !IDS.length || IDS.includes(id))
  .sort();
const sparkIds = new Set(
  SPARK === "none" ? [] : SPARK === "all" ? ids : SPARK === "labelled" ? ids.filter((id) => all[id].spark && Object.keys(all[id].spark!).length) : SPARK.split(","),
);

type Reading = { status: Record<string, string>; claimed: Record<string, string>; summary: string; why: Record<string, string> };
type PhotoResult = { id: string; detections: Detection[]; raw: Record<string, string>; failed: string[]; spark: Reading | null };

const work = join(tmpdir(), "br-practice");
const stripMasks = (raw: string) => raw.replace(/<\|mask;[^|]*\|>/g, "");

// The photo as an upload makes it: upright, 1280 px, JPEG. Kept so every pass sends the same bytes.
async function prepared(id: string): Promise<string> {
  const dir = join(work, id, "frames");
  const path = join(dir, "0000.jpg");
  if (!existsSync(path)) {
    const bytes = readFileSync(join(DIR, all[id].file));
    const kind = sniffPhoto(bytes);
    if (!kind) throw new Error(`${id}: not a photo`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path, await uprightPhoto(bytes, kind));
  }
  return path;
}

type Misses = { sam: number; spark: number };

async function runPhoto(id: string, misses: Misses): Promise<PhotoResult> {
  const path = await prepared(id);
  const url = dataUrl(path, "image/jpeg");
  const raw: Record<string, string> = {};
  const failed: string[] = [];
  const found = await findInPhotos(1, concepts, async (concept) => {
    try {
      const text = await samImage(concept, url);
      raw[concept] = stripMasks(text);
      return text;
    } catch (err) {
      if (err instanceof ReplayMiss) misses.sam++;
      else failed.push(`${concept}: ${err instanceof Error ? err.message.slice(0, 120) : err}`);
      throw err;
    }
  }, undefined, 11);
  const { finds: detections } = mergePhotoFinds(found, () => 0, () => null);
  let spark: Reading | null = null;
  if (sparkIds.has(id)) {
    try {
      const read = await readWithSpark({ dir: join(work, id), household: "renter", municipality: "waterloo-on", photos: 1, model: MODEL }, [...detections], "", []);
      const known = new Set(detections.map((d) => d.id));
      const status: Record<string, string> = {};
      const claimed: Record<string, string> = {};
      const why: Record<string, string> = {};
      for (const f of read.model.findings ?? []) {
        claimed[f.ruleId] = f.status;
        // The trust rule (server/assess.ts buildResult): a claim needs a find behind it.
        const backed = (f.evidence ?? []).some((e: string) => known.has(e));
        status[f.ruleId] = (f.status === "likely_ok" || f.status === "likely_fix") && !backed ? "held_back" : f.status;
        why[f.ruleId] = f.why ?? "";
      }
      spark = { status, claimed, summary: read.model.summary ?? "", why };
    } catch (err) {
      if (err instanceof ReplayMiss || (err instanceof Error && /Replay has no saved answer/.test(err.message))) misses.spark++;
      else failed.push(`spark: ${err instanceof Error ? err.message.slice(0, 160) : err}`);
    }
  }
  return { id, detections, raw, failed, spark };
}

async function pass(): Promise<{ results: PhotoResult[]; misses: Misses }> {
  const misses: Misses = { sam: 0, spark: 0 };
  const results: PhotoResult[] = [];
  const queue = [...ids];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) results.push(await runPhoto(id, misses));
    }),
  );
  return { results: results.sort((a, b) => a.id.localeCompare(b.id)), misses };
}

const ledgerTotal = () =>
  existsSync(LEDGER)
    ? readFileSync(LEDGER, "utf8").split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0)
    : 0;

// What this run's new calls cost: SAM by the image, Spark by its saved answer's tokens.
function spentThisRun(log: string) {
  if (!existsSync(log)) return { sam: 0, spark: 0, usd: 0 };
  let sam = 0;
  let spark = 0;
  let usd = 0;
  for (const line of readFileSync(log, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    if (e.event !== "recorded" || e.status !== 200) continue;
    if (e.model === "sam-3.1") {
      sam++;
      usd += PRICES.samImage;
    } else if (tokenCost(e.model ?? "", {})) {
      spark++;
      const saved = join(replayDirs[0], `${e.key}.json`);
      const body = existsSync(saved) ? JSON.parse(readFileSync(saved, "utf8")).body : null;
      const u = body ? JSON.parse(body).usage ?? {} : {};
      usd += tokenCost(e.model, u)?.usd || SPARK_ESTIMATE;
    }
  }
  return { sam, spark, usd };
}

const findsOf = (r: PhotoResult): Find[] =>
  r.detections.map((d) => ({ key: KEYS[d.label] ?? d.label, box: [d.box.x, d.box.y, d.box.w, d.box.h], c: d.confidence }));

function report(results: PhotoResult[], spend: { thisRun: number; total: number }) {
  const keys = [...new Set(Object.values(KEYS))];
  const tallies = Object.fromEntries(keys.map((k) => [k, emptyTally()])) as Record<string, Tally>;
  const errors: Record<string, { miss: string[]; falseFind: string[] }> = Object.fromEntries(keys.map((k) => [k, { miss: [], falseFind: [] }]));
  for (const r of results) {
    const finds = findsOf(r);
    for (const k of keys) {
      const t = scoreKey(all[r.id], k, finds);
      if (!t) continue;
      addTally(tallies[k], t);
      if (t.miss) errors[k].miss.push(r.id);
      if (t.falsePhotos || t.fp) errors[k].falseFind.push(r.id);
    }
  }
  const grades: Record<string, Record<Grade, number>> = {};
  const wrong: string[] = [];
  for (const r of results.filter((x) => x.spark)) {
    for (const [key, expect] of Object.entries(all[r.id].spark ?? {}) as [string, Expect][]) {
      const rule = SPARK_RULES[key][0];
      const g = sparkGrade(expect, r.spark!.status[rule]);
      grades[key] ??= { right: 0, hedge: 0, missed: 0, wrong: 0 };
      grades[key][g]++;
      if (g === "wrong" || g === "missed") wrong.push(`- ${r.id} · ${key}: expected ${expect}, Spark said ${r.spark!.claimed[rule] ?? "nothing"}${r.spark!.status[rule] === "held_back" ? " (held back: no find behind it)" : ""}. “${r.spark!.why[rule] ?? ""}”`);
    }
  }
  const sum = (f: (t: Tally) => number) => keys.reduce((s, k) => s + f(tallies[k]), 0);
  const lines = [
    `# Practice scores`,
    ``,
    `${results.length} photos (${SPLIT}), ${results.filter((r) => r.spark).length} read by Spark. Concepts: ${arg("concepts") || "the app's"}. New Meta calls this run: $${spend.thisRun.toFixed(2)}; the ledger is at $${spend.total.toFixed(2)}.`,
    results.some((r) => r.failed.length) ? `\nCalls that failed (counted as nothing found): ${results.filter((r) => r.failed.length).map((r) => r.id).join(", ")}` : "",
    ``,
    `## What SAM found`,
    ``,
    `"Found" is per photo: at least one find on the thing. A false find is a photo without it where something was found anyway. Boxes: every labelled one, matched one to one.`,
    ``,
    `| Thing | Photos with it | Found | Photos without it | False finds | Boxes found | Boxes on nothing |`,
    `|---|---|---|---|---|---|---|`,
    ...keys.map((k) => {
      const t = tallies[k];
      const without = results.filter((r) => !all[r.id].unsure?.includes(k) && !(all[r.id].objects[k] ?? []).length).length;
      return `| ${k} | ${t.photos} | ${t.hit} (${pct(t.hit, t.photos)}) | ${without} | ${t.falsePhotos} (${pct(t.falsePhotos, without)}) | ${t.tp}/${t.tp + t.fn} | ${t.fp} |`;
    }),
    `| **all** | ${sum((t) => t.photos)} | ${sum((t) => t.hit)} (${pct(sum((t) => t.hit), sum((t) => t.photos))}) | | ${sum((t) => t.falsePhotos)} | ${sum((t) => t.tp)}/${sum((t) => t.tp + t.fn)} | ${sum((t) => t.fp)} |`,
    ``,
    `## What Spark said`,
    ``,
    `Right: the claim that was due, or no claim where none was. Hedge: no claim where one was fine either way. Missed: no claim where one was due. Wrong: the opposite claim, or a claim the photo can't support.`,
    ``,
    `| Rule | Right | Hedge | Missed | Wrong |`,
    `|---|---|---|---|---|`,
    ...Object.entries(grades).map(([k, g]) => `| ${k} | ${g.right} | ${g.hedge} | ${g.missed} | ${g.wrong} |`),
    ``,
    wrong.length ? `### Spark's misses and wrong claims\n\n${wrong.join("\n")}` : "",
    ``,
    `## Which photos`,
    ``,
    ...keys.map((k) => `- **${k}**: missed in ${errors[k].miss.join(", ") || "none"}; false finds in ${errors[k].falseFind.join(", ") || "none"}`),
  ];
  return { markdown: lines.join("\n"), tallies, grades };
}

mkdirSync(work, { recursive: true });
const log = join(work, `replay-${Date.now()}.jsonl`);
process.env.REPLAY_LOG = log;

// First, replay only: free, and it counts what isn't saved yet.
process.env.META_CACHE = "replay";
let { results, misses } = await pass();
const estimate = misses.sam * PRICES.samImage + misses.spark * SPARK_ESTIMATE;
console.log(`${ids.length} photos, ${sparkIds.size} for Spark. Not saved yet: ${misses.sam} SAM looks, ${misses.spark} Spark reads (about $${estimate.toFixed(2)}). Ledger: $${ledgerTotal().toFixed(2)} of $${BUDGET}.`);
if (DRY) process.exit(0);
if (misses.sam || misses.spark) {
  if (ledgerTotal() + estimate > BUDGET) {
    console.error(`Stopping: that would take the ledger past $${BUDGET}. Nothing was called.`);
    process.exit(2);
  }
  process.env.META_CACHE = "record";
  ({ results } = await pass());
}
const spent = spentThisRun(log);
if (spent.usd > 0) appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), dir: DIR, photos: ids.length, sam: spent.sam, spark: spent.spark, usd: Math.round(spent.usd * 10000) / 10000 }) + "\n");
const { markdown, tallies, grades } = report(results, { thisRun: spent.usd, total: ledgerTotal() });
if (arg("out")) writeFileSync(arg("out"), JSON.stringify({ split: SPLIT, concepts, results, tallies, grades }, null, 1));
if (arg("report")) writeFileSync(arg("report"), markdown + "\n");
console.log(markdown);
// The database client the Spark path loads keeps the process open.
process.exit(0);
