// The notes a City examiner adds to a basement second-unit set when they're missing, each with the
// Code section or City page it rests on (all checked against the 2024 Building Code Compendium and
// Kitchener's "Adding a Second Unit" guide on 2026-10-30). The notes sheet prints every note that
// applies; tests check none is dropped.
import type { Cite } from "./data";

const PART9 = "https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings";
const PART7 = "https://www.ontario.ca/document/2024-building-code-compendium/part-7-plumbing";
const PART11 = "https://www.ontario.ca/document/2024-building-code-compendium/part-11-renovation";
const KITCHENER = "https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf";
const ON = "2026-10-30";

const code = (part: 7 | 9 | 11, section: string): Cite => ({
  title: `2024 Building Code (O. Reg. 163/24), Div. B Part ${part}`,
  url: part === 7 ? PART7 : part === 11 ? PART11 : PART9,
  section,
  retrieved: ON,
});
const kitchener = (pages: string): Cite => ({ title: "Adding a Second Unit to an Existing House (City of Kitchener, 2025)", url: KITCHENER, section: pages, retrieved: ON });

export type NoteWhen = "always" | "fuel_burning" | "stairs" | "escape_new" | "shared_heating" | "bath_new";
export type ExaminerNote = { id: string; title: string; text: string; cites: Cite[]; when: NoteWhen };

export const EXAMINER_NOTES: ExaminerNote[] = [
  {
    id: "general",
    title: "Code",
    text: "All work to the 2024 Ontario Building Code (O. Reg. 163/24), Part 9, using the Part 11 compliance alternatives for an existing house where noted.",
    cites: [{ title: "O. Reg. 163/24: Building Code (e-Laws)", url: "https://www.ontario.ca/laws/regulation/240163", section: null, retrieved: ON }],
    when: "always",
  },
  {
    id: "structure_existing",
    title: "Structure assumed existing",
    text: "All structure is existing unless noted. No foundation wall, beam, post or joist is removed, cut or changed unless shown; any such change, and any new opening in the foundation wall over 1.2 m wide, is designed by an engineer.",
    cites: [code(9, "9.4.1.1.(1), 9.15.4.3.(3)")],
    when: "always",
  },
  {
    id: "contractor_responsible",
    title: "Responsibility",
    text: "The owner and the contractor are responsible for building to the Code and to these drawings. Verify all dimensions on site before building; report any difference to the designer before work goes on.",
    cites: [{ title: "Building Code Act, 1992, s. 1.1 (roles of owners and builders)", url: "https://www.ontario.ca/laws/statute/92b23", section: "s. 1.1", retrieved: ON }],
    when: "always",
  },
  {
    id: "fire_separation",
    title: "Fire separation between the units",
    text: "Walls between unit 2 and the rest of the house, and around the shared stair and the furnace room: 30-minute fire separation. Ceiling of unit 2: 15-minute horizontal fire separation, allowed because smoke alarms are interconnected in every unit and common area. Continuous and smoke-tight: carried through bulkheads, soffits, shafts and duct chases, behind tubs and showers, around the stair, and up to the underside of the floor above; joints taped, penetrations sealed. See the legend on A2 and assemblies on A6.",
    cites: [code(11, "Table 11.5.1.1.-C, C156"), code(9, "9.10.9.2., 9.10.9.16.")],
    when: "always",
  },
  {
    id: "fire_doors",
    title: "Doors in the fire separation",
    text: "Each door in the fire separation is a 20-minute rated door (an existing 45 mm solid-core wood door is acceptable) with a self-closing device, a positive latch and a lever handle.",
    cites: [code(9, "Table 9.10.13.1., 9.10.13.10.(1)"), code(11, "Table 11.5.1.1.-C, C160")],
    when: "always",
  },
  {
    id: "service_room",
    title: "Furnace room",
    text: "The room with the furnace and water heater is enclosed by a 30-minute fire separation, walls and ceiling, with a 20-minute self-closing door. If a continuous separation can't be kept there, the service room is sprinklered to NFPA 13D and a certification letter goes to the inspector.",
    cites: [code(11, "Table 11.5.1.1.-C, C157"), code(9, "9.10.10.3.(1)")],
    when: "fuel_burning",
  },
  {
    id: "supports",
    title: "Beams and posts",
    text: "Beams, posts and walls that hold up the floor between the units are covered with 15.9 mm (5/8\") Type X gypsum board, or have the same fire rating as the ceiling.",
    cites: [code(9, "9.10.8.3.(2)")],
    when: "always",
  },
  {
    id: "smoke_alarms",
    title: "Smoke alarms: interconnected, with strobes",
    text: "Smoke alarms on every storey of each unit including the basement, in each bedroom, between the bedrooms and the rest of the storey (in the hall if there is one), and in shared areas such as the stair and laundry. Hard-wired with battery backup, to CAN/ULC-S531, on or near the ceiling. All alarms in the house are interconnected, so any alarm sounds every alarm in both units. Each alarm has a visual signal (strobe) as well as sound.",
    cites: [code(9, "9.10.19.3., 9.10.19.4.(1), 9.10.19.5.(2)"), kitchener("p. 17")],
    when: "always",
  },
  {
    id: "co_alarms",
    title: "CO alarms by the sleeping areas",
    text: "With a fuel-burning furnace or water heater: a carbon monoxide alarm next to each sleeping area in each unit, in any bedroom that shares a wall, floor or ceiling with the furnace room, and in the furnace room. Hard-wired with battery backup and interconnected, with a visual signal.",
    cites: [code(9, "9.32.3.9A.(2)-(4), 9.32.3.9B.(1)")],
    when: "fuel_burning",
  },
  {
    id: "stairs",
    title: "Existing stair",
    text: "The existing stair keeps at least 700 mm (2'-3\") between wall faces and 1,800 mm (5'-11\") clear headroom over the nosings and landings. A handrail 865 to 1,070 mm high on at least one side; a guard at least 900 mm high on any open side more than 600 mm above the floor below. Stair lighting with 3-way switches at the top and bottom.",
    cites: [code(11, "Table 11.5.1.1.-C, C112"), code(9, "9.8.7.1., 9.8.7.4., 9.8.8.1., 9.8.8.3., 9.34.2.3.(2)")],
    when: "stairs",
  },
  {
    id: "heights",
    title: "Ceiling heights",
    text: "Finished ceiling in unit 2 at least 1.95 m (6'-5\"); at least 1.85 m (6'-1\") clear under beams and ducts. Heights on the ceiling plan, A4.",
    cites: [code(9, "9.5.3.1.(2) and (3)")],
    when: "always",
  },
  {
    id: "shut_offs",
    title: "Water shut-offs",
    text: "A shut-off valve where the water supply enters each unit, so either unit's water can be shut off without cutting the other's.",
    cites: [code(7, "7.6.1.3.(5)")],
    when: "always",
  },
  {
    id: "hot_water",
    title: "Hot water at most 49 °C",
    text: "Hot water to fixtures (other than a dishwasher or clothes washer) at most 49 °C, by a mixing valve or high-limit stops set at 49 °C.",
    cites: [code(7, "7.2.10.7.")],
    when: "always",
  },
  {
    id: "bath_fan",
    title: "Bathroom fan",
    text: "A bathroom exhaust fan of at least 25 L/s (50 cfm), ducted to the outdoors.",
    cites: [code(9, "9.32.3.7., 9.32.3.13.")],
    when: "always",
  },
  {
    id: "dryer",
    title: "Dryer vents",
    text: "Each clothes dryer exhausts to the outdoors through its own duct, the outlet at least 1,800 mm from any air intake.",
    cites: [code(9, "9.32.3.13.(4)")],
    when: "always",
  },
  {
    id: "laundry",
    title: "Laundry for both units",
    text: "Laundry, or space and hook-ups for it, for each unit: in each unit or in a shared room both units reach without passing through the other unit.",
    cites: [code(9, "9.31.4.1A."), kitchener("p. 28")],
    when: "always",
  },
  {
    id: "hvac",
    title: "Heating: a duct smoke detector or separate systems",
    text: "No duct joins one unit to the other and no air is recirculated between them. Where the existing forced-air system serves both units, a duct smoke detector in its supply or return duct shuts off the furnace's fuel and power when it senses smoke; otherwise unit 2 gets its own heating. Supply and return ducts in unit 2 are best dropped to the floor.",
    cites: [code(9, "9.33.1.1.(3)"), code(11, "Table 11.5.1.1.-C, C201")],
    when: "always",
  },
  {
    id: "grab_bars",
    title: "Grab-bar blocking",
    text: "Solid blocking in the main bathroom's stud walls beside the toilet and the tub or shower, for grab bars later.",
    cites: [code(9, "9.5.2.4.(1)"), kitchener("p. 23")],
    // New walls only: a bathroom kept as it is gets none.
    when: "bath_new",
  },
  {
    id: "esa",
    title: "Electrical permit",
    text: "Electrical work needs its own permit from the Electrical Safety Authority (1-877-372-7233) before it starts, and ESA inspections; the building permit doesn't cover it.",
    cites: [{ title: "Notifications and Inspections (Electrical Safety Authority)", url: "https://esasafe.com/compliance/what-you-need-to-know/", section: null, retrieved: ON }],
    when: "always",
  },
  {
    id: "escape_window",
    title: "Bedroom escape window",
    text: "The bedroom has a window that opens from inside without tools and stays open: at least 0.35 m² clear, no side under 380 mm. A window well leaves at least 550 mm clear in front of it, and any cover opens from inside. Detail on A6.",
    cites: [code(9, "9.9.10.1.(1), (3) and (5)"), kitchener("pp. 23-24")],
    when: "always",
  },
  {
    id: "insulation",
    title: "Insulation and vapour barrier",
    text: "New insulation at least matches what's there. Vapour barrier on the warm (room) side of the insulation, lapped and carried into the rim joist space; cut any old blanket wrap's barrier so there aren't two. Foam insulation covered.",
    cites: [code(9, "9.25.4.3.(1)"), code(11, "11.3.1.2, C207"), kitchener("pp. 32-34")],
    when: "always",
  },
  {
    id: "framing",
    title: "New walls",
    text: "38 x 89 mm (2x4) studs at 400 mm (16\") on centre, single top plate, a bottom plate on a sill gasket: pressure-treated, or on 0.05 mm polyethylene or Type S roll roofing where it sits on concrete.",
    cites: [code(9, "Table 9.23.10.1., 9.23.2.3.(1)")],
    when: "always",
  },
];

// The notes that apply to this project.
export function notesFor(o: { fuelBurning: boolean; stairs: boolean; escapeNew: boolean; sharedHeating?: boolean; bathNew?: boolean }) {
  return EXAMINER_NOTES.filter((n) => n.when === "always" || (n.when === "fuel_burning" && o.fuelBurning) || (n.when === "stairs" && o.stairs) || (n.when === "escape_new" && o.escapeNew) || (n.when === "shared_heating" && o.sharedHeating !== false) || (n.when === "bath_new" && o.bathNew !== false));
}

export const citeText = (c: Cite) => `${c.section ? `${c.section}, ` : ""}${c.title}`;
