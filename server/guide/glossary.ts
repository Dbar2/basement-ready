// The words the guide uses that a homeowner may not know, each with a plain answer, the drawing that
// explains it (src/guide/visuals/explain) and where the rule comes from. "What's a fire separation?" is
// answered here, from the rules pack, without a model; anything the glossary can't answer goes to Muse
// Spark (server/guide/ask.ts).
import type { Pack } from "../rules";
import type { Choice, GlossaryTerm } from "../../src/guide/types";

export type Entry = {
  term: GlossaryTerm;
  name: string; // as it reads in "What's a …?"
  text: string;
  rules: string[]; // the pack's rules it sums up: their sources go under the answer
  grant?: string; // or the program it describes
  more?: Choice[]; // the next question someone usually has
  words: RegExp;
};

export const GLOSSARY: Entry[] = [
  {
    term: "fire_separation",
    name: "fire separation",
    text: "Walls and a ceiling that hold fire and smoke back from the other home for 45 minutes. In most basements that means 15.9 mm (5/8 in.) Type X drywall under the ceiling joists and on both sides of the walls between the homes, around the stairs and the furnace room too. A drywaller does it in a few days.",
    rules: ["fire_separation_between_units", "service_room_separation"],
    more: [{ label: "Can I do it myself?", action: { type: "ask", text: "Can I do the fire separation myself?" } }],
    words: /fire[\s-]*(separation|separated|rated|rating|wall|drywall|barrier)|type[\s-]*x|firewall/i,
  },
  {
    term: "egress_window",
    name: "escape window",
    text: "A bedroom window big enough to climb out of in a fire. It opens from inside without tools and gives a clear opening of at least 0.35 m², with no side under 380 mm. If it opens into a window well, 550 mm stays clear in front of it.",
    rules: ["egress_window_bedroom_area", "egress_window_min_dimension", "egress_window_well_clearance"],
    more: [{ label: "Is my window big enough?", action: { type: "ask", text: "Is my window big enough to be an escape window?" } }],
    words: /egress|escape[\s-]*window|bedroom[\s-]*window|window[\s-]*well/i,
  },
  {
    term: "ceiling_height",
    name: "ceiling height rule",
    text: "The finished ceiling in the suite needs to be at least 1.95 m high, and at least 1.85 m under beams and ducts. It's measured after the drywall goes up.",
    rules: ["ceiling_height_suite", "clearance_beams_ducts_suite"],
    words: /ceiling[\s-]*height|head[\s-]*room|how (high|tall)|low ceiling|1\.95|1\.85/i,
  },
  {
    term: "separate_entrance",
    name: "separate entrance",
    text: "A way out for the basement home in a fire. Best is its own door to the outside. A shared exit works if it's separated from the rest of the house and both homes have alarms that sound together.",
    rules: ["exit_from_suite"],
    words: /separate[\s-]*(entrance|entry|door|exit)|own[\s-]*(entrance|door)|side[\s-]*door|second[\s-]*exit|way out/i,
  },
  {
    term: "smoke_co_alarms",
    name: "linked alarms",
    text: "Smoke alarms on every floor and in every bedroom, wired (or wirelessly linked) so one sounds them all in both homes. With a gas furnace or water heater, carbon monoxide alarms by the bedrooms too, linked the same way.",
    rules: ["smoke_alarms_interconnected", "co_alarms_interconnected"],
    words: /smoke[\s-]*alarm|carbon[\s-]*monoxide|\bco[\s-]*alarm|interconnect|linked alarm/i,
  },
  {
    term: "permit_set",
    name: "permit set",
    text: "What you hand the City for a building permit: the floor plans, a section, the window and wall sizes, and the City's forms. I draw it and fill it from your scan; you check a few numbers with a tape.",
    rules: [],
    words: /permit[\s-]*(set|package|drawings|forms)|building permit|what do i (hand|submit|give)/i,
  },
  {
    term: "hired_out",
    name: "hired-out price",
    text: "What it costs if contractors do all of it, labour and materials, as a rough range. Doing parts yourself costs less, and a contractor's own quote is the real number.",
    rules: [],
    words: /hired[\s-]*out|all[\s-]*in|contractor('s)? price|rough (cost|price|range)/i,
  },
  {
    term: "tax_credit",
    name: "tax credit",
    text: "The Multigenerational Home Renovation Tax Credit: when a senior (65 or older) or an adult with a disability lives in the suite with family, you get back 14% of up to $50,000 of the cost, so up to $7,000, with your tax return.",
    rules: [],
    grant: "federal_mhrtc",
    words: /tax[\s-]*credit|mhrtc|multigenerational|money back/i,
  },
];

export const entryFor = (term: GlossaryTerm) => GLOSSARY.find((e) => e.term === term) ?? null;

// A question that only asks what a word means: "what's a fire separation?", "fire separation?", "egress?".
// "Can I do the fire separation myself?" isn't one: that goes to Spark.
const DEFINING = /^\s*(what('?s| is| are| does)|whats|define|explain|meaning of|what do you mean by|tell me about)\b/i;

export function matchTerm(text: string): GlossaryTerm | null {
  const t = text.trim();
  if (!t) return null;
  const words = t.split(/\s+/).length;
  const asking = DEFINING.test(t) || (words <= 4 && !/^(can|do|does|is|how|why|should|will)\b/i.test(t));
  if (!asking) return null;
  return GLOSSARY.find((e) => e.words.test(t))?.term ?? null;
}

// Where an answer comes from, one link per document with its sections after it:
// "[2024 Building Code Compendium (MMAH), Division B](https://…), 9.10.9.16.(1); 9.10.10.4.(1)".
export function cite(sources: { title: string; url: string; section?: string }[]): string[] {
  const docs = new Map<string, { title: string; sections: string[] }>();
  for (const s of sources) {
    const d = docs.get(s.url) ?? { title: s.title, sections: [] };
    if (s.section && !d.sections.includes(s.section)) d.sections.push(s.section);
    docs.set(s.url, d);
  }
  return [...docs].map(([url, d]) => `[${d.title}](${url})${d.sections.length ? `, ${d.sections.join("; ")}` : ""}`);
}

// The pack's sources for the rules a glossary entry sums up, or the program it describes.
export function sourcesFor(entry: Entry, pack: Pack | null): string[] {
  if (!pack) return [];
  const rules = entry.rules.flatMap((id) => pack.rules.find((r) => r.id === id)?.source ?? []);
  const g = entry.grant ? pack.grants.find((x: { id: string }) => x.id === entry.grant) : null;
  return cite([...rules, ...(g?.source?.url ? [{ title: g.name, url: g.source.url }] : [])]);
}
