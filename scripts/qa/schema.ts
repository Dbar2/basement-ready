// What the reviewer returns, and what the report and other sessions read. The model's answer is held
// to a JSON schema (structured outputs) and checked again here with zod.
import { z } from "zod";

export const SEVERITIES = ["P0", "P1", "P2"] as const;
export const CATEGORIES = ["correctness", "polish", "brand", "credibility", "copy"] as const;

export const SEVERITY_MEANING: Record<(typeof SEVERITIES)[number], string> = {
  P0: "Broken, wrong or misleading: a judge would stop trusting the product (blank or crashed view, wrong numbers, impossible geometry, a promise we can't make).",
  P1: "Clearly noticeable: a judge would notice it in the demo (overlap, cut-off text, off-brand colour, numbers that disagree, fake-looking picture).",
  P2: "Polish: small spacing, alignment or wording issues a careful designer would fix.",
};

const Box = z.object({ x: z.number().int(), y: z.number().int(), w: z.number().int(), h: z.number().int() }).strict();

// One finding as the model writes it. `image` is the 1-based number of the image it is about; the box is
// in that image's pixels (the whole image when it isn't about one spot).
export const ModelFinding = z
  .object({
    severity: z.enum(SEVERITIES),
    category: z.enum(CATEGORIES),
    title: z.string(),
    what: z.string(),
    where: z.string(),
    fix: z.string(),
    image: z.number().int(),
    box: Box,
  })
  .strict();

export const ScreenReview = z
  .object({
    summary: z.string(),
    verdict: z.enum(["pass", "fail"]),
    findings: z.array(ModelFinding),
  })
  .strict();

// The cross-screen pass reads text, not images: each finding names the screens that disagree.
export const ConsistencyFinding = z
  .object({
    severity: z.enum(SEVERITIES),
    title: z.string(),
    what: z.string(),
    screens: z.array(z.string()),
    fix: z.string(),
  })
  .strict();

export const ConsistencyReview = z.object({ summary: z.string(), findings: z.array(ConsistencyFinding) }).strict();

export type ModelFinding = z.infer<typeof ModelFinding>;
export type ScreenReview = z.infer<typeof ScreenReview>;
export type ConsistencyReview = z.infer<typeof ConsistencyReview>;

// JSON schema for output_config.format: every object closed, every field required, and none of the
// numeric or length limits structured outputs leaves out (zod adds safe-integer bounds to every int).
const UNSUPPORTED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "pattern", "format"];
export function jsonSchema(t: z.ZodType): Record<string, unknown> {
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(strip);
    if (!v || typeof v !== "object") return v;
    return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$schema" && !UNSUPPORTED.includes(k)).map(([k, x]) => [k, strip(x)]));
  };
  return strip(z.toJSONSchema(t, { target: "draft-7" })) as Record<string, unknown>;
}

// A finding as the report and findings.json carry it.
export const Finding = z.object({
  id: z.string(),
  source: z.enum(["opus", "auto", "consistency", "notes"]),
  screen: z.string(),
  shot: z.string().nullable(), // the screenshot it's on, when it's on one
  shots: z.array(z.string()), // every screenshot it concerns
  browser: z.string().nullable(),
  viewport: z.string().nullable(),
  severity: z.enum(SEVERITIES),
  category: z.enum(CATEGORIES),
  title: z.string(),
  what: z.string(),
  where: z.string(),
  fix: z.string(),
  box: Box.nullable(), // in the screenshot's pixels
  crop: z.string().nullable(), // relative path of the cropped region
  screenshot: z.string().nullable(),
  cached: z.boolean(),
});
export type Finding = z.infer<typeof Finding>;

export const ScreenStatus = z.object({
  screen: z.string(),
  title: z.string(),
  status: z.enum(["pass", "fail", "not reviewed"]),
  summary: z.string(),
  counts: z.object({ P0: z.number(), P1: z.number(), P2: z.number() }),
  shots: z.array(z.string()),
  reviewed: z.enum(["opus", "cached", "notes", "skipped (budget)", "skipped (no key)", "skipped (error)", "auto only"]),
});
export type ScreenStatus = z.infer<typeof ScreenStatus>;

export const Report = z.object({
  run: z.string(),
  createdAt: z.string(),
  commit: z.string().nullable(),
  baseURL: z.string(),
  scans: z.array(z.string()),
  mode: z.enum(["review", "capture only"]),
  reviewer: z.string().nullable(),
  model: z.string(),
  budgetUsd: z.number(),
  costUsd: z.number(),
  calls: z.object({ made: z.number(), cached: z.number(), skipped: z.number() }),
  screens: z.array(ScreenStatus),
  findings: z.array(Finding),
  shots: z.array(z.object({ id: z.string(), screen: z.string(), file: z.string(), browser: z.string(), viewport: z.string(), camera: z.string().nullable(), notes: z.array(z.string()) })),
});
export type Report = z.infer<typeof Report>;

// Findings written by hand (or by a Claude Code session reading the shots when there's no API key),
// merged with --notes <file>. Boxes are in the shot's pixels.
export const Notes = z.object({
  reviewer: z.string(),
  reviewed: z.record(z.string(), z.string()), // screen id → one-line summary
  findings: z.array(
    z.object({
      screen: z.string(),
      shot: z.string().nullable(),
      severity: z.enum(SEVERITIES),
      category: z.enum(CATEGORIES),
      title: z.string(),
      what: z.string(),
      where: z.string(),
      fix: z.string(),
      box: Box.nullable(),
    }),
  ),
});
export type Notes = z.infer<typeof Notes>;

const RANK = { P0: 0, P1: 1, P2: 2 } as const;
const CAT_RANK = { correctness: 0, credibility: 1, copy: 2, brand: 3, polish: 4 } as const;
const SOURCE_RANK = { opus: 0, consistency: 0, notes: 0, auto: 1 } as const;

// Most severe first; then what's wrong before how it looks; then the model's word before the free checks.
export function rank(a: Finding, b: Finding) {
  return RANK[a.severity] - RANK[b.severity] || CAT_RANK[a.category] - CAT_RANK[b.category] || SOURCE_RANK[a.source] - SOURCE_RANK[b.source] || a.screen.localeCompare(b.screen);
}
