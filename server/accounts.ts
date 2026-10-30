// Accounts: claiming anonymous scans, listing a homeowner's basements, deleting their data.
// Pure database functions keyed by user id, so they can be tested without Clerk.
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { savedAnswers } from "./answers";
import { db, schema } from "./db";
import { pricedForBasement } from "./priced";

export async function ensureUser(id: string, email: string | null) {
  await db.insert(schema.users).values({ id, email }).onConflictDoUpdate({ target: schema.users.id, set: { email } });
}

function sameToken(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Moves basements scanned before sign-up into the account. Only unowned basements with a matching token move.
export async function claimBasements(userId: string, claims: { basementId: string; claimToken: string }[]) {
  const ids = claims.map((c) => c.basementId).filter((id) => /^[0-9a-f-]{36}$/.test(id)).slice(0, 50);
  if (!ids.length) return 0;
  const rows = await db
    .select({ id: schema.basements.id, claimToken: schema.basements.claimToken })
    .from(schema.basements)
    .where(and(inArray(schema.basements.id, ids), isNull(schema.basements.ownerId)));
  const ok = rows.filter((r) => claims.some((c) => c.basementId === r.id && sameToken(c.claimToken, r.claimToken))).map((r) => r.id);
  if (!ok.length) return 0;
  await db.update(schema.basements).set({ ownerId: userId, updatedAt: new Date() }).where(inArray(schema.basements.id, ok));
  return ok.length;
}

export async function listBasements(userId: string) {
  const basements = await db
    .select()
    .from(schema.basements)
    .where(eq(schema.basements.ownerId, userId))
    .orderBy(desc(schema.basements.updatedAt));
  if (!basements.length) return [];
  const scans = await db
    .select({ id: schema.scans.id, basementId: schema.scans.basementId, status: schema.scans.status, result: schema.scans.result, createdAt: schema.scans.createdAt })
    .from(schema.scans)
    .where(inArray(schema.scans.basementId, basements.map((b) => b.id)))
    .orderBy(desc(schema.scans.createdAt));
  return Promise.all(basements.map(async (b) => {
    const latest = scans.find((s) => s.basementId === b.id);
    const stored = latest?.result as { headline?: string; verdict?: string; cost?: { low: number; high: number }; findings?: unknown[] } | null;
    // Priced on the design they picked, as their workspace shows it (server/priced.ts).
    const r = latest && stored?.findings ? await pricedForBasement(latest.id, b.id, { ...(stored as any), household: b.household ?? (stored as any).household }, await savedAnswers(b.id)) : stored;
    return {
      id: b.id,
      address: b.address,
      municipality: b.municipality,
      household: b.household,
      updatedAt: b.updatedAt,
      latestScan: latest ? { id: latest.id, status: latest.status, headline: r?.headline ?? null, verdict: r?.verdict ?? null, cost: r?.cost ?? null, createdAt: latest.createdAt } : null,
    };
  }));
}

// Scan ids under the user's basements, so their stored files can be removed too.
export async function scanIdsForUser(userId: string) {
  const rows = await db
    .select({ id: schema.scans.id })
    .from(schema.scans)
    .innerJoin(schema.basements, eq(schema.scans.basementId, schema.basements.id))
    .where(eq(schema.basements.ownerId, userId));
  return rows.map((r) => r.id);
}

// Deletes the account row; basements, scans, events and answers cascade.
export async function deleteUserData(userId: string) {
  const scanIds = await scanIdsForUser(userId);
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  return scanIds;
}

export async function deleteBasement(userId: string, basementId: string) {
  const scans = await db.select({ id: schema.scans.id }).from(schema.scans).where(eq(schema.scans.basementId, basementId));
  const deleted = await db
    .delete(schema.basements)
    .where(and(eq(schema.basements.id, basementId), eq(schema.basements.ownerId, userId)))
    .returning({ id: schema.basements.id });
  return deleted.length ? scans.map((s) => s.id) : null;
}
