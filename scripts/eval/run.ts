// Runs the synthetic basements (scripts/eval/generate.py) through the real scan and scores it
// against their ground truth: ceiling height, room sizes, rooms found, windows found, and the verdict.
// Usage: tsx scripts/eval/run.ts [--api http://127.0.0.1:8787] [--only b1,b4] [--rooms truth|detector|none] [--reuse|--fresh]
//   --rooms truth     send the true room starts, as if the phone marked every doorway (default):
//                     the 3D is then scored room by room, apart from room finding
//   --rooms detector  send what src/capture/rooms.ts finds in the video on its own (no live door finds)
//   --rooms none      send no room marks: one 3D scan of the whole basement
// A basement already scanned (saved in tmp/eval/scans.json) is scored from that scan, not paid for again.
//   --reuse           only score saved scans; never upload (free)
//   --fresh           upload again even when a scan is saved
//   --3d-only         skip SAM and Spark: send each true room's frames straight to the local 3D service
//                     (free), as filmed, without the stairs, and with a tape measurement of the ceiling
// Needs the API (`pnpm dev` or `pnpm dev:phone`) and the 3D service (`pnpm dev:scan3d`).
// Each new scan spends about $0.45–0.70 of Meta credit (SAM + Spark). Writes tmp/eval/report.md.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openAsBlob, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RoomDetector, lookOf } from "../../src/capture/rooms";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const API = arg("api", "http://127.0.0.1:8787");
const ONLY = arg("only", "").split(",").filter(Boolean);
const ROOMS = arg("rooms", "truth") as "truth" | "detector" | "none";
const REUSE = process.argv.includes("--reuse");
const FRESH = process.argv.includes("--fresh");
const ONLY_3D = process.argv.includes("--3d-only");
const EVAL = "media/eval";
const OUT = "tmp/eval";
const SCANS = join(OUT, "scans.json");
const FPS = 5; // analysis frames per second, as in server/pipeline.ts
const LIVE_EVERY = 6; // the phone checks for a new room about every 1.2 s

type Box = [number, number, number, number, number]; // frame, x, y, w, h (0..1)
type TruthRoom = {
  index: number; name: string; startS: number; endS: number; widthM: number; depthM: number; areaM2: number;
  ceiling: string; ceilingHeightM: number; subfloorM: number | null; minClearanceM: number | null; windows: string[]; hasFurnace: boolean;
};
type TruthWindow = { id: string; room: number; widthM: number; heightM: number; areaM2: number; meetsEgress: boolean; analysisBoxes: Box[] };
type Truth = {
  id: string; about: string; durationS: number; rooms: TruthRoom[]; roomStartsS: number[]; stairsEndS: number; windows: TruthWindow[];
  doors: { widthM: number; heightM: number; slab: boolean }[];
  expected: {
    ceilingHeightOk: boolean; clearanceOk: boolean; egressWindow: boolean; verdict: "yes" | "fix"; fixes: string[]; fixCategories: string[];
    minCeilingM: number; minClearanceM: number | null;
  };
};

mkdirSync(OUT, { recursive: true });
const saved: Record<string, { scanId: string; rooms: string; at: string }> = existsSync(SCANS) ? JSON.parse(readFileSync(SCANS, "utf8")) : {};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : NaN);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

// ---- Room finding: replay the phone's detector on 16×16 frames, like scripts/tune-rooms.ts ----

function looks(video: string) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", video, "-vf", `fps=${FPS},scale=16:16`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 28 });
  return Array.from({ length: raw.length / 768 }, (_, n) => lookOf(raw.subarray(n * 768, n * 768 + 768), 3));
}

function detectRooms(frames: ReturnType<typeof looks>, doorWidth: Map<number, number>) {
  const det = new RoomDetector();
  const starts: number[] = [0];
  for (let n = 0; n < frames.length; n += LIVE_EVERY) {
    if (det.push({ sec: n / FPS, look: frames[n], doorWidth: doorWidth.get(n) ?? 0 })) starts.push(n / FPS);
  }
  return starts;
}

// Each true doorway matched to the nearest detected start within 5 s.
function scoreStarts(truth: number[], found: number[]) {
  const real = truth.slice(1);
  const got = found.slice(1);
  const used = new Set<number>();
  const hits: number[] = [];
  for (const t of real) {
    let best = -1;
    for (let i = 0; i < got.length; i++) if (!used.has(i) && Math.abs(got[i] - t) <= 5 && (best < 0 || Math.abs(got[i] - t) < Math.abs(got[best] - t))) best = i;
    if (best >= 0) {
      used.add(best);
      hits.push(got[best] - t);
    }
  }
  return { rooms: found.length, doorways: real.length, found: hits.length, extra: got.length - hits.length, lagS: hits.length ? round(mean(hits), 1) : null };
}

// ---- Windows: SAM's window tracks against the true openings, frame by frame ----

function iou(a: number[], b: number[]) {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

function scoreWindows(truth: Truth, detections: any[]) {
  // SAM boxes take in the frame and trim around the glass, so a loose overlap counts.
  const tracks = detections.filter((d) => d.kind === "window").map((d) => ({ id: d.id as string, track: d.track as Box[] }));
  const byFrame = (t: Box[]) => new Map(t.map((b) => [b[0], b.slice(1)]));
  const found = truth.windows.map((w) => {
    const gt = byFrame(w.analysisBoxes);
    const matched = tracks.filter((tr) => tr.track.some((b) => gt.has(b[0]) && iou(gt.get(b[0])!, b.slice(1)) >= 0.25));
    return { id: w.id, room: w.room, size: `${w.widthM}×${w.heightM}`, meetsEgress: w.meetsEgress, framesInView: w.analysisBoxes.length, foundBy: matched.map((m) => m.id) };
  });
  const allTruth = truth.windows.map((w) => byFrame(w.analysisBoxes));
  const falseTracks = tracks.filter((tr) => !tr.track.some((b) => allTruth.some((gt) => gt.has(b[0]) && iou(gt.get(b[0])!, b.slice(1)) >= 0.1)));
  return { windows: found, found: found.filter((f) => f.foundBy.length).length, total: found.length, samTracks: tracks.length, falseTracks: falseTracks.map((t) => t.id) };
}

// ---- The scan ----

async function upload(truth: Truth, video: string, marks: number[] | null) {
  const form = new FormData();
  form.append("video", await openAsBlob(video, { type: "video/mp4" }), "walkthrough.mp4");
  form.append("household", "unsure");
  form.append("municipality", "waterloo-on");
  if (marks && marks.length > 1) form.append("rooms", JSON.stringify(marks.map((startS) => ({ startS }))));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${API}/api/scans`, { method: "POST", body: form });
    if (res.ok) return (await res.json()).id as string;
    const text = await res.text();
    // The API allows a few scans per hour from one address: wait it out rather than fail.
    if (res.status === 429 && attempt < 12) {
      console.log(`  ${truth.id}: hourly scan limit, waiting 5 min…`);
      await sleep(5 * 60_000);
      continue;
    }
    throw new Error(`upload ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function waitFor(scanId: string) {
  const started = Date.now();
  for (;;) {
    const s = await (await fetch(`${API}/api/scans/${scanId}`)).json();
    if (s.status === "done") return s.result;
    if (s.status === "error") throw new Error(`scan ${scanId} failed`);
    if (Date.now() - started > 45 * 60_000) throw new Error(`scan ${scanId} still ${s.status} after 45 min`);
    await sleep(5000);
  }
}

async function spend() {
  try {
    return (await (await fetch(`${API}/api/ops/summary`)).json()).spend24h as number;
  } catch {
    return NaN;
  }
}

// ---- Scoring one basement ----

const RULES = [
  "ceiling_height_suite", "clearance_beams_ducts_suite", "egress_window_bedroom_area", "egress_window_min_dimension",
  "fire_separation_between_units", "service_room_separation",
];

function ruleGrade(expectedOk: boolean, status: string) {
  if (status === "likely_ok") return expectedOk ? "right" : "WRONG (missed a problem)";
  if (status === "likely_fix") return expectedOk ? "WRONG (false alarm)" : "right";
  return "undecided";
}

function score(truth: Truth, result: any, analysisVideo: string, scanId: string) {
  // Rooms: each scan room against the true room it overlaps most in time.
  const rooms = (result.rooms ?? []).map((r: any) => {
    const t = [...truth.rooms].sort(
      (a, b) => Math.min(r.endS, b.endS) - Math.max(r.startS, b.startS) - (Math.min(r.endS, a.endS) - Math.max(r.startS, a.startS)),
    )[0];
    const m = r.measurements;
    const ceil = m?.ceilingHeightM ?? null;
    const w = m?.widthM ?? null;
    const d = m?.depthM ?? null;
    return {
      index: r.index, name: r.name, truthRoom: t.index, truthName: t.name, startS: r.startS, endS: r.endS, has3d: r.has3d,
      ceiling: { truth: t.ceilingHeightM, subfloor: t.subfloorM, scan: ceil, errCm: ceil == null ? null : round((ceil - t.ceilingHeightM) * 100, 1),
        subfloorErrCm: ceil == null || t.subfloorM == null ? null : round((ceil - t.subfloorM) * 100, 1) },
      width: { truth: t.widthM, scan: w, errPct: w == null ? null : round(((w - t.widthM) / t.widthM) * 100, 1) },
      depth: { truth: t.depthM, scan: d, errPct: d == null ? null : round(((d - t.depthM) / t.depthM) * 100, 1) },
      area: { truth: t.areaM2, scan: w != null && d != null ? round(w * d, 1) : null, errPct: w != null && d != null ? round(((w * d - t.areaM2) / t.areaM2) * 100, 1) : null },
      clearance: { truth: t.minClearanceM, scan: m?.clearances?.length ? Math.min(...m.clearances.map((c: any) => c.clearanceM)) : null },
      sides: r.plan?.sides ? Object.values(r.plan.sides).filter((s) => s === "wall").length : null,
      trusted: m?.trusted ?? null, scaleSource: m?.scaleSource ?? null, expectedErrorPct: m?.expectedErrorPct ?? null,
      warnings: m?.warnings ?? [],
      windowsInPlan: (r.plan?.openings ?? []).filter((o: any) => o.kind === "window").length,
      windowsTrue: t.windows.length,
    };
  });

  // Room finding, replayed on the analysis video with and without SAM's doors.
  const frames = looks(analysisVideo);
  const doorWidth = new Map<number, number>();
  for (const d of result.detections.filter((x: any) => x.kind === "exit")) for (const t of d.track) doorWidth.set(t[0], Math.max(doorWidth.get(t[0]) ?? 0, t[3]));
  const withDoors = detectRooms(frames, doorWidth);
  const lookOnly = detectRooms(frames, new Map());

  const findings = Object.fromEntries((result.findings ?? []).map((f: any) => [f.ruleId, f]));
  const expectedOk: Record<string, boolean> = {
    ceiling_height_suite: truth.expected.ceilingHeightOk,
    clearance_beams_ducts_suite: truth.expected.clearanceOk,
    egress_window_bedroom_area: truth.expected.egressWindow,
    egress_window_min_dimension: truth.expected.egressWindow,
    fire_separation_between_units: !truth.expected.fixes.includes("fire_separation_between_units"),
    service_room_separation: !truth.expected.fixes.includes("service_room_separation"),
  };
  const rules = RULES.map((id) => ({
    ruleId: id, expected: expectedOk[id] ? "pass" : "fail", status: findings[id]?.status ?? "missing",
    measured: findings[id]?.measured?.value ?? null, grade: ruleGrade(expectedOk[id], findings[id]?.status ?? ""),
  }));
  const main = rooms.find((r: any) => r.index === result.mainRoom) ?? null;
  // The verdict can be right for the wrong reason, so the kinds of fix are compared too.
  const got: string[] = [...new Set<string>((result.fixGroups ?? []).map((g: any) => g.category))].filter((c) => c !== "zoning").sort();
  const want = truth.expected.fixCategories;
  const missed = want.filter((c) => !got.includes(c));
  const extra = got.filter((c) => !want.includes(c));
  return {
    id: truth.id, scanId, about: truth.about, roomsMode: ROOMS,
    verdict: {
      expected: truth.expected.verdict, got: result.verdict, right: result.verdict === truth.expected.verdict,
      fixesExpected: want, fixesFlagged: got, missed, extra, forTheRightReasons: result.verdict === truth.expected.verdict && !missed.length && !extra.length,
      headline: result.headline,
    },
    mainRoom: main ? { index: main.index, truthRoom: main.truthRoom } : null,
    rooms,
    roomFinding: { truthStarts: truth.roomStartsS, withDoors: { starts: withDoors, ...scoreStarts(truth.roomStartsS, withDoors) }, lookOnly: { starts: lookOnly, ...scoreStarts(truth.roomStartsS, lookOnly) } },
    windows: scoreWindows(truth, result.detections),
    doors: { truth: truth.doors.filter((d) => d.slab).length, samTracks: result.detections.filter((x: any) => x.kind === "exit").length },
    detections: Object.fromEntries(["window", "stairs", "duct", "beam", "mechanical", "exit"].map((k) => [k, result.detections.filter((x: any) => x.kind === k).length])),
    rules,
  };
}

// ---- 3D only: the local MapAnything service on each true room, no Meta calls ----

async function scan3dOnly(truth: Truth, video: string) {
  process.env.SCAN3D_URL ??= "http://127.0.0.1:8790";
  process.env.SCAN3D_TOKEN ??= "dev";
  const { runScan3d, summarize } = await import("../../server/scan3d");
  // The same 5 fps frames the pipeline makes (server/pipeline.ts prepare()).
  const dir = join(OUT, "frames", truth.id);
  if (!existsSync(join(dir, "frames", "0000.jpg"))) {
    mkdirSync(join(dir, "frames"), { recursive: true });
    const analysis = join(dir, "analysis.mp4");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-t", "120", "-vf", `fps=${FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'`,
      "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", analysis]);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", analysis, "-vsync", "0", "-q:v", "2", "-start_number", "0", join(dir, "frames", "%04d.jpg")]);
  }
  const frameCount = readdirSync(join(dir, "frames")).filter((f) => f.endsWith(".jpg")).length;
  const out: any[] = [];
  for (const t of truth.rooms) {
    const from = Math.round(t.startS * FPS);
    const to = Math.min(frameCount, Math.round(t.endS * FPS));
    const variants: { name: string; from: number; known: { floorToJoistsM?: number } }[] = [{ name: "as filmed", from, known: {} }];
    if (t.index === 0) variants.push({ name: "without the stairs", from: Math.round(truth.stairsEndS * FPS), known: {} });
    variants.push({ name: "with a tape", from: t.index === 0 ? Math.round(truth.stairsEndS * FPS) : from, known: { floorToJoistsM: t.ceilingHeightM } });
    for (const v of variants) {
      try {
        const s3 = await runScan3d(dir, { from: v.from, to }, v.known);
        const m = summarize(s3, []);
        const err = (scan: number | null, real: number, pct = true) => (scan == null ? null : pct ? round(((scan - real) / real) * 100, 1) : round((scan - real) * 100, 1));
        out.push({
          basement: truth.id, room: `${t.index + 1}. ${t.name}`, variant: v.name,
          ceiling: `${t.ceilingHeightM} → ${fmt(m.ceilingHeightM)} (${signed(err(m.ceilingHeightM, t.ceilingHeightM, false), "cm")})`,
          width: `${t.widthM} → ${fmt(m.widthM)} (${signed(err(m.widthM, t.widthM), "%")})`,
          depth: `${t.depthM} → ${fmt(m.depthM)} (${signed(err(m.depthM, t.depthM), "%")})`,
          trusted: m.trusted, doubled: s3.scan.quality?.wallsDoubled ?? null,
          ceilingErrCm: err(m.ceilingHeightM, t.ceilingHeightM, false), widthErrPct: err(m.widthM, t.widthM), depthErrPct: err(m.depthM, t.depthM),
        });
      } catch (e) {
        out.push({ basement: truth.id, room: `${t.index + 1}. ${t.name}`, variant: v.name, error: e instanceof Error ? e.message.slice(0, 120) : String(e) });
      }
      console.log(`  ${truth.id} room ${t.index + 1} (${v.name}): ${JSON.stringify(out.at(-1)).slice(0, 220)}`);
    }
  }
  return out;
}

// ---- Report ----

const fmt = (v: number | null | undefined, unit = "") => (v == null || Number.isNaN(v) ? "–" : `${v}${unit}`);
const signed = (v: number | null | undefined, unit = "") => (v == null || Number.isNaN(v) ? "–" : `${v > 0 ? "+" : ""}${v}${unit}`);

function report(all: ReturnType<typeof score>[], spent: number) {
  const L: string[] = [];
  L.push(`# Scan accuracy on synthetic basements`, "");
  L.push(`${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${all.length} basements · room marks: ${ROOMS} · API ${API}` + (Number.isFinite(spent) ? ` · about $${spent.toFixed(2)} of Meta credit this run` : ""), "");
  L.push("Rendered in Blender with exact sizes (`scripts/eval/generate.py`); truth in `media/eval/<id>/truth.json`.", "");

  const rooms = all.flatMap((b) => b.rooms.map((r: any) => ({ ...r, basement: b.id })));
  const ceil = rooms.filter((r) => r.ceiling.errCm != null);
  const sizes = rooms.filter((r) => r.width.errPct != null && r.depth.errPct != null);
  const within = (xs: number[], lim: number) => xs.filter((x) => Math.abs(x) <= lim).length;
  L.push("## Summary", "");
  L.push(`- **Ceiling height** (${ceil.length} rooms with a 3D scan): median error ${signed(round(median(ceil.map((r) => r.ceiling.errCm)), 1), " cm")}, ` +
    `mean absolute ${round(mean(ceil.map((r) => Math.abs(r.ceiling.errCm))), 1)} cm; within ±5 cm in ${within(ceil.map((r) => r.ceiling.errCm), 5)}/${ceil.length}, within ±10 cm in ${within(ceil.map((r) => r.ceiling.errCm), 10)}/${ceil.length}.`);
  L.push(`- **Room size**: width off by a median ${round(median(sizes.map((r) => Math.abs(r.width.errPct))), 1)}%, depth ${round(median(sizes.map((r) => Math.abs(r.depth.errPct))), 1)}%, ` +
    `area ${round(median(sizes.map((r) => Math.abs(r.area.errPct))), 1)}% (absolute); area within ±10% in ${within(sizes.map((r) => r.area.errPct), 10)}/${sizes.length} rooms.`);
  L.push(`- **Trusted rooms** (flat floor and level ceiling, so rules may use them): ${rooms.filter((r) => r.trusted).length}/${rooms.length}.`);
  const rf = all.map((b) => b.roomFinding);
  const doorways = rf.reduce((s, r) => s + r.withDoors.doorways, 0);
  L.push(`- **Rooms found** by the phone's detector replayed on the video: ${rf.reduce((s, r) => s + r.withDoors.found, 0)}/${doorways} doorways with SAM's doors ` +
    `(${rf.reduce((s, r) => s + r.withDoors.extra, 0)} false splits), ${rf.reduce((s, r) => s + r.lookOnly.found, 0)}/${doorways} on colour change alone (${rf.reduce((s, r) => s + r.lookOnly.extra, 0)} false splits).`);
  const wTot = all.reduce((s, b) => s + b.windows.total, 0);
  L.push(`- **Windows found** by SAM: ${all.reduce((s, b) => s + b.windows.found, 0)}/${wTot} real windows; ${all.reduce((s, b) => s + b.windows.falseTracks.length, 0)} window tracks matched no window.`);
  const rulesAll = all.flatMap((b) => b.rules);
  L.push(`- **Verdict**: ${all.filter((b) => b.verdict.right).length}/${all.length} right, ${all.filter((b) => b.verdict.forTheRightReasons).length} of them with exactly the right kinds of fix ` +
    `(${all.reduce((s, b) => s + b.verdict.missed.length, 0)} kinds missed, ${all.reduce((s, b) => s + b.verdict.extra.length, 0)} flagged that weren't there).`);
  L.push(`- **Rule calls**: ${rulesAll.filter((r) => r.grade === "right").length} right, ` +
    `${rulesAll.filter((r) => r.grade === "undecided").length} left to a designer or tape, ${rulesAll.filter((r) => r.grade.startsWith("WRONG")).length} wrong.`);
  L.push("");

  L.push("## By basement", "");
  L.push("| Basement | Rooms (true / found with doors / colour only) | Main room ceiling (true → scan) | Windows found | Verdict (expected → got) | Fixes expected → flagged |");
  L.push("|---|---|---|---|---|---|");
  for (const b of all) {
    const m = b.rooms.find((r: any) => r.index === b.mainRoom?.index);
    L.push(`| ${b.id} | ${b.roomFinding.truthStarts.length} / ${b.roomFinding.withDoors.rooms} / ${b.roomFinding.lookOnly.rooms} | ` +
      `${m ? `${m.ceiling.truth} → ${fmt(m.ceiling.scan)} m (${signed(m.ceiling.errCm, " cm")})` : "no 3D"} | ${b.windows.found}/${b.windows.total} | ` +
      `${b.verdict.expected} → ${b.verdict.got} ${b.verdict.right ? "✓" : "✗"} | ${b.verdict.fixesExpected.join(", ") || "none"} → ${b.verdict.fixesFlagged.join(", ") || "none"} |`);
  }
  L.push("");

  L.push("## Rooms", "");
  L.push("| Basement | Room | Ceiling true / scan / error | Width true / scan / error | Depth true / scan / error | Walls seen | Trusted | Scale | Windows (plan / true) |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of rooms) {
    L.push(`| ${r.basement} | ${r.index + 1}. ${r.truthName} | ${r.ceiling.truth} / ${fmt(r.ceiling.scan)} / ${signed(r.ceiling.errCm, " cm")}` +
      `${r.ceiling.subfloorErrCm != null ? ` (subfloor ${signed(r.ceiling.subfloorErrCm, " cm")})` : ""} | ${r.width.truth} / ${fmt(r.width.scan)} / ${signed(r.width.errPct, "%")} | ` +
      `${r.depth.truth} / ${fmt(r.depth.scan)} / ${signed(r.depth.errPct, "%")} | ${fmt(r.sides)}/4 | ${r.trusted == null ? "–" : r.trusted ? "yes" : "no"} | ${r.scaleSource ?? "–"}` +
      `${r.expectedErrorPct != null ? ` ±${r.expectedErrorPct}%` : ""} | ${r.windowsInPlan} / ${r.windowsTrue} |`);
  }
  L.push("");

  L.push("## Rules", "");
  L.push("| Basement | Rule | Truth | Scan says | Reading | Grade |");
  L.push("|---|---|---|---|---|---|");
  for (const b of all) for (const r of b.rules) L.push(`| ${b.id} | ${r.ruleId} | ${r.expected} | ${r.status} | ${fmt(r.measured)} | ${r.grade} |`);
  L.push("");

  L.push("## Room finding", "");
  L.push("| Basement | True starts (s) | With SAM doors | Colour only |");
  L.push("|---|---|---|---|");
  for (const b of all) {
    const f = b.roomFinding;
    L.push(`| ${b.id} | ${f.truthStarts.join(", ")} | ${f.withDoors.starts.join(", ")} (lag ${signed(f.withDoors.lagS, " s")}) | ${f.lookOnly.starts.join(", ")} (lag ${signed(f.lookOnly.lagS, " s")}) |`);
  }
  L.push("");

  L.push("## Windows", "");
  L.push("| Basement | Window | Room | Size (m) | Escape size | In view (frames) | Found by |");
  L.push("|---|---|---|---|---|---|---|");
  for (const b of all) for (const w of b.windows.windows) L.push(`| ${b.id} | ${w.id} | ${w.room + 1} | ${w.size} | ${w.meetsEgress ? "yes" : "no"} | ${w.framesInView} | ${w.foundBy.join(", ") || "—"} |`);
  L.push("");
  L.push("## Warnings the scan gave", "");
  for (const r of rooms) if (r.warnings.length) L.push(`- ${r.basement}, room ${r.index + 1}: ${r.warnings.join(" ")}`);
  return L.join("\n");
}

// ---- Main ----

const ids = readdirSync(EVAL).filter((d) => existsSync(join(EVAL, d, "truth.json")) && existsSync(join(EVAL, d, "walkthrough.mp4")));
const todo = ids.filter((id) => !ONLY.length || ONLY.some((o) => id.startsWith(o))).sort();
if (!todo.length) {
  console.error(`No rendered basements in ${EVAL}. Render them first: Blender -b --factory-startup -P scripts/eval/generate.py`);
  process.exit(1);
}
const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null);
if (!health?.ok) {
  console.error(`The API isn't answering at ${API}. Start it with \`pnpm dev\` (and \`pnpm dev:scan3d\` for 3D).`);
  process.exit(1);
}
if (ONLY_3D) {
  const rows: any[] = [];
  for (const id of todo) rows.push(...(await scan3dOnly(JSON.parse(readFileSync(join(EVAL, id, "truth.json"), "utf8")), join(EVAL, id, "walkthrough.mp4"))));
  console.table(rows.map(({ ceilingErrCm, widthErrPct, depthErrPct, ...r }: any) => r));
  writeFileSync(join(OUT, "3d-only.json"), JSON.stringify(rows, null, 1));
  const L = ["# 3D only, room by room (local MapAnything, no Meta calls)", "", "| Basement | Room | Variant | Ceiling | Width | Depth | Trusted | Walls doubled |", "|---|---|---|---|---|---|---|---|"];
  for (const r of rows as any[]) L.push(`| ${r.basement} | ${r.room} | ${r.variant} | ${r.ceiling ?? r.error} | ${r.width ?? ""} | ${r.depth ?? ""} | ${r.trusted ?? ""} | ${r.doubled ?? ""} |`);
  const byVariant = (name: string, key: string) => (rows as any[]).filter((r) => r.variant === name && r[key] != null).map((r) => Math.abs(r[key]));
  L.push("", "| Variant | Rooms | Median ceiling error | Median width error | Median depth error |", "|---|---|---|---|---|");
  for (const v of ["as filmed", "without the stairs", "with a tape"]) {
    const c = byVariant(v, "ceilingErrCm");
    L.push(`| ${v} | ${c.length} | ${round(median(c), 1)} cm | ${round(median(byVariant(v, "widthErrPct")), 1)}% | ${round(median(byVariant(v, "depthErrPct")), 1)}% |`);
  }
  writeFileSync(join(OUT, "3d-only.md"), L.join("\n"));
  console.log(`Report: ${join(OUT, "3d-only.md")}`);
  process.exit(0);
}
const spentBefore = await spend();
const results: ReturnType<typeof score>[] = [];
for (const id of todo) {
  const truth: Truth = JSON.parse(readFileSync(join(EVAL, id, "truth.json"), "utf8"));
  const video = join(EVAL, id, "walkthrough.mp4");
  const key = `${id}:${ROOMS}`;
  let scanId = FRESH ? undefined : saved[key]?.scanId;
  if (REUSE && !scanId) {
    console.log(`${id}: no saved scan with --rooms ${ROOMS}, skipping`);
    continue;
  }
  if (!scanId) {
    const marks = ROOMS === "truth" ? truth.roomStartsS : ROOMS === "detector" ? detectRooms(looks(video), new Map()) : null;
    console.log(`${id}: uploading (${truth.rooms.length} rooms, ${truth.durationS} s, room marks: ${marks ? marks.join(", ") : "none"})`);
    scanId = await upload(truth, video, marks);
    // Saved before waiting, so a crash never pays for the same scan twice.
    saved[key] = { scanId, rooms: ROOMS, at: new Date().toISOString() };
    writeFileSync(SCANS, JSON.stringify(saved, null, 1));
  }
  const started = Date.now();
  const result = await waitFor(scanId);
  const analysis = join(OUT, "videos", `${id}-${scanId.slice(0, 8)}.mp4`);
  mkdirSync(join(OUT, "videos"), { recursive: true });
  if (!existsSync(analysis)) writeFileSync(analysis, Buffer.from(await (await fetch(`${API}/api/scans/${scanId}/video`)).arrayBuffer()));
  const s = score(truth, result, analysis, scanId);
  results.push(s);
  mkdirSync(join(OUT, "results"), { recursive: true });
  writeFileSync(join(OUT, "results", `${id}.json`), JSON.stringify({ score: s, result }, null, 1));
  const m = s.rooms.find((r: any) => r.index === s.mainRoom?.index);
  console.log(
    `${id}: ${s.verdict.right ? "right" : "WRONG"} verdict (${s.verdict.expected} → ${s.verdict.got})` +
      ` | ceiling ${m ? `${m.ceiling.truth} → ${m.ceiling.scan} m` : "no 3D"} | rooms ${truth.rooms.length} → ${s.roomFinding.withDoors.rooms}` +
      ` | windows ${s.windows.found}/${s.windows.total} | ${Math.round((Date.now() - started) / 1000)} s`,
  );
}
const spent = (await spend()) - spentBefore;
if (results.length) {
  console.log("");
  console.table(
    results.flatMap((b) =>
      b.rooms.map((r: any) => ({
        basement: b.id, room: `${r.index + 1}. ${r.truthName}`,
        ceiling: `${r.ceiling.truth} → ${fmt(r.ceiling.scan)} (${signed(r.ceiling.errCm, "cm")})`,
        width: `${r.width.truth} → ${fmt(r.width.scan)} (${signed(r.width.errPct, "%")})`,
        depth: `${r.depth.truth} → ${fmt(r.depth.scan)} (${signed(r.depth.errPct, "%")})`,
        trusted: r.trusted, scale: r.scaleSource,
      })),
    ),
  );
  // --reuse scores the latest saved scans; the report always covers every basement in this run.
  writeFileSync(join(OUT, "report.md"), report(results, REUSE ? NaN : spent));
  console.log(`Report: ${join(OUT, "report.md")}${!REUSE && Number.isFinite(spent) ? ` · spent about $${spent.toFixed(2)}` : ""}`);
}
