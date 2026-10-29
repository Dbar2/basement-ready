// Makes the sample basement's "what it could look like" photos (Muse Image, checked by SAM), so the
// public sample shows them too. Usage: tsx --env-file=.env scripts/sample-concepts.ts   (about $0.03)
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { renderConcepts } from "../server/concepts";

const sample = "public/samples/sample";
const result = JSON.parse(readFileSync(`${sample}/result.json`, "utf8"));
// renderConcepts reads frames from storage: lend it the sample's frames under a scratch id.
const id = "sample-concepts";
mkdirSync(`media/private/scans/${id}/frames`, { recursive: true });
for (const f of readdirSync(`${sample}/frames`)) copyFileSync(`${sample}/frames/${f}`, `media/private/scans/${id}/frames/${f}`);
result.frameCount ??= readdirSync(`${sample}/frames`).length;
const items = await renderConcepts(id, result);
mkdirSync(`${sample}/concepts`, { recursive: true });
for (const c of items) copyFileSync(`media/private/scans/${id}/concepts/${c.n}.jpg`, `${sample}/concepts/${c.n}.jpg`);
writeFileSync(`${sample}/result.json`, JSON.stringify({ ...result, concepts: { status: "done", items } }, null, 2) + "\n");
console.log(items.map((c) => `${c.n}: ${c.title} · kept ${c.kept}`).join("\n"));
