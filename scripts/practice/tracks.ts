// Scores a video scan's finds against track labels: runs SAM's saved answers (scripts/practice/video.ts)
// through the app's own video finds (server/videoFinds.ts) and counts what each kept track really is.
// No calls.
//   tsx scripts/practice/tracks.ts --labels track-labels.json --answers dir [--concept "support beam"]
// The labels name each track by its id in SAM's answer, per video and concept:
//   { "<video>": { "support beam": { "0": "beam", "3": "joist", "5": "post" } } }
// and `<dir>/<video>.answers.json` holds that video's answers.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bestFrame, parseSam } from "../../server/sam";
import { videoFinds } from "../../server/videoFinds";

const arg = (name: string, fallback = "") => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const labels = JSON.parse(readFileSync(arg("labels"), "utf8"));
const dir = arg("answers");
const concept = arg("concept", "support beam");
const KINDS: Record<string, { kind: string; label: string }> = {
  "support beam": { kind: "beam", label: "Beam" },
  "ceiling duct": { kind: "duct", label: "Duct" },
  staircase: { kind: "stairs", label: "Stairs" },
};
const c = { concept, ...(KINDS[concept] ?? { kind: concept, label: concept }) };

const total: Record<string, number> = {};
const rows: string[] = [];
for (const video of Object.keys(labels).filter((k) => k !== "about")) {
  const raw: string = JSON.parse(readFileSync(join(dir, `${video}.answers.json`), "utf8")).raw[concept] ?? "";
  const tracks = parseSam(raw);
  // Each find back to its track: the same clearest frame and box.
  const kept = videoFinds(c, raw, 5).map((d) => {
    const t = tracks.find((t) => {
      const b = bestFrame(t);
      return b.frame === d.frame && Math.abs(b.box.x1 / b.box.w - d.box.x) < 1e-6 && Math.abs(b.box.y1 / b.box.h - d.box.y) < 1e-6;
    });
    return labels[video][concept]?.[String(t?.id)] ?? "unlabelled";
  });
  for (const k of kept) total[k] = (total[k] ?? 0) + 1;
  rows.push(`| ${video} | ${kept.join(", ") || "none"} |`);
}
console.log(`${concept}: ${Object.entries(total).map(([k, n]) => `${n} ${k}`).join(", ") || "nothing kept"}\n\n| Video | Kept tracks |\n|---|---|\n${rows.join("\n")}`);
process.exit(0);
