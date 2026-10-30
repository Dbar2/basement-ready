// The styles, finishes and uses a homeowner swipes through, and the Muse Image prompt for one card.
// Pure, so the browser reads the same words: a card's tags are these ids, and the mood board turns
// the liked ones back into finishes (server/ideas/deck.ts moodFrom).

import type { FurnitureKind } from "../model/types";

export type StyleId = "bright" | "warm" | "green" | "cottage" | "modern" | "industrial";
export type Use = "bedroom" | "living" | "kitchen" | "bathroom";
export type Light = "day" | "evening";

type Style = {
  label: string; // plain words a homeowner picks from
  feel: string; // what the prompt asks for
  floors: [string, string]; // two of each, so a deck can tell "this style" from "this floor"
  walls: [string, string];
  kitchen: string;
  bath: string;
  furniture: Partial<Record<FurnitureKind, string>>; // named colours (COLOURS has their hex)
};

export const STYLES: Record<StyleId, Style> = {
  bright: {
    label: "Bright Scandinavian",
    feel: "bright Scandinavian: white oak, soft white walls, linen, plants",
    floors: ["Light oak floor", "Whitewashed oak floor"],
    walls: ["Soft white walls", "Pale sage walls"],
    kitchen: "White flat-front kitchen, oak shelves",
    bath: "White tile, oak vanity",
    furniture: { sofa: "Oatmeal linen", armchair: "Oatmeal linen", bed: "White linen", dresser: "White oak", rug: "Natural jute", shelf: "White oak", desk: "White oak", dining: "White oak", kitchen: "White flat-front", vanity: "White oak", shower: "White tile" },
  },
  warm: {
    label: "Warm wood",
    feel: "warm walnut and oak, cream walls, brass lamps, wool textiles",
    floors: ["Warm oak floor", "Walnut floor"],
    walls: ["Cream walls", "Warm beige walls"],
    kitchen: "Walnut kitchen, brass handles",
    bath: "Cream tile, walnut vanity",
    furniture: { sofa: "Cream bouclé", armchair: "Walnut leather", bed: "Oat linen", dresser: "Walnut", rug: "Cream wool", shelf: "Walnut", desk: "Walnut", dining: "Walnut", kitchen: "Walnut", fridge: "Stainless steel", vanity: "Walnut", shower: "Cream tile" },
  },
  green: {
    label: "Deep green",
    feel: "deep green accent wall, oak floor, black metal details, cosy",
    floors: ["Warm oak floor", "Light oak floor"],
    walls: ["Deep green accent wall", "Sage walls"],
    kitchen: "Green kitchen, oak counter",
    bath: "Green tile, black taps",
    furniture: { sofa: "Forest velvet", armchair: "Forest velvet", bed: "Sage linen", dresser: "Oak", rug: "Sage wool", shelf: "Black metal", desk: "Oak", dining: "Oak", kitchen: "Deep green", vanity: "Deep green", shower: "Green tile" },
  },
  cottage: {
    label: "Cottage",
    feel: "relaxed cottage: painted wood, soft blue and white, woven baskets",
    floors: ["Whitewashed oak floor", "Light oak floor"],
    walls: ["Soft white walls", "Pale blue walls"],
    kitchen: "Painted shaker kitchen",
    bath: "White tile, blue vanity",
    furniture: { sofa: "Soft blue linen", armchair: "Soft blue linen", bed: "White linen", dresser: "Painted white", rug: "Woven blue", shelf: "Painted white", desk: "Painted white", dining: "Painted white", kitchen: "Painted blue shaker", vanity: "Painted blue shaker", shower: "White tile" },
  },
  modern: {
    label: "Clean modern",
    feel: "minimal modern: matte white, light grey, black fixtures, slim lines",
    floors: ["Pale grey floor", "Light oak floor"],
    walls: ["White walls", "Light grey walls"],
    kitchen: "Matte white kitchen, black taps",
    bath: "Large grey tile, floating vanity",
    furniture: { sofa: "Light grey", armchair: "Light grey", bed: "White linen", dresser: "Matte white", rug: "Pale grey", shelf: "Black metal", desk: "Matte white", dining: "Light oak", kitchen: "Matte white", fridge: "Stainless steel", vanity: "Matte white", shower: "Large grey tile" },
  },
  industrial: {
    label: "Soft industrial",
    feel: "soft industrial: polished concrete, black metal, warm wood, a dark painted open ceiling",
    floors: ["Polished concrete floor", "Dark oak floor"],
    walls: ["Warm grey walls", "White painted brick wall"],
    kitchen: "Black metal and oak kitchen",
    bath: "Black and white tile, concrete vanity",
    furniture: { sofa: "Charcoal", armchair: "Brown leather", bed: "Charcoal linen", dresser: "Dark oak", rug: "Faded grey", shelf: "Black metal", desk: "Black metal", dining: "Dark oak", kitchen: "Black metal and oak", fridge: "Stainless steel", vanity: "Concrete grey", shower: "Black and white tile" },
  },
};

// What every style shares, then each colour's hex for the 3D (a Furniture.colour is the name).
const ALWAYS: Partial<Record<FurnitureKind, string>> = { tv: "Matte black", toilet: "White", washer_dryer: "White", fridge: "White" };
export const COLOURS: Record<string, string> = {
  "Oatmeal linen": "#D8CFC1", "White linen": "#F1EEE8", "White oak": "#CDB08A", "Natural jute": "#C2A77F", "White flat-front": "#F2F1EC", "White tile": "#F4F4F1",
  "Cream bouclé": "#E6DCCB", "Walnut leather": "#5C4033", "Oat linen": "#D9CCB4", Walnut: "#5D4130", "Cream wool": "#E9E1D2", "Cream tile": "#EDE4D3",
  "Forest velvet": "#2F4A3A", "Sage linen": "#B7C2A8", Oak: "#B48A5A", "Sage wool": "#A9B79B", "Black metal": "#222222", "Deep green": "#2E4A3B", "Green tile": "#4E6B57",
  "Soft blue linen": "#AFC3D6", "Painted white": "#F3F1EA", "Woven blue": "#7F98B2", "Painted blue shaker": "#8FA8BF",
  "Light grey": "#BFC2C4", "Matte white": "#EFEFEC", "Pale grey": "#D5D7D8", "Light oak": "#C9A97E", "Large grey tile": "#A9ABAD", "Stainless steel": "#B9BCBE",
  Charcoal: "#3A3C3E", "Brown leather": "#5A3E2B", "Charcoal linen": "#4A4C4E", "Dark oak": "#4A3A2C", "Faded grey": "#8C8A85", "Black metal and oak": "#2A2622", "Concrete grey": "#9A9893", "Black and white tile": "#6E6E6E",
  "Matte black": "#1E1E1E", White: "#F6F6F4",
};

export const furnitureOf = (style: StyleId): Partial<Record<FurnitureKind, string>> => ({ ...ALWAYS, ...STYLES[style].furniture });

// The four a deck mixes: one of each in the first few cards, so the board learns fast.
export const DECK_STYLES: StyleId[] = ["warm", "modern", "bright", "industrial"];

export const USES: Record<Use, { label: string; space: string }> = {
  bedroom: { label: "Bedroom corner", space: "bedroom corner with a bed, a side table and a reading lamp" },
  living: { label: "Living room", space: "living room with a sofa, a rug and a coffee table" },
  kitchen: { label: "Kitchenette", space: "small kitchenette with a counter, a sink and upper cabinets, and a small dining table" },
  bathroom: { label: "Bathroom on your pipes", space: "bathroom with a walk-in shower, a toilet and a vanity" },
};

export const LIGHTS: Record<Light, string> = {
  day: "daylight, bright and airy",
  evening: "evening, warm lamps and slim recessed lights",
};

export type Tags = { style: StyleId; floor: string; walls: string; kitchen: string; bath: string; use: Use; light: Light };

// A card's tags: the style's finishes, the variant picking which floor and walls.
export function tagsFor(style: StyleId, use: Use, light: Light, variant: number): Tags {
  const s = STYLES[style];
  return { style, floor: s.floors[variant % 2], walls: s.walls[(variant >> 1) % 2], kitchen: s.kitchen, bath: s.bath, use, light };
}

// One card's instruction: their own photo, the same room, finished in this style for this use.
export function cardPrompt(t: Pick<Tags, "style" | "floor" | "walls" | "kitchen" | "bath" | "use" | "light">) {
  return [
    `Renovate this unfinished basement photo into a finished ${USES[t.use].space}.`,
    "Keep the exact same camera angle, room shape and ceiling height.",
    "Keep every window, door and stair exactly where it is and the same size. Do not add, remove or move any window, door or stair.",
    "If a furnace, water heater or electrical panel is in view, close it into a utility room behind a plain wall with a door.",
    "Take out exercise machines, storage boxes, tools and clutter: show only the finished room and its new furniture.",
    `Floor: ${t.floor.toLowerCase()}. Walls and ceiling: smooth drywall, ${t.walls.toLowerCase()}.`,
    t.use === "kitchen" ? `Kitchen: ${t.kitchen.toLowerCase()}.` : "",
    t.use === "bathroom" ? `Bathroom: ${t.bath.toLowerCase()}.` : "",
    `Feel: ${STYLES[t.style].feel}. Light: ${LIGHTS[t.light]}.`,
    "Photorealistic interior photo, uncluttered.",
  ]
    .filter(Boolean)
    .join(" ");
}
