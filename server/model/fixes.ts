// The fixes a design brings to the basement's list. The answer (server/priced.ts) adds them to the rules'
// fixes, and the layout cards and the studio count the same list in the browser, so "after 2 fixes" and
// a card's "2 fixes" are one number. A design brings: a new escape window it puts in a bedroom (or one
// its sleeping place still needs), and every check it still fails. One fix per category, as the rules'
// fixes are grouped (server/assess.ts verdictFrom): a category the rules already list isn't added again.
import { checkDesign, openingsOn } from "./checks";
import type { Design, Existing } from "./types";

// The category each check's rule has in the rules packs (data/rules/*.json; tests/unit/one-quote.test.ts
// holds every pack to it).
export const CHECK_CATEGORY: Record<string, string> = {
  ceiling_height_suite: "height",
  clearance_beams_ducts_suite: "height",
  co_alarms_interconnected: "fire",
  egress_window_bedroom_area: "egress",
  exit_from_suite: "exit",
  fire_separation_between_units: "fire",
  min_room_sizes: "size",
  plumbing_fixtures_and_shutoff: "plumbing",
  service_room_separation: "fire",
  smoke_alarms_interconnected: "fire",
  stair_width: "exit",
};

export type DesignFix = { category: string; ruleId: string | null; title: string; why: string[]; priced: boolean };

export function designFixes(design: Design, existing: Existing): DesignFix[] {
  const checks = checkDesign(design, existing);
  const out: DesignFix[] = [];
  const bedrooms = design.proposed.rooms.filter((r) => r.kind === "bedroom" && r.unit === 2);
  const failingEscape = checks.filter((c) => c.id.startsWith("escape:") && c.ok === false);
  const added = bedrooms.some((b) => openingsOn(b, design, "window").some((o) => o.status === "new"));
  if (added || failingEscape.length)
    out.push({
      category: "egress",
      ruleId: "egress_window_bedroom_area",
      title: "Bedroom escape window",
      why: failingEscape.length
        ? failingEscape.map((c) => `In your design (${design.name}): ${c.detail}`)
        : [`In your design (${design.name}), the bedroom has no window to climb out of, so it gets a new escape window in its outside wall.`],
      // Priced from the quote's own lines when the design has the window; not while it still needs one.
      priced: !failingEscape.length,
    });
  for (const c of checks) {
    if (c.ok !== false || c.id.startsWith("escape:")) continue;
    const category = c.ruleId ? (CHECK_CATEGORY[c.ruleId] ?? c.ruleId) : c.id.split(":")[0];
    if (out.some((f) => f.category === category)) continue;
    out.push({ category, ruleId: c.ruleId ?? null, title: c.label, why: [`In your design (${design.name}): ${c.detail}`], priced: false });
  }
  return out;
}

// "2 fixes", as the headline counts them.
export const fixesWord = (n: number) => (n ? `${n} fix${n === 1 ? "" : "es"}` : "no fixes");

// How many fixes the answer lists with this design: the basement's own (the rules', `base`), and the
// design's in any category those don't cover.
export function fixCount(base: { category: string }[], design: Design, existing: Existing) {
  const have = new Set(base.map((g) => g.category));
  return base.length + designFixes(design, existing).filter((f) => !have.has(f.category)).length;
}
