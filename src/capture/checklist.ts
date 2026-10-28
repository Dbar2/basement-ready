// What we ask people to film, in the order a walk-through usually goes.

export type ChecklistId = "stairs" | "windows" | "ceiling" | "furnace" | "door" | "plans";

export type ChecklistItem = { id: ChecklistId; label: string; short: string; hint: string };

export const CHECKLIST: readonly ChecklistItem[] = [
  { id: "stairs", short: "Stairs", label: "The stairs down", hint: "Start at the top and film your way down." },
  { id: "windows", short: "Windows", label: "Every window", hint: "Stop at each one for a second, wells too." },
  { id: "ceiling", short: "Ceiling", label: "The ceiling", hint: "Point your phone up and hold it for 3 seconds." },
  { id: "furnace", short: "Furnace", label: "The furnace room", hint: "Show the furnace and the electrical panel." },
  { id: "door", short: "Door", label: "Any outside door", hint: "A door straight outside, if there is one." },
  { id: "plans", short: "Plans", label: "Say what you want", hint: "“Kitchen here, Mom's room here.” Talk as you walk." },
];

export const TIPS = [
  { label: "Lights on", hint: "Every light, closets too." },
  { label: "Move slowly", hint: "About one step a second." },
  { label: "Phone upright", hint: "Hold it tall, not sideways." },
];

export const MIN_SEC = 30;
export const MAX_SEC = 120;
export const CEILING_HOLD_MS = 3000;
