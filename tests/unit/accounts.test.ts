import { beforeAll, describe, expect, it } from "vitest";
import { claimBasements, deleteBasement, deleteUserData, ensureUser, listBasements } from "../../server/accounts";
import { db, migrateDb, schema } from "../../server/db";

beforeAll(async () => {
  await migrateDb();
});

async function anonymousBasement(token: string) {
  const [b] = await db.insert(schema.basements).values({ claimToken: token, household: "relative" }).returning();
  const [s] = await db.insert(schema.scans).values({ basementId: b.id, status: "done", result: { headline: "Yes, if you fix 1 thing.", verdict: "fix" } }).returning();
  return { basement: b, scan: s };
}

describe("accounts", () => {
  it("claims an anonymous scan only with the right token", async () => {
    await ensureUser("user_a", "a@example.com");
    await ensureUser("user_b", "b@example.com");
    const { basement } = await anonymousBasement("secret-token-1");
    expect(await claimBasements("user_b", [{ basementId: basement.id, claimToken: "wrong-token-123" }])).toBe(0);
    expect(await claimBasements("user_a", [{ basementId: basement.id, claimToken: "secret-token-1" }])).toBe(1);
    // Already owned: nobody else can take it, even with the token.
    expect(await claimBasements("user_b", [{ basementId: basement.id, claimToken: "secret-token-1" }])).toBe(0);
    const list = await listBasements("user_a");
    expect(list.map((b) => b.id)).toContain(basement.id);
    expect(list.find((b) => b.id === basement.id)!.latestScan?.headline).toBe("Yes, if you fix 1 thing.");
    expect(await listBasements("user_b")).toHaveLength(0);
  });

  it("only the owner can delete a basement", async () => {
    await ensureUser("user_c", null);
    const { basement, scan } = await anonymousBasement("tok-c");
    await claimBasements("user_c", [{ basementId: basement.id, claimToken: "tok-c" }]);
    expect(await deleteBasement("user_b", basement.id)).toBeNull();
    expect(await deleteBasement("user_c", basement.id)).toEqual([scan.id]);
  });

  it("deleting an account removes its basements and scans", async () => {
    await ensureUser("user_d", null);
    const { basement, scan } = await anonymousBasement("tok-d");
    await claimBasements("user_d", [{ basementId: basement.id, claimToken: "tok-d" }]);
    expect(await deleteUserData("user_d")).toEqual([scan.id]);
    expect(await db.select().from(schema.scans).where((await import("drizzle-orm")).eq(schema.scans.id, scan.id))).toHaveLength(0);
  });
});
