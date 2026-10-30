// The model a scan works from, for every reader: the studio, the pictures, the layout cards, the quote,
// the book, the permit set and the materials list. Once they confirm the plan, pick a layout or edit
// the design, it's the one saved on the workspace; until then it's seeded from the scan the same way
// every time, finished and coloured by whatever their board reads so far. So every page shows the same
// design.
import { ModelSchema } from "./schema";
import { emptyMood, seedModel } from "./seed";
import type { Model, Mood } from "./types";

type Tape = { egressWidthMm?: number | null; egressHeightMm?: number | null; egressSillMm?: number | null; ceilingMm?: number | null };
type StateLike = { model?: unknown; tape?: Tape | null; ideas?: { kind?: "one_bedroom" | "studio" | null; side?: "minX" | "maxX" | "minZ" | "maxZ" | null } | null } | null | undefined;

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
  const saved = savedModel(state);
  if (saved) return { model: saved, saved: true };
  if (!result) return null;
  const mood = savedMood(state) ?? emptyMood();
  const k = key ? JSON.stringify([key, state?.tape ?? null, state?.ideas?.kind ?? null, state?.ideas?.side ?? null, mood.finishes, mood.colours ?? null]) : null;
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
