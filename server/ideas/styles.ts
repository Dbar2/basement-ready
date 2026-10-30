// The styles, finishes and uses a homeowner swipes through, and the Muse Image prompt for one card.
// Pure, so the browser reads the same words: a card's tags are these ids, and the mood board turns
// the liked ones back into finishes (server/ideas/deck.ts moodFrom).

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
};

export const STYLES: Record<StyleId, Style> = {
  bright: {
    label: "Bright Scandinavian",
    feel: "bright Scandinavian: white oak, soft white walls, linen, plants",
    floors: ["Light oak floor", "Whitewashed oak floor"],
    walls: ["Soft white walls", "Pale sage walls"],
    kitchen: "White flat-front kitchen, oak shelves",
    bath: "White tile, oak vanity",
  },
  warm: {
    label: "Warm wood",
    feel: "warm walnut and oak, cream walls, brass lamps, wool textiles",
    floors: ["Warm oak floor", "Walnut floor"],
    walls: ["Cream walls", "Warm beige walls"],
    kitchen: "Walnut kitchen, brass handles",
    bath: "Cream tile, walnut vanity",
  },
  green: {
    label: "Deep green",
    feel: "deep green accent wall, oak floor, black metal details, cosy",
    floors: ["Warm oak floor", "Light oak floor"],
    walls: ["Deep green accent wall", "Sage walls"],
    kitchen: "Green kitchen, oak counter",
    bath: "Green tile, black taps",
  },
  cottage: {
    label: "Cottage",
    feel: "relaxed cottage: painted wood, soft blue and white, woven baskets",
    floors: ["Whitewashed oak floor", "Light oak floor"],
    walls: ["Soft white walls", "Pale blue walls"],
    kitchen: "Painted shaker kitchen",
    bath: "White tile, blue vanity",
  },
  modern: {
    label: "Clean modern",
    feel: "minimal modern: matte white, light grey, black fixtures, slim lines",
    floors: ["Pale grey floor", "Light oak floor"],
    walls: ["White walls", "Light grey walls"],
    kitchen: "Matte white kitchen, black taps",
    bath: "Large grey tile, floating vanity",
  },
  industrial: {
    label: "Soft industrial",
    feel: "soft industrial: polished concrete, black metal, warm wood, a dark painted open ceiling",
    floors: ["Polished concrete floor", "Dark oak floor"],
    walls: ["Warm grey walls", "White painted brick wall"],
    kitchen: "Black metal and oak kitchen",
    bath: "Black and white tile, concrete vanity",
  },
};

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
