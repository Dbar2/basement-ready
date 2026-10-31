import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Storage goes to a folder of its own, never the repo's media/ (set before server/storage.ts loads).
vi.hoisted(() => {
  process.env.LOCAL_STORAGE_DIR = `${process.env.TMPDIR ?? "/tmp"}/br-privacy-${process.pid}-${Date.now()}`;
});

import { mountAdmin, stageTimes } from "../../server/admin";
import { db, migrateDb, schema } from "../../server/db";
import { adminCookieValue, cookieClaims, mountScanGate, NOT_FOUND } from "../../server/privacy";
import { mountWorkspace } from "../../server/workspaceRoutes";

const KEY = "test-admin-key-not-a-real-one";

async function newScan(opts: { claimToken?: string; ip?: string; ownerId?: string; result?: unknown } = {}) {
  const [b] = await db.insert(schema.basements).values({ claimToken: opts.claimToken ?? `tok-${Math.random().toString(36).slice(2)}`, municipality: "waterloo-on", ...(opts.ownerId ? { ownerId: opts.ownerId } : {}) }).returning();
  const [s] = await db.insert(schema.scans).values({ basementId: b.id, clientIp: opts.ip ?? "10.0.0.1", status: "done", result: (opts.result ?? null) as any }).returning();
  return { basement: b, scan: s };
}

// The gate in front of stand-in routes, as server/index.ts mounts it in front of the real ones; the
// signed-in user comes from a test header.
const app = new Hono();
mountScanGate(app, async (c) => c.req.header("x-test-user") ?? null);
app.get("/api/scans/:id", (c) => c.json({ id: c.req.param("id") }));
app.get("/api/scans/:id/video", (c) => c.text("video"));
app.get("/api/scans/:id/frames/:n", (c) => c.text("frame"));
app.post("/api/scans/:id/answers", (c) => c.json({ saved: true }));
mountWorkspace(app, async (c) => c.req.header("x-test-user") ?? null);
mountAdmin(app);

const claimsHeader = (basementId: string, claimToken: string) => ({ "x-claims": encodeURIComponent(JSON.stringify([{ basementId, claimToken }])) });
const claimsCookie = (basementId: string, claimToken: string) => ({ cookie: `br_claims=${encodeURIComponent(`${basementId}.${claimToken}`)}` });

beforeAll(async () => {
  await migrateDb();
  await db.insert(schema.users).values([{ id: "user_owner" }, { id: "user_other" }]).onConflictDoNothing();
});
beforeEach(async () => {
  await db.execute(sql`DELETE FROM basements`);
  process.env.ADMIN_TOKEN = KEY;
});
afterEach(() => {
  delete process.env.ADMIN_TOKEN;
});

describe("private scans: only the owner or an admin", () => {
  it("answers anyone else with the same 404 a scan that doesn't exist gets", async () => {
    const { scan } = await newScan();
    for (const path of ["", "/video", "/frames/3", "/workspace"]) {
      const res = await app.request(`/api/scans/${scan.id}${path}`);
      expect(res.status, path).toBe(404);
      expect(await res.json()).toEqual({ error: NOT_FOUND });
    }
    const none = await app.request("/api/scans/00000000-0000-0000-0000-000000000000/video");
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ error: NOT_FOUND });
  });

  it("opens for the device that made it: its claim as a header, or as the cookie for what a page loads", async () => {
    const { basement, scan } = await newScan({ claimToken: "the-real-token" });
    expect((await app.request(`/api/scans/${scan.id}`, { headers: claimsHeader(basement.id, "the-real-token") })).status).toBe(200);
    expect((await app.request(`/api/scans/${scan.id}/frames/3`, { headers: claimsCookie(basement.id, "the-real-token") })).status).toBe(200);
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: claimsCookie(basement.id, "a-guess-at-it") })).status).toBe(404);
  });

  it("never lets the cookie alone post: another site's form can't act as the owner", async () => {
    const { basement, scan } = await newScan({ claimToken: "the-real-token" });
    const post = (headers: Record<string, string>) => app.request(`/api/scans/${scan.id}/answers`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: "{}" });
    expect((await post(claimsCookie(basement.id, "the-real-token"))).status).toBe(404);
    expect((await post(claimsHeader(basement.id, "the-real-token"))).status).toBe(200);
  });

  it("opens for its signed-in owner, and not another account", async () => {
    const { scan } = await newScan({ ownerId: "user_owner" });
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { "x-test-user": "user_owner" } })).status).toBe(200);
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { "x-test-user": "user_other" } })).status).toBe(404);
  });

  it("opens for an admin to read, by bearer, header or cookie, and through a route's own owner check", async () => {
    const { scan } = await newScan();
    for (const headers of [{ authorization: `Bearer ${KEY}` }, { "x-admin-token": KEY }, { cookie: `br_admin=${adminCookieValue(KEY)}` }]) {
      expect((await app.request(`/api/scans/${scan.id}/video`, { headers })).status).toBe(200);
      expect((await app.request(`/api/scans/${scan.id}/workspace`, { headers })).status).toBe(200);
    }
  });

  it("never lets an admin change a scan, and a wrong or unset key opens nothing", async () => {
    const { scan } = await newScan();
    expect((await app.request(`/api/scans/${scan.id}/answers`, { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: "{}" })).status).toBe(404);
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { authorization: "Bearer not-the-key" } })).status).toBe(404);
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { cookie: `br_admin=${KEY}` } })).status).toBe(404);
    delete process.env.ADMIN_TOKEN;
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { authorization: "Bearer " } })).status).toBe(404);
    expect((await app.request(`/api/scans/${scan.id}/video`, { headers: { "x-admin-token": "" } })).status).toBe(404);
  });

  it("leaves the example open to everyone", async () => {
    expect((await app.request("/api/scans/sample")).status).toBe(200);
    expect((await app.request("/api/scans/sample/frames/3")).status).toBe(200);
  });

  it("reads the cookie's compact claims and nothing malformed", () => {
    const id = "3f2a8c1e-0000-4000-8000-000000000001";
    expect(cookieClaims(encodeURIComponent(`${id}.abcDEF123_-xyz|not-a-uuid.token1234|${id}.`))).toEqual([{ basementId: id, claimToken: "abcDEF123_-xyz" }]);
    expect(cookieClaims(undefined)).toEqual([]);
  });
});

describe("/admin", () => {
  it("takes the key once from the address, sets a cookie that isn't the key, and moves off the URL", async () => {
    const res = await app.request(`/admin?key=${KEY}`);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^br_admin=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).not.toContain(KEY);
    expect((await app.request("/admin?key=wrong")).status).toBe(404);
    expect((await app.request("/admin")).status).toBe(404);
    delete process.env.ADMIN_TOKEN;
    expect((await app.request("/admin?key=")).status).toBe(404);
  });

  it("lists scans newest first, with no street address, and marks the ones that are probably David's", async () => {
    const mine = await newScan({ claimToken: "davids-token", ip: "203.0.113.7", result: { headline: "Yes, after 1 fix." } });
    const samePhone = await newScan({ ip: "203.0.113.7" });
    const stranger = await newScan({ ip: "198.51.100.9" });
    await db.update(schema.basements).set({ address: "12 Secret Street" }).where(sql`id = ${stranger.basement.id}`);
    await db.insert(schema.scanEvents).values([
      { scanId: mine.scan.id, at: 0.1, type: "stage", text: "prepare" },
      { scanId: mine.scan.id, at: 7.2, type: "stage", text: "find" },
      { scanId: mine.scan.id, at: 53, type: "stage", text: "assess" },
      { scanId: mine.scan.id, at: 95.4, type: "done", text: "Your answer is ready" },
    ]);
    const html = await (await app.request("/admin", { headers: { cookie: `br_admin=${adminCookieValue(KEY)}; br_claims=${encodeURIComponent(`${mine.basement.id}.davids-token`)}`, "x-forwarded-for": "198.51.100.1" } })).text();
    expect(html).toContain("Yes, after 1 fix.");
    expect(html).toContain("prepare 7 s · find 46 s · assess 42 s · total 95 s");
    expect(html).not.toContain("Secret Street");
    const rowOf = (id: string) => html.slice(html.indexOf(`/admin/scans/${id}`), html.indexOf("</tr>", html.indexOf(`/admin/scans/${id}`)));
    expect(rowOf(mine.scan.id)).toContain("Probably David");
    expect(rowOf(samePhone.scan.id)).toContain("Probably David");
    expect(rowOf(stranger.scan.id)).not.toContain("Probably David");
  });

  it("shows one scan and gives it as JSON, only with the key", async () => {
    const { scan } = await newScan({ result: { headline: "Looks like yes." } });
    const admin = { authorization: `Bearer ${KEY}` };
    const page = await app.request(`/admin/scans/${scan.id}`, { headers: admin });
    expect(page.status).toBe(200);
    expect(await page.text()).toContain(`<video controls preload="metadata" src="/api/scans/${scan.id}/video">`);
    const json = await (await app.request(`/admin/api/scans/${scan.id}`, { headers: admin })).json();
    expect(json.scan).toMatchObject({ id: scan.id, source: "Web, video", city: "Waterloo" });
    expect(json.result.headline).toBe("Looks like yes.");
    expect((await app.request(`/admin/api/scans/${scan.id}`)).status).toBe(404);
    expect((await app.request(`/admin/scans/${scan.id}/file?name=../../etc/passwd`, { headers: admin })).status).toBe(404);
  });
});

describe("stageTimes", () => {
  it("is each stage's seconds from the scan's own events", () => {
    expect(stageTimes([{ at: 0, type: "stage", text: "prepare" }, { at: 6, type: "stage", text: "find" }, { at: 50, type: "error", text: "x" }])).toEqual({ prepare: 6, find: null, assess: null, total: 50 });
  });
});
