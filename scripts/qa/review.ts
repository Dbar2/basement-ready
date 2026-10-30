// Sends the shots to Claude Opus with what each screen is meant to show and the checklist, and turns the
// answers into findings with the problem cropped out. Each screen is one request (its phone and desktop
// shots together, Safari only where it differs from Chrome); 3D views, the plan overlay and PDF pages are
// grouped likewise; one text-only pass compares numbers across every screen. A request whose images and
// text are unchanged since an earlier run is answered from the cache for free.
import Anthropic from "@anthropic-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Captured } from "./capture";
import { Budget, costOf, estimate, MODEL, type Usage } from "./cost";
import { Images, sha256, type Box } from "./images";
import { CACHE_DIR } from "./paths";
import { CAMERA_LABEL, screenById, type Viewport } from "./plan";
import { CONSISTENCY_SYSTEM, PROMPT_VERSION, SYSTEM } from "./prompts";
import { ConsistencyReview, jsonSchema, ScreenReview, type Finding, type ModelFinding } from "./schema";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

type Sent = { shot: Captured; label: string; data: Buffer; w: number; h: number; scale: number; offsetY: number };
type Unit = { key: string; screen: string; title: string; priority: number; shots: Captured[]; images: Sent[]; text: string; outputTokens: number };

export type UnitResult = {
  key: string;
  screen: string;
  status: "opus" | "cached" | "skipped (budget)" | "skipped (error)";
  summary: string;
  verdict: "pass" | "fail" | null;
  cost: number;
  error?: string;
};

export type ReviewResult = { findings: Finding[]; units: UnitResult[]; cost: number; calls: { made: number; cached: number; skipped: number } };

// How much of a shot each request carries, and how sharp. Long pages are cut into screen-tall pieces;
// the first two pieces go sharp, the rest at half detail.
const MAX_TILES = 8;
const SHARP_TILES = 2;
const PAGE_SCALE: Record<Viewport, { high: number; low: number }> = { phone: { high: 0.75, low: 0.5 }, desktop: { high: 1, low: 0.6 } };
const WEBKIT_DIFF = 0.06; // share of pixels: above this Safari is sent too
const WEBKIT_3D_DIFF = 0.25;

const nice = (s: Captured) => `${s.browser === "webkit" ? "Safari (WebKit)" : "Chrome"} ${s.viewport === "phone" ? "phone 390×844" : "desktop 1280×800"}`;

export async function review(opts: {
  runDir: string;
  shots: Captured[];
  apiKey: string;
  budget: Budget;
  effort: Effort;
  concurrency: number;
  facts: unknown;
  log: (s: string) => void;
  // Build and price every request, write them to requests.json, send nothing.
  dryRun?: boolean;
}): Promise<ReviewResult> {
  RUN_DIR = opts.runDir;
  const images = await Images.open();
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 3, timeout: 10 * 60_000 });
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(join(opts.runDir, "crops"), { recursive: true });
  const out: ReviewResult = { findings: [], units: [], cost: 0, calls: { made: 0, cached: 0, skipped: 0 } };
  try {
    const units = await buildUnits(opts.shots, images);
    opts.log(`${units.length} review requests planned (budget $${opts.budget.cap.toFixed(2)})`);
    const consistency = consistencyUnit(opts.shots, opts.facts);

    if (opts.dryRun) {
      const rows = [consistency, ...units.sort((a, b) => a.priority - b.priority)].map((u) => ({
        key: u.key,
        screen: u.screen,
        images: u.images.map((i) => ({ label: i.label, w: i.w, h: i.h, kb: Math.round(i.data.length / 1024) })),
        textChars: u.text.length,
        estimateUsd: Number(estimate(u.images, (u.key === "consistency" ? CONSISTENCY_SYSTEM : SYSTEM) + u.text, u.outputTokens).toFixed(4)),
        cached: existsSync(join(CACHE_DIR, `${unitCacheKey(u, opts.effort)}.json`)),
      }));
      const total = rows.reduce((n, r) => n + (r.cached ? 0 : r.estimateUsd), 0);
      writeFileSync(join(opts.runDir, "requests.json"), JSON.stringify({ effort: opts.effort, totalEstimateUsd: Number(total.toFixed(3)), requests: rows }, null, 1));
      opts.log(`Dry run: ${rows.length} requests, ${rows.reduce((n, r) => n + r.images.length, 0)} images, about $${total.toFixed(2)} uncached (requests.json)`);
      return out;
    }
    const queue = [...units.sort((a, b) => a.priority - b.priority)];
    // The cross-screen pass goes right after the most important screens.
    queue.splice(Math.min(queue.length, 6), 0, consistency);
    let next = 0;
    const worker = async () => {
      while (next < queue.length) {
        const u = queue[next++];
        await runUnit(u, { client, images, budget: opts.budget, effort: opts.effort, runDir: opts.runDir, out, log: opts.log });
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
  } finally {
    await images.close();
  }
  out.cost = opts.budget.spent;
  return out;
}

// ---- Building the requests ----

async function buildUnits(shots: Captured[], images: Images): Promise<Unit[]> {
  const units: Unit[] = [];
  const byScreen = new Map<string, Captured[]>();
  for (const s of shots) {
    const k = `${s.screen}@${s.scan}`;
    byScreen.set(k, [...(byScreen.get(k) ?? []), s]);
  }
  for (const list of byScreen.values()) {
    const screen = screenById(list[0].screen);
    if (!screen) continue;
    const scan = list[0].scan;
    const key = scan === "sample" ? screen.id : `${screen.id}@${scan}`;
    const head = `Screen: ${screen.title}${scan === "sample" ? "" : ` (scan ${scan})`}\nRoute: ${list[0].route}\nMeant to show: ${screen.purpose}\nAlso check: ${screen.checks.length ? screen.checks.join(" ") : "(the shared checklist only)"}${screen.captureNote ? `\nAbout the capture: ${screen.captureNote}` : ""}\nFull-page shots: the sticky header and bottom bar appear once, where they sit in the first screen.`;

    if (screen.kind === "page") {
      const sent: Sent[] = [];
      for (const vp of ["desktop", "phone"] as Viewport[]) {
        const chrome = list.find((s) => s.browser === "chromium" && s.viewport === vp);
        const safari = list.find((s) => s.browser === "webkit" && s.viewport === vp);
        const base = chrome ?? safari;
        if (!base) continue;
        sent.push(...(await pageTiles(base, images)));
        if (chrome && safari) {
          const d = await images.diff(readShot(chrome), readShot(safari));
          if (d > WEBKIT_DIFF) sent.push(...(await differingTiles(chrome, safari, images)));
        }
      }
      const notes = list.flatMap((s) => s.notes.map((n) => `${s.id}: ${n}`));
      units.push(unit(key, screen, list, sent, head + (notes.length ? `\nCapture notes: ${notes.join(" ")}` : "")));
    } else if (screen.kind === "3d") {
      const sent: Sent[] = [];
      const chromeDesk = list.filter((s) => s.browser === "chromium" && s.viewport === "desktop");
      const chromePhone = list.filter((s) => s.browser === "chromium" && s.viewport === "phone");
      for (const s of chromeDesk.filter((s) => s.camera)) sent.push(await fitShot(s, images, 1280, 1000, `${nice(s)}, camera ${CAMERA_LABEL[s.camera!]}`));
      for (const s of chromeDesk.filter((s) => s.step)) sent.push(await fitShot(s, images, 768, 768, `${nice(s)}, the page at scroll step ${s.step} of the story`));
      for (const s of chromePhone.filter((s) => s.camera)) sent.push(await fitShot(s, images, 520, 700, `${nice(s)}, camera ${CAMERA_LABEL[s.camera!]}`));
      for (const s of list.filter((s) => s.browser === "webkit" && s.camera)) {
        const twin = list.find((c) => c.browser === "chromium" && c.viewport === s.viewport && c.camera === s.camera);
        if (!twin || (await images.diff(readShot(twin), readShot(s))) > WEBKIT_3D_DIFF) sent.push(await fitShot(s, images, 640, 640, `${nice(s)}, camera ${CAMERA_LABEL[s.camera!]} (differs from Chrome)`));
      }
      if (sent.length) units.push(unit(key, screen, list, sent, head + "\nThese are fixed cameras put into the app's own 3D view by the QA tool; judge the scene, not the camera choice."));
    } else if (screen.kind === "overlay") {
      const s = list[0];
      units.push(unit(key, screen, list, [await fitShot(s, images, 1400, 1100, "Top-down render of the scan with the plan drawn over it")], head + `\n${s.notes.join(" ")}`));
    } else if (screen.kind === "pdf") {
      // Pages three to a request, sharp enough to read a title block.
      const pages = list.filter((s) => s.page).sort((a, b) => (a.doc ?? "").localeCompare(b.doc ?? "") || a.page! - b.page!);
      const docs = [...new Set(pages.map((p) => p.doc))];
      // The submit copy repeats the review copy's drawings: one of them is enough.
      const doc = docs.includes("submit") ? "submit" : docs[0];
      const mine = pages.filter((p) => p.doc === doc);
      for (let i = 0; i < mine.length; i += 3) {
        const group = mine.slice(i, i + 3);
        const sent = [];
        // Permit sheets carry small dimension text; book pages are set larger.
        const px = screen.id === "permit-pdf" ? 1800 : 1400;
        for (const s of group) sent.push(await fitShot(s, images, px, px, `PDF page ${s.page} of ${mine.length} (${doc} copy)`));
        units.push({ ...unit(`${key}.${doc}.p${group[0].page}-${group[group.length - 1].page}`, screen, group, sent, `${head}\nThis request: pages ${group[0].page}–${group[group.length - 1].page} of ${mine.length}.`), priority: screen.priority + i / 100 });
      }
    }
  }
  return units;
}

function unit(key: string, screen: { id: string; title: string; priority: number }, shots: Captured[], images: Sent[], head: string): Unit {
  const list = images.map((s, i) => `Image ${i + 1}: ${s.label} (${s.w}×${s.h} px)`).join("\n");
  return { key, screen: screen.id, title: screen.title, priority: screen.priority, shots, images, text: `${head}\n\n${list}\n\nReview these images against the checklist.`, outputTokens: 3500 };
}

// Shots are saved relative to the run folder, which review() sets before anything is read.
let RUN_DIR = "";
const readShot = (s: Captured) => readFileSync(join(RUN_DIR, s.file));

async function fitShot(s: Captured, images: Images, maxW: number, maxH: number, label: string): Promise<Sent> {
  const r = await images.fit(readShot(s), maxW, maxH);
  return { shot: s, label, data: r.data, w: r.w, h: r.h, scale: r.scale, offsetY: 0 };
}

async function pageTiles(s: Captured, images: Images): Promise<Sent[]> {
  const tileH = Math.round((s.viewport === "phone" ? 844 : 800) * s.dpr);
  const pieces = await images.tiles(readShot(s), tileH, MAX_TILES);
  const out: Sent[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i];
    const k = (i < SHARP_TILES ? PAGE_SCALE[s.viewport].high : PAGE_SCALE[s.viewport].low) * (s.viewport === "phone" ? 2 / s.dpr : 1);
    const r = await images.fit(p.data, Math.round(p.w * k), Math.round(p.h * k));
    out.push({ shot: s, label: `${nice(s)}, part ${i + 1} of ${pieces.length} (top to bottom)`, data: r.data, w: r.w, h: r.h, scale: r.scale, offsetY: p.y });
  }
  return out;
}

// Safari's pieces that differ from Chrome's at the same size, at most three.
async function differingTiles(chrome: Captured, safari: Captured, images: Images): Promise<Sent[]> {
  const tileH = Math.round((safari.viewport === "phone" ? 844 : 800) * safari.dpr);
  const a = await images.tiles(readShot(chrome), tileH, MAX_TILES);
  const b = await images.tiles(readShot(safari), tileH, MAX_TILES);
  const out: Sent[] = [];
  for (let i = 0; i < b.length && out.length < 3; i++) {
    const d = a[i] ? await images.diff(a[i].data, b[i].data) : 1;
    if (d <= WEBKIT_DIFF) continue;
    const k = PAGE_SCALE[safari.viewport].low * (safari.viewport === "phone" ? 2 / safari.dpr : 1);
    const r = await images.fit(b[i].data, Math.round(b[i].w * k), Math.round(b[i].h * k));
    out.push({ shot: safari, label: `${nice(safari)}, part ${i + 1} (differs from Chrome by ${(d * 100).toFixed(0)}%)`, data: r.data, w: r.w, h: r.h, scale: r.scale, offsetY: b[i].y });
  }
  return out;
}

// The numbers on every screen and PDF page, plus the plan model, for one text-only pass.
function consistencyUnit(shots: Captured[], facts: unknown): Unit {
  const seen = new Set<string>();
  const parts: string[] = [];
  // One browser is enough for text: Chrome's desktop shot, else whatever there is.
  const order = [...shots].sort((a, b) => Number(b.browser === "chromium") - Number(a.browser === "chromium") || Number(b.viewport === "desktop") - Number(a.viewport === "desktop"));
  for (const s of order) {
    if (!s.numbers?.length) continue;
    const id = s.page ? s.id : `${s.screen}${s.scan === "sample" ? "" : `@${s.scan}`}`;
    if (seen.has(id)) continue;
    seen.add(id);
    parts.push(`### ${id}\n${s.numbers.join("\n")}`);
  }
  const text = `The plan model (source of truth for the drawings):\n${JSON.stringify(facts ?? null).slice(0, 6000)}\n\nNumbers on each screen and PDF page:\n\n${parts.join("\n\n")}`;
  return { key: "consistency", screen: "consistency", title: "Numbers across screens", priority: 0, shots: [], images: [], text, outputTokens: 4000 };
}

// ---- Running a request ----

// Same prompt version, model, effort, instructions, text and image bytes: same answer, from the cache.
function unitCacheKey(u: Unit, effort: Effort) {
  const system = u.key === "consistency" ? CONSISTENCY_SYSTEM : SYSTEM;
  return sha256(JSON.stringify({ v: PROMPT_VERSION, model: MODEL, effort, system: sha256(system), text: u.text, images: u.images.map((i) => sha256(i.data)) }));
}

type Ctx = { client: Anthropic; images: Images; budget: Budget; effort: Effort; runDir: string; out: ReviewResult; log: (s: string) => void };

async function runUnit(u: Unit, ctx: Ctx) {
  const isText = u.key === "consistency";
  const system = isText ? CONSISTENCY_SYSTEM : SYSTEM;
  const schema = jsonSchema(isText ? ConsistencyReview : ScreenReview);
  const cacheFile = join(CACHE_DIR, `${unitCacheKey(u, ctx.effort)}.json`);
  const est = estimate(u.images, system + u.text, u.outputTokens);

  let answer: unknown;
  let status: UnitResult["status"] = "opus";
  let cost = 0;
  if (existsSync(cacheFile)) {
    answer = JSON.parse(readFileSync(cacheFile, "utf8")).answer;
    status = "cached";
    ctx.out.calls.cached++;
  } else {
    if (!ctx.budget.hold(est)) {
      ctx.out.calls.skipped++;
      ctx.out.units.push({ key: u.key, screen: u.screen, status: "skipped (budget)", summary: `Not reviewed: about $${est.toFixed(2)} would pass the budget ($${ctx.budget.left.toFixed(2)} left).`, verdict: null, cost: 0 });
      ctx.log(`  skip ${u.key} (budget)`);
      return;
    }
    try {
      const content: Anthropic.Beta.BetaContentBlockParam[] = [];
      u.images.forEach((img, i) => {
        content.push({ type: "text", text: `Image ${i + 1}: ${img.label}` });
        content.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: img.data.toString("base64") } });
      });
      content.push({ type: "text", text: u.text });
      const res = await ctx.client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        // Server-side fallback if a request is ever declined (it shouldn't be: these are app screenshots).
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        output_config: { effort: ctx.effort, format: { type: "json_schema", schema } },
        messages: [{ role: "user", content }],
      });
      cost = costOf(res.usage as Usage);
      ctx.budget.settle(est, cost);
      ctx.out.calls.made++;
      if (res.stop_reason === "refusal") throw new Error(`declined (${res.stop_details?.category ?? "no category"})`);
      if (res.stop_reason === "max_tokens") throw new Error("ran out of output tokens");
      const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      answer = JSON.parse(text);
      writeFileSync(cacheFile, JSON.stringify({ key: u.key, at: new Date().toISOString(), cost, usage: res.usage, answer }, null, 1));
    } catch (e) {
      ctx.budget.settle(est, cost);
      const msg = e instanceof Anthropic.APIError ? `API ${e.status}: ${e.message}` : (e as Error).message;
      ctx.out.units.push({ key: u.key, screen: u.screen, status: "skipped (error)", summary: `Review failed: ${msg}`, verdict: null, cost, error: msg });
      ctx.log(`  error ${u.key}: ${msg}`);
      return;
    }
  }

  if (isText) {
    const parsed = ConsistencyReview.safeParse(answer);
    if (!parsed.success) return badAnswer(u, ctx, status, cost, parsed.error.message);
    parsed.data.findings.forEach((f, i) =>
      ctx.out.findings.push({
        id: `consistency-${i + 1}`,
        source: "consistency",
        screen: "consistency",
        shot: null,
        shots: f.screens,
        browser: null,
        viewport: null,
        severity: f.severity,
        category: "correctness",
        title: f.title,
        what: f.what,
        where: f.screens.join(", "),
        fix: f.fix,
        box: null,
        crop: null,
        screenshot: null,
        cached: status === "cached",
      }),
    );
    ctx.out.units.push({ key: u.key, screen: u.screen, status, summary: parsed.data.summary, verdict: parsed.data.findings.some((f) => f.severity !== "P2") ? "fail" : "pass", cost });
    ctx.log(`  ${status === "cached" ? "cached" : `$${cost.toFixed(3)}`} ${u.key}: ${parsed.data.findings.length} findings`);
    return;
  }

  const parsed = ScreenReview.safeParse(answer);
  if (!parsed.success) return badAnswer(u, ctx, status, cost, parsed.error.message);
  let n = 0;
  for (const f of parsed.data.findings) ctx.out.findings.push(await toFinding(u, f, ++n, status === "cached", ctx));
  ctx.out.units.push({ key: u.key, screen: u.screen, status, summary: parsed.data.summary, verdict: parsed.data.verdict, cost });
  ctx.log(`  ${status === "cached" ? "cached" : `$${cost.toFixed(3)}`} ${u.key}: ${parsed.data.findings.length} findings`);
}

function badAnswer(u: Unit, ctx: Ctx, status: UnitResult["status"], cost: number, why: string) {
  ctx.out.units.push({ key: u.key, screen: u.screen, status: "skipped (error)", summary: `The answer didn't match the schema: ${why.slice(0, 200)}`, verdict: null, cost, error: why });
  ctx.log(`  bad answer ${u.key} (${status}): ${why.slice(0, 200)}`);
}

// The model's box is in the sent image's pixels; the report wants it in the saved shot's pixels.
export function toShotBox(box: Box, img: { scale: number; offsetY: number }, shot: { w: number; h: number }): Box {
  const x = Math.max(0, Math.round(box.x / img.scale));
  const y = Math.max(0, Math.round(box.y / img.scale + img.offsetY));
  const w = Math.max(1, Math.min(shot.w - x, Math.round(box.w / img.scale)));
  const h = Math.max(1, Math.min(shot.h - y, Math.round(box.h / img.scale)));
  return { x: Math.min(x, shot.w - 1), y: Math.min(y, shot.h - 1), w, h };
}

async function toFinding(u: Unit, f: ModelFinding, n: number, cached: boolean, ctx: Ctx): Promise<Finding> {
  const img = u.images[f.image - 1] ?? u.images[0];
  const shot = img?.shot ?? u.shots[0];
  const id = `${u.key}-${n}`;
  let box: Box | null = null;
  let crop: string | null = null;
  if (img && shot) {
    box = toShotBox(f.box, img, shot);
    const whole = box.w >= shot.w * 0.95 && box.h >= Math.min(shot.h, img.h / img.scale) * 0.95;
    if (!whole) {
      const png = await ctx.images.crop(readShot(shot), box, Math.round(24 * shot.dpr), 900);
      if (png) {
        crop = `crops/${id}.png`;
        writeFileSync(join(ctx.runDir, crop), png);
      }
    }
  }
  return {
    id,
    source: "opus",
    screen: u.screen,
    shot: shot?.id ?? null,
    shots: [...new Set(u.shots.map((s) => s.id))],
    browser: shot?.browser ?? null,
    viewport: shot?.viewport ?? null,
    severity: f.severity,
    category: f.category,
    title: f.title,
    what: f.what,
    where: f.where,
    fix: f.fix,
    box,
    crop,
    screenshot: shot?.file ?? null,
    cached,
  };
}
