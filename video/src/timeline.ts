import voice from "./data/voice.json";

export const FPS = 30;
const f = (s: number) => Math.round(s * FPS);

type VoiceLine = { take: string | null; seconds: number; text: string };
const VOICE = voice as Record<string, VoiceLine>;

export type SceneId = "question" | "film" | "models" | "answer" | "design" | "build" | "close";

// Each scene: its voice lines, the breath before the first line, the pause between lines and after the last.
// Some lines get extra room after them (`hold`) where the picture needs to land.
const SCENES: { id: SceneId; lines: string[]; lead: number; gap: number; tail: number; hold?: Record<string, number> }[] = [
  { id: "question", lines: ["L00", "L01", "N02"], lead: 0.5, gap: 0.45, tail: 0.5 },
  { id: "film", lines: ["N03"], lead: 0.4, gap: 0.4, tail: 0.8 },
  { id: "models", lines: ["N06b", "N04", "N05", "L09"], lead: 0.3, gap: 0.4, tail: 0.5, hold: { N06b: 0.3, N04: 0.5, N05: 1.8, L09: 0.6 } },
  { id: "answer", lines: ["N07b", "N08", "L13"], lead: 0.4, gap: 0.4, tail: 0.5, hold: { N07b: 1.2, N08: 0.6, L13: 1.2 } },
  { id: "design", lines: ["N09", "N10"], lead: 0.4, gap: 0.4, tail: 0.5, hold: { N09: 1.2, N10: 1.6 } },
  { id: "build", lines: ["N11", "N12"], lead: 0.4, gap: 0.4, tail: 0.5, hold: { N11: 1.2, N12: 1.0 } },
  { id: "close", lines: ["N13", "N14"], lead: 0.4, gap: 0.6, tail: 5.0 },
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
