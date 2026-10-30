// Paints the rendered test basements (scripts/eval/generate.py) from their true plans and true
// cameras, so the painting can be judged apart from any error in the plan or the 3D's camera poses.
// Writes tmp/asbuilt/<id>/ (existing.json, the atlas and its index) for src/three/AsBuiltPreview.tsx.
// Usage: SCAN3D_PYTHON=path/to/services/scan3d/.venv/bin/python tsx scripts/asbuilt-eval.ts [b1,b2,b3]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { project } from "../server/model/geometry";
import type { Existing, Fixture, Opening, Pt, Room, Wall } from "../server/model/types";
import { buildAsBuilt, paintJob } from "../src/three/AsBuiltModel";

const PY = process.env.SCAN3D_PYTHON ?? "services/scan3d/.venv/bin/python";
const EVAL = process.env.EVAL_DIR ?? "media/eval";
const STEP = Number(process.env.EVAL_STEP ?? 12); // every 12th of 30 fps: 2.5 frames a second
const JOIST_D = 0.235, EXT_WALL = 0.25, DOOR_H = 2.032, RISER_MAX = 0.2, TREAD = 0.254;
const only = (process.argv[2] ?? "b1,b2,b3").split(",");

type Cfg = any;
// The generator's own table of basements, read without Blender.
const cfgs: Cfg[] = JSON.parse(
  execFileSync("python3", ["-c", "import ast,json,sys;t=ast.parse(open(sys.argv[1]).read());n=[x for x in t.body if isinstance(x,ast.Assign) and getattr(x.targets[0],'id','')=='BASEMENTS'][0];print(json.dumps(eval(compile(ast.Expression(n.value),'b','eval'),{'dict':dict,'__builtins__':{}})))", "scripts/eval/generate.py"], { encoding: "utf8" }),
);

// Blender's plan (x east, y north) -> the basement frame (x, z = −y).
const P = (x: number, y: number): Pt => [x, -y];

function ceilingOf(cfg: Cfg, r: Cfg) {
  return r.ceiling === "joists" ? cfg.subfloor - JOIST_D : r.ceiling;
}

function existingOf(cfg: Cfg): { existing: Existing; stairTop: Pt } {
  const rooms: Room[] = cfg.rooms.map((r: Cfg, i: number) => {
    const [x0, y0, x1, y1] = r.rect;
    return { id: `room-${i}`, polygon: [P(x0, y1), P(x1, y1), P(x1, y0), P(x0, y0)], kind: "other", name: r.name, unit: 1, ceilingM: ceilingOf(cfg, r) };
  });
  // Every side of every room is a wall: between two rooms, one partition in the gap; elsewhere a
  // foundation wall standing outside the room.
  const walls: Wall[] = [];
  const sides = (r: number[]) => {
    const [x0, y0, x1, y1] = r;
    return { N: { a: [x0, y1], b: [x1, y1], axis: "y", at: y1, out: 1 }, S: { a: [x0, y0], b: [x1, y0], axis: "y", at: y0, out: -1 }, E: { a: [x1, y0], b: [x1, y1], axis: "x", at: x1, out: 1 }, W: { a: [x0, y0], b: [x0, y1], axis: "x", at: x0, out: -1 } } as Record<string, { a: number[]; b: number[]; axis: "x" | "y"; at: number; out: number }>;
  };
  cfg.rooms.forEach((r: Cfg, i: number) => {
    for (const [name, s] of Object.entries(sides(r.rect))) {
      const along = s.axis === "y" ? 0 : 1;
      const lo = s.a[along], hi = s.b[along];
      // Pieces of this side that face another room across a gap under 0.2 m.
      const cuts: [number, number, number][] = [];
      cfg.rooms.forEach((o: Cfg, j: number) => {
        if (j === i) return;
        const os = sides(o.rect)[{ N: "S", S: "N", E: "W", W: "E" }[name]!];
        const gap = (os.at - s.at) * s.out;
        if (gap <= 0 || gap > 0.2) return;
        const a = Math.max(lo, os.a[along]), b = Math.min(hi, os.b[along]);
        if (b - a > 0.05) cuts.push([a, b, gap]);
      });
      cuts.sort((x, y) => x[0] - y[0]);
      const pieces: [number, number, number][] = [];
      let at = lo;
      for (const c of cuts) {
        if (c[0] - at > 0.05) pieces.push([at, c[0], 0]);
        pieces.push(c);
        at = c[1];
      }
      if (hi - at > 0.05) pieces.push([at, hi, 0]);
      for (const [a, b, gap] of pieces) {
        const line = gap ? s.at + (s.out * gap) / 2 : s.at;
        const pa = s.axis === "y" ? P(a, line) : P(line, a), pb = s.axis === "y" ? P(b, line) : P(line, b);
        // A partition is drawn once, from whichever room comes first.
        if (gap && walls.some((w) => Math.abs(project(w, pa).off) < 0.02 && Math.abs(project(w, pb).off) < 0.02)) continue;
        walls.push({ id: `w${walls.length + 1}`, a: pa, b: pb, thicknessM: gap || EXT_WALL, kind: gap ? "existing" : "foundation", rating: null });
      }
    }
  });
  // Doors and windows on the wall under their centre.
  const openings: Opening[] = [];
  const host = (room: number, wall: string, at: number) => {
    const s = sides(cfg.rooms[room].rect)[wall];
    const c = s.axis === "y" ? P(s.a[0] + at, s.at) : P(s.at, s.a[1] + at);
    const w = walls.filter((x) => Math.abs(project(x, c).off) < x.thicknessM / 2 + 0.02 && project(x, c).t > 0 && project(x, c).t < Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1])).sort((x, y) => Math.abs(project(x, c).off) - Math.abs(project(y, c).off))[0];
    return w ? { w, t: project(w, c).t } : null;
  };
  for (const d of cfg.doors ?? []) {
    const h = host(d.room, d.wall, d.at);
    if (h) openings.push({ id: `door${openings.length + 1}`, wallId: h.w.id, kind: "door", offsetM: h.t, widthM: d.width, heightM: d.height ?? DOOR_H + 0.02, status: "existing" });
  }
  for (const [wall, room, at, w, hgt, sill] of cfg.windows) {
    const h = host(room, wall, at);
    if (h) openings.push({ id: `window${openings.length + 1}`, wallId: h.w.id, kind: "window", offsetM: h.t, widthM: w, heightM: hgt, sillM: sill, status: "existing" });
  }
  // The stairs (generate.py stair_layout), with their top for the flight's direction.
  const st = cfg.stairs;
  const width = st.width ?? 0.92;
  const rise = cfg.subfloor + 0.02;
  const n = Math.ceil(rise / RISER_MAX);
  const top = st.bottom + st.up * (n - 1) * TREAD;
  const [a0, a1] = [Math.min(st.bottom, top), Math.max(st.bottom, top)];
  const [c0, c1] = [Math.min(st.line, st.line + st.side * width), Math.max(st.line, st.line + st.side * width)];
  const fp = st.axis === "x" ? [a0, c0, a1, c1] : [c0, a0, c1, a1];
  const fixtures: Fixture[] = [{ id: "stairs1", kind: "stairs", at: P((fp[0] + fp[2]) / 2, (fp[1] + fp[3]) / 2), sizeM: [fp[2] - fp[0], fp[3] - fp[1]] }];
  const topPt = st.axis === "x" ? P(top, (c0 + c1) / 2) : P((c0 + c1) / 2, top);
  const roomAt = (x: number, y: number) => cfg.rooms.find((r: Cfg) => x >= r.rect[0] && x <= r.rect[2] && y >= r.rect[1] && y <= r.rect[3]) ?? cfg.rooms[0];
  const box = (id: string, kind: Fixture["kind"], [x0, y0, x1, y1]: number[], heightM: number | null) => fixtures.push({ id, kind, at: P((x0 + x1) / 2, (y0 + y1) / 2), sizeM: [x1 - x0, y1 - y0], heightM });
  (cfg.ducts ?? []).forEach((d: Cfg, i: number) => {
    const r = roomAt((d.rect[0] + d.rect[2]) / 2, (d.rect[1] + d.rect[3]) / 2);
    box(`duct${i + 1}`, "duct", d.rect, ceilingOf(cfg, r) - d.depth - (d.hang ?? 0));
  });
  (cfg.beams ?? []).forEach((b: Cfg, i: number) => {
    const rect = b.axis === "x" ? [b.span[0], b.at - 0.1, b.span[1], b.at + 0.1] : [b.at - 0.1, b.span[0], b.at + 0.1, b.span[1]];
    const r = roomAt((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2);
    const under = ceilingOf(cfg, r) - b.depth;
    box(`beam${i + 1}`, "beam", rect, under);
    for (const [k, p] of (b.posts ?? []).entries()) fixtures.push({ id: `post${i + 1}-${k + 1}`, kind: "post", at: b.axis === "x" ? P(p, b.at) : P(b.at, p), sizeM: [0.1, 0.1], heightM: under });
  });
  (cfg.bulkheads ?? []).forEach((b: Cfg, i: number) => box(`bulkhead${i + 1}`, "bulkhead", b.rect, b.bottom));
  const fu = cfg.furnace;
  if (fu) {
    const [w, d] = [0.56, 0.74];
    const ns = fu.face === "N" || fu.face === "S";
    box("furnace1", "furnace", [fu.x, fu.y, fu.x + (ns ? w : d), fu.y + (ns ? d : w)], null);
  }
  if (cfg.heater) box("heater1", "water_heater", [cfg.heater.x - 0.28, cfg.heater.y - 0.28, cfg.heater.x + 0.28, cfg.heater.y + 0.28], null);
  const existing: Existing = { walls, openings, rooms, fixtures, ceilingM: Math.max(...rooms.map((r) => r.ceilingM!)), scale: { source: "arkit", factor: 1 }, confirmedAt: "truth" };
  return { existing, stairTop: topPt };
}

for (const cfg of cfgs.filter((c) => only.some((o) => c.id.startsWith(o)))) {
  const src = join(EVAL, cfg.id);
  if (!existsSync(join(src, "capture.json"))) {
    console.log(`${cfg.id}: not rendered, skipped`);
    continue;
  }
  const out = resolve("tmp/asbuilt", cfg.id.slice(0, 2));
  const frames = join(out, "frames");
  mkdirSync(frames, { recursive: true });
  const capture = JSON.parse(readFileSync(join(src, "capture.json"), "utf8"));
  if (!readdirSync(frames).length) {
    // Frame k of these is the capture's frame STEP·k; portrait, 1280 tall like the pipeline's frames.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", join(src, "walkthrough.mp4"), "-vf", `select=not(mod(n\\,${STEP})),scale=720:1280`, "-fps_mode", "passthrough", "-q:v", "2", "-start_number", "0", join(frames, "%04d.jpg")]);
  }
  const files = readdirSync(frames).filter((f) => f.endsWith(".jpg")).sort();
  const { existing, stairTop } = existingOf(cfg);
  const model = buildAsBuilt(existing, { stairTop });
  const [W, H] = capture.imageResolution;
  const cameras = files.flatMap((f, k) => {
    const c = capture.frames[k * STEP];
    if (!c) return [];
    // ARKit camera-to-world, column-major, in a +Y-up world that is already the basement frame; its
    // camera looks down −z with +y up, OpenCV's down +z with +y down.
    const m = (r: number, col: number) => c.transform[col * 4 + r];
    const pose = [0, 1, 2, 3].map((r) => [m(r, 0), -m(r, 1), -m(r, 2), m(r, 3)]);
    const [fx, fy, cx, cy] = c.intrinsics;
    return [{ image: k, K: [[fx, 0, cx], [0, fy, cy], [0, 0, 1]], pose, width: W, height: H }];
  });
  const job = { ...paintJob(model), cameras, images: files.slice(0, cameras.length).map((f) => join(frames, f)), options: { ppm: 100, maxPage: 4096 } };
  writeFileSync(join(out, "job.json"), JSON.stringify(job));
  writeFileSync(join(out, "existing.json"), JSON.stringify(existing));
  console.log(`${cfg.id}: ${model.surfaces.length} surfaces, ${cameras.length} frames`);
  execFileSync(PY, ["-m", "scan3d.texture", join(out, "job.json"), out], { stdio: "inherit", env: { ...process.env, PYTHONPATH: resolve("services/scan3d") } });
  const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
  writeFileSync(join(out, "index.json"), JSON.stringify({ ...index, stairTop }));
  const cov = Object.entries(index.surfaces as Record<string, { coverage: number }>).map(([id, e]) => `${id} ${Math.round(e.coverage * 100)}%`);
  console.log(cov.join(" · "));
}
