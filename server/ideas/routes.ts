// The swipe deck's and the layout picker's API, mounted from server/index.ts. Reading a deck or the
// layouts needs only the scan's id, like its events; anything that spends money or saves (starting
// a deck, a layout's corner picture, the pick) needs the owner or this browser's claim token.
// The example ("sample") reads its deck straight from public/samples/sample/cards, no server needed.
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { z } from "zod";
import { db, schema } from "../db";
import { enqueue } from "../jobs";
import { keys, storage } from "../storage";
import { basementFor, loadWorkspace, parseClaims, saveWorkspace } from "../workspace";
import type { Design, Model } from "../model/types";
import { jpegSize } from "../concepts";
import { cardKey, cardsSoFar, cornerKey, enqueueCards, makeCorner, SAMPLE_CARDS } from "./cards";
import type { Slot } from "./deck";
import { cameras, designFrom, layoutOptions, withCorners, type LayoutOption } from "./layouts";
import { STYLES, type StyleId } from "./styles";

const UUID = /^[0-9a-f-]{36}$/;
const SAMPLE = "public/samples/sample";
const NEED_ACCESS = "Open this on the device you scanned with, or sign in.";
const MAX_CORNERS = 24; // per scan and server run: a board changes the finishes, not without end

const metaKey = () => Boolean(process.env.MODEL_API_KEY || process.env.RELAY_TOKEN);

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}

async function sendStored(key: string, type: string) {
  const body = await storage.get(key);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(body) as ReadableStream, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
}

const text = (max: number) => z.string().trim().max(max);
const FinishesSchema = z.object({
  style: z.enum(Object.keys(STYLES) as [StyleId, ...StyleId[]]).optional(),
  floor: text(60).optional(),
  walls: text(60).optional(),
  kitchen: text(60).optional(),
  bath: text(60).optional(),
});
const MoodSchema = z.object({
  liked: z.array(text(12)).max(40),
  disliked: z.array(text(12)).max(40),
  style: z.enum(Object.keys(STYLES) as [StyleId, ...StyleId[]]).nullable(),
  finishes: FinishesSchema,
});

function sampleResult() {
  return JSON.parse(readFileSync(`${SAMPLE}/result.json`, "utf8"));
}

// The example's deck views: its corners are picked among them, so a card already shows each one.
function sampleViews(): number[] {
  if (!existsSync(`${SAMPLE_CARDS}/deck.json`)) return [];
  const deck = JSON.parse(readFileSync(`${SAMPLE_CARDS}/deck.json`, "utf8")) as { slots: Slot[] };
  return [...new Set(deck.slots.map((s) => s.frame))];
}

// The layouts for a scan's plan, each with the real frame that faces its room.
async function optionsFor(id: string, result: any): Promise<LayoutOption[]> {
  if (!result?.plan) return [];
  const main = result.mainRoom ?? 0;
  const scan = id === "sample" ? JSON.parse(readFileSync(`${SAMPLE}/3d/scan.json`, "utf8")) : JSON.parse((await read(keys.scan3d(id, "scan.json", main)))?.toString("utf8") ?? "{}");
  const cams = cameras(scan);
  const first = id === "sample" ? readFileSync(`${SAMPLE}/frames/0000.jpg`) : cams.length ? await read(keys.frame(id, cams[0].frame)) : null;
  const [w, h] = (first && jpegSize(first)) || [16, 9];
  return withCorners(layoutOptions(result.plan), cams, Math.round((w / h) * 1000) / 1000, id === "sample" ? sampleViews() : undefined);
}

const cornerRuns = new Map<string, Promise<{ kept: boolean; checked: string } | null>>();
const cornerCount = new Map<string, number>();

export function mountIdeas(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  async function access(c: Context) {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) return null;
    const userId = await currentUser(c);
    const a = await basementFor(id, { userId, claims: parseClaims(c.req.header("x-claims")) });
    return a.basement ? { ...a, id } : null;
  }

  // ---- The deck ----

  // Opening the deck starts it: the cards are made as soon as the scan's frames are stored.
  app.post("/api/scans/:id/cards", async (c) => {
    const a = await access(c);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NEED_ACCESS }, 403);
    if (!metaKey()) return c.json({ error: "Cards need the Muse Image key on this server." }, 503);
    const [scan] = await db.select({ status: schema.scans.status }).from(schema.scans).where(eq(schema.scans.id, a.id));
    if (scan?.status === "error") return c.json({ error: "This scan didn't finish." }, 409);
    // Development only: ?again=1 deals a fresh deck.
    if (c.req.query("again") === "1" && process.env.NODE_ENV !== "production") await enqueue("cards", { scanId: a.id });
    else await enqueueCards(a.id);
    return c.json(await cardsSoFar(a.id), 200, { "Cache-Control": "no-store" });
  });

  app.get("/api/scans/:id/cards", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
    return c.json(await cardsSoFar(id), 200, { "Cache-Control": "no-store" });
  });

  app.get("/api/scans/:id/cards/:file", async (c) => {
    const id = c.req.param("id");
    const n = Number.parseInt(c.req.param("file"), 10);
    if (!UUID.test(id) || !Number.isInteger(n) || n < 1 || n > 40) return c.json({ error: "Not found" }, 404);
    return sendStored(cardKey(id, n), "image/jpeg");
  });

  // ---- The layouts ----

  app.get("/api/scans/:id/layouts", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id) && id !== "sample") return c.json({ error: "Not found" }, 404);
    let result: any;
    if (id === "sample") result = sampleResult();
    else [{ result } = { result: null }] = await db.select({ result: schema.scans.result }).from(schema.scans).where(eq(schema.scans.id, id));
    if (!result?.plan) return c.json({ plan: null, options: [] });
    return c.json({ plan: result.plan, options: await optionsFor(id, result) }, 200, { "Cache-Control": "no-store" });
  });

  // One layout's corner, finished the way their board reads. Made once per finish and kept.
  app.post("/api/scans/:id/corner", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NEED_ACCESS }, 403);
    const body = z.object({ option: text(40), finishes: FinishesSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Pick a layout." }, 400);
    const option = (await optionsFor(a.id, a.result)).find((o) => o.id === body.data.option);
    if (!option?.corner) return c.json({ error: "No picture for that layout." }, 404);
    const style = body.data.finishes.style ?? "bright";
    const s = STYLES[style];
    const tags = {
      style,
      floor: body.data.finishes.floor ?? s.floors[0],
      walls: body.data.finishes.walls ?? s.walls[0],
      kitchen: body.data.finishes.kitchen ?? s.kitchen,
      bath: body.data.finishes.bath ?? s.bath,
      use: option.corner.use,
      light: "day" as const,
    };
    const hash = createHash("sha1").update(JSON.stringify([option.corner.frame, tags])).digest("hex").slice(0, 12);
    const url = `/api/scans/${a.id}/corners/${hash}.jpg`;
    const done = await read(`${cornerKey(a.id, hash)}.json`);
    if (done) return c.json({ url, ...JSON.parse(done.toString("utf8")) });
    const run = `${a.id}:${hash}`;
    if (!cornerRuns.has(run)) {
      if (!metaKey()) return c.json({ error: "Pictures need the Muse Image key on this server." }, 503);
      if ((cornerCount.get(a.id) ?? 0) >= MAX_CORNERS) return c.json({ error: "That's enough pictures for this basement today." }, 429);
      cornerCount.set(a.id, (cornerCount.get(a.id) ?? 0) + 1);
      cornerRuns.set(
        run,
        makeCorner(a.id, option.corner.frame, tags, hash)
          .then(async (r) => {
            if (r) await storage.put(`${cornerKey(a.id, hash)}.json`, Buffer.from(JSON.stringify(r)), "application/json");
            return r;
          })
          .finally(() => cornerRuns.delete(run)),
      );
    }
    const r = await cornerRuns.get(run)!.catch(() => null);
    return r ? c.json({ url, ...r }) : c.json({ error: "We couldn't stage this corner without moving a window." }, 422);
  });

  app.get("/api/scans/:id/corners/:file", async (c) => {
    const id = c.req.param("id");
    const hash = c.req.param("file").replace(/\.jpg$/, "");
    if (!UUID.test(id) || !/^[0-9a-f]{12}$/.test(hash)) return c.json({ error: "Not found" }, 404);
    return sendStored(cornerKey(id, hash), "image/jpeg");
  });

  // ---- The board and the pick ----

  async function saveModel(basementId: string, change: (m: Partial<Model>) => Partial<Model>) {
    const w = await loadWorkspace(basementId);
    const model = ((w.state as { model?: Partial<Model> }).model ?? {}) as Partial<Model>;
    const next = { ...change(model), version: 1 as const };
    await saveWorkspace(basementId, { state: { model: next } as never });
    return next;
  }

  // What their board reads, saved as they swipe, so the studio and the quote start from it.
  app.post("/api/scans/:id/mood", async (c) => {
    const a = await access(c);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NEED_ACCESS }, 403);
    const mood = MoodSchema.safeParse(await c.req.json().catch(() => null));
    if (!mood.success) return c.json({ error: "That didn't save." }, 400);
    await saveModel(a.basement.id, (m) => ({ ...m, mood: mood.data }));
    return c.json({ ok: true });
  });

  // The layout they picked, as a design in the model, with the board it came from. Other designs stay,
  // no longer chosen; whatever else the model holds (what's there, from the plan check) is kept.
  app.post("/api/scans/:id/design", async (c) => {
    const a = await access(c);
    if (!a?.result) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NEED_ACCESS }, 403);
    const body = z.object({ option: text(40), mood: MoodSchema }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Pick a layout." }, 400);
    const option = (await optionsFor(a.id, a.result)).find((o) => o.id === body.data.option);
    if (!option) return c.json({ error: "That layout isn't there any more." }, 404);
    const design = designFrom(option, body.data.mood.finishes);
    await saveModel(a.basement.id, (m) => ({
      ...m,
      designs: [...(m.designs ?? []).filter((d: Design) => d.id !== design.id).map((d: Design) => ({ ...d, chosen: false })), design],
      mood: body.data.mood,
    }));
    return c.json({ design });
  });
}
