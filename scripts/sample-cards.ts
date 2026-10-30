// Makes the example basement's swipe deck (Muse Image, checked by SAM), so the public example deals
// real cards with no keys. Usage: tsx --env-file=.env scripts/sample-cards.ts   (about $0.25)
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { makeDeck, pickViews, realCardWork, SAMPLE_CARDS } from "../server/ideas/cards";

const sample = "public/samples/sample";
const result = JSON.parse(readFileSync(`${sample}/result.json`, "utf8"));
const file = (n: number) => `${sample}/frames/${String(n).padStart(4, "0")}.jpg`;
// The example ships six frames; four of them are different enough to be views.
const frames = readdirSync(`${sample}/frames`).map((f) => Number.parseInt(f, 10));
const detail = new Map(frames.map((f) => [f, statSync(file(f)).size]));
const picks = pickViews({ frameCount: result.frameCount, detections: result.detections, vision: result.vision, household: result.household, candidates: frames, detail }, 4);
console.log("views:", picks.map((p) => `${p.frame} ${p.title}`).join(" · "));

rmSync(SAMPLE_CARDS, { recursive: true, force: true });
mkdirSync(SAMPLE_CARDS, { recursive: true });
const work = {
  ...realCardWork("sample", null),
  frame: async (n: number) => (frames.includes(n) ? readFileSync(file(n)) : null),
  save: async (n: number, jpeg: Buffer) => writeFileSync(`${SAMPLE_CARDS}/${n}.jpg`, jpeg),
  planned: async (slots: unknown[]) => console.log(`${slots.length} cards planned`),
  landed: async (c: { n: number; title: string; checked: string }) => console.log(`  ${c.n}: ${c.title} · ${c.checked}`),
  dropped: async (n: number) => console.log(`  ${n}: left out (SAM lost a window, stair or door)`),
  url: (n: number) => `/samples/sample/cards/${n}.jpg`,
  from: (frame: number) => `/samples/sample/frames/${String(frame).padStart(4, "0")}.jpg`,
};
const deck = await makeDeck("sample", picks, work);
writeFileSync(`${SAMPLE_CARDS}/deck.json`, JSON.stringify({ status: "done", ...deck }, null, 2) + "\n");
console.log(`${deck.cards.length} cards kept, ${deck.dropped.length} left out`);
