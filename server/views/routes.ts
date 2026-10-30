// Pictures that agree with each other: the best real angles of the scan, the design to draw in them,
// and each angle's picture of a design (a Muse Image photo checked by SAM, or the 3D render).
//   GET  /api/scans/:id/views                     angles, the design (?designId=, else the chosen one), frame and mesh URLs, and the pictures already made of ?design=<hash>
//   POST /api/scans/:id/views/:angle              the browser's render of a design from that angle → its picture (cached by angle and design)
//   GET  /api/scans/:id/views/:angle/:view.jpg    a picture (`view`: what the angle shows of a design)
// Mounted from server/index.ts.
//
// Money: a photo is made only while the day's cap on paid calls has room (server/limits.ts overSpend),
// and this route's own tally is under VIEWS_CAP_USD. The example never calls Muse Image on the live
// site: its pictures are made once (SAMPLE_VIEWS_WRITE=1 on a dev server) and committed under
// public/samples/sample/views; anything else it asks for is drawn as the 3D render, in the browser.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Hono } from "hono";
import { boxesIn, toFrameJpeg } from "../concepts";
import { overSpend } from "../limits";
import { museEdit } from "../meta";
import { designHash } from "../model/furniture";
import type { Design } from "../model/types";
import { keys, storage } from "../storage";
import { anchorsAt, angleById, bestAngles, designAngles, designFor, frameUrl, meshUrl, readStored, SAMPLE, sampleFile, scanResult, type Anchor } from "./load";
import { ANCHOR_CONCEPT, makePicture, type DrawnItem, type PictureMeta } from "./photoreal";

const UUID = /^[0-9a-f-]{36}$/;
const ANGLE = /^\d{1,2}-\d{4}$/;
const HASH = /^[0-9a-z]{3,14}$/;
const DESIGN_ID = /^[a-z0-9_-]{1,40}$/i;
const MAX_GUIDE_BYTES = 4 * 1024 * 1024;

// Meta's prices (server/meta.ts): Muse Image per picture, SAM 3.1 per image.
const MUSE_USD = 0.01;
const SAM_USD = 2.5 / 1000;
// Pictures stop when today's spend on them reaches this, or the site's daily cap on paid calls is reached.
const VIEWS_CAP_USD = Number(process.env.VIEWS_CAP_USD ?? 3);
const spent = { day: "", usd: 0 };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
function charge(usd: number) {
  if (spent.day !== today()) Object.assign(spent, { day: today(), usd: 0 });
  spent.usd += usd;
}
// Making the example's pictures to commit: a dev server only.
const writeSample = () => process.env.SAMPLE_VIEWS_WRITE === "1" && process.env.NODE_ENV !== "production";
const canSpend = async (id: string) => {
  if (id === SAMPLE && !writeSample()) return false;
  if (spent.day !== today()) Object.assign(spent, { day: today(), usd: 0 });
  if (!(process.env.MODEL_API_KEY || process.env.RELAY_TOKEN) || spent.usd + MUSE_USD + 6 * SAM_USD > VIEWS_CAP_USD) return false;
  return !(await overSpend());
};

// A picture is kept by what its angle shows (the view key); each design that looked at it points there.
const rel = (angle: string, view: string, ext: "jpg" | "json") => `views/${angle}-${view}.${ext}`;
const designRel = (angle: string, hash: string) => `views/${angle}-d-${hash}.json`;
const anchorsRel = (angle: string) => `views/${angle}-anchors.json`;
// The picture's address changes when the picture does (a photo replacing the render), so no browser
// keeps showing the old one.
export const pictureUrl = (id: string, angle: string, hash: string, at?: string) => `/api/scans/${id}/views/${angle}/${hash}.jpg${at ? `?v=${Date.parse(at).toString(36)}` : ""}`;

// The example's are committed files; everyone else's are in storage.
async function readPic(id: string, path: string): Promise<Buffer | null> {
  return id === SAMPLE ? sampleFile(path) : readStored(`scans/${id}/${path}`);
}
async function writePic(id: string, path: string, body: Buffer, type: string): Promise<boolean> {
  if (id !== SAMPLE) {
    await storage.put(`scans/${id}/${path}`, body, type);
    return true;
  }
  if (!writeSample()) return false;
  const file = join("public", "samples", "sample", path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
  return true;
}

async function storedMeta(id: string, angle: string, view: string): Promise<PictureMeta | null> {
  const raw = await readPic(id, rel(angle, view, "json"));
  return raw ? (JSON.parse(raw.toString("utf8")) as PictureMeta) : null;
}

// The picture a design got from an angle.
async function designPicture(id: string, angle: string, hash: string): Promise<PictureMeta | null> {
  const raw = await readPic(id, designRel(angle, hash));
  const view = raw ? (JSON.parse(raw.toString("utf8")) as { viewKey?: string }).viewKey : null;
  return view && HASH.test(view) ? storedMeta(id, angle, view) : null;
}

// What a picture of this frame must keep (the windows, doors and stairs SAM tracked through the video
// there), and what it may show at all: those, plus the windows and stairs SAM sees in the frame itself
// (it can miss one in the video). The frame is looked at once per angle and kept.
async function anchorsFor(id: string, angle: { id: string; frame: number }): Promise<{ keep: Anchor[]; known: Anchor[] }> {
  const keep = await anchorsAt(id, angle.frame);
  const kept = await readPic(id, anchorsRel(angle.id));
  if (kept) return { keep, known: JSON.parse(kept.toString("utf8")) as Anchor[] };
  if (!(await canSpend(id))) return { keep, known: [] };
  const frame = id === SAMPLE ? sampleFile(`frames/${String(angle.frame).padStart(4, "0")}.jpg`) : await readStored(keys.frame(id, angle.frame));
  if (!frame) return { keep, known: [] };
  const kinds = ["window", "stairs"] as const;
  charge(kinds.length * SAM_USD);
  const known = (await Promise.all(kinds.map(async (kind) => (await boxesIn(frame, ANCHOR_CONCEPT[kind]).catch(() => [])).map((box) => ({ kind, box }))))).flat();
  await writePic(id, anchorsRel(angle.id), Buffer.from(JSON.stringify(known)), "application/json");
  return { keep, known };
}

const okId = (id: string) => UUID.test(id) || id === SAMPLE;

const cleanBoxes = (raw: unknown): DrawnItem["box"][] =>
  (Array.isArray(raw) ? raw : []).slice(0, 40).flatMap((b: any) => ([b?.x, b?.y, b?.w, b?.h].every((v) => typeof v === "number" && Number.isFinite(v)) ? [{ x: b.x, y: b.y, w: b.w, h: b.h }] : []));

const cleanItems = (raw: unknown): DrawnItem[] =>
  (Array.isArray(raw) ? raw : []).slice(0, 40).flatMap((i: any) => {
    const b = i?.box;
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (typeof i?.id !== "string" || typeof i?.kind !== "string" || !b || ![b.x, b.y, b.w, b.h, i.share].every(num)) return [];
    return [{ id: i.id.slice(0, 60), kind: i.kind.slice(0, 20), label: String(i.label ?? i.kind).slice(0, 40), ...(typeof i.colour === "string" ? { colour: i.colour.slice(0, 30) } : {}), box: { x: b.x, y: b.y, w: b.w, h: b.h }, share: i.share }];
  });

// The pictures already made of a design, best angle first: for the book.
export async function picturesOfDesign(id: string, design: Design) {
  const hash = designHash(design);
  const angles = await designAngles(id, 5, design.proposed.furniture);
  const out: { angleId: string; url: string; kind: PictureMeta["kind"]; checked: string; load: () => Promise<Buffer | null> }[] = [];
  for (const a of angles) {
    const meta = await designPicture(id, a.id, hash);
    if (meta) out.push({ angleId: a.id, url: pictureUrl(id, a.id, meta.viewKey, meta.at), kind: meta.kind, checked: meta.checked, load: () => readPic(id, rel(a.id, meta.viewKey, "jpg")) });
  }
  return out;
}

export function mountViews(app: Hono) {
  app.get("/api/scans/:id/views", async (c) => {
    const id = c.req.param("id");
    if (!okId(id)) return c.json({ error: "Not found" }, 404);
    const perRoom = Math.min(6, Math.max(4, Number(c.req.query("perRoom") ?? 5) || 5));
    const designId = c.req.query("designId");
    const design = await designFor(id, designId && DESIGN_ID.test(designId) ? designId : null);
    const furniture = design?.proposed.furniture ?? [];
    const [own, rooms, result] = await Promise.all([designAngles(id, perRoom, furniture), bestAngles(id, perRoom, furniture), scanResult(id)]);
    // The design's own set first (group "design"), then each room's (group: the room's index).
    const angles = [...own.map((a) => ({ ...a, group: "design" as const })), ...rooms.map((a) => ({ ...a, group: a.room }))];
    const main = (result?.rooms ?? []).find((r: { index: number }) => r.index === result?.mainRoom);
    const hash = HASH.test(c.req.query("design") ?? "") ? c.req.query("design")! : design ? designHash(design) : null;
    const pictures = hash
      ? (await Promise.all([...new Map(angles.map((a) => [a.id, a])).values()].map(async (a) => {
          const meta = await designPicture(id, a.id, hash);
          return meta ? { ...meta, url: pictureUrl(id, a.id, meta.viewKey, meta.at) } : null;
        }))).filter(Boolean)
      : [];
    return c.json({
      angles: angles.map((a) => ({ ...a, frameUrl: frameUrl(id, a.frame) })),
      design,
      designHash: design ? designHash(design) : null,
      meshUrl: meshUrl(id),
      ceilingM: main?.plan?.ceilingHeightM ?? result?.plan?.ceilingHeightM ?? null,
      pictures,
      label: "Virtually staged",
    });
  });

  app.post("/api/scans/:id/views/:angle", async (c) => {
    const id = c.req.param("id"), angleId = c.req.param("angle");
    if (!okId(id) || !ANGLE.test(angleId)) return c.json({ error: "Not found" }, 404);
    const body = await c.req.parseBody().catch(() => null);
    const guide = body?.guide;
    let meta: any = null;
    try {
      meta = JSON.parse(String(body?.meta ?? ""));
    } catch {
      return c.json({ error: "Send the render and what's in it." }, 400);
    }
    if (!(guide instanceof File) || guide.size > MAX_GUIDE_BYTES || !HASH.test(String(meta?.designHash ?? "")) || !HASH.test(String(meta?.viewKey ?? ""))) return c.json({ error: "Send the render and what's in it." }, 400);
    const angle = await angleById(id, angleId);
    if (!angle) return c.json({ error: "Not found" }, 404);
    const hash = String(meta.designHash), view = String(meta.viewKey);
    const finishes = { style: String(meta.finishes?.style ?? "").slice(0, 120), floor: String(meta.finishes?.floor ?? "").slice(0, 60), walls: String(meta.finishes?.walls ?? "").slice(0, 60) };
    let saved = true;
    const { keep, known } = await anchorsFor(id, angle);
    const picture = await makePicture(
      {
        angleId,
        designHash: hash,
        viewKey: view,
        guide: Buffer.from(await guide.arrayBuffer()),
        size: [angle.intrinsics.width, angle.intrinsics.height],
        items: cleanItems(meta.items),
        anchors: keep,
        known,
        hidden: cleanBoxes(meta.walls),
        doors: cleanBoxes(meta.doors),
        finishes,
      },
      {
        cached: () => storedMeta(id, angleId, view),
        edit: async (img, prompt, size) => {
          charge(MUSE_USD);
          return museEdit(img, "image/jpeg", prompt, size);
        },
        resize: toFrameJpeg,
        boxes: async (jpeg, concept) => {
          charge(SAM_USD);
          return boxesIn(jpeg, concept);
        },
        save: async (jpeg, m) => {
          saved = await writePic(id, rel(angleId, view, "jpg"), jpeg, "image/jpeg");
          if (saved) await writePic(id, rel(angleId, view, "json"), Buffer.from(JSON.stringify(m)), "application/json");
        },
        canSpend: () => canSpend(id),
      },
    );
    if (saved) await writePic(id, designRel(angleId, hash), Buffer.from(JSON.stringify({ viewKey: view })), "application/json");
    // Not kept anywhere (the example, past what's committed): the browser shows its own render.
    return c.json({ ...picture, designHash: hash, url: saved ? pictureUrl(id, angleId, view, picture.at) : null, spentTodayUsd: Math.round(spent.usd * 1000) / 1000 });
  });

  app.get("/api/scans/:id/views/:angle/:file", async (c) => {
    const id = c.req.param("id"), angleId = c.req.param("angle");
    const hash = c.req.param("file").replace(/\.jpg$/, "");
    if (!okId(id) || !ANGLE.test(angleId) || !HASH.test(hash)) return c.json({ error: "Not found" }, 404);
    const jpeg = await readPic(id, rel(angleId, hash, "jpg"));
    if (!jpeg) return c.json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });
}
