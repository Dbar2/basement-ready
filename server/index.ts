import { clerkMiddleware, getAuth } from "@hono/clerk-auth";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { and, eq, gt, gte, sql } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { claimBasements, deleteBasement, deleteUserData, ensureUser, listBasements } from "./accounts";
import { db, migrateDb, schema, usingPglite } from "./db";
import { enqueue, startWorker } from "./jobs";
import { listModels } from "./meta";
import { buildPlan } from "./plan";
import { searchAddresses } from "./address";
import { suggestLayout } from "./layout";
import { fetchAerial, lookupProperty, type Property } from "./property";
import { recheck, type Answers, type AnswerValue } from "./recheck";
import { cameraLookup, cleanCapture } from "./capture";
import { finishRooms, saveBasement3d, storedText, ANALYSIS_FPS, type Detection } from "./pipeline";
import { scanBasement } from "./basement";
import { cleanIdeas, cleanRooms, cleanSpoken, mainRoom, MAX_ROOMS, MAX_TAKE_S, MIN_ROOM_FRAMES, roomRanges } from "./rooms";
import { liteSurfels, lowOverhead, runScan3d, summarize, type Scan3d } from "./scan3d";
import { admit, detectLive, LIVE_CONCEPTS } from "./live";
import { addLiveFrame, live3dEnabled, livePreview } from "./live3d";
import { MUNICIPALITIES, packFor, type Household } from "./rules";
import { cleanMoneyAnswer, evaluateMoney, STORED_MONEY_QUESTIONS, type MoneyAnswers } from "./eligibility";
import { TRIAGE } from "./triage";
import { handlers } from "./scanJobs";
import { keys, storage, type Scan3dFile } from "./storage";

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

// ---- The house: address type-ahead, then what public data already says about it ----

app.get("/api/address", (c) => c.json({ results: searchAddresses(String(c.req.query("q") ?? "").slice(0, 80)) }));

// Only addresses from our own list: the client sends the text it picked, we find the point again.
function resolveAddress(address: unknown, municipality: unknown) {
  const text = String(address ?? "").slice(0, 120);
  return searchAddresses(text, 10).find((a) => a.address.toLowerCase() === text.toLowerCase() && (!municipality || a.municipality === municipality)) ?? null;
}

app.get("/api/property", async (c) => {
  const a = resolveAddress(c.req.query("address"), c.req.query("municipality"));
  if (!a) return c.json({ error: "We couldn't find that address in Waterloo Region." }, 404);
  return c.json({ property: await lookupProperty(a) });
});

// The house from above (Region of Waterloo, 2026). Cached, since the photo doesn't change.
app.get("/api/aerial", async (c) => {
  const a = resolveAddress(c.req.query("address"), c.req.query("municipality"));
  if (!a) return c.body(null, 404);
  const key = `aerial/${a.municipality}/${a.address.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.jpg`;
  if (!(await storage.get(key))) {
    try {
      await storage.put(key, await fetchAerial(a.lon, a.lat), "image/jpeg");
    } catch {
      return c.body(null, 502);
    }
  }
  return sendStored(key, "image/jpeg");
});

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
  if (video.size > MAX_VIDEO_BYTES) return c.json({ error: "That video is too large. Keep it under 3 minutes." }, 413);
  const household = (["relative", "renter", "unsure"].includes(String(body.household)) ? body.household : "unsure") as Household;
  // A picked address sets the city and brings its public facts; otherwise the chosen city's rules.
  const picked = resolveAddress(body.address, body.addressMunicipality);
  const property = picked ? await lookupProperty(picked).catch(() => null) : null;
  const municipality = picked ? (picked.city ?? "ontario") : String(body.municipality ?? "waterloo-on");

  const claimToken = randomBytes(24).toString("base64url");
  const [basement] = await db
    .insert(schema.basements)
    .values({ claimToken, household, municipality, address: (picked?.address ?? String(body.address ?? "")).slice(0, 200), property })
    .returning();
  // Optional tape measurement, floor to the underside of the joists, in metres.
  const tape = Number(body.floorToJoistsM);
  // Where each room starts in the take, when it was filmed room by room.
  const rooms = cleanRooms(body.rooms);
  const ideas = cleanIdeas(body.ideas);
  const spoken = cleanSpoken(body.spoken);
  // Which camera filmed it (the 0.5x ultra-wide or the main one), and when they held still for the wide shot.
  const lens = body.lens === "ultrawide" || body.lens === "wide" ? body.lens : null;
  // The iPhone app's camera tracking (docs/capture-contract.md).
  const capture = body.capture instanceof File && body.capture.size < 40 * 1024 * 1024 ? cleanCapture(await body.capture.text()) : null;
  const wideAt = Number(body.wideAt);
  const inputs = {
    ...(Number.isFinite(tape) && tape >= 1 && tape <= 4 ? { floorToJoistsM: tape } : {}),
    ...(rooms ? { rooms } : {}),
    ...(ideas ? { ideas } : {}),
    ...(spoken ? { spoken } : {}),
    ...(lens ? { lens } : {}),
    ...(capture ? { capture: { device: capture.device ?? null, frames: capture.frames.length } } : {}),
    ...(body.wideAt != null && Number.isFinite(wideAt) && wideAt >= 0 && wideAt <= MAX_TAKE_S + 10 ? { wideAt } : {}),
  };
  const [scan] = await db
    .insert(schema.scans)
    .values({ basementId: basement.id, clientIp: ip, inputs: Object.keys(inputs).length ? inputs : null })
    .returning();
  if (capture) await storage.put(keys.capture(scan.id), Buffer.from(JSON.stringify(capture)), "application/json");

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
  // Scans from before layouts get one on the way out: it's pure, from the saved plan.
  const result = scan.result as any;
  const withLayout = result?.plan && !result.layout ? { ...result, layout: suggestLayout(result.plan) } : result;
  // And scans from before the money questions get their money worked out again, with their answers.
  const withMoney = withLayout?.findings && !withLayout.moneyQuestions ? recheck(withLayout, await savedAnswers(scan.basementId)) : withLayout;
  return c.json({ id: scan.id, status: scan.status, result: withMoney ?? null, error: scan.status === "error" ? "We couldn't read this video." : null });
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

// Development only: make the finished-basement photos again for a scan.
app.post("/api/scans/:id/concepts", async (c) => {
  if (process.env.NODE_ENV === "production") return c.json({ error: "Not found" }, 404);
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  if (!scan?.result) return c.json({ error: "Not ready" }, 404);
  await db.update(schema.scans).set({ result: { ...(scan.result as object), concepts: { status: "pending", items: [] } } }).where(eq(schema.scans.id, id));
  await enqueue("concepts", { scanId: id });
  return c.json({ queued: true });
});

// The finished-basement photos (virtually staged).
app.get("/api/scans/:id/concepts/:file", async (c) => {
  const id = c.req.param("id");
  const n = Number.parseInt(c.req.param("file"), 10);
  if (!UUID.test(id) || !Number.isInteger(n) || n < 1 || n > 4) return c.json({ error: "Not found" }, 404);
  return sendStored(keys.concept(id, n), "image/jpeg");
});

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

// Live finds while filming: a small JPEG frame plus up to three concept keys.
app.post("/api/live/detect", async (c) => {
  const body = await c.req.parseBody();
  const frame = body.frame;
  const session = String(body.session ?? "").slice(0, 64);
  let keys: string[] = [];
  try {
    keys = (JSON.parse(String(body.concepts ?? "[]")) as string[]).filter((k) => k in LIVE_CONCEPTS).slice(0, 3);
  } catch {
    keys = [];
  }
  if (!(frame instanceof File) || frame.size > 400 * 1024 || !keys.length || session.length < 8) {
    return c.json({ error: "Send a small JPEG frame, a session id and 1–3 concepts." }, 400);
  }
  const refused = admit(clientIp(c), session, keys.length);
  if (refused) return c.json({ error: refused, finds: [] }, 429);
  const started = Date.now();
  const jpeg = Buffer.from(await frame.arrayBuffer());
  addLiveFrame(session, jpeg); // the same frames build the 3D preview
  const finds = await detectLive(`data:image/jpeg;base64,${jpeg.toString("base64")}`, keys);
  return c.json({ finds, ms: Date.now() - started });
});

// The 3D scan so far, for this recording. 204 until there's something newer than `since`.
app.get("/api/live/3d", (c) => {
  if (!live3dEnabled) return c.body(null, 404);
  const body = livePreview(String(c.req.query("session") ?? ""), Number(c.req.query("since") ?? 0));
  if (!body) return c.body(null, 204);
  return new Response(new Uint8Array(body), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "no-store" } });
});

// ---- Answers: the homeowner confirms what the video couldn't show, and the verdict re-checks ----

function cleanAnswer(v: unknown): number | boolean | "unsure" | null {
  if (typeof v === "boolean" || v === "unsure") return v;
  if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e6) return v;
  return null;
}

// A rule answer (yes/no, a number, or "unsure"), or a money question's own option.
function answerFor(ruleId: string, v: unknown, pack: ReturnType<typeof packFor>["pack"]) {
  return STORED_MONEY_QUESTIONS.has(ruleId) ? cleanMoneyAnswer(ruleId, v, pack) : cleanAnswer(v);
}

async function savedAnswers(basementId: string): Promise<Answers> {
  const rows = await db.select().from(schema.answers).where(eq(schema.answers.basementId, basementId));
  return Object.fromEntries(rows.map((r) => [r.ruleId, r.value as AnswerValue]));
}

app.post("/api/scans/:id/answers", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const ruleId = String(body.ruleId ?? "");
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  const result = scan?.result as any;
  if (!scan) return c.json({ error: "Not found" }, 404);
  const [basement] = await db.select().from(schema.basements).where(eq(schema.basements.id, scan.basementId));
  const { pack } = packFor(result?.municipality ?? basement?.municipality ?? "waterloo-on");
  const value = answerFor(ruleId, body.value, pack);
  const known = STORED_MONEY_QUESTIONS.has(ruleId) || (result ? result.findings?.some((f: any) => f.ruleId === ruleId) : ruleId in TRIAGE);
  if (!known) return c.json({ error: "Unknown question." }, 400);
  // null clears an answer; anything else the question doesn't offer is refused, never taken as a clear.
  if (value === null && body.value !== null) return c.json({ error: "Unknown answer." }, 400);
  // Answered while the scan runs: keep it, and the scan applies it when it finishes.
  if (!result) {
    if (value === null) {
      await db.delete(schema.answers).where(and(eq(schema.answers.basementId, scan.basementId), eq(schema.answers.ruleId, ruleId)));
      return c.json({ saved: true });
    }
    await db
      .insert(schema.answers)
      .values({ basementId: scan.basementId, ruleId, value })
      .onConflictDoUpdate({ target: [schema.answers.basementId, schema.answers.ruleId], set: { value, updatedAt: new Date() } });
    return c.json({ saved: true });
  }
  if (value === null) {
    await db.delete(schema.answers).where(and(eq(schema.answers.basementId, scan.basementId), eq(schema.answers.ruleId, ruleId)));
  } else {
    await db
      .insert(schema.answers)
      .values({ basementId: scan.basementId, ruleId, value })
      .onConflictDoUpdate({ target: [schema.answers.basementId, schema.answers.ruleId], set: { value, updatedAt: new Date() } });
  }
  const updated = recheck(result, await savedAnswers(scan.basementId));
  await db.update(schema.scans).set({ result: updated }).where(eq(schema.scans.id, id));
  return c.json({ result: updated });
});

// Who the suite is for, answered while the scan runs or afterwards. It changes which money fits.
app.post("/api/scans/:id/household", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const household = String(body.household ?? "");
  if (!["relative", "renter", "unsure"].includes(household)) return c.json({ error: "Pick who it's for." }, 400);
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  if (!scan) return c.json({ error: "Not found" }, 404);
  await db.update(schema.basements).set({ household }).where(eq(schema.basements.id, scan.basementId));
  const result = scan.result as any;
  if (!result) return c.json({ saved: true });
  // Re-check with the saved answers: the money and the plan's steps follow who it's for.
  const updated = recheck({ ...result, household }, await savedAnswers(scan.basementId));
  await db.update(schema.scans).set({ result: updated }).where(eq(schema.scans.id, id));
  return c.json({ result: updated });
});

// The money questions still open for this basement, asked on the wait screen while the scan runs.
app.get("/api/scans/:id/money", async (c) => {
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  if (!scan) return c.json({ error: "Not found" }, 404);
  const [basement] = await db.select().from(schema.basements).where(eq(schema.basements.id, scan.basementId));
  const { pack } = packFor(basement.municipality);
  const money = evaluateMoney(pack, {
    household: basement.household as Household,
    answers: (await savedAnswers(scan.basementId)) as MoneyAnswers,
    property: basement.property as Property | null,
  });
  return c.json({ questions: money.questions, total: money.total });
});

// The sample basement's money questions: nothing saved, the answers come with the request.
app.post("/api/money", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const household = (["relative", "renter", "unsure"].includes(String(body.household)) ? body.household : "unsure") as Household;
  const { pack } = packFor(String(body.municipality ?? "waterloo-on"));
  const raw = (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<string, unknown>;
  const answers = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, cleanMoneyAnswer(k, v, pack)]).filter(([, v]) => v !== null));
  const money = evaluateMoney(pack, { household, answers, property: null });
  return c.json({ questions: money.questions, total: money.total });
});

// The sample basement: same re-check, nothing saved, so anyone can try answering.
app.post("/api/recheck", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.result?.findings || typeof body.answers !== "object") return c.json({ error: "Send a result and answers." }, 400);
  const { pack } = packFor(body.result.municipality ?? "waterloo-on");
  const answers: Answers = Object.fromEntries(Object.entries(body.answers as Record<string, unknown>).map(([k, v]) => [k, answerFor(k, v, pack)]));
  const household = ["relative", "renter", "unsure"].includes(String(body.household)) ? body.household : body.result.household;
  return c.json({ result: recheck({ ...body.result, household }, answers) });
});

// The 3D scan's files, for the scan reveal and the explorer. `?room=n` for rooms after the first.
// `surfels.bin?lite=1` is the first share of the (shuffled) surface points, for phones.
app.get("/api/scans/:id/3d/:file", async (c) => {
  const id = c.req.param("id");
  const file = c.req.param("file");
  // `?room=all`: the whole basement put together (server/basement.ts). `?area=n`: one area as it was
  // measured, for the wait screen.
  const all = c.req.query("room") === "all";
  const area = c.req.query("area") != null ? Number(c.req.query("area")) : null;
  const room = all ? 0 : Number(c.req.query("room") ?? 0);
  const whole = all || area != null; // only the files these have
  if (
    !UUID.test(id) ||
    !["scan.json", "points.ply", "surfels.bin", "mesh.bin"].includes(file) ||
    !Number.isInteger(room) || room < 0 || room >= MAX_ROOMS ||
    (area != null && (!Number.isInteger(area) || area < 0 || area >= 32)) ||
    (whole && file === "points.ply")
  ) {
    return c.json({ error: "Not found" }, 404);
  }
  const shared = file as "scan.json" | "surfels.bin" | "mesh.bin";
  const key = area != null ? keys.area3d(id, area, shared) : all ? keys.basement3d(id, shared) : keys.scan3d(id, file as Scan3dFile, room);
  if (file === "surfels.bin" && c.req.query("lite")) {
    const body = await storage.get(key);
    if (!body) return c.json({ error: "Not found" }, 404);
    const parts: Buffer[] = [];
    for await (const chunk of body) parts.push(chunk as Buffer);
    return new Response(new Uint8Array(liteSurfels(Buffer.concat(parts))), { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, max-age=86400" } });
  }
  return sendStored(key, file.endsWith(".json") ? "application/json" : "application/octet-stream");
});

// Development only: rebuild a scan's plan and measurements from its saved 3D files, without a new scan.
// Send { rooms: [{ startS }] } to redo the 3D room by room instead (local 3D service; no Meta calls).
app.post("/api/scans/:id/replan", async (c) => {
  if (process.env.NODE_ENV === "production") return c.json({ error: "Not found" }, 404);
  const id = c.req.param("id");
  if (!UUID.test(id)) return c.json({ error: "Not found" }, 404);
  const [scan] = await db.select().from(schema.scans).where(eq(schema.scans.id, id));
  const result = scan?.result as any;
  const body = await c.req.json().catch(() => ({}));
  // { basement: true }: the whole basement again, the way new scans do it (server/basement.ts).
  if (result && body?.basement === true) {
    const work = join(tmpdir(), "basement-ready", `replan-${id}`);
    mkdirSync(join(work, "frames"), { recursive: true });
    try {
      for (let n = 0; n < result.frameCount; n++) await storage.download(keys.frame(id, n), join(work, "frames", `${String(n).padStart(4, "0")}.jpg`));
      const known = (scan.inputs as { floorToJoistsM?: number } | null)?.floorToJoistsM;
      const cameraFor = await cameraLookup(() => storedText(keys.capture(id)), ANALYSIS_FPS);
      const b = await scanBasement(work, result.frameCount, known ? { floorToJoistsM: known } : {}, async (t) => console.log(`[replan] ${id}: ${t}`), cameraFor);
      if (!b) return c.json({ error: "No 3D" }, 500);
      const low = new Set(lowOverhead(b.scans, result.detections));
      const detections = (result.detections as Detection[]).filter((d) => !low.has(d));
      const rooms = await finishRooms(id, b.spans.map((s, index) => ({ index, ...s })), b.scans, detections, async () => {}, b.placements);
      await saveBasement3d(id, b);
      const main = mainRoom(rooms);
      const next = {
        ...result,
        detections,
        rooms,
        mainRoom: main?.index ?? null,
        has3d: rooms.some((r) => r.has3d),
        plan: main?.plan ?? null,
        measurements: main?.measurements ?? null,
        layout: main?.plan ? suggestLayout(main.plan) : null,
      };
      await db.update(schema.scans).set({ result: next }).where(eq(schema.scans.id, id));
      return c.json({ rooms: rooms.map(({ name, startS, endS, plan, placement }) => ({ name, startS, endS, size: plan && `${plan.widthM} × ${plan.depthM} m`, placement })), rects: b.rects });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  // With room starts, run the 3D again one room at a time from the saved frames.
  const marks = cleanRooms(body?.rooms);
  if (result && marks) {
    const work = join(tmpdir(), "basement-ready", `replan-${id}`);
    mkdirSync(join(work, "frames"), { recursive: true });
    try {
      const ranges = roomRanges(marks, result.frameCount, ANALYSIS_FPS);
      for (let n = 0; n < result.frameCount; n++) await storage.download(keys.frame(id, n), join(work, "frames", `${String(n).padStart(4, "0")}.jpg`));
      const known = (scan.inputs as { floorToJoistsM?: number } | null)?.floorToJoistsM;
      const scans3d: (Scan3d | null)[] = [];
      for (const r of ranges) scans3d.push(r.to - r.from < MIN_ROOM_FRAMES ? null : await runScan3d(work, r, known ? { floorToJoistsM: known } : {}).catch(() => null));
      const low = new Set(lowOverhead(scans3d, result.detections));
      const detections = (result.detections as Detection[]).filter((d) => !low.has(d));
      const rooms = await finishRooms(id, ranges, scans3d, detections, async () => {});
      const main = mainRoom(rooms);
      const next = { ...result, detections, rooms, mainRoom: main?.index ?? null, has3d: rooms.some((r) => r.has3d), plan: main?.plan ?? null, measurements: main?.measurements ?? null };
      await db.update(schema.scans).set({ result: next }).where(eq(schema.scans.id, id));
      return c.json({ rooms: rooms.map(({ name, startS, endS, plan }) => ({ name, startS, endS, size: plan && `${plan.widthM} × ${plan.depthM} m`, trusted: plan?.trusted ?? null })) });
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const json = await storage.get(keys.scan3d(id, "scan.json"));
  const depthStream = await storage.get(keys.scan3d(id, "depth.bin"));
  if (!result || !json || !depthStream) return c.json({ error: "No 3D scan saved for this scan" }, 404);
  const read = async (s: NodeJS.ReadableStream) => {
    const parts: Buffer[] = [];
    for await (const chunk of s) parts.push(chunk as Buffer);
    return Buffer.concat(parts);
  };
  const scanJson = JSON.parse((await read(json)).toString("utf8"));
  const depthBuf = await read(depthStream);
  const step = Math.max(1, Math.ceil((result.frameCount ?? 0) / 120));
  const sentFrames: number[] = scanJson.sentFrames ?? Array.from({ length: scanJson.framesReceived }, (_, i) => i * step);
  const s3: Scan3d = { scan: scanJson, ply: new ArrayBuffer(0), depth: depthBuf.buffer.slice(depthBuf.byteOffset, depthBuf.byteOffset + depthBuf.byteLength), sentFrames };
  const measurements = summarize(s3, result.detections);
  const plan = buildPlan(s3, result.detections, measurements.trusted);
  await db.update(schema.scans).set({ result: { ...result, measurements, plan } }).where(eq(schema.scans.id, id));
  return c.json({ plan, measurements });
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
