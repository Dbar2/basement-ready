// The swipe deck's API, mounted from server/index.ts. Reading a deck needs only the scan's id, like its
// events; anything that spends money or saves (starting a deck, the board) needs the owner or this
// browser's claim token. The example ("sample") reads its deck straight from
// public/samples/sample/cards, no server needed. The layouts are the model's designs
// (server/model/routes.ts), pictured by server/views.
import { eq } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { Readable } from "node:stream";
import { z } from "zod";
import { db, schema } from "../db";
import { enqueue } from "../jobs";
import { metaKey, overSpend, USED_UP } from "../limits";
import { storage } from "../storage";
import { basementFor, loadWorkspace, parseClaims, saveWorkspace } from "../workspace";
import type { Model } from "../model/types";
import { cardKey, cardsSoFar, enqueueCards } from "./cards";
import { STYLES, type StyleId } from "./styles";

const UUID = /^[0-9a-f-]{36}$/;
const NEED_ACCESS = "Open this on the device you scanned with, or sign in.";

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
  colours: z.record(z.string().max(20), text(40)).optional(),
});

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
    if (await overSpend()) return c.json({ error: USED_UP }, 503);
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

  // ---- The board ----

  async function saveModel(basementId: string, change: (m: Partial<Model>) => Partial<Model>) {
    const w = await loadWorkspace(basementId);
    const model = ((w.state as { model?: Partial<Model> }).model ?? {}) as Partial<Model>;
    const next = { ...change(model), version: 1 as const };
    await saveWorkspace(basementId, { state: { model: next } as never });
    return next;
  }

  // What their board reads, saved as they swipe, into the model (whole or not yet), so the layouts, the
  // studio and the quote start from it.
  app.post("/api/scans/:id/mood", async (c) => {
    const a = await access(c);
    if (!a) return c.json({ error: "Not found" }, 404);
    if (!a.allowed) return c.json({ error: NEED_ACCESS }, 403);
    const mood = MoodSchema.safeParse(await c.req.json().catch(() => null));
    if (!mood.success) return c.json({ error: "That didn't save." }, 400);
    await saveModel(a.basement.id, (m) => ({ ...m, mood: mood.data }));
    return c.json({ ok: true });
  });
}
