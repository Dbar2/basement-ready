// Pictures that agree with each other: the best real angles of the scan, the design to draw in them,
// and each angle's picture of a design (a Muse Image photo checked by SAM, or the 3D render).
//   GET  /api/scans/:id/views                     angles, the design, frame and mesh URLs, and the pictures already made of ?design=<hash>
//   POST /api/scans/:id/views/:angle              the browser's render of a design from that angle → its picture (cached by angle and design)
//   GET  /api/scans/:id/views/:angle/:view.jpg    a picture (`view`: what the angle shows of a design)
// Mounted from server/index.ts.
import type { Hono } from "hono";
import { boxesIn, toFrameJpeg } from "../concepts";
import { museEdit } from "../meta";
import { designHash } from "../model/furniture";
import { storage } from "../storage";
import { anchorsAt, bestAngles, designAngles, designFor, frameUrl, meshUrl, readStored, SAMPLE, scanResult } from "./load";
import { makePicture, type DrawnItem, type PictureMeta } from "./photoreal";

const UUID = /^[0-9a-f-]{36}$/;
const ANGLE = /^\d{1,2}-\d{4}$/;
const HASH = /^[0-9a-z]{3,14}$/;
const MAX_GUIDE_BYTES = 4 * 1024 * 1024;

// Meta's prices (server/meta.ts): Muse Image per picture, SAM 3.1 per image.
const MUSE_USD = 0.01;
const SAM_USD = 2.5 / 1000;
// Pictures stop when today's spend on them reaches this, or the site's daily cap is reached.
// TODO(merge with section A): also ask server/limits.ts overSpend(), which counts every model call.
const VIEWS_CAP_USD = Number(process.env.VIEWS_CAP_USD ?? 3);
const spent = { day: "", usd: 0 };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
function charge(usd: number) {
  if (spent.day !== today()) Object.assign(spent, { day: today(), usd: 0 });
  spent.usd += usd;
}
const canSpend = async () => {
  if (spent.day !== today()) Object.assign(spent, { day: today(), usd: 0 });
  return Boolean(process.env.MODEL_API_KEY || process.env.RELAY_TOKEN) && spent.usd + MUSE_USD + 6 * SAM_USD <= VIEWS_CAP_USD;
};

// A picture is kept by what its angle shows (the view key); each design that looked at it points there.
const key = (id: string, angle: string, view: string, ext: "jpg" | "json") => `scans/${id}/views/${angle}-${view}.${ext}`;
const designKey = (id: string, angle: string, hash: string) => `scans/${id}/views/${angle}-d-${hash}.json`;
// The picture's address changes when the picture does (a photo replacing the render), so no browser
// keeps showing the old one.
export const pictureUrl = (id: string, angle: string, hash: string, at?: string) => `/api/scans/${id}/views/${angle}/${hash}.jpg${at ? `?v=${Date.parse(at).toString(36)}` : ""}`;

async function storedMeta(id: string, angle: string, view: string): Promise<PictureMeta | null> {
  const raw = await readStored(key(id, angle, view, "json"));
  return raw ? (JSON.parse(raw.toString("utf8")) as PictureMeta) : null;
}

// The picture a design got from an angle.
async function designPicture(id: string, angle: string, hash: string): Promise<PictureMeta | null> {
  const raw = await readStored(designKey(id, angle, hash));
  const view = raw ? (JSON.parse(raw.toString("utf8")) as { viewKey?: string }).viewKey : null;
  return view && HASH.test(view) ? storedMeta(id, angle, view) : null;
}

const okId = (id: string) => UUID.test(id) || id === SAMPLE;

const cleanItems = (raw: unknown): DrawnItem[] =>
  (Array.isArray(raw) ? raw : []).slice(0, 40).flatMap((i: any) => {
    const b = i?.box;
    const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
    if (typeof i?.id !== "string" || typeof i?.kind !== "string" || !b || ![b.x, b.y, b.w, b.h, i.share].every(num)) return [];
    return [{ id: i.id.slice(0, 60), kind: i.kind.slice(0, 20), label: String(i.label ?? i.kind).slice(0, 40), ...(typeof i.colour === "string" ? { colour: i.colour.slice(0, 30) } : {}), box: { x: b.x, y: b.y, w: b.w, h: b.h }, share: i.share }];
  });

export function mountViews(app: Hono) {
  app.get("/api/scans/:id/views", async (c) => {
    const id = c.req.param("id");
    if (!okId(id)) return c.json({ error: "Not found" }, 404);
    const perRoom = Math.min(6, Math.max(4, Number(c.req.query("perRoom") ?? 5) || 5));
    const [own, rooms, design, result] = await Promise.all([designAngles(id, perRoom), bestAngles(id, perRoom), designFor(id), scanResult(id)]);
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
    const angle = [...(await designAngles(id, 6)), ...(await designAngles(id, 5)), ...(await designAngles(id, 4)), ...(await bestAngles(id, 6))].find((a) => a.id === angleId);
    if (!angle) return c.json({ error: "Not found" }, 404);
    const hash = String(meta.designHash), view = String(meta.viewKey);
    const finishes = { style: String(meta.finishes?.style ?? "").slice(0, 120), floor: String(meta.finishes?.floor ?? "").slice(0, 60), walls: String(meta.finishes?.walls ?? "").slice(0, 60) };
    const picture = await makePicture(
      {
        angleId,
        designHash: hash,
        viewKey: view,
        guide: Buffer.from(await guide.arrayBuffer()),
        size: [angle.intrinsics.width, angle.intrinsics.height],
        items: cleanItems(meta.items),
        anchors: await anchorsAt(id, angle.frame),
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
          await storage.put(key(id, angleId, view, "jpg"), jpeg, "image/jpeg");
          await storage.put(key(id, angleId, view, "json"), Buffer.from(JSON.stringify(m)), "application/json");
        },
        canSpend,
      },
    );
    await storage.put(designKey(id, angleId, hash), Buffer.from(JSON.stringify({ viewKey: view })), "application/json");
    return c.json({ ...picture, designHash: hash, url: pictureUrl(id, angleId, view, picture.at), spentTodayUsd: Math.round(spent.usd * 1000) / 1000 });
  });

  app.get("/api/scans/:id/views/:angle/:file", async (c) => {
    const id = c.req.param("id"), angleId = c.req.param("angle");
    const hash = c.req.param("file").replace(/\.jpg$/, "");
    if (!okId(id) || !ANGLE.test(angleId) || !HASH.test(hash)) return c.json({ error: "Not found" }, 404);
    const jpeg = await readStored(key(id, angleId, hash, "jpg"));
    if (!jpeg) return c.json({ error: "Not found" }, 404);
    return new Response(new Uint8Array(jpeg), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
  });
}
