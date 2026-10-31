// Writes tmp/e2e/<run>/report.html: each journey's steps with a screenshot each, where the time went in
// every scan (record mode times the real services, replay mode times our own work), what was replayed,
// and anything that was missing. Then tidies tmp/e2e (see below).
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { files, mode, ROOT, runDir, runId } from "./run";
import { MILESTONE_LABELS } from "./timing";

const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const secs = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(1)} s`);

// Run folders hold a whole database and copied uploads (a gigabyte or more for a take), so a run that
// passes deletes its folder once it's done, keeping a copy of its report, screenshots and timing in
// tmp/e2e/latest. Failed runs stay for their traces: the newest two.
const E2E = join(ROOT, "tmp/e2e");
const LATEST = join(E2E, "latest");
const KEEP_FAILED = 2;
// Record runs' scan timings (the real services), kept here when their folder goes.
const RECORDED = join(E2E, "recorded-timing.jsonl");

// Each take's newest real-service timing.
function lastRecordedScans() {
  const byTake = new Map<string, any>();
  // Rows whose calls all came from saved answers aren't real-service times.
  for (const t of lines(RECORDED).reverse()) if (t.kind === "scan" && t.realCalls !== 0 && !byTake.has(t.take)) byTake.set(t.take, { ...t, run: "record" });
  return [...byTake.values()];
}

export default class HtmlReport implements Reporter {
  private results: { title: string; project: string; status: string; ms: number; error: string | null; notes: string[] }[] = [];

  // A journey's x-e2e-test tag (support/fixtures.ts) to its name, for the misses table.
  private tags = new Map<string, string>();

  onTestEnd(test: TestCase, result: TestResult) {
    this.tags.set(`${test.id}-${result.retry}`, `${test.parent.project()?.name ?? ""} · ${test.titlePath().slice(3).join(" › ")}`);
    this.results.push({
      title: test.titlePath().slice(3).join(" › "),
      project: test.parent.project()?.name ?? "",
      status: result.status,
      ms: result.duration,
      error: result.error?.message?.split("\n").slice(0, 6).join("\n") ?? null,
      notes: test.annotations.map((a) => `${a.type}: ${a.description ?? ""}`),
    });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    mkdirSync(runDir, { recursive: true });
    const steps = lines(files.steps);
    const timing = lines(files.timing);
    const calls = lines(files.replayLog);
    const misses = lines(files.missLog);
    const count = (event: string) => calls.filter((c) => c.event === event).length;
    // Each journey fails on its own misses (support/fixtures.ts); one no journey set off fails the run.
    const untagged = misses.filter((m) => !m.test);
    const journeyOf = (tag: string | null) => (tag ? (this.tags.get(tag) ?? tag) : "none");

    const tests = this.results
      .map((r) => {
        const own = steps.filter((s) => s.project === r.project && r.title.endsWith(s.test.split(" › ").at(-1)));
        return `<section class="test ${r.status}">
  <h3>${esc(r.project)} · ${esc(r.title)} <span class="badge">${esc(r.status)}</span> <small>${(r.ms / 1000).toFixed(1)} s</small></h3>
  ${r.error ? `<pre class="err">${esc(r.error)}</pre>` : ""}
  ${r.notes.length ? `<p class="note">${r.notes.map(esc).join("<br>")}</p>` : ""}
  <div class="shots">${own
    .map((s) => `<figure><a href="${esc(s.shot)}"><img loading="lazy" src="${esc(s.shot)}" alt=""></a><figcaption>${s.n}. ${esc(s.step)} <small>${(s.ms / 1000).toFixed(1)} s</small></figcaption></figure>`)
    .join("")}</div>
</section>`;
      })
      .join("\n");

    // Beside a replay run's own times (our work only), the newest record run's (the real services).
    const recorded = mode === "replay" ? lastRecordedScans() : [];
    const scans = [...timing.filter((t) => t.kind === "scan").map((t) => ({ ...t, run: mode })), ...recorded];
    const keys = Object.keys(MILESTONE_LABELS) as (keyof typeof MILESTONE_LABELS)[];
    const timingTable = scans.length
      ? `<table><tr><th>Take</th><th>Run</th><th>Project</th><th>Upload</th>${keys.map((k) => `<th>${esc(MILESTONE_LABELS[k])}</th>`).join("")}<th>Upload → answer on screen</th></tr>${scans
          .map(
            (t) =>
              `<tr><td>${esc(t.take)}</td><td>${esc(t.run === "record" ? "record (real services)" : t.run)}</td><td>${esc(t.project)}</td><td>${secs(t.uploadS)}</td>${keys.map((k) => `<td>${secs(t.milestones?.[k])}</td>`).join("")}<td><b>${secs(t.toAnswerS)}</b></td></tr>`,
          )
          .join("")}</table><p class="note">Milestones are seconds after the scan job started (the server's own event log); upload is in the browser. Record rows are the real services; replay rows are our own work (ffmpeg, storage, the database, the browser) with every model answer instant.</p>`
      : "<p>No scans timed in this run.</p>";

    // How long each kind of call took when it was recorded: the real services.
    const byKind = new Map<string, number[]>();
    for (const c of calls.filter((c) => c.ms != null)) {
      // Public data by host: its URLs are long and many.
      const k = c.service === "public" ? `public · ${new URL(c.route).host}` : `${c.service} ${c.route}${c.model ? ` · ${c.model}` : ""}`;
      byKind.set(k, [...(byKind.get(k) ?? []), c.ms]);
    }
    const callTable = [...byKind]
      .map(([k, ms]) => `<tr><td>${esc(k)}</td><td>${ms.length}</td><td>${secs(Math.min(...ms) / 1000)}</td><td>${secs(ms.reduce((a, b) => a + b, 0) / ms.length / 1000)}</td><td>${secs(Math.max(...ms) / 1000)}</td></tr>`)
      .join("");

    const costs = timing.filter((t) => t.kind === "cost");
    const costTable = costs.length
      ? `<h2>What recording cost</h2><table><tr><th>Take</th><th>Frames</th><th>SAM concepts on the video</th><th>SAM picture checks</th><th>Muse images</th><th>Spark reads</th><th>Wonder reads</th><th>Voice</th><th>3D areas</th><th>Cost</th></tr>${costs
          .map((c) => `<tr><td>${esc(c.take)}</td><td>${c.frames}</td><td>${c.samVideoConcepts}</td><td>${c.samPictureChecks}</td><td>${c.museImages}</td><td>${c.sparkReads}</td><td>${c.wonderReads ?? 0}</td><td>${c.voice}</td><td>${c.areas3d}</td><td><b>$${Number(c.usd).toFixed(2)}</b></td></tr>`)
          .join("")}</table><p class="note">Only calls that really went out. SAM $0.20 per 1,000 video frames and $0.0025 a picture; Muse Image $0.01 an image; Spark and Wonder by their token counts; about $0.03 an area on Modal; voice not priced.</p>`
      : "";
    const tally = ["passed", "failed", "timedOut", "skipped", "interrupted"]
      .map((st) => [st, this.results.filter((r) => r.status === st).length] as const)
      .filter(([st, n]) => n > 0 || st === "failed")
      .map(([st, n]) => `${n} ${st === "timedOut" ? "timed out" : st}`)
      .join(", ");
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>E2E ${esc(runId)}</title>
<style>
body{font:14px/1.45 system-ui,sans-serif;margin:24px;color:#1b1f1c;background:#fafaf7}
h1{font-size:22px;margin:0 0 4px} h2{margin-top:32px;font-size:17px} h3{font-size:15px;margin:0 0 8px}
table{border-collapse:collapse;font-size:12px;background:#fff} td,th{border:1px solid #ddd;padding:4px 6px;text-align:left;vertical-align:top}
.test{background:#fff;border:1px solid #ddd;border-radius:8px;padding:12px;margin:12px 0}
.test.failed,.test.timedOut{border-color:#c33} .badge{font-size:11px;padding:1px 6px;border-radius:9px;background:#e6efe8}
.failed .badge,.timedOut .badge{background:#f6dcdc} .err{background:#fff4f4;padding:8px;white-space:pre-wrap;font-size:12px}
.shots{display:flex;gap:10px;overflow-x:auto} figure{margin:0;flex:0 0 auto;width:180px} figure img{width:180px;border:1px solid #ddd;border-radius:4px}
figcaption{font-size:11px} .note{color:#666;font-size:12px} .miss{color:#a11}
</style>
<h1>End-to-end run ${esc(runId)}</h1>
<p>Mode <b>${esc(mode)}</b> · ${tally} · ${(result.duration / 1000).toFixed(0)} s</p>
<p>Saved answers: ${count("hit")} replayed exactly, ${count("loose")} pictures answered by a recorded picture of the same kind, ${count("recorded")} recorded from the real services, <span class="${misses.length ? "miss" : ""}">${misses.length} missing</span>${untagged.length ? `, <span class="miss">${untagged.length} of them from no journey (they fail the run)</span>` : ""}.</p>
${misses.length ? `<h2 class="miss">Missing saved answers</h2><table><tr><th>Journey</th><th>Service</th><th>Route</th><th>Model</th><th>About</th><th>Key</th></tr>${misses.map((m) => `<tr><td>${esc(journeyOf(m.test))}</td><td>${esc(m.service)}</td><td>${esc(m.route)}</td><td>${esc(m.model)}</td><td>${esc(m.about)}</td><td>${esc(m.key)}</td></tr>`).join("")}</table>` : ""}
<h2>Timing, upload to answer</h2>
${timingTable}
${callTable ? `<h2>Calls to the services (time when recorded)</h2><table><tr><th>Call</th><th>Count</th><th>Fastest</th><th>Average</th><th>Slowest</th></tr>${callTable}</table>` : ""}
${costTable}
<h2>Journeys</h2>
${tests}
<p class="note">Folder: ${esc(relative(ROOT, runDir))}</p>`;
    writeFileSync(files.report, html);
    if (mode === "record") for (const t of timing.filter((t) => t.kind === "scan")) appendFileSync(RECORDED, JSON.stringify({ ...t, runId }) + "\n");
    this.passed = result.status === "passed" && !untagged.length;
    if (this.passed) {
      // The small part, kept: the report and what it links to.
      rmSync(LATEST, { recursive: true, force: true });
      mkdirSync(LATEST, { recursive: true });
      for (const f of ["report.html", "steps.jsonl", "timing.jsonl", "replay-log.jsonl", "shots"]) {
        if (existsSync(join(runDir, f))) cpSync(join(runDir, f), join(LATEST, f), { recursive: true });
      }
      console.log(`\nE2E report: ${relative(process.cwd(), join(LATEST, "report.html"))} (this run's folder is removed now that it passed)`);
    } else console.log(`\nE2E report: ${relative(process.cwd(), files.report)} (kept with its traces; only the newest ${KEEP_FAILED} failed runs are kept)`);
    if (untagged.length && result.status === "passed") {
      console.log(`${untagged.length} saved answers were missing outside any journey: see the report.`);
      return { status: "failed" };
    }
  }

  // After the servers have stopped: a passing run's folder goes, and failed runs past the newest two.
  async onExit() {
    // E2E_KEEP=1 keeps a passing run's folder too (its database, uploads and downloaded PDFs), to look into.
    if (this.passed && !process.env.E2E_KEEP) rmSync(runDir, { recursive: true, force: true });
    if (!existsSync(E2E)) return;
    const runs = readdirSync(E2E).filter((d) => /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-(replay|record)$/.test(d)).sort().reverse();
    for (const old of runs.slice(KEEP_FAILED)) rmSync(join(E2E, old), { recursive: true, force: true });
  }

  private passed = false;
}
