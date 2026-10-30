// pnpm qa: capture every screen of the journey (replay mode, no Meta credit), run the free checks, review
// the shots with Claude Opus within a budget, and write tmp/qa/<run>/report.html and findings.json.
// Without ANTHROPIC_API_KEY it captures and checks only. A development tool: nothing here ships.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs, USAGE } from "./args";
import { capture, type CaptureResult } from "./capture";
import { stillHolds } from "./lint";
import { Budget, MODEL } from "./cost";
import { anthropicKey, QA_DIR, ROOT } from "./paths";
import { buildPlan, matches, screenById } from "./plan";
import { autoFindings, buildReport, notesFindings, writeReport } from "./report";
import { review, type ReviewResult } from "./review";
import { startServers, type Servers } from "./servers";
import { Notes } from "./schema";
import { runTake, takeProblem } from "./takes";

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(USAGE);
  process.exit(0);
}

const log = (s: string) => console.log(s);
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const run = `${stamp}${args.name ? `-${args.name}` : ""}`;
const runDir = join(QA_DIR, run);
mkdirSync(runDir, { recursive: true });
const commit = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return null;
  }
})();

function latestRun(): string {
  const dirs = readdirSync(QA_DIR)
    .filter((d) => d !== run && existsSync(join(QA_DIR, d, "capture.json")))
    .sort();
  if (!dirs.length) throw new Error("no earlier capture in tmp/qa to review");
  return join(QA_DIR, dirs[dirs.length - 1]);
}

let servers: Servers | null = null;
let baseURL = args.baseURL ?? "";
let cap: CaptureResult;
let facts: Record<string, unknown> = {};
let scans = [...args.scans];

try {
  if (args.from) {
    // Review an earlier capture: its shots are copied by reference (the report links into that folder).
    const from = args.from === "latest" ? latestRun() : resolve(QA_DIR, args.from);
    const saved = JSON.parse(readFileSync(join(from, "capture.json"), "utf8"));
    cap = saved.capture;
    // --only and --all narrow an earlier capture the same way they narrow a new one.
    const keep = (screen: string) => {
      const def = screenById(screen);
      return !def || matches(def, args.only, args.all);
    };
    cap = { ...cap, shots: cap.shots.filter((s) => keep(s.screen)), auto: cap.auto.filter((a) => keep(a.screen) && stillHolds(a)) };
    facts = saved.facts ?? {};
    baseURL = saved.baseURL;
    scans = saved.scans;
    for (const sub of ["shots", "pdf"]) if (existsSync(join(from, sub))) symlinkSync(join(from, sub), join(runDir, sub));
    log(`Reviewing the capture in ${from}`);
  } else {
    if (!baseURL) {
      log(`Starting the app (${args.web === "build" ? "production build" : "Vite dev"}, replay mode, no Meta key)…`);
      servers = await startServers(runDir, args.web, { takes: args.takes.length > 0 });
      baseURL = servers.baseURL;
    }
    const claims: unknown[] = [];
    for (const take of args.takes) {
      const why = takeProblem(take);
      if (why) {
        log(`Skipping take ${take}: ${why}`);
        continue;
      }
      try {
        const t = await runTake(take, baseURL, log);
        scans.push(t.scanId);
        claims.push(...t.claims);
      } catch (e) {
        log(`Skipping take ${take}: ${(e as Error).message.split("\n")[0]}`);
      }
    }
    const shots = buildPlan({ scans, browsers: args.browsers, viewports: args.viewports, only: args.only, all: args.all });
    if (!shots.length) throw new Error(`--only ${args.only.join(",")} matches no screen`);
    log(`Capturing ${shots.length} shots at ${baseURL}`);
    cap = await capture({ baseURL, runDir, shots, claims, log });
    // The plan model each scan's drawings come from, for the cross-screen check.
    for (const scan of scans) {
      try {
        const r = await fetch(`${baseURL}/api/scans/${scan}/model`, { headers: claims.length ? { "x-claims": encodeURIComponent(JSON.stringify(claims)) } : {} });
        if (r.ok) facts[scan] = (await r.json()).model?.existing ?? null;
      } catch {
        facts[scan] = null;
      }
    }
    writeFileSync(join(runDir, "capture.json"), JSON.stringify({ baseURL, scans, facts, capture: cap }, null, 1));
  }
} finally {
  if (servers) {
    writeFileSync(join(runDir, "server.log"), servers.logs.join("\n"));
    await servers.stop();
  }
}

const key = args.captureOnly ? null : anthropicKey();
let result: ReviewResult | null = null;
if (args.dryRun) {
  await review({ runDir, shots: cap.shots, apiKey: "", budget: new Budget(args.budget), effort: args.effort, concurrency: 1, facts, log, dryRun: true });
} else if (key) {
  log(`Reviewing with ${MODEL} (effort ${args.effort}, budget $${args.budget.toFixed(2)})…`);
  const budget = new Budget(args.budget);
  result = await review({ runDir, shots: cap.shots, apiKey: key, budget, effort: args.effort, concurrency: args.concurrency, facts, log });
} else {
  log(args.captureOnly ? "Capture only (--capture-only)." : "No ANTHROPIC_API_KEY in the environment or .env: capture and free checks only.");
}

const auto = await autoFindings(runDir, cap.shots, cap.auto);
const notes = args.notes ? Notes.parse(JSON.parse(readFileSync(resolve(args.notes), "utf8"))) : null;
const noted = notes ? await notesFindings(runDir, cap.shots, notes) : [];
const report = buildReport({
  run,
  commit,
  baseURL,
  scans,
  mode: result ? "review" : "capture only",
  model: MODEL,
  budgetUsd: args.budget,
  shots: cap.shots,
  findings: [...(result?.findings ?? []), ...noted, ...auto],
  review: result,
  noKey: !key,
  notes,
});
writeReport(runDir, report);
const latest = join(QA_DIR, "latest");
rmSync(latest, { force: true });
symlinkSync(runDir, latest);

const counts = { P0: 0, P1: 0, P2: 0 };
for (const f of report.findings) counts[f.severity]++;
log("");
log(`Screens: ${report.screens.filter((s) => s.status === "pass").length} pass, ${report.screens.filter((s) => s.status === "fail").length} fail, ${report.screens.filter((s) => s.status === "not reviewed").length} not reviewed`);
log(`Findings: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2${result ? ` · spent $${report.costUsd.toFixed(2)} of $${args.budget.toFixed(2)} (${report.calls.made} calls, ${report.calls.cached} cached, ${report.calls.skipped} skipped)` : ""}`);
for (const f of report.findings.slice(0, 10)) log(`  ${f.severity} ${f.screen}: ${f.title}`);
log("");
log(`Report: ${join(runDir, "report.html")}`);
log(`JSON:   ${join(runDir, "findings.json")}`);
