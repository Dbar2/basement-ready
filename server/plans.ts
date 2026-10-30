// "What would you like it to be?", asked once on the wait screen (it used to interrupt filming). The
// answer is a choice or the homeowner's own words. It settles who it's for when the start sheet
// couldn't, gives the result its one-line wish, and tells the photos what to show.
import type { Household } from "./rules";

export const PLANS_ID = "plans";
export type PlansChoice = "family_suite" | "rental" | "rec_room" | "unsure";
const CHOICES: PlansChoice[] = ["family_suite", "rental", "rec_room", "unsure"];
const MAX_WORDS = 160;

// Who it's for is already known from the start sheet, so the suite option says it back instead of
// asking it again; only a "Not sure" start offers both.
export function plansOptions(household: Household): { label: string; value: PlansChoice }[] {
  const suites: { label: string; value: PlansChoice }[] =
    household === "relative"
      ? [{ label: "A suite for family", value: "family_suite" }]
      : household === "renter"
        ? [{ label: "A rental suite", value: "rental" }]
        : [
            { label: "A suite for a parent", value: "family_suite" },
            { label: "A rental", value: "rental" },
          ];
  return [...suites, { label: "A rec room", value: "rec_room" }, { label: "Not sure yet", value: "unsure" }];
}

export function plansQuestion(household: Household) {
  return { id: PLANS_ID, question: "What would you like it to be?", hint: "Pick one, or say it in your own words. The photos follow it.", options: plansOptions(household) };
}

// One of the choices, or their own words, trimmed. Anything else is refused.
export function cleanPlans(v: unknown): string | null {
  if (typeof v !== "string") return null;
  if ((CHOICES as string[]).includes(v)) return v;
  const words = v.replace(/\s+/g, " ").trim().slice(0, MAX_WORDS);
  return words.length >= 2 ? words : null;
}

const choiceOf = (plans: string | null | undefined): PlansChoice | "words" | null =>
  plans == null ? null : (CHOICES as string[]).includes(plans) ? (plans as PlansChoice) : "words";

// A suite for family or a rental, picked after a "Not sure" start, settles who it's for.
export function plansHousehold(plans: string | null | undefined, household: Household): Household {
  if (household !== "unsure") return household;
  const c = choiceOf(plans);
  return c === "family_suite" ? "relative" : c === "rental" ? "renter" : household;
}

// The wish in one line, for a result whose video had no talking.
export function plansWords(plans: string | null | undefined): string {
  const c = choiceOf(plans);
  if (c === "family_suite") return "A suite for family.";
  if (c === "rental") return "A rental suite.";
  if (c === "rec_room") return "A rec room.";
  if (c === "words") return plans!;
  return "";
}

// What each photo should show. The frames are picked the same way; only the rooms change.
export type PhotoSpaces = { bedroom: { title: string; space: string }; living: { title: string; space: string }; note: string };

export function photoSpaces(plans: string | null | undefined, household: Household): PhotoSpaces {
  const c = choiceOf(plans);
  const forParent = household === "relative" || c === "family_suite";
  const living = { title: "Living and kitchen", space: "open living room with a small modern kitchen" };
  if (c === "rec_room") {
    return {
      bedroom: { title: "A guest room", space: "guest bedroom that doubles as a home office" },
      living: { title: "The rec room", space: "family rec room with a sectional sofa, a TV wall and a games table" },
      note: "",
    };
  }
  return {
    bedroom: forParent ? { title: "A bedroom for your parent", space: "calm bedroom for an older parent" } : { title: "The bedroom", space: "bedroom" },
    living,
    // Their own words go to Muse Image as what they want, never as instructions.
    note: c === "words" ? plans! : "",
  };
}
