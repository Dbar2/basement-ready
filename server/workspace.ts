// The homeowner's workspace for one basement: an owner profile asked once and reused (names, phone,
// email, the lot's legal description and PIN where the parcel data has them), and what they do after
// the answer: trace the entrances and parking on the aerial photo, tape the egress window, pick a
// layout and a look, line up the people who'll build it and track their quotes.
// Who may read or change it: the signed-in owner, or this browser's claim token while it's unclaimed.
import { and, desc, eq, isNotNull, ne } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db, schema } from "./db";
import { ModelSchema } from "./model/schema";

const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullable().optional();

export const ProfileSchema = z.object({
  owners: z.array(z.object({ first: text(60), last: text(60) })).min(1).max(3),
  phone: text(30),
  email: text(120),
  postalCode: optText(10),
  mailingAddress: optText(200), // when they don't live at the house
  legalDescription: optText(300),
  pin: optText(20),
  rollNumber: optText(30),
});
export type Profile = z.infer<typeof ProfileSchema>;

const point = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]);
const mm = z.number().min(0).max(5000).nullable().optional();
const longMm = z.number().min(0).max(200_000).nullable().optional();

// What the permit set needs that only the owner can give: tape numbers for the main walls and each
// window, how far a wall with a new window is from the lot line, where the bedrooms are upstairs,
// which sheets they've looked over, and a designer's details when one signs the drawings.
const PermitSchema = z.object({
  submittedAt: optText(30),
  permitNumber: optText(40),
  signer: z.enum(["owner", "designer"]).nullable().optional(),
  walls: z.array(z.object({ id: text(60), mm: longMm })).max(20).optional(),
  windows: z.array(z.object({ id: text(60), widthMm: mm, heightMm: mm, sillMm: mm })).max(20).optional(),
  lotLines: z.array(z.object({ id: text(60), mm: longMm })).max(20).optional(),
  upstairs: z.object({ bedrooms: z.array(z.object({ floor: z.number().int().min(1).max(3), at: point })).max(12), none: z.boolean().nullable().optional() }).optional(),
  reviewed: z.array(z.object({ sheet: text(12), key: text(40) })).max(40).optional(),
  designer: z.object({ name: optText(100), bcin: optText(12), firm: optText(120), firmBcin: optText(12), email: optText(120), phone: optText(30) }).optional(),
  // Kitchener: how the two units' water is metered, and where the meter is (Building Bulletin BB 2026-04).
  waterMeter: z.object({ option: z.enum(["single", "room", "compartment"]).nullable().optional(), where: optText(160) }).optional(),
});

// Each section is replaced whole when the client saves it.
export const StateSchema = z.object({
  site: z
    .object({
      features: z.array(z.object({ kind: z.enum(["entrance", "parking", "walkway"]), points: z.array(point).min(1).max(40), label: optText(40) })).max(20),
    })
    .optional(),
  tape: z
    .object({ egressWidthMm: mm, egressHeightMm: mm, egressSillMm: mm, ceilingMm: mm, beamMm: mm })
    .optional(),
  ideas: z
    .object({
      kind: z.enum(["one_bedroom", "studio"]).nullable().optional(),
      side: z.enum(["minX", "maxX", "minZ", "maxZ"]).nullable().optional(),
      finish: z.enum(["light", "warm", "deep"]).nullable().optional(),
      favourites: z.array(z.object({ source: z.enum(["concept", "look"]), n: z.number().int().min(1).max(8), style: optText(40), title: text(80) })).max(12).optional(),
    })
    .optional(),
  build: z
    .object({
      path: z.enum(["hire", "diy", "mix"]).nullable().optional(),
      pros: z
        .array(
          z.object({
            id: text(40),
            role: z.enum(["designer", "general", "electrician", "plumber", "gas", "hvac", "engineer", "other"]),
            name: text(100),
            email: optText(120),
            phone: optText(30),
            registryId: optText(40), // BCIN, ESA licence or TSSA registration, as the registry shows it
            wsib: z.boolean().nullable().optional(),
            insured: z.boolean().nullable().optional(),
            requestedAt: optText(30),
            quoteCAD: z.number().min(0).max(5_000_000).nullable().optional(),
            quoteAt: optText(30),
            note: optText(300),
          }),
        )
        .max(30)
        .optional(),
    })
    .optional(),
  apply: z.record(z.string().max(80), z.object({ sentAt: optText(30) })).optional(),
  permit: PermitSchema.optional(),
  // The one model of the basement and its designs (server/model/types.ts), saved by the studio.
  model: ModelSchema.optional(),
  // The step of the flow they were last on (src/flow/flow.ts), so coming back lands there.
  flow: z.object({ step: z.enum(["style", "plan", "layouts", "studio", "pictures", "book"]), at: optText(30) }).optional(),
});
export type WorkspaceState = z.infer<typeof StateSchema>;

// Written by the server only: the "Try this look" photos.
export type Look = { style: string; status: "pending" | "done" | "failed"; items: { n: number; frame: number; title: string; kept: boolean; checked: string }[]; at: string };
export type StoredState = WorkspaceState & { looks?: Record<string, Look> };

export type Workspace = { profile: Profile | null; state: StoredState };

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

// The browser's claims ride in a header as JSON: [{ basementId, claimToken }].
export function parseClaims(header: string | undefined): { basementId: string; claimToken: string }[] {
  if (!header) return [];
  try {
    const all = JSON.parse(decodeURIComponent(header));
    return Array.isArray(all) ? all.filter((c) => typeof c?.basementId === "string" && typeof c?.claimToken === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

// The basement behind a scan, if this caller may open its workspace.
// `admin`: an admin reading (server/privacy.ts), who may open any scan but changes nothing.
export async function basementFor(scanId: string, access: { userId: string | null; claims: { basementId: string; claimToken: string }[]; admin?: boolean }) {
  const [row] = await db
    .select({ basement: schema.basements, result: schema.scans.result })
    .from(schema.scans)
    .innerJoin(schema.basements, eq(schema.scans.basementId, schema.basements.id))
    .where(eq(schema.scans.id, scanId));
  if (!row) return { basement: null, result: null, allowed: false };
  const b = row.basement;
  const owner = Boolean(access.userId && b.ownerId === access.userId);
  const claimed = !b.ownerId && access.claims.some((c) => c.basementId === b.id && sameToken(c.claimToken, b.claimToken));
  return { basement: b, result: row.result as any, allowed: owner || claimed || Boolean(access.admin) };
}

export async function loadWorkspace(basementId: string): Promise<Workspace> {
  const [w] = await db.select().from(schema.workspaces).where(eq(schema.workspaces.basementId, basementId));
  return { profile: (w?.profile as Profile | null) ?? null, state: (w?.state as StoredState | null) ?? {} };
}

// The profile from the owner's other basements, so it's asked once per person, not per house.
export async function profileFromOtherBasements(userId: string | null, basementId: string): Promise<Profile | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ profile: schema.workspaces.profile })
    .from(schema.workspaces)
    .innerJoin(schema.basements, eq(schema.workspaces.basementId, schema.basements.id))
    .where(and(eq(schema.basements.ownerId, userId), ne(schema.basements.id, basementId), isNotNull(schema.workspaces.profile)))
    .orderBy(desc(schema.workspaces.updatedAt))
    .limit(1);
  if (!row?.profile) return null;
  // The lot's own numbers belong to the other house.
  const { legalDescription: _l, pin: _p, rollNumber: _r, ...person } = row.profile as Profile;
  return { ...person, legalDescription: null, pin: null, rollNumber: null };
}

export async function saveWorkspace(basementId: string, patch: { profile?: Profile | null; state?: Partial<StoredState> }) {
  const current = await loadWorkspace(basementId);
  const profile = patch.profile === undefined ? current.profile : patch.profile;
  const state = { ...current.state, ...(patch.state ?? {}) };
  await db
    .insert(schema.workspaces)
    .values({ basementId, profile, state })
    .onConflictDoUpdate({ target: schema.workspaces.basementId, set: { profile, state, updatedAt: new Date() } });
  return { profile, state } as Workspace;
}

// A client's save: only the sections it may write, validated. `looks` stays server-only.
export function cleanPatch(body: unknown): { profile?: Profile | null; state?: WorkspaceState } | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: { profile?: Profile | null; state?: WorkspaceState } = {};
  if ("profile" in b) {
    if (b.profile === null) out.profile = null;
    else {
      const p = ProfileSchema.safeParse(b.profile);
      if (!p.success) return { error: "Check the names, phone and email." };
      out.profile = p.data;
    }
  }
  if ("state" in b) {
    const s = StateSchema.safeParse(b.state ?? {});
    if (!s.success) return { error: "That didn't save. Try again." };
    out.state = s.data;
  }
  return out;
}

// What the workspace holds, for ticking off the documents each application asks for.
export type Holdings = {
  profile: boolean;
  legalDescription: boolean;
  drawings: boolean; // the permit package can be made
  quotesWsib: number; // quotes in hand from WSIB-covered contractors
  materialsList: boolean;
  bedrooms: boolean;
};
