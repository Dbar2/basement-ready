// Writes tmp/e2e/<run>/report.html: each journey's steps with a screenshot each, where the time went in
// every scan (record mode times the real services, replay mode times our own work), what was replayed,
// and anything that was missing.
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { files, mode, ROOT, runDir, runId } from "./run";
import { MILESTONE_LABELS } from "./timing";

const lines = (path: string) => (existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const secs = (n: number | null | undefined) => (n == null ? "–" : `${n.toFixed(1)} s`);

// Each take's newest real-service timing, from the record runs (their folders end in -record).
function lastRecordedScans() {
  const root = join(ROOT, "tmp/e2e");
  if (!existsSync(root)) return [];
  const byTake = new Map<string, any>();
  for (const dir of readdirSync(root).filter((d) => d.endsWith("-record")).sort().reverse()) {
    // Rows whose calls all came from saved answers aren't real-service times.
    for (const t of lines(join(root, dir, "timing.jsonl"))) if (t.kind === "scan" && t.realCalls !== 0 && !byTake.has(t.take)) byTake.set(t.take, { ...t, run: "record", runId: dir });
  }
  return [...byTake.values()];
}

export default class HtmlReport implements Reporter {
  private results: { title: string; project: string; status: string; ms: number; error: string | null; notes: string[] }[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({
      title: test.titlePath().slice(3).join(" › "),
      project: test.parent.project()?.name ?? "",
      status: result.status,
      ms: result.duration,
      error: result.error?.message?.split("\n").slice(0, 6).join("\n") ?? null,
      notes: test.annotations.map((a) => `${a.type}: ${a.description ?? ""}`),
    });
  }

  onEnd(result: FullResult) {
    mkdirSync(runDir, { recursive: true });
    const steps = lines(files.steps);
    const timing = lines(files.timing);
    const calls = lines(files.replayLog);
    const misses = lines(files.missLog);
    const count = (event: string) => calls.filter((c) => c.event === event).length;

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
      ? `<h2>What recording cost</h2><table><tr><th>Take</th><th>Frames</th><th>SAM concepts on the video</th><th>SAM picture checks</th><th>Muse images</th><th>Spark reads</th><th>Voice</th><th>3D areas</th><th>Cost</th></tr>${costs
          .map((c) => `<tr><td>${esc(c.take)}</td><td>${c.frames}</td><td>${c.samVideoConcepts}</td><td>${c.samPictureChecks}</td><td>${c.museImages}</td><td>${c.sparkReads}</td><td>${c.voice}</td><td>${c.areas3d}</td><td><b>$${Number(c.usd).toFixed(2)}</b></td></tr>`)
          .join("")}</table><p class="note">Only calls that really went out. SAM $0.20 per 1,000 frames (50-frame minimum per request); Muse Image $0.01 an image; Spark by its token count; about $0.03 an area on Modal; voice not priced.</p>`
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
<p>Saved answers: ${count("hit")} replayed, ${count("recorded")} recorded from the real services, <span class="${misses.length ? "miss" : ""}">${misses.length} missing</span>.</p>
${misses.length ? `<h2 class="miss">Missing saved answers</h2><table><tr><th>Service</th><th>Route</th><th>Model</th><th>About</th><th>Key</th></tr>${misses.map((m) => `<tr><td>${esc(m.service)}</td><td>${esc(m.route)}</td><td>${esc(m.model)}</td><td>${esc(m.about)}</td><td>${esc(m.key)}</td></tr>`).join("")}</table>` : ""}
<h2>Timing, upload to answer</h2>
${timingTable}
${callTable ? `<h2>Calls to the services (time when recorded)</h2><table><tr><th>Call</th><th>Count</th><th>Fastest</th><th>Average</th><th>Slowest</th></tr>${callTable}</table>` : ""}
${costTable}
<h2>Journeys</h2>
${tests}
<p class="note">Folder: ${esc(relative(ROOT, runDir))}</p>`;
    writeFileSync(files.report, html);
    console.log(`\nE2E report: ${relative(process.cwd(), files.report)}`);
  }
}
