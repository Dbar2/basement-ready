// Database schema. Postgres in production (Railway), embedded PGlite in development and tests.
import { sql } from "drizzle-orm";
import { doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id
  email: text("email"),
  role: text("role").notNull().default("homeowner"), // homeowner | pro | admin
  createdAt: createdAt(),
});

// One homeowner's basement. Scans, answers and briefs hang off it.
export const basements = pgTable(
  "basements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id").references(() => users.id, { onDelete: "cascade" }),
    // Lets an anonymous visitor claim the basement after signing up. Kept only in their browser.
    claimToken: text("claim_token").notNull(),
    address: text("address").notNull().default(""),
    municipality: text("municipality").notNull().default("waterloo-on"),
    household: text("household").notNull().default("unsure"), // relative | renter | unsure
    // What public data says about the house (server/property.ts): zoning, lot, building, units.
    property: jsonb("property"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("basements_owner_idx").on(t.ownerId)],
);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    basementId: uuid("basement_id").notNull().references(() => basements.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("queued"), // queued | running | done | error
    videoKey: text("video_key"),
    frameCount: integer("frame_count"),
    transcript: text("transcript"),
    result: jsonb("result"),
    error: text("error"),
    costUsd: doublePrecision("cost_usd").notNull().default(0),
    // What the homeowner measured themselves, e.g. { floorToJoistsM: 2.1 }. Sets the 3D scan's scale.
    inputs: jsonb("inputs"),
    clientIp: text("client_ip"),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [index("scans_basement_idx").on(t.basementId), index("scans_created_idx").on(t.createdAt)],
);

// The live log the scan screen streams. Kept so a refresh replays the whole scan.
export const scanEvents = pgTable(
  "scan_events",
  {
    id: serial("id").primaryKey(),
    scanId: uuid("scan_id").notNull().references(() => scans.id, { onDelete: "cascade" }),
    at: doublePrecision("at").notNull(),
    type: text("type").notNull(), // log | find | stage | done | error
    text: text("text").notNull(),
    data: jsonb("data"),
    createdAt: createdAt(),
  },
  (t) => [index("scan_events_scan_idx").on(t.scanId, t.id)],
);

// What the homeowner told us or measured, per rule. Re-checks read these.
export const answers = pgTable(
  "answers",
  {
    id: serial("id").primaryKey(),
    basementId: uuid("basement_id").notNull().references(() => basements.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    value: jsonb("value").notNull(),
    source: text("source").notNull().default("user"), // user | measured
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("answers_basement_rule_idx").on(t.basementId, t.ruleId)],
);

// The homeowner's workspace for a basement (server/workspace.ts): the owner profile, asked once,
// and what they've done since: site tracing, tape numbers, ideas, quotes, applications sent.
export const workspaces = pgTable("workspaces", {
  basementId: uuid("basement_id")
    .primaryKey()
    .references(() => basements.id, { onDelete: "cascade" }),
  profile: jsonb("profile"),
  state: jsonb("state").notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// Durable job queue: workers claim rows with FOR UPDATE SKIP LOCKED.
export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("queued"), // queued | running | done | failed
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(2),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("jobs_ready_idx").on(t.status, t.runAfter).where(sql`status = 'queued'`)],
);
