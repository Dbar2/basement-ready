// /admin: every scan as it happened, for us to see what a homeowner (David, mostly) did in the app.
// Behind ADMIN_TOKEN (server/privacy.ts): /admin?key=… sets a cookie and moves straight off the URL, or
// send the key as `Authorization: Bearer` / `x-admin-token`. Without it every /admin path is a plain 404.
// Read-only: the scan's own screens open read-only, and nothing here changes a scan.
//   /admin                      today's and recent scans, newest first
//   /admin/scans/:id            one scan: its video, plan, frames, events and answer
//   /admin/scans/:id/plan.png   the plan as "Is this your basement?" draws it
//   /admin/scans/:id/file?name= any file the scan stored (the take with its sound, depth, the camera track)
//   /admin/api/scans/:id        the scan, its events and answer as JSON (scripts/pull-scan.ts)
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { setCookie } from "hono/cookie";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { db, schema } from "./db";
import { clientIp } from "./limits";
import { existingFromScan } from "./model/seed";
import { drawPlan } from "./planDraw";
import { ADMIN_COOKIE, adminCookieValue, isAdmin, keyMatches, requestClaims } from "./privacy";
import { packFor } from "./rules";
import { storage } from "./storage";

const UUID = /^[0-9a-f-]{36}$/;
const tokens = (() => {
  try {
    return readFileSync(new URL("../brand/tokens.css", import.meta.url), "utf8");
  } catch {
    return "";
  }
})();

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const when = (d: Date | string | null) =>
  d ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d)) : "";
const day = (d: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", weekday: "long", month: "long", day: "numeric" }).format(new Date(d));
const city = (m: string) => {
  try {
    return packFor(m).city;
  } catch {
    return m;
  }
};

type Inputs = { capture?: { device?: string | null } | null; photos?: { count: number } | null; demo?: boolean } | null;
export const sourceOf = (inputs: Inputs) => `${inputs?.capture ? "iPhone app" : "Web"}, ${inputs?.photos ? `${inputs.photos.count} photos` : "video"}${inputs?.demo ? ", example address" : ""}`;

type StageEvent = { scanId: string; at: number; type: string; text: string };
// Seconds in each stage, from the scan's own events: prepare (ffmpeg), find (SAM and the 3D), assess (the rules), and in all.
export function stageTimes(events: Omit<StageEvent, "scanId">[]) {
  const start = (s: string) => events.find((e) => e.type === "stage" && e.text === s)?.at ?? null;
  const end = events.find((e) => e.type === "done" || e.type === "error")?.at ?? null;
  const [prepare, find, assess] = [start("prepare"), start("find"), start("assess")];
  const span = (a: number | null, b: number | null) => (a != null && b != null ? Math.max(0, Math.round(b - a)) : null);
  return { prepare: span(prepare, find), find: span(find, assess), assess: span(assess, end), total: end != null ? Math.round(end) : null };
}
const stagesText = (t: ReturnType<typeof stageTimes>) =>
  (["prepare", "find", "assess", "total"] as const)
    .filter((k) => t[k] != null)
    .map((k) => `${k} ${t[k]} s`)
    .join(" · ");

const STATUS: Record<string, string> = { done: "ok", error: "stop", running: "fix", queued: "fix" };
const status = (s: string) => `<span class="status" data-s="${STATUS[s] ?? "fix"}"><i></i>${esc(s)}</span>`;

function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Basement Ready admin</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;800;900&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>${tokens}
*{box-sizing:border-box}body{margin:0;background:var(--color-bg);color:var(--color-ink);font:var(--text-body)/1.5 var(--font-body)}
main{padding:var(--space-4) var(--gutter) var(--space-6);max-width:1400px;margin:0 auto}
h1{font:800 var(--text-h2)/1.15 var(--font-display);letter-spacing:-0.02em;margin:0 0 var(--space-2)}
h2{font:700 var(--text-h3)/1.3 var(--font-display);margin:var(--space-5) 0 var(--space-2);padding-top:var(--space-3);border-top:var(--line-ink)}
a{color:var(--color-accent-text)}p{margin:0 0 var(--space-2)}.muted{color:var(--color-ink-muted)}
.mono,td.mono{font-family:var(--font-mono);font-size:var(--text-figure)}
table{width:100%;border-collapse:collapse;font-size:var(--text-small)}
th{text-align:left;font-weight:600;color:var(--color-ink-muted);padding:var(--space-2) var(--space-2) var(--space-2) 0;border-bottom:var(--line-ink)}
td{padding:var(--space-2) var(--space-2) var(--space-2) 0;border-bottom:var(--line);vertical-align:top}
tr.day td{padding-top:var(--space-4);font-weight:700;border-bottom:var(--line-ink)}
.status i{display:inline-block;width:8px;height:8px;margin-right:6px;background:var(--color-fix)}
.status[data-s=ok] i{background:var(--color-ok)}.status[data-s=stop] i{background:var(--color-stop)}
.david{font-weight:700}
dl{display:grid;grid-template-columns:max-content 1fr;gap:var(--space-1) var(--space-3);margin:0}dt{color:var(--color-ink-muted)}dd{margin:0}
video,.plan{max-width:100%;border:var(--line-ink);border-radius:var(--radius-1);background:var(--color-card)}
video{max-height:70vh}
.frames{display:flex;gap:var(--space-2);overflow-x:auto;padding-bottom:var(--space-2)}
.frames figure{margin:0;flex:0 0 auto}.frames img{height:140px;border-radius:var(--radius-1);display:block}
.frames figcaption{font:var(--text-tiny) var(--font-mono);color:var(--color-ink-muted)}
pre{font:var(--text-tiny)/1.45 var(--font-mono);background:var(--color-card);border:var(--line);border-radius:var(--radius-1);padding:var(--space-3);overflow:auto;max-height:70vh}
summary{cursor:pointer;font-weight:600}
@media (max-width:760px){thead{display:none}table,tbody,tr,td{display:block}tr{border-bottom:var(--line);padding:var(--space-2) 0}td{border:0;padding:2px 0}}
</style></head><body><main>${body}</main></body></html>`;
}

const notFound = (c: Context) => c.text("Not found", 404);

export function mountAdmin(app: Hono) {
  app.get("/admin", async (c) => {
    // The key in the address once: a cookie for it, and off the URL at once (it stays out of history).
    const key = c.req.query("key");
    if (key !== undefined) {
      if (!keyMatches(key)) return notFound(c);
      const https = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
      setCookie(c, ADMIN_COOKIE, adminCookieValue(process.env.ADMIN_TOKEN!.trim()), { httpOnly: true, secure: https, sameSite: "Lax", path: "/", maxAge: 30 * 24 * 3600 });
      return c.redirect("/admin", 303);
    }
    if (!isAdmin(c)) return notFound(c);

    const scans = await db
      .select({
        id: schema.scans.id,
        createdAt: schema.scans.createdAt,
        status: schema.scans.status,
        costUsd: schema.scans.costUsd,
        inputs: schema.scans.inputs,
        clientIp: schema.scans.clientIp,
        basementId: schema.scans.basementId,
        municipality: schema.basements.municipality,
        headline: sql<string | null>`${schema.scans.result}->>'headline'`,
      })
      .from(schema.scans)
      .innerJoin(schema.basements, eq(schema.scans.basementId, schema.basements.id))
      .orderBy(desc(schema.scans.createdAt))
      .limit(80);
    const events: StageEvent[] = scans.length
      ? await db
          .select({ scanId: schema.scanEvents.scanId, at: schema.scanEvents.at, type: schema.scanEvents.type, text: schema.scanEvents.text })
          .from(schema.scanEvents)
          .where(sql`${inArray(schema.scanEvents.scanId, scans.map((s) => s.id))} and ${schema.scanEvents.type} in ('stage', 'done', 'error')`)
          .orderBy(schema.scanEvents.id)
      : [];
    // Probably David: a scan of a basement this browser holds the claim to, or from an address one of those came from, or this one.
    const mine = new Set(requestClaims(c).map((x) => x.basementId));
    const ips = new Set([clientIp(c), ...scans.filter((s) => mine.has(s.basementId)).map((s) => s.clientIp)].filter((ip): ip is string => Boolean(ip) && ip !== "unknown"));
    const david = (s: (typeof scans)[number]) => mine.has(s.basementId) || (s.clientIp != null && ips.has(s.clientIp));

    let lastDay = "";
    const rows = scans
      .map((s) => {
        const d = day(s.createdAt);
        const head = d !== lastDay ? `<tr class="day"><td colspan="8">${esc(d)}</td></tr>` : "";
        lastDay = d;
        const t = stageTimes(events.filter((e) => e.scanId === s.id));
        return `${head}<tr>
<td class="mono"><a href="/admin/scans/${s.id}">${esc(when(s.createdAt))}</a></td>
<td>${esc(sourceOf(s.inputs as Inputs))}</td>
<td>${status(s.status)}</td>
<td class="mono">${esc(stagesText(t))}</td>
<td class="mono">$${s.costUsd.toFixed(2)}</td>
<td>${esc(city(s.municipality))}</td>
<td>${esc(s.headline ?? "")}</td>
<td>${david(s) ? '<span class="david">Probably David</span>' : ""}</td></tr>`;
      })
      .join("");
    return c.html(
      page(
        "Scans",
        `<h1>Scans</h1><p class="muted">The newest ${scans.length}, newest first. Times in Toronto; stages in seconds from the job's start.</p>
<table><thead><tr><th>When</th><th>Source</th><th>Status</th><th>Stages</th><th>Cost</th><th>City</th><th>Answer</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="8" class="muted">No scans yet.</td></tr>'}</tbody></table>`,
      ),
    );
  });

  async function scanRow(id: string) {
    const [row] = await db
      .select({ scan: schema.scans, municipality: schema.basements.municipality })
      .from(schema.scans)
      .innerJoin(schema.basements, eq(schema.scans.basementId, schema.basements.id))
      .where(eq(schema.scans.id, id));
    return row ?? null;
  }
  const allEvents = (id: string) =>
    db.select({ at: schema.scanEvents.at, type: schema.scanEvents.type, text: schema.scanEvents.text, data: schema.scanEvents.data }).from(schema.scanEvents).where(eq(schema.scanEvents.scanId, id)).orderBy(schema.scanEvents.id);

  app.get("/admin/scans/:id", async (c) => {
    const id = c.req.param("id");
    if (!isAdmin(c) || !UUID.test(id)) return notFound(c);
    const row = await scanRow(id);
    if (!row) return notFound(c);
    const { scan } = row;
    const result = scan.result as any;
    const events = await allEvents(id);
    const t = stageTimes(events);
    const frames = scan.frameCount ?? 0;
    const step = Math.max(1, Math.ceil(frames / 30));
    const strip = Array.from({ length: Math.ceil(frames / step) }, (_, i) => i * step)
      .map((n) => `<figure><a href="/api/scans/${id}/frames/${n}"><img loading="lazy" src="/api/scans/${id}/frames/${n}" alt="Frame ${n}"></a><figcaption>${n} · ${(n / 5).toFixed(1)} s</figcaption></figure>`)
      .join("");
    // Long SAM tracks make the answer hard to read; the raw JSON has them.
    const shown = result ? JSON.stringify({ ...result, detections: (result.detections ?? []).map(({ track, ...d }: any) => ({ ...d, track: `${track?.length ?? 0} frames` })) }, null, 1) : "null";
    const original = scan.videoKey && !(scan.inputs as Inputs)?.photos ? `/admin/scans/${id}/file?name=${encodeURIComponent(scan.videoKey.split(`scans/${id}/`)[1] ?? "")}` : null;
    return c.html(
      page(
        `Scan ${when(scan.createdAt)}`,
        `<p><a href="/admin">← All scans</a></p>
<h1>${esc(when(scan.createdAt))}: ${esc(result?.headline ?? scan.status)}</h1>
<dl>
<dt>Status</dt><dd>${status(scan.status)}${scan.error ? ` <span class="muted">${esc(scan.error)}</span>` : ""}</dd>
<dt>Source</dt><dd>${esc(sourceOf(scan.inputs as Inputs))}${(scan.inputs as Inputs)?.capture?.device ? ` <span class="muted">(${esc((scan.inputs as Inputs)!.capture!.device)})</span>` : ""}</dd>
<dt>City</dt><dd>${esc(city(row.municipality))}</dd>
<dt>Stages</dt><dd class="mono">${esc(stagesText(t)) || "–"}</dd>
<dt>Cost</dt><dd class="mono">$${scan.costUsd.toFixed(2)}</dd>
<dt>Frames</dt><dd class="mono">${frames}</dd>
<dt>Their screens</dt><dd><a href="/scans/${id}">Wait screen and answer</a> · <a href="/scans/${id}/plan">Is this your basement?</a> · <a href="/scans/${id}?tab=decision">Workspace</a> <span class="muted">(read-only)</span></dd>
<dt>Raw</dt><dd><a href="/admin/api/scans/${id}">Scan, events and answer as JSON</a>${original ? ` · <a href="${original}">The take as filmed, with sound</a>` : ""}</dd>
</dl>
<h2>The video</h2>
<video controls preload="metadata" src="/api/scans/${id}/video"></video>
<p class="muted">The 5 fps video SAM and the 3D read, without sound.${original ? ` <a href="${original}">The take as filmed</a> has the sound.` : ""}</p>
${result ? `<h2>The plan</h2><img class="plan" src="/admin/scans/${id}/plan.png" alt="The plan as Is this your basement? draws it">` : ""}
${frames ? `<h2>Frames</h2><div class="frames">${strip}</div>` : ""}
<h2>Events</h2>
<table><thead><tr><th>At</th><th>Type</th><th>What</th></tr></thead><tbody>${events.map((e) => `<tr><td class="mono">${e.at.toFixed(1)} s</td><td>${esc(e.type)}</td><td>${esc(e.text)}</td></tr>`).join("")}</tbody></table>
<h2>The answer</h2>
<details><summary>Result JSON</summary><pre>${esc(shown)}</pre></details>`,
      ),
    );
  });

  app.get("/admin/scans/:id/plan.png", async (c) => {
    const id = c.req.param("id");
    if (!isAdmin(c) || !UUID.test(id)) return notFound(c);
    const row = await scanRow(id);
    const existing = row?.scan.result ? existingFromScan(row.scan.result as any) : null;
    if (!existing) return notFound(c);
    return c.body(new Uint8Array(drawPlan(existing)), 200, { "Content-Type": "image/png", "Cache-Control": "private, no-store" });
  });

  // Any file the scan stored, by its name under scans/<id>/: never outside that folder.
  app.get("/admin/scans/:id/file", async (c) => {
    const id = c.req.param("id");
    const name = c.req.query("name") ?? "";
    if (!isAdmin(c) || !UUID.test(id) || !/^[A-Za-z0-9._/-]{1,200}$/.test(name) || name.includes("..") || name.startsWith("/")) return notFound(c);
    const body = await storage.get(`scans/${id}/${name}`);
    if (!body) return notFound(c);
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const type = { mp4: "video/mp4", mov: "video/quicktime", jpg: "image/jpeg", png: "image/png", json: "application/json" }[ext] ?? "application/octet-stream";
    return new Response(Readable.toWeb(body) as ReadableStream, { headers: { "Content-Type": type, "Cache-Control": "private, no-store" } });
  });

  app.get("/admin/api/scans/:id", async (c) => {
    const id = c.req.param("id");
    if (!isAdmin(c) || !UUID.test(id)) return notFound(c);
    const row = await scanRow(id);
    if (!row) return notFound(c);
    const { scan } = row;
    return c.json(
      {
        scan: {
          id: scan.id,
          createdAt: scan.createdAt,
          startedAt: scan.startedAt,
          finishedAt: scan.finishedAt,
          status: scan.status,
          error: scan.error,
          costUsd: scan.costUsd,
          frameCount: scan.frameCount,
          inputs: scan.inputs,
          source: sourceOf(scan.inputs as Inputs),
          city: city(row.municipality),
          // Its stored input under scans/<id>/ (the take as filmed, or a photo take's record), for /admin/scans/:id/file.
          input: scan.videoKey?.split(`scans/${id}/`)[1] ?? null,
        },
        events: await allEvents(id),
        result: scan.result,
      },
      200,
      { "Cache-Control": "private, no-store" },
    );
  });
}
