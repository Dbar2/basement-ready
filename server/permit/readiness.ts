// "N things left before you can submit": every number only a tape can give, the owner's details, the
// bedrooms upstairs, how far a wall with a new window is from the lot line, each sheet looked over,
// and a designer where one is needed. The submit copy is offered only once nothing is left. Pure, so
// the Permit tab can show the same list the PDF prints.

export type ReadyGroup = "design" | "tape" | "windows" | "owner" | "upstairs" | "lot" | "designer" | "review";
export type ReadyItem = { id: string; group: ReadyGroup; label: string; detail: string; done: boolean };
export type Readiness = { left: number; items: ReadyItem[] };

export type ReadinessInput = {
  mainWalls: { id: string; label: string; scanM: number; tapedM: number | null }[];
  windows: { id: string; tag: string; room: string; change: "keep" | "enlarge" | "new"; taped: boolean; escape: boolean }[];
  heights: { ceilingMm: number | null; beamMm: number | null; overhead: boolean };
  profile: { owners: { first: string; last: string }[]; phone: string; email: string; postalCode?: string | null } | null;
  upstairs: { bedrooms: unknown[]; none?: boolean | null } | null;
  lotLines: { id: string; mm?: number | null }[];
  sheets: { number: string; title: string }[];
  reviewed: { sheet: string; key: string }[];
  reviewKey: string;
  designer: { needed: boolean; chosen: boolean; reasons: string[]; name: string | null; bcin: string | null };
  // The design's own checks that fail (a bedroom too small, no escape window): fixed in the design.
  checks: { id: string; label: string; detail: string; ok: boolean | null }[];
};

const filled = (s: string | null | undefined) => Boolean(s && s.trim());

export function readiness(i: ReadinessInput): Readiness {
  const items: ReadyItem[] = [];
  for (const c of i.checks) if (c.ok === false) items.push({ id: `check:${c.id}`, group: "design", label: c.label, detail: c.detail, done: false });
  for (const w of i.mainWalls)
    items.push({ id: `wall:${w.id}`, group: "tape", label: `Tape the ${w.label.toLowerCase()}`, detail: `The video says about ${w.scanM.toFixed(2)} m. Wall face to wall face, at the floor.`, done: w.tapedM != null });
  items.push({
    id: "heights",
    group: "tape",
    label: i.heights.overhead ? "Tape the ceiling and the lowest beam or duct" : "Tape the ceiling height",
    detail: "Floor to the underside of the joists, and floor to the bottom of the lowest beam or duct.",
    done: i.heights.ceilingMm != null && (!i.heights.overhead || i.heights.beamMm != null),
  });
  for (const w of i.windows) {
    if (w.change === "new") continue;
    items.push({ id: `window:${w.id}`, group: "windows", label: `Window ${w.tag}${w.room ? ` (${w.room.toLowerCase()})` : ""}: width, height and sill`, detail: "The opening that opens, not the frame, and floor to the bottom of the opening.", done: w.taped });
  }
  const p = i.profile;
  items.push({ id: "owner", group: "owner", label: "Owner details", detail: "Names, phone, email and postal code, for the forms.", done: Boolean(p && p.owners.some((o) => filled(o.first) && filled(o.last)) && filled(p.phone) && filled(p.email) && filled(p.postalCode)) });
  items.push({ id: "upstairs", group: "upstairs", label: "Mark the bedrooms upstairs", detail: "Tap where each bedroom is in unit 1, so its alarms go on the plan.", done: Boolean(i.upstairs && (i.upstairs.bedrooms.length > 0 || i.upstairs.none)) });
  for (const w of i.windows.filter((x) => x.change !== "keep")) {
    const d = i.lotLines.find((l) => l.id === w.id);
    items.push({ id: `lot:${w.id}`, group: "lot", label: `Distance from window ${w.tag}'s wall to the lot line`, detail: "From the house wall straight out to the property line. Your survey shows it.", done: d?.mm != null });
  }
  if (i.designer.needed || i.designer.chosen)
    items.push({
      id: "designer",
      group: "designer",
      label: i.designer.needed ? "Choose a BCIN designer" : "Add your designer's details",
      detail: i.designer.needed ? i.designer.reasons.join(" ") : "Their name and BCIN go in every sheet's statement box.",
      done: i.designer.chosen && filled(i.designer.name) && filled(i.designer.bcin),
    });
  for (const s of i.sheets) items.push({ id: `sheet:${s.number}`, group: "review", label: `Look over ${s.number}: ${s.title}`, detail: "Check it matches your basement.", done: i.reviewed.some((r) => r.sheet === s.number && r.key === i.reviewKey) });
  return { left: items.filter((x) => !x.done).length, items };
}

// A short fingerprint of what the drawings show, so a sheet looked over goes back on the list when
// what it draws changes. FNV-1a, 32 bits.
export function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
