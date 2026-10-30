// The run's report: findings.json for other sessions to read, and report.html for people (findings
// ranked with their crops, a pass/fail line per screen, every shot linked).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AutoFinding, Captured } from "./capture";
import { Images } from "./images";
import { SCREENS } from "./plan";
import type { ReviewResult } from "./review";
import { rank, Report, type Finding, type Notes, type ScreenStatus } from "./schema";

// The free checks become findings like the model's, cropped the same way.
export async function autoFindings(runDir: string, shots: Captured[], auto: AutoFinding[]): Promise<Finding[]> {
  mkdirSync(join(runDir, "crops"), { recursive: true });
  const images = await Images.open();
  const out: Finding[] = [];
  try {
    // The same rule on the same screen at the same spot in several browsers is one finding.
    const seen = new Map<string, Finding>();
    let n = 0;
    for (const a of auto) {
      const shot = shots.find((s) => s.id === a.shot);
      const key = `${a.screen}|${a.rule}|${a.what.replace(/\d+/g, "#")}`;
      const prior = seen.get(key);
      if (prior) {
        prior.shots.push(a.shot);
        continue;
      }
      const id = `auto-${++n}`;
      let crop: string | null = null;
      if (shot && a.box && a.box.w > 0 && a.box.h > 0) {
        const png = await images.crop(readFileSync(join(runDir, shot.file)), a.box, Math.round(16 * shot.dpr), 700);
        if (png) {
          crop = `crops/${id}.png`;
          writeFileSync(join(runDir, crop), png);
        }
      }
      const f: Finding = {
        id,
        source: "auto",
        screen: a.screen,
        shot: a.shot,
        shots: [a.shot],
        browser: shot?.browser ?? null,
        viewport: shot?.viewport ?? null,
        severity: a.severity,
        category: a.category,
        title: a.title,
        what: a.what,
        where: a.box ? `at ${a.box.x},${a.box.y} (${a.box.w}×${a.box.h} px) in the shot` : "the whole screen",
        fix: a.fix,
        box: a.box ? { x: Math.round(a.box.x), y: Math.round(a.box.y), w: Math.round(a.box.w), h: Math.round(a.box.h) } : null,
        crop,
        screenshot: shot?.file ?? null,
        cached: false,
      };
      seen.set(key, f);
      out.push(f);
    }
  } finally {
    await images.close();
  }
  return out;
}

// Hand-written findings (--notes), cropped like the rest.
export async function notesFindings(runDir: string, shots: Captured[], notes: Notes): Promise<Finding[]> {
  mkdirSync(join(runDir, "crops"), { recursive: true });
  const images = await Images.open();
  const out: Finding[] = [];
  try {
    let n = 0;
    for (const f of notes.findings) {
      const shot = f.shot ? shots.find((s) => s.id === f.shot) : undefined;
      const id = `notes-${++n}`;
      let crop: string | null = null;
      if (shot && f.box) {
        const png = await images.crop(readFileSync(join(runDir, shot.file)), f.box, Math.round(20 * shot.dpr), 900);
        if (png) {
          crop = `crops/${id}.png`;
          writeFileSync(join(runDir, crop), png);
        }
      }
      out.push({ id, source: "notes", screen: f.screen, shot: shot?.id ?? null, shots: shot ? [shot.id] : [], browser: shot?.browser ?? null, viewport: shot?.viewport ?? null, severity: f.severity, category: f.category, title: f.title, what: f.what, where: f.where, fix: f.fix, box: f.box, crop, screenshot: shot?.file ?? null, cached: false });
    }
  } finally {
    await images.close();
  }
  return out;
}

export function buildReport(input: {
  run: string;
  commit: string | null;
  baseURL: string;
  scans: string[];
  mode: Report["mode"];
  model: string;
  budgetUsd: number;
  shots: Captured[];
  findings: Finding[];
  review: ReviewResult | null;
  noKey: boolean;
  notes?: Notes | null;
}): Report {
  const findings = [...input.findings].sort(rank);
  const screens: ScreenStatus[] = [];
  const ids = [...new Set(input.shots.map((s) => s.screen))];
  for (const def of SCREENS.filter((s) => ids.includes(s.id))) {
    const mine = findings.filter((f) => f.screen === def.id);
    const units = input.review?.units.filter((u) => u.screen === def.id) ?? [];
    const counts = { P0: 0, P1: 0, P2: 0 };
    for (const f of mine) counts[f.severity]++;
    let reviewed: ScreenStatus["reviewed"];
    const noted = input.notes?.reviewed[def.id];
    if (!units.length && noted !== undefined) reviewed = "notes";
    else if (!units.length) reviewed = input.noKey ? "skipped (no key)" : input.review ? "auto only" : "skipped (no key)";
    else if (units.every((u) => u.status === "cached")) reviewed = "cached";
    else if (units.some((u) => u.status === "opus" || u.status === "cached")) reviewed = "opus";
    else reviewed = units[0].status === "skipped (budget)" ? "skipped (budget)" : "skipped (error)";
    const modelLooked = reviewed === "opus" || reviewed === "cached" || reviewed === "notes";
    const status: ScreenStatus["status"] = counts.P0 + counts.P1 > 0 ? "fail" : modelLooked ? "pass" : "not reviewed";
    const summary = units.map((u) => u.summary).filter(Boolean).join(" ") || noted || (modelLooked ? "" : "Free checks only: no model review.");
    screens.push({ screen: def.id, title: def.title, status, summary, counts, shots: input.shots.filter((s) => s.screen === def.id).map((s) => s.id), reviewed });
  }
  const consistency = input.review?.units.find((u) => u.key === "consistency");
  if (consistency) {
    const mine = findings.filter((f) => f.screen === "consistency");
    const counts = { P0: 0, P1: 0, P2: 0 };
    for (const f of mine) counts[f.severity]++;
    screens.unshift({
      screen: "consistency",
      title: "Numbers across screens",
      status: consistency.status.startsWith("skipped") ? "not reviewed" : counts.P0 + counts.P1 > 0 ? "fail" : "pass",
      summary: consistency.summary,
      counts,
      shots: [],
      reviewed: consistency.status === "cached" ? "cached" : consistency.status === "opus" ? "opus" : consistency.status,
    });
  }
  return Report.parse({
    run: input.run,
    createdAt: new Date().toISOString(),
    commit: input.commit,
    baseURL: input.baseURL,
    scans: input.scans,
    mode: input.mode,
    reviewer: input.review ? input.model : (input.notes?.reviewer ?? null),
    model: input.model,
    budgetUsd: input.budgetUsd,
    costUsd: Math.round((input.review?.cost ?? 0) * 10000) / 10000,
    calls: input.review?.calls ?? { made: 0, cached: 0, skipped: 0 },
    screens,
    findings,
    shots: input.shots.map((s) => ({ id: s.id, screen: s.screen, file: s.file, browser: s.browser, viewport: s.viewport, camera: s.camera ?? null, notes: s.notes })),
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function writeReport(runDir: string, r: Report) {
  writeFileSync(join(runDir, "findings.json"), JSON.stringify(r, null, 1));
  writeFileSync(join(runDir, "report.html"), html(r));
}

function html(r: Report): string {
  const total = { P0: 0, P1: 0, P2: 0 };
  for (const f of r.findings) total[f.severity]++;
  const shotFile = new Map(r.shots.map((s) => [s.id, s.file]));
  const finding = (f: Finding, i: number) => `
    <article class="f" data-sev="${f.severity}" data-src="${f.source}">
      <div class="f-head"><span class="sev ${f.severity}">${f.severity}</span><span class="tag">${esc(f.category)}</span><span class="tag">${f.source === "auto" ? "free check" : f.source === "consistency" ? "cross-screen" : f.source === "notes" ? "notes" : "Opus"}${f.cached ? " · cached" : ""}</span><span class="where">#${i + 1} · ${esc(f.screen)}${f.browser ? ` · ${f.browser} ${f.viewport}` : ""}</span></div>
      <div class="f-body">
        <div class="f-text">
          <h3>${esc(f.title)}</h3>
          <p>${esc(f.what)}</p>
          <p class="muted"><b>Where:</b> ${esc(f.where)}</p>
          <p><b>Fix:</b> ${esc(f.fix)}</p>
          <p class="links">${f.shots
            .slice(0, 6)
            .map((s) => (shotFile.get(s) ? `<a href="${esc(shotFile.get(s)!)}">${esc(s)}</a>` : esc(s)))
            .join(" ")}</p>
        </div>
        ${f.crop ? `<a class="crop" href="${esc(f.screenshot ?? f.crop)}"><img loading="lazy" src="${esc(f.crop)}" alt="The problem, cropped"></a>` : f.screenshot ? `<a class="crop" href="${esc(f.screenshot)}"><img loading="lazy" src="${esc(f.screenshot)}" alt="The screen"></a>` : ""}
      </div>
    </article>`;
  const row = (s: ScreenStatus) => `
    <tr>
      <td><b>${esc(s.title)}</b><br><span class="muted mono">${esc(s.screen)}</span></td>
      <td><span class="pill ${s.status.replace(" ", "-")}">${s.status}</span></td>
      <td class="mono">${s.counts.P0} / ${s.counts.P1} / ${s.counts.P2}</td>
      <td class="muted">${esc(s.reviewed)}</td>
      <td>${esc(s.summary)}</td>
      <td class="thumbs">${s.shots
        .slice(0, 4)
        .map((id) => `<a href="${esc(shotFile.get(id)!)}" title="${esc(id)}"><img loading="lazy" src="${esc(shotFile.get(id)!)}" alt=""></a>`)
        .join("")}${s.shots.length > 4 ? `<a href="#g-${esc(s.screen)}" class="more">+${s.shots.length - 4}</a>` : ""}</td>
    </tr>`;
  const gallery = [...new Set(r.shots.map((s) => s.screen))]
    .map(
      (screen) => `
    <section class="g" id="g-${esc(screen)}"><h3>${esc(screen)}</h3><div class="g-grid">${r.shots
      .filter((s) => s.screen === screen)
      .map((s) => `<figure><a href="${esc(s.file)}"><img loading="lazy" src="${esc(s.file)}" alt=""></a><figcaption class="mono">${esc(s.id)}${s.notes.length ? `<br><span class="muted">${esc(s.notes.join(" "))}</span>` : ""}</figcaption></figure>`)
      .join("")}</div></section>`,
    )
    .join("");
  const passed = r.screens.filter((s) => s.status === "pass").length;
  const failed = r.screens.filter((s) => s.status === "fail").length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>QA report ${esc(r.run)}</title>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;800&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#F4F6F2;--card:#FBFCFA;--surface:#E6EBE4;--border:#D5DDD4;--ink:#0F2A1E;--muted:#4A5D52;--accent:#1F7A4A;--ok:#1F7A4A;--fix:#8C6A00;--stop:#B42318}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 "Hanken Grotesk",system-ui,sans-serif}
main{max-width:1180px;margin:0 auto;padding:32px 16px 80px}h1{font-weight:800;font-size:40px;letter-spacing:-0.04em;line-height:1;margin:0 0 8px}
h2{font-weight:800;font-size:24px;letter-spacing:-0.02em;margin:40px 0 12px}h3{margin:0 0 6px;font-size:17px}
.mono{font-family:"Geist Mono",ui-monospace,monospace;font-size:13px}.muted{color:var(--muted)}a{color:var(--accent)}
.stats{display:flex;flex-wrap:wrap;gap:24px;margin:16px 0 8px}.stats div{min-width:110px}.stats b{display:block;font:500 22px "Geist Mono",monospace}
table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--border)}td,th{padding:10px;border-top:1px solid var(--border);vertical-align:top;text-align:left}
th{font-weight:600;font-size:13px;color:var(--muted)}.thumbs{white-space:nowrap}.thumbs img{width:56px;height:56px;object-fit:cover;object-position:top;border:1px solid var(--border);margin-right:4px}
.more{font:13px "Geist Mono",monospace}.pill{font:500 12px "Geist Mono",monospace;padding:2px 8px;border-radius:999px;border:1px solid}
.pill.pass{color:var(--ok)}.pill.fail{color:var(--stop)}.pill.not-reviewed{color:var(--muted)}
.filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.filters button{font:inherit;border:1px solid var(--border);background:var(--card);padding:4px 12px;border-radius:999px;cursor:pointer}
.filters button[aria-pressed=true]{background:var(--ink);color:var(--card);border-color:var(--ink)}
.f{background:var(--card);border:1px solid var(--border);border-left:4px solid var(--border);padding:12px 14px;margin-bottom:10px}
.f[data-sev=P0]{border-left-color:var(--stop)}.f[data-sev=P1]{border-left-color:var(--fix)}.f[data-sev=P2]{border-left-color:var(--muted)}
.f-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:6px}.where{color:var(--muted);font:12px "Geist Mono",monospace}
.sev{font:500 12px "Geist Mono",monospace;color:#fff;padding:1px 6px}.sev.P0{background:var(--stop)}.sev.P1{background:var(--fix)}.sev.P2{background:var(--muted)}
.tag{font:12px "Geist Mono",monospace;color:var(--muted);border:1px solid var(--border);padding:0 6px}
.f-body{display:flex;gap:16px;align-items:flex-start}.f-text{flex:1;min-width:0}.f-text p{margin:4px 0}.links{font:12px "Geist Mono",monospace;word-break:break-all}
.crop img{max-width:360px;max-height:260px;border:1px solid var(--border);display:block}
.g-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}.g figure{margin:0}.g img{width:100%;height:150px;object-fit:cover;object-position:top;border:1px solid var(--border)}
figcaption{font-size:11px;word-break:break-all}
@media (max-width:700px){.f-body{flex-direction:column}.crop img{max-width:100%}table,tbody,tr,td{display:block}tr{border-top:1px solid var(--border)}td{border:0;padding:6px 10px}th{display:none}}
</style></head><body><main>
<h1>QA report</h1>
<p class="muted mono">${esc(r.run)} · ${esc(r.createdAt.slice(0, 16).replace("T", " "))} UTC${r.commit ? ` · ${esc(r.commit)}` : ""} · ${esc(r.baseURL)} · ${esc(r.mode)}</p>
<div class="stats">
  <div><b>${passed}/${r.screens.length}</b><span class="muted">screens pass</span></div>
  <div><b>${failed}</b><span class="muted">fail</span></div>
  <div><b>${total.P0} / ${total.P1} / ${total.P2}</b><span class="muted">P0 / P1 / P2</span></div>
  <div><b>$${r.costUsd.toFixed(2)}</b><span class="muted">of $${r.budgetUsd.toFixed(2)} budget</span></div>
  <div><b>${r.calls.made} / ${r.calls.cached} / ${r.calls.skipped}</b><span class="muted">calls made / cached / skipped</span></div>
  <div><b>${r.shots.length}</b><span class="muted">shots</span></div>
</div>
${r.mode === "capture only" ? `<p><b>Capture only:</b> no Opus review ran${r.reviewer ? `; the screens marked "notes" were reviewed by ${esc(r.reviewer)}` : ", so only the free checks ran"}. Add ANTHROPIC_API_KEY to .env and run <span class="mono">pnpm qa:review</span>.</p>` : ""}
<h2>Screens</h2>
<table><thead><tr><th>Screen</th><th>Status</th><th>P0 / P1 / P2</th><th>Reviewed</th><th>Summary</th><th>Shots</th></tr></thead><tbody>${r.screens.map(row).join("")}</tbody></table>
<h2>Findings, most severe first</h2>
<div class="filters" role="group" aria-label="Filter findings">
  <button data-f="all" aria-pressed="true">All</button><button data-f="P0">P0</button><button data-f="P1">P1</button><button data-f="P2">P2</button><button data-f="opus">Opus only</button><button data-f="auto">Free checks</button>
</div>
<div id="findings">${r.findings.map(finding).join("") || "<p>No findings.</p>"}</div>
<h2>Every shot</h2>
${gallery}
</main>
<script>
document.querySelectorAll(".filters button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".filters button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  const f = b.dataset.f;
  document.querySelectorAll(".f").forEach((el) => {
    const show = f === "all" || el.dataset.sev === f || (f === "opus" && el.dataset.src !== "auto") || (f === "auto" && el.dataset.src === "auto");
    el.style.display = show ? "" : "none";
  });
}));
</script>
</body></html>`;
}
