// The model a scan works from, for every reader: the studio, the pictures, the layout cards, the quote,
// the book, the permit set and the materials list. Once they confirm the plan, pick a layout or edit
// the design, it's the one saved on the workspace; until then it's seeded from the scan the same way
// every time, finished and coloured by whatever their board reads so far. So every page shows the same
// design.
import { ModelSchema } from "./schema";
import { entranceOf, saidOutside } from "./entrance";
import { emptyMood, recommendedOf, seedModel } from "./seed";
import type { Model, Mood, Opening } from "./types";

type Tape = { egressWidthMm?: number | null; egressHeightMm?: number | null; egressSillMm?: number | null; ceilingMm?: number | null };
type TapedWindow = { id: string; widthMm?: number | null; heightMm?: number | null; sillMm?: number | null };
type StateLike = { model?: unknown; tape?: Tape | null; ideas?: { kind?: "one_bedroom" | "studio" | null; side?: "minX" | "maxX" | "minZ" | "maxZ" | null } | null; permit?: { windows?: TapedWindow[] | null } | null } | null | undefined;

const SEEDED_AT = "2026-10-30T00:00:00.000Z";

// A whole saved model, or null.
export function savedModel(state: StateLike): Model | null {
  const s = ModelSchema.safeParse(state?.model);
  return s.success ? (s.data as Model) : null;
}

// What a board saved before there was a whole model to save it in (POST /api/scans/:id/mood).
function savedMood(state: StateLike): Mood | null {
  const mood = ModelSchema.shape.mood.safeParse((state?.model as { mood?: unknown } | undefined)?.mood);
  return mood.success ? (mood.data as Mood) : null;
}

// Seeding takes about a tenth of a second: the last few are kept, by scan and what changes them.
const cache = new Map<string, Model | null>();
const CACHE_MAX = 40;

export function currentModel(result: unknown, state: StateLike, key?: string): { model: Model; saved: boolean } | null {
  const found = foundModel(result, state, key);
  return found && { ...found, model: withRecommended(withEntrance(withTapedWindows(found.model, state?.permit?.windows), result)) };
}

// The design the guide recommends: kept as it was seeded while that design is still there; a model saved
// before there was one, or without that design any more, gets the first of its own.
function withRecommended(model: Model): Model {
  if (!model.designs.length || (model.recommended && model.designs.some((d) => d.id === model.recommended!.designId))) return model;
  return { ...model, recommended: recommendedOf(model.designs) };
}

// Whether it has its own way in, from the answer as it stands now: they may tell us after the model was
// saved (server/model/entrance.ts).
function withEntrance(model: Model, result: unknown): Model {
  const findings = (result as { findings?: { ruleId?: string; status?: string }[] } | null)?.findings;
  return { ...model, existing: { ...model.existing, entrance: entranceOf(model.existing, saidOutside(findings)) } };
}

// A window they taped on the Permit tab is that size everywhere: the studio's checks, the answer, the
// brief, the quote and the drawings all read it from the model, a saved one too (the tape comes later).
export function withTapedWindows(model: Model, taped: TapedWindow[] | null | undefined): Model {
  const by = new Map((taped ?? []).map((t) => [t.id, t]));
  if (!by.size) return model;
  const size = (o: Opening): Opening => {
    const t = o.kind === "window" ? by.get(o.id) : undefined;
    if (!t) return o;
    return { ...o, ...(t.widthMm ? { widthM: t.widthMm / 1000 } : {}), ...(t.heightMm ? { heightM: t.heightMm / 1000 } : {}), ...(t.sillMm ? { sillM: t.sillMm / 1000 } : {}) };
  };
  return {
    ...model,
    existing: { ...model.existing, openings: model.existing.openings.map(size) },
    designs: model.designs.map((d) => ({ ...d, proposed: { ...d.proposed, openings: d.proposed.openings.map(size) } })),
  };
}

function foundModel(result: unknown, state: StateLike, key?: string): { model: Model; saved: boolean } | null {
  const saved = savedModel(state);
  if (saved) return { model: saved, saved: true };
  if (!result) return null;
  const mood = savedMood(state) ?? emptyMood();
  const said = saidOutside((result as { findings?: { ruleId?: string; status?: string }[] }).findings);
  const k = key ? JSON.stringify([key, state?.tape ?? null, state?.ideas?.kind ?? null, state?.ideas?.side ?? null, mood.finishes, mood.colours ?? null, said]) : null;
  if (k && cache.has(k)) {
    const hit = cache.get(k)!;
    return hit ? { model: { ...hit, mood }, saved: false } : null;
  }
  const model = seedModel(result as Parameters<typeof seedModel>[0], { tape: state?.tape ?? {}, ideas: state?.ideas ?? undefined, mood }, SEEDED_AT);
  if (k) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
    cache.set(k, model);
  }
  return model ? { model, saved: false } : null;
}
