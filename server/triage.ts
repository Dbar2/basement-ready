// Who answers each rule, so the homeowner is only asked what they can know.
//   records:  public data about the address answers it (zoning, services).
//   video:    the scan reads it; when it can't, the designer checks it (never a tape question).
//   standard: work nearly every basement suite needs. Budgeted and stated, not asked.
//   ask:      a plain yes/no the homeowner knows. At most a couple per scan.
// A rule the video already decided, with proof, keeps that answer.
import type { Property } from "./property";

export type Who = "records" | "video" | "standard" | "ask";

export type Option = { label: string; value: boolean | "unsure" };

type Triage = { who: Who; text: string; question?: string; hint?: string };

export const TRIAGE: Record<string, Triage> = {
  zoning_max_units: { who: "records", text: "How many homes the lot can have" },
  zoning_municipal_services: { who: "records", text: "City water and sewer" },
  ceiling_height_suite: { who: "video", text: "Ceiling height: at least 1.95 m once finished." },
  clearance_beams_ducts_suite: { who: "video", text: "Under beams and ducts: at least 1.85 m." },
  egress_window_bedroom_area: { who: "video", text: "A bedroom escape window: an opening of at least 0.35 m², no side under 38 cm." },
  egress_window_min_dimension: { who: "video", text: "A bedroom escape window: an opening of at least 0.35 m², no side under 38 cm." },
  egress_window_well_clearance: { who: "video", text: "If that window opens into a window well, 55 cm of space in front of it." },
  fire_separation_between_units: { who: "standard", text: "A fire-rated ceiling between the two homes, usually new 5/8\" Type X drywall." },
  service_room_separation: { who: "standard", text: "Fire-rated walls and a door around the furnace room." },
  smoke_alarms_interconnected: { who: "standard", text: "Smoke alarms in both homes, wired so they all sound together." },
  co_alarms_interconnected: { who: "standard", text: "Carbon monoxide alarms near the bedrooms, linked together, when anything burns gas." },
  hvac_separate_systems: { who: "standard", text: "Heating set up so smoke can't travel between the homes: a separate system or a smoke detector in the ducts." },
  electrical_esa_permit: { who: "standard", text: "Electrical work by a licensed electrician, with an ESA permit." },
  exit_from_suite: {
    who: "ask",
    text: "A safe way out of the basement home",
    question: "Is there a door from the basement straight outside?",
    hint: "A side door or walk-out that opens to the yard. Not the stairs up to the main floor.",
  },
  plumbing_fixtures_and_shutoff: {
    who: "ask",
    text: "A bathroom and kitchen for the basement home",
    question: "Is there a bathroom down there, or capped pipes for one?",
    hint: "Capped pipes sticking out of the floor are called a rough-in. They make a bathroom much cheaper.",
  },
};

export const ASK_OPTIONS: Option[] = [
  { label: "Yes", value: true },
  { label: "No", value: false },
  { label: "Not sure", value: "unsure" },
];

const URBAN = new Set(["waterloo-on", "kitchener-on", "cambridge-on"]);

type Check = { operator: string; value: unknown; unit: string | null };

// What public records answer, with the sentence that says so.
export function fromRecords(ruleId: string, check: Check, p: Property | null | undefined): { value: number | boolean; why: string } | null {
  if (!p?.zone || p.residential !== true) return null;
  const zone = `${p.zone.code}${p.zone.label && p.zone.label.toUpperCase() !== p.zone.code.toUpperCase() ? ` (${p.zone.label.toLowerCase()})` : ""}`;
  if (ruleId === "zoning_max_units" && typeof check.value === "number") {
    const now = Math.max(1, p.unitsRegistered);
    const after = now + 1;
    return {
      value: after,
      why: `Public records: your lot is zoned ${zone} with ${now === 1 ? "one home" : `${now} homes`} today. This suite makes ${after}; up to ${check.value} are allowed.`,
    };
  }
  if (ruleId === "zoning_municipal_services" && p.city && URBAN.has(p.city)) {
    return { value: true, why: `Homes in ${p.municipality}'s residential zones like ${zone} are on City water and sewer.` };
  }
  return null;
}
