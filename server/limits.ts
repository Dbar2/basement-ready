// The live site's limits, checked on the start sheet before anyone films (GET /api/scans/allowance)
// and again on upload: real scans per IP per hour, real scans per day for everyone, and a daily cap on
// what the paid calls cost, every one of them (server/spend.ts writes each to the `spend` table).
// A day runs midnight to midnight, Eastern time. The client's IP is the one Railway's proxy appended:
// the right-most X-Forwarded-For entry, never the first, which the client can write itself.
import { sql } from "drizzle-orm";
import type { Context, Hono } from "hono";
import { db, schema } from "./db";
import { onSpend } from "./spend";

const setting = (name: string, fallback: number) => {
  const v = process.env[name];
  return v != null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : fallback;
};
export const limits = () => ({
  perHour: setting("SCANS_PER_IP_PER_HOUR", 6),
  perDay: setting("SCANS_PER_DAY", 5),
  capUsd: setting("DAILY_COST_CAP_USD", 25),
});

export const metaKey = () => Boolean(process.env.MODEL_API_KEY || process.env.RELAY_TOKEN);

export function clientIp(c: Context): string {
  const hops = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return hops.at(-1) || (c.env as any)?.incoming?.socket?.remoteAddress || "unknown";
}

// Midnight in Toronto. On the two days a year the clock changes it's an hour out, which is fine here.
export function dayStart(now = new Date()): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((x) => [x.type, Number(x.value)]),
  );
  const offset = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - offset);
}

const nextDay = (now: Date) => dayStart(new Date(dayStart(now).getTime() + 26 * 3600 * 1000));

function rows<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : (result as { rows: T[] }).rows) as T[];
}

// Today's spend, read from the ledger at most every 15 s; this process's own calls are added as they happen.
let cache: { day: number; at: number; usd: number } | null = null;

export async function spentToday(): Promise<number> {
  const day = dayStart().getTime();
  if (cache && cache.day === day && Date.now() - cache.at < 15_000) return cache.usd;
  const [{ usd }] = rows<{ usd: number }>(await db.execute(sql`SELECT coalesce(sum(usd), 0)::float AS usd FROM spend WHERE created_at >= ${new Date(day).toISOString()}::timestamptz`));
  cache = { day, at: Date.now(), usd };
  return usd;
}

export const overSpend = async () => (await spentToday()) >= limits().capUsd;

// The API and the worker each write their own calls.
export function startSpendLedger() {
  onSpend((kind, usd) => {
    if (cache && cache.day === dayStart().getTime()) cache.usd += usd;
    void db
      .insert(schema.spend)
      .values({ kind, usd })
      .catch((err) => console.error(`[spend] ${kind} $${usd.toFixed(4)}: ${err instanceof Error ? err.message : err}`));
  });
}

export function resetSpendCache() {
  cache = null;
}

export type Allowance = {
  ok: boolean;
  reason: "no_key" | "spend" | "day" | "hour" | null;
  message: string | null;
  leftToday: number;
  perDay: number;
  resetsAt: string;
};

export const USED_UP = "Today's real scans are used up. They come back at midnight, Eastern time. The example shows everything meanwhile.";

// Whether this IP may start a real scan now, and if not, why in plain words.
export async function allowance(ip: string): Promise<Allowance> {
  const now = new Date();
  const { perHour, perDay, capUsd } = limits();
  const [{ today }] = rows<{ today: number }>(await db.execute(sql`SELECT count(*)::int AS today FROM scans WHERE created_at >= ${dayStart(now).toISOString()}::timestamptz`));
  const base = { leftToday: Math.max(0, perDay - today), perDay, resetsAt: nextDay(now).toISOString() };
  if (!metaKey()) {
    return { ok: false, reason: "no_key", message: "This copy has no Meta key, so it can't read new videos. Add MODEL_API_KEY to .env, or try the example.", ...base };
  }
  if ((await spentToday()) >= capUsd) return { ok: false, reason: "spend", message: USED_UP, ...base, leftToday: 0 };
  if (base.leftToday <= 0) return { ok: false, reason: "day", message: USED_UP, ...base };
  const [{ n, oldest }] = rows<{ n: number; oldest: number | null }>(
    await db.execute(sql`
      SELECT count(*)::int AS n, (extract(epoch from min(created_at)) * 1000)::float AS oldest
        FROM scans WHERE client_ip = ${ip} AND created_at > ${new Date(now.getTime() - 3600 * 1000).toISOString()}::timestamptz`),
  );
  if (n >= perHour) {
    const mins = Math.max(1, Math.ceil(((oldest ?? now.getTime()) + 3600 * 1000 - now.getTime()) / 60000));
    return { ok: false, reason: "hour", message: `You've filmed a lot this hour. Try again in about ${mins} min, or try the example.`, ...base };
  }
  return { ok: true, reason: null, message: null, ...base };
}

// Before any upload: the start sheet asks, so nobody films a take that can't be read today.
export function mountLimits(app: Hono) {
  app.get("/api/scans/allowance", async (c) => c.json(await allowance(clientIp(c)), 200, { "Cache-Control": "no-store" }));
}
