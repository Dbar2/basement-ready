// Section A: a journey that holds up, and a live site that's safe to leave open. Today's allowance and
// the daily cap (with a spoofed IP), every paid call counted, the answers only the owner may write, the
// example and the demo house sending nothing, the demo house labelled, why a scan failed, and the
// 30-day sweep of raw videos. Nothing here touches the network: fetch is stubbed where a model is called.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Storage goes to a folder of its own, never the repo's media/ (set before server/storage.ts loads).
vi.hoisted(() => {
  process.env.LOCAL_STORAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/br-journey-${process.pid}-${Date.now()}`;
});

import { mountAnswers, NOT_YOURS } from "../../server/answers";
import { db, migrateDb, schema } from "../../server/db";
import { DEMO_MUNICIPALITY, isDemo, labelled } from "../../server/demo";
import { causeOf, failureOf, FAILURE, stored } from "../../server/failure";
import { allowance, clientIp, dayStart, mountLimits, resetSpendCache, spentToday, startSpendLedger, USED_UP } from "../../server/limits";
import { museEdit, responses, samImage, samVideo, transcribe } from "../../server/meta";
import { packFor } from "../../server/rules";
import { charge } from "../../server/spend";
import { keys, storage } from "../../server/storage";
import { sweepOldVideos } from "../../server/sweep";
import { waitState } from "../../src/screens/waitTime";
import { mountWorkspace } from "../../server/workspaceRoutes";

const rows = <T>(r: unknown) => (Array.isArray(r) ? r : (r as { rows: T[] }).rows) as T[];
const spendRows = async () => rows<{ kind: string; usd: number }>(await db.execute(sql`SELECT kind, usd FROM spend ORDER BY id`));
const settle = () => new Promise((r) => setTimeout(r, 80));

async function newScan(opts: { ip?: string; claimToken?: string; createdAt?: Date; result?: unknown; inputs?: unknown; videoKey?: string | null; municipality?: string } = {}) {
  const [b] = await db.insert(schema.basements).values({ claimToken: opts.claimToken ?? "tok-" + Math.random(), municipality: opts.municipality ?? "waterloo-on" }).returning();
  const [s] = await db
    .insert(schema.scans)
    .values({ basementId: b.id, clientIp: opts.ip ?? "10.0.0.1", result: (opts.result ?? null) as any, inputs: (opts.inputs ?? null) as any, videoKey: opts.videoKey ?? null, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) })
    .returning();
  return { basement: b, scan: s };
}

beforeAll(async () => {
  await migrateDb();
  startSpendLedger();
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM spend`);
  await db.execute(sql`DELETE FROM basements`);
  resetSpendCache();
  process.env.MODEL_API_KEY = "test-key";
  delete process.env.SCANS_PER_DAY;
  delete process.env.SCANS_PER_IP_PER_HOUR;
  delete process.env.DAILY_COST_CAP_USD;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the client's IP", () => {
  const app = new Hono();
  app.get("/ip", (c) => c.text(clientIp(c)));
  it("is the entry Railway's proxy appended, not the one the client wrote", async () => {
    expect(await (await app.request("/ip", { headers: { "x-forwarded-for": "203.0.113.9" } })).text()).toBe("203.0.113.9");
    // A client that sends its own header gets the real address appended after it.
    expect(await (await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.9" } })).text()).toBe("203.0.113.9");
    expect(await (await app.request("/ip", { headers: { "x-forwarded-for": "1.2.3.4,  5.6.7.8 , 203.0.113.9" } })).text()).toBe("203.0.113.9");
  });
});

describe("today's allowance, checked before filming", () => {
  const app = new Hono();
  mountLimits(app);
  const ask = async (xff: string) => (await app.request("/api/scans/allowance", { headers: { "x-forwarded-for": xff } })).json();

  it("is open on a quiet day", async () => {
    const a = await ask("203.0.113.9");
    expect(a).toMatchObject({ ok: true, reason: null, leftToday: 5, perDay: 5 });
    expect(Date.parse(a.resetsAt)).toBeGreaterThan(Date.now());
  });

  it("says plainly when there's no Meta key", async () => {
    process.env.MODEL_API_KEY = "";
    const a = await ask("203.0.113.9");
    expect(a.ok).toBe(false);
    expect(a.reason).toBe("no_key");
    expect(a.message).toMatch(/example/);
  });

  it("stops one IP after 6 an hour, however it writes its header", async () => {
    process.env.SCANS_PER_DAY = "100";
    for (let i = 0; i < 6; i++) await newScan({ ip: "203.0.113.9" });
    const spoofed = await ask(`10.${Math.floor(Math.random() * 200)}.0.1, 203.0.113.9`);
    expect(spoofed.ok).toBe(false);
    expect(spoofed.reason).toBe("hour");
    expect(spoofed.message).toMatch(/Try again in about \d+ min, or try the example/);
    // Someone else is still fine.
    expect((await ask("198.51.100.4")).ok).toBe(true);
  });

  it("stops everyone after SCANS_PER_DAY real scans", async () => {
    for (let i = 0; i < 5; i++) await newScan({ ip: `198.51.100.${i}` });
    const a = await ask("192.0.2.1");
    expect(a).toMatchObject({ ok: false, reason: "day", leftToday: 0, message: USED_UP });
    // Yesterday's don't count.
    await db.execute(sql`UPDATE scans SET created_at = ${new Date(dayStart().getTime() - 3600_000).toISOString()}::timestamptz`);
    expect((await ask("192.0.2.1")).ok).toBe(true);
  });

  it("stops everyone once today's paid calls reach the cap", async () => {
    process.env.DAILY_COST_CAP_USD = "1";
    await db.insert(schema.spend).values([{ kind: "sam_video", usd: 0.6 }, { kind: "muse_image", usd: 0.5 }]);
    const a = await ask("192.0.2.1");
    expect(a).toMatchObject({ ok: false, reason: "spend", message: USED_UP });
  });

  it("counts a day from midnight in Toronto", () => {
    // 11 pm on Oct 29 in Toronto (EDT, UTC-4) is still Oct 29 there.
    expect(dayStart(new Date("2026-10-30T03:00:00Z")).toISOString()).toBe("2026-10-29T04:00:00.000Z");
    expect(dayStart(new Date("2026-10-30T05:00:00Z")).toISOString()).toBe("2026-10-30T04:00:00.000Z");
    // In winter (EST, UTC-5).
    expect(dayStart(new Date("2026-12-15T12:00:00Z")).toISOString()).toBe("2026-12-15T05:00:00.000Z");
  });
});

describe("every paid call counts toward the cap", () => {
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it("writes each charge to the ledger and today's total", async () => {
    charge("scan3d", 0.06);
    charge("nothing", 0);
    await settle();
    expect(await spendRows()).toEqual([{ kind: "scan3d", usd: 0.06 }]);
    resetSpendCache();
    expect(await spentToday()).toBeCloseTo(0.06);
  });

  it("charges SAM by the frame and image, Spark by the token, transcription by the minute, Muse Image by the image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).endsWith("/asr/transcribe")) return ok({ transcript: "", turns: [] });
        if (String(url).endsWith("/images/edits")) return ok({ data: [{ b64_json: Buffer.from("img").toString("base64") }] });
        return ok({ output_text: "", usage: { input_tokens: 1_000_000, output_tokens: 0 } });
      }),
    );
    await samVideo("door", "file-1", 600);
    await samVideo("door", "file-1", 10); // 50-frame minimum
    await samImage("door", "data:image/jpeg;base64,AA==");
    await responses({ model: "muse-spark-1.3", input: [] });
    const wav = join(mkdtempSync(join(tmpdir(), "wav-")), "voice.wav");
    writeFileSync(wav, Buffer.alloc(32000 * 60)); // one minute
    await transcribe(wav);
    await museEdit(Buffer.from("x"), "image/jpeg", "a room", "1280x720");
    await settle();
    const got = Object.fromEntries((await spendRows()).map((r, i) => [`${i}:${r.kind}`, Math.round(r.usd * 1e6) / 1e6]));
    expect(got).toEqual({ "0:sam_video": 0.12, "1:sam_video": 0.01, "2:sam_image": 0.0025, "3:spark": 1.25, "4:transcribe": 0.006, "5:muse_image": 0.01 });
  });

  it("charges nothing for a call that failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(samImage("door", "data:image/jpeg;base64,AA==")).rejects.toThrow(/503/);
    await settle();
    expect(await spendRows()).toEqual([]);
  });
});

describe("answers: only the owner writes them", () => {
  const app = new Hono();
  mountAnswers(app, async () => null);
  const post = (id: string, path: string, body: unknown, claims?: unknown) =>
    app.request(`/api/scans/${id}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(claims ? { "x-claims": encodeURIComponent(JSON.stringify(claims)) } : {}) },
      body: JSON.stringify(body),
    });

  it("refuses a shared link, and a wrong claim token", async () => {
    const { basement, scan } = await newScan({ claimToken: "the-real-token" });
    const plain = await post(scan.id, "answers", { ruleId: "plans", value: "rec_room" });
    expect(plain.status).toBe(403);
    expect((await plain.json()).error).toBe(NOT_YOURS);
    const wrong = await post(scan.id, "answers", { ruleId: "plans", value: "rec_room" }, [{ basementId: basement.id, claimToken: "a-guess" }]);
    expect(wrong.status).toBe(403);
    expect((await post(scan.id, "household", { household: "renter" })).status).toBe(403);
    const saved = await db.select().from(schema.answers);
    expect(saved).toEqual([]);
    const [b] = await db.select().from(schema.basements);
    expect(b.household).toBe("unsure");
  });

  it("takes the owner's answer with the claim token", async () => {
    const { basement, scan } = await newScan({ claimToken: "the-real-token" });
    const res = await post(scan.id, "answers", { ruleId: "plans", value: "rec_room" }, [{ basementId: basement.id, claimToken: "the-real-token" }]);
    expect(res.status).toBe(200);
    expect((await res.json()).saved).toBe(true);
    const saved = await db.select().from(schema.answers);
    expect(saved.map((a) => [a.ruleId, a.value])).toEqual([["plans", "rec_room"]]);
  });

  it("takes the signed-in owner's answer, and not another account's", async () => {
    await db.insert(schema.users).values([{ id: "user_owner" }, { id: "user_other" }]).onConflictDoNothing();
    const { basement, scan } = await newScan();
    await db.update(schema.basements).set({ ownerId: "user_owner" }).where(sql`id = ${basement.id}`);
    const as = (userId: string) => {
      const signedIn = new Hono();
      mountAnswers(signedIn, async () => userId);
      return signedIn.request(`/api/scans/${scan.id}/household`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ household: "renter" }) });
    };
    expect((await as("user_other")).status).toBe(403);
    expect((await as("user_owner")).status).toBe(200);
  });
});

describe("the example and the demo house send nothing", () => {
  const app = new Hono();
  mountWorkspace(app, async () => null);

  it("flags every example application, the Region's email included", async () => {
    // A judge who answers the example as a rental: its re-checked grants come with the request.
    const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
    const grants = sample.grants.map((g: { id: string }) => (g.id === "region_ontario_renovates_secondary_suites" ? { ...g, qualify: "yes" } : g));
    const res = await app.request("/api/sample/apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ grants }) });
    const { applications } = await res.json();
    expect(applications.length).toBeGreaterThan(0);
    expect(applications.every((a: { example?: boolean }) => a.example === true)).toBe(true);
    // The address still shows, so the example teaches where it would go.
    const emails = applications.filter((a: { email: { to: string } | null }) => a.email?.to).map((a: { email: { to: string } }) => a.email.to);
    expect(emails.some((to: string) => /regionofwaterloo\.ca$/i.test(to))).toBe(true);
  });

  it("flags a demo house's applications too, and not a real basement's", async () => {
    const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
    const demo = await newScan({ claimToken: "t-demo", result: labelled(sample, true), inputs: { demo: true } });
    const real = await newScan({ claimToken: "t-real", result: sample });
    const get = (s: typeof demo, token: string) =>
      app.request(`/api/scans/${s.scan.id}/apply`, { headers: { "x-claims": encodeURIComponent(JSON.stringify([{ basementId: s.basement.id, claimToken: token }])) } }).then((r) => r.json());
    expect((await get(demo, "t-demo")).applications.every((a: { example?: boolean }) => a.example)).toBe(true);
    expect((await get(real, "t-real")).applications.some((a: { example?: boolean }) => a.example)).toBe(false);
  });
});

describe("the demo house", () => {
  it("uses the City of Waterloo's rules", () => {
    expect(DEMO_MUNICIPALITY).toBe("waterloo-on");
    expect(packFor(DEMO_MUNICIPALITY).pack.jurisdiction.city).toMatch(/waterloo/i);
    expect(isDemo("true")).toBe(true);
    expect(isDemo("1")).toBe(true);
    expect(isDemo(undefined)).toBe(false);
    expect(isDemo("false")).toBe(false);
  });

  it("is labelled on its result, and nothing else is", () => {
    expect(labelled({ verdict: "yes" }, true)).toEqual({ verdict: "yes", demo: true });
    expect(labelled({ verdict: "yes" }, false)).toEqual({ verdict: "yes" });
    expect(labelled(null, true)).toBeNull();
  });
});

describe("why a scan failed", () => {
  it("names the real cause, and only offers a retry where one can help", () => {
    expect(causeOf(new Error("MODEL_API_KEY is not set"))).toBe("no_key");
    expect(causeOf(new Error("Upload 401: bad key"))).toBe("key");
    expect(causeOf(new Error("Meta API 429: slow down"))).toBe("busy");
    expect(causeOf(new Error("Meta API 502: bad gateway"))).toBe("service");
    expect(causeOf(new TypeError("fetch failed"))).toBe("service");
    expect(causeOf(new Error("Command failed: ffmpeg -i input.mov\nmoov atom not found"))).toBe("video");
    expect(causeOf(new Error("ffmpeg: no frames in the video"))).toBe("video");
    expect(causeOf(new Error("Cannot read properties of undefined"))).toBe("unknown");
    expect(FAILURE.no_key.retry).toBe(false);
    expect(FAILURE.video.retry).toBe(false);
    expect(FAILURE.service.retry).toBe(true);
    // Nothing says "try a shorter clip" when the clip wasn't the problem.
    for (const f of Object.values(FAILURE)) expect(f.text).not.toMatch(/shorter/);
  });

  it("is kept with the scan and read back", () => {
    expect(failureOf(stored("service", new Error("fetch failed")))).toMatchObject({ cause: "service", retry: true, text: FAILURE.service.text });
    expect(failureOf("an error from before causes were kept")).toMatchObject({ cause: "unknown", retry: true });
    expect(failureOf(null).cause).toBe("unknown");
  });

  it("is slow after a quiet minute and a half, and stalled after ten", () => {
    expect(waitState(10, 60)).toBe("ok");
    expect(waitState(95, 120)).toBe("slow");
    expect(waitState(5, 9 * 60)).toBe("slow");
    expect(waitState(11 * 60, 12 * 60)).toBe("stalled");
  });
});

describe("raw videos are deleted after 30 days", () => {
  it("deletes each older scan's input video and keeps everything else", async () => {
    const old = await newScan({ createdAt: new Date(Date.now() - 31 * 24 * 3600_000) });
    const recent = await newScan({ createdAt: new Date(Date.now() - 10 * 24 * 3600_000) });
    for (const s of [old.scan, recent.scan]) {
      await storage.put(keys.input(s.id, "mp4"), Buffer.from("video"), "video/mp4");
      await storage.put(keys.frame(s.id, 0), Buffer.from("frame"), "image/jpeg");
      await db.update(schema.scans).set({ videoKey: keys.input(s.id, "mp4") }).where(sql`id = ${s.id}`);
    }
    expect(await sweepOldVideos()).toBe(1);
    expect(await storage.get(keys.input(old.scan.id, "mp4"))).toBeNull();
    expect(await storage.get(keys.frame(old.scan.id, 0))).not.toBeNull();
    expect(await storage.get(keys.input(recent.scan.id, "mp4"))).not.toBeNull();
    const [o] = await db.select().from(schema.scans).where(sql`id = ${old.scan.id}`);
    const [r] = await db.select().from(schema.scans).where(sql`id = ${recent.scan.id}`);
    expect(o.videoKey).toBeNull();
    expect(r.videoKey).toBe(keys.input(recent.scan.id, "mp4"));
    // Swept once is enough.
    expect(await sweepOldVideos()).toBe(0);
  });
});
