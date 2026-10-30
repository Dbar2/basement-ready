// Tries other confidence bars on SAM answers already saved by scripts/practice/score.ts (--out), with no
// new calls: for each concept, what each bar would have found and falsely found.
//   tsx scripts/practice/sweep.ts --from results.json[,more.json] --labels labels.json[,more.json]
import { readFileSync } from "node:fs";
import { mergePhotoFinds, photoFinds } from "../../server/photoFinds";
import { addTally, emptyTally, KEYS, pct, scoreKey, type Find, type Label } from "./scoring";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : "";
};
const labels: Record<string, Label> = Object.assign({}, ...arg("labels").split(",").map((f) => JSON.parse(readFileSync(f, "utf8")).photos));
type Saved = { concepts: { concept: string; kind: string; label: string }[]; results: { id: string; raw: Record<string, string> }[] };
const runs: Saved[] = arg("from").split(",").map((f) => JSON.parse(readFileSync(f, "utf8")));
const BARS = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

for (const c of runs[0].concepts) {
  const key = KEYS[c.label];
  const rows = BARS.map((bar) => {
    const t = emptyTally();
    let without = 0;
    for (const run of runs) {
      for (const r of run.results) {
        const label = labels[r.id];
        if (!label?.keep || r.raw[c.concept] === undefined) continue;
        const { finds } = mergePhotoFinds(photoFinds(0, c, r.raw[c.concept], bar), () => 0, () => null);
        const mine: Find[] = finds.map((d) => ({ key, box: [d.box.x, d.box.y, d.box.w, d.box.h], c: d.confidence }));
        const s = scoreKey(label, key, mine);
        if (!s) continue;
        if (!s.photos) without++;
        addTally(t, s);
      }
    }
    return `| ${bar.toFixed(2)} | ${t.hit}/${t.photos} (${pct(t.hit, t.photos)}) | ${t.falsePhotos}/${without} (${pct(t.falsePhotos, without)}) | ${t.tp}/${t.tp + t.fn} | ${t.fp} |`;
  });
  console.log(`\n### ${c.label} ("${c.concept}")\n\n| Bar | Found | False finds | Boxes found | Boxes on nothing |\n|---|---|---|---|---|\n${rows.join("\n")}`);
}
