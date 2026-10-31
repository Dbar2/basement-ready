// Scans are private. A scan's data and media open only for:
// - the device or browser that made it (its claim)
// - its signed-in owner
// - an admin holding ADMIN_TOKEN, and only to read
// Anyone else, and an id that doesn't exist, get the same 404, so ids can't be probed. The example
// ("sample") stays open.
//
// Claims travel two ways:
// - the x-claims header (src/api.ts)
// - for what the browser loads by itself (a frame, the video, a 3D file, the event stream), the br_claims
//   cookie the web app keeps in step with its stored claims. It counts only on reads, so another site's
//   form can't post as the owner.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Context, Hono, Next } from "hono";
import { getCookie } from "hono/cookie";
import { basementFor, parseClaims } from "./workspace";

export type Claim = { basementId: string; claimToken: string };

export const CLAIMS_COOKIE = "br_claims";
export const ADMIN_COOKIE = "br_admin";
export const NOT_FOUND = "We couldn't open this scan here. Open it on the device you filmed with, or sign in.";
const UUID = /^[0-9a-f-]{36}$/;

const isRead = (c: Context) => c.req.method === "GET" || c.req.method === "HEAD";

// "basementId.claimToken|basementId.claimToken", the shape src/api.ts writes: compact, so twenty fit.
export function cookieClaims(raw: string | undefined): Claim[] {
  if (!raw) return [];
  return decodeURIComponent(raw)
    .split("|")
    .map((pair) => {
      const dot = pair.indexOf(".");
      return { basementId: pair.slice(0, dot), claimToken: pair.slice(dot + 1) };
    })
    .filter((c) => UUID.test(c.basementId) && /^[A-Za-z0-9_-]{8,128}$/.test(c.claimToken))
    .slice(0, 20);
}

// The claims a request carries: the header always, the cookie on a read.
export function requestClaims(c: Context): Claim[] {
  const all = [...parseClaims(c.req.header("x-claims")), ...(isRead(c) ? cookieClaims(getCookie(c, CLAIMS_COOKIE)) : [])];
  return all.filter((x, i) => all.findIndex((y) => y.basementId === x.basementId && y.claimToken === x.claimToken) === i);
}

// ---- The admin key ----

const adminToken = () => process.env.ADMIN_TOKEN?.trim() || null;
// Equal-length digests, so the comparison takes the same time whatever the input.
const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

// The cookie holds a value derived from the key, never the key itself.
export const adminCookieValue = (token: string) => createHmac("sha256", token).update("basement-ready admin cookie v1").digest("base64url");

export function keyMatches(key: string | undefined | null): boolean {
  const token = adminToken();
  return Boolean(token && key && same(key, token));
}

// ADMIN_TOKEN as `Authorization: Bearer`, as `x-admin-token`, or the cookie /admin?key=… set. Nothing when it's unset.
export function isAdmin(c: Context): boolean {
  const token = adminToken();
  if (!token) return false;
  const auth = c.req.header("authorization");
  const bearer = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  const cookie = getCookie(c, ADMIN_COOKIE);
  return keyMatches(bearer) || keyMatches(c.req.header("x-admin-token")) || Boolean(cookie && same(cookie, adminCookieValue(token)));
}

// An admin reads; only the owner changes anything.
export const adminRead = (c: Context) => isRead(c) && isAdmin(c);

// The one link an owner sends on purpose: the permit package's share copy, for their designer (the brief
// email, server/permit/designer.ts). It opens that file and nothing else, read-only, for whoever holds
// the link. Signed with the scan's own claim token: no secret of its own, and it's gone with the scan.
export const shareKey = (scanId: string, claimToken: string) => createHmac("sha256", claimToken).update(`permit share copy ${scanId}`).digest("base64url").slice(0, 32);
const sharedCopy = (c: Context, scanId: string, claimToken: string) =>
  isRead(c) && c.req.path.endsWith("/permit.pdf") && c.req.query("copy") === "share" && Boolean(c.req.query("key")) && same(c.req.query("key")!, shareKey(scanId, claimToken));

// ---- The gate in front of every /api/scans/<id> route ----

export function mountScanGate(app: Hono, currentUser: (c: Context) => Promise<string | null>) {
  const gate = async (c: Context, next: Next) => {
    const id = c.req.param("id") ?? "";
    // The example, /api/scans/allowance and malformed ids: their own handlers answer.
    if (!UUID.test(id) || adminRead(c)) return next();
    const a = await basementFor(id, { userId: await currentUser(c), claims: requestClaims(c) });
    if (!a.basement || !(a.allowed || sharedCopy(c, id, a.basement.claimToken))) return c.json({ error: NOT_FOUND }, 404);
    return next();
  };
  app.use("/api/scans/:id", gate);
  app.use("/api/scans/:id/*", gate);
}
