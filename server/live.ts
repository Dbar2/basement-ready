// Live finds while the homeowner films: one small frame, a few SAM concepts, boxes back in ~1.5 s.
// Limits keep a stuck phone or a script from running up the bill.
import { samImage } from "./meta";
import { parseSam } from "./sam";

// What the camera can look for live. Keys are what the client asks for; prompts go to SAM.
export const LIVE_CONCEPTS: Record<string, { prompt: string; label: string }> = {
  stairs: { prompt: "staircase", label: "Stairs" },
  window: { prompt: "basement window", label: "Window" },
  furnace: { prompt: "furnace", label: "Furnace" },
  panel: { prompt: "electrical panel", label: "Electrical panel" },
  door: { prompt: "door", label: "Door" },
  duct: { prompt: "ceiling duct", label: "Duct" },
  beam: { prompt: "support beam", label: "Beam" },
};

const MIN_CONFIDENCE = 0.45;
// Things that aren't on the checklist need to be surer before they show up as a card.
const MIN_CONFIDENCE_EXTRA: Partial<Record<string, number>> = { duct: 0.6, beam: 0.7 };
const PER_IP_PER_MINUTE = Number(process.env.LIVE_PER_IP_PER_MINUTE ?? 120);
const PER_SESSION = Number(process.env.LIVE_PER_SESSION ?? 300);
const DAILY_MAX = Number(process.env.LIVE_DAILY_MAX ?? 8000); // SAM images are $2.50 per 1,000
export const LIVE_USD_PER_CALL = 2.5 / 1000;

const ipWindow = new Map<string, number[]>();
const sessions = new Map<string, number>();
let day = new Date().toDateString();
let todayCalls = 0;

export type LiveFind = { key: string; label: string; boxes: { x: number; y: number; w: number; h: number; c: number | null }[] };

// Returns why a request is refused, or null if it may go ahead (and counts it).
export function admit(ip: string, session: string, calls: number): string | null {
  const now = Date.now();
  if (new Date().toDateString() !== day) {
    day = new Date().toDateString();
    todayCalls = 0;
    sessions.clear();
  }
  const recent = (ipWindow.get(ip) ?? []).filter((t) => now - t < 60_000);
  if (recent.length + calls > PER_IP_PER_MINUTE) return "slow down";
  if ((sessions.get(session) ?? 0) + calls > PER_SESSION) return "session limit";
  if (todayCalls + calls > DAILY_MAX) return "daily limit";
  for (let i = 0; i < calls; i++) recent.push(now);
  ipWindow.set(ip, recent);
  sessions.set(session, (sessions.get(session) ?? 0) + calls);
  todayCalls += calls;
  return null;
}

export async function detectLive(imageDataUrl: string, keys: string[]): Promise<LiveFind[]> {
  const out = await Promise.all(
    keys.map(async (key) => {
      const concept = LIVE_CONCEPTS[key];
      const raw = await samImage(concept.prompt, imageDataUrl).catch(() => "");
      const boxes = parseSam(raw)
        .map((t) => t.frames[0]?.box)
        .filter((b): b is NonNullable<typeof b> => Boolean(b) && (b.c ?? 1) >= (MIN_CONFIDENCE_EXTRA[key] ?? MIN_CONFIDENCE))
        .map((b) => ({ x: b.x1 / b.w, y: b.y1 / b.h, w: (b.x2 - b.x1) / b.w, h: (b.y2 - b.y1) / b.h, c: b.c ?? null }))
        .slice(0, 4);
      return { key, label: concept.label, boxes };
    }),
  );
  return out.filter((f) => f.boxes.length > 0);
}
