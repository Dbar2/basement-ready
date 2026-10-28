import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { claimBasements, deleteBasement, deleteUserData, ensureUser, listBasements } from "./accounts";
import { db, migrateDb, schema, usingPglite } from "./db";
import { enqueue, startWorker } from "./jobs";
import { listModels } from "./meta";
import { MUNICIPALITIES, type Household } from "./rules";
import { handlers } from "./scanJobs";
import { keys, storage } from "./storage";

const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
const SCANS_PER_IP_PER_HOUR = Number(process.env.SCANS_PER_IP_PER_HOUR ?? 6);
const DAILY_COST_CAP_USD = Number(process.env.DAILY_COST_CAP_USD ?? 25);
const UUID = /^[0-9a-f-]{36}$/;

await migrateDb();

if (process.env.MODEL_API_KEY || process.env.RELAY_TOKEN) {
  listModels()
    .then((ids) => console.log(`[meta] models available: ${ids.join(", ")}`))
    .catch((err) => console.error(`[meta] model check failed: ${err.message}`));
}

const app = new Hono();

function clientIp(c: Context) {
  const fwd = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || (c.env as any)?.incoming?.socket?.remoteAddress || "unknown";
}

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

const accountsOn = Boolean(process.env.CLERK_SECRET_KEY && process.env.CLERK_PUBLISHABLE_KEY);
if (accountsOn) app.use("/api/*", clerkMiddleware());

// Returns the signed-in user's id, creating their row on first sight; null if signed out.
async function currentUser(c: Context) {
  if (!accountsOn) return null;
  const userId = getAuth(c)?.userId;
  if (!userId) return null;
  const clerk = c.get("clerk");
  const user = await clerk.users.getUser(userId).catch(() => null);
  await ensureUser(userId, user?.primaryEmailAddress?.emailAddress ?? null);
  return userId;
}

app.get("/api/health", (c) =>
  c.json({ ok: true, metaKey: Boolean(process.env.MODEL_API_KEY || process.env.RELAY_TOKEN), db: usingPglite ? "pglite" : "postgres", accounts: accountsOn }),
);

app.get("/api/municipalities", (c) => c.json(MUNICIPALITIES));

// Create a basement + scan from an uploaded video, then queue the work.
app.post("/api/scans", async (c) => {
  const ip = clientIp(c);
  const [{ count }] = rows<{ count: number }>(
    await db.execute(sql`SELECT count(*)::int AS count FROM scans WHERE client_ip = ${ip} AND created_at > now() - interval '1 hour'`),
  );
  if (count >= SCANS_PER_IP_PER_HOUR) return c.json({ error: "You've scanned a lot this hour. Please try again a bit later." }, 429);
  const [{ spent }] = rows<{ spent: number }>(
    await db.execute(sql`SELECT coalesce(sum(cost_usd), 0)::float AS spent FROM scans WHERE created_at > now() - interval '1 day'`),
  );
  if (spent >= DAILY_COST_CAP_USD) return c.json({ error: "We've reached today's scanning limit. Please try again tomorrow." }, 503);

  const body = await c.req.parseBody();
  const video = body.video;
  if (!(video instanceof File)) return c.json({ error: "Please attach a video." }, 400);
  if (video.size > MAX_VIDEO_BYTES) return c.json({ error: "That video is too large. Keep it under 2 minutes." }, 413);
  const household = (["relative", "renter", "unsure"].includes(String(body.household)) ? body.household : "unsure") as Household;
  const municipality = String(body.municipality ?? "waterloo-on");

  const claimToken = randomBytes(24).toString("base64url");
  const [basement] = await db
    .insert(schema.basements)
    .values({ claimToken, household, municipality, address: String(body.address ?? "").slice(0, 200) })
    .returning();
  // Optional tape measurement, floor to the underside of the joists, in metres.
  const tape = Number(body.floorToJoistsM);
  const inputs = Number.isFinite(tape) && tape >= 1 && tape <= 4 ? { floorToJoistsM: tape } : null;
  const [scan] = await db.insert(schema.scans).values({ basementId: basement.id, clientIp: ip, inputs }).returning();

  const ext = (video.name.split(".").pop() || "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const videoKey = keys.input(scan.id, ext);
  await storage.put(videoKey, Buffer.from(await video.arrayBuffer()), video.type || "video/mp4");
  await db.update(schema.scans).set({ videoKey }).where(eq(schema.scans.id, scan.id));
  await enqueue("scan", { scanId: scan.id });

  return c.json({ id: scan.id, basementId: basement.id, claimToken });
});

app.get("/api/scans/:id", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  if (!scan) return c.json({ error: "Not found" }, 404);
  return c.json({ id: scan.id, status: scan.status, result: scan.result ?? null, error: scan.status === "error" ? "We couldn't read this video." : null });
});

// Live scan events: replays what already happened, then follows new rows until done.
app.get("/api/scans/:id/events", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  return streamSSE(c, async (stream) => {
    let lastId = 0;
    let closed = false;
    stream.onAbort(() => {
      closed = true;
    });
    const deadline = Date.now() + 15 * 60 * 1000;
    while (!closed && Date.now() < deadline) {
      const events = await db
        .select()
        .from(schema.scanEvents)
        .where(and(eq(schema.scanEvents.scanId, id), gt(schema.scanEvents.id, lastId)))
        .orderBy(schema.scanEvents.id);
      for (const e of events) {
        lastId = e.id;
        await stream.writeSSE({ id: String(e.id), data: JSON.stringify({ at: e.at, type: e.type, text: e.text, data: e.data }) });
        if (e.type === "done" || e.type === "error") return;
      }
      await stream.sleep(400);
    }
  });
});

async function sendStored(key: string, type: string) {
  const body = await storage.get(key);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(body) as ReadableStream, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
}

app.get("/api/scans/:id/frames/:n", async (c) => {
  const id = c.req.param("id");
  const n = Number.parseInt(c.req.param("n"), 10);
  if (!UUID.test(id) || !Number.isFinite(n) || n < 0) return c.json({ error: "Not found" }, 404);
  return sendStored(keys.frame(id, n), "image/jpeg");
});

app.get("/api/scans/:id/video", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  return sendStored(keys.analysis(id), "video/mp4");
});

// ---- Accounts: signed-in homeowners -------------------------------------------------------

app.post("/api/me/claim", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const body = await c.req.json().catch(() => ({}));
  const claimed = await claimBasements(userId, Array.isArray(body.claims) ? body.claims : []);
  return c.json({ claimed });
});

app.get("/api/me/basements", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  return c.json({ basements: await listBasements(userId) });
});

app.delete("/api/me/basements/:id", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const scanIds = await deleteBasement(userId, c.req.param("id"));
  if (!scanIds) return c.json({ error: "Not found" }, 404);
  await Promise.all(scanIds.map((id) => storage.removePrefix(keys.scanPrefix(id))));
  return c.json({ deleted: true });
});

// Deletes the account's data here. The Clerk login itself is removed from the account page.
app.delete("/api/me", async (c) => {
  const userId = await currentUser(c);
  if (!userId) return c.json({ error: "Sign in first." }, 401);
  const scanIds = await deleteUserData(userId);
  await Promise.all(scanIds.map((id) => storage.removePrefix(keys.scanPrefix(id))));
  return c.json({ deleted: true, scans: scanIds.length });
});

// The 3D scan's files, for the scan reveal and the explorer.
app.get("/api/scans/:id/3d/:file", async (c) => {
  const id = c.req.param("id");
  const file = c.req.param("file");
  if (!UUID.test(id) || !["scan.json", "points.ply"].includes(file)) return c.json({ error: "Not found" }, 404);
  return sendStored(keys.scan3d(id, file as "scan.json" | "points.ply"), file.endsWith(".json") ? "application/json" : "application/octet-stream");
});

// Queue and spend at a glance. Development only until admin auth lands.
app.get("/api/ops/summary", async (c) => {
  if (process.env.NODE_ENV === "production") return c.json({ error: "Not found" }, 404);
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const recent = await db.select({ status: schema.scans.status, cost: schema.scans.costUsd }).from(schema.scans).where(gte(schema.scans.createdAt, since));
  const queue = rows(await db.execute(sql`SELECT status, count(*)::int AS n FROM jobs GROUP BY status`));
  return c.json({ scans24h: recent.length, spend24h: recent.reduce((s, r) => s + r.cost, 0), queue });
});

// In production the built web app is served from the same process.
app.use("/*", serveStatic({ root: "./dist" }));
app.get("*", serveStatic({ path: "./dist/index.html" }));

// PGlite is single-process, so in development the worker runs here. Production runs `pnpm worker`.
if (usingPglite || process.env.WORKER_INLINE === "1") startWorker(handlers);

// API_PORT wins in dev, where the preview launcher sets PORT for the web server.
const port = Number(process.env.API_PORT ?? process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api on :${port}`));
