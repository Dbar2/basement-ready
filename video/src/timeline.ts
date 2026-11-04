import voice from "./data/voice.json";

export const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

type VoiceLine = { take: string | null; seconds: number; text: string };
const VOICE = voice as Record<string, VoiceLine>;

export type SceneId = "question" | "film" | "models" | "answer" | "design" | "build" | "close";

// Each scene: its voice lines, the breath before the first line, the pause between lines and after the last.
// Some lines get extra room after them (`hold`) where the picture needs to land.
const SCENES: { id: SceneId; lines: string[]; lead: number; gap: number; tail: number; hold?: Record<string, number> }[] = [
  { id: "question", lines: ["L01", "L02", "L03"], lead: 1.6, gap: 0.7, tail: 0.6 },
  { id: "film", lines: ["L04"], lead: 0.5, gap: 0.6, tail: 1.4 },
  { id: "models", lines: ["L05", "L06", "L07", "L08", "L09"], lead: 0.3, gap: 0.6, tail: 0.6, hold: { L06: 1.4, L07: 1.4, L08: 1.0, L09: 1.6 } },
  { id: "answer", lines: ["L10", "L11", "L12", "L13"], lead: 0.4, gap: 0.6, tail: 0.6, hold: { L10: 1.6, L11: 1.2, L12: 0.8, L13: 1.6 } },
  { id: "design", lines: ["L14", "L15", "L16"], lead: 0.4, gap: 0.6, tail: 0.6, hold: { L14: 1.4, L15: 1.8, L16: 2.0 } },
  { id: "build", lines: ["L17", "L18", "L19"], lead: 0.4, gap: 0.6, tail: 0.6, hold: { L17: 1.4, L18: 1.2, L19: 1.6 } },
  { id: "close", lines: ["L20", "L21"], lead: 0.4, gap: 0.8, tail: 6.0 },
];

export type LineTiming = { id: string; text: string; from: number; dur: number };
export type SceneTiming = { id: SceneId; from: number; duration: number; lines: LineTiming[]; index: number };

export const buildTimeline = () => {
  let cursor = 0;
  const scenes: SceneTiming[] = SCENES.map((s, index) => {
    const from = cursor;
    let t = f(s.lead);
    const lines = s.lines.map((id, i) => {
      const v = VOICE[id];
      const line = { id, text: v.text, from: t, dur: f(v.seconds) };
      t += line.dur + (i < s.lines.length - 1 ? f(s.gap + (s.hold?.[id] ?? 0)) : 0);
      return line;
    });
    t += f(s.tail + (s.hold?.[s.lines[s.lines.length - 1]] ?? 0));
    cursor += t;
    return { id: s.id, from, duration: t, lines, index };
  });
  return { scenes, total: cursor };
};

export const TIMELINE = buildTimeline();
export const sceneById = (id: SceneId) => TIMELINE.scenes.find((s) => s.id === id)!;
export const lineIn = (scene: SceneTiming, id: string) => scene.lines.find((l) => l.id === id)!;
