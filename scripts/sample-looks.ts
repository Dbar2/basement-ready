// Makes the sample basement's "Try this look" photos once (Muse Image, checked by SAM) and keeps them
// in public/samples/sample/looks, so the example shows every look with no keys and costs nothing to
// replay. Styles already there are skipped. Usage: tsx --env-file=.env scripts/sample-looks.ts   (about 2 cents a style)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The renders land in a scratch folder, then the JPEGs are copied next to the sample.
process.env.LOCAL_STORAGE_DIR ??= mkdtempSync(join(tmpdir(), "sample-looks-"));
const { lookKey, renderLook, sourcesFrom, STYLES } = await import("../server/ideas/looks");
const { storage } = await import("../server/storage");

const sample = "public/samples/sample";
const result = JSON.parse(readFileSync(`${sample}/result.json`, "utf8"));
const frames = new Map<number, Buffer>();
for (const it of result.concepts?.items ?? []) {
  const f = `${sample}/frames/${String(it.frame).padStart(4, "0")}.jpg`;
  if (existsSync(f)) frames.set(it.frame, readFileSync(f));
}
const manifest = `${sample}/looks/looks.json`;
const done: Record<string, unknown> = existsSync(manifest) ? JSON.parse(readFileSync(manifest, "utf8")) : {};

for (const style of Object.keys(STYLES)) {
  if (done[style]) continue;
  const look = await renderLook("sample", style, sourcesFrom(result, frames));
  if (look.status !== "done") {
    console.log(`${style}: failed`);
    continue;
  }
  mkdirSync(`${sample}/looks/${style}`, { recursive: true });
  for (const it of look.items) {
    const s = await storage.get(lookKey("sample", style, it.n));
    const parts: Buffer[] = [];
    for await (const chunk of s!) parts.push(chunk as Buffer);
    writeFileSync(`${sample}/looks/${style}/${it.n}.jpg`, Buffer.concat(parts));
  }
  done[style] = { ...look, at: "" };
  writeFileSync(manifest, JSON.stringify(done, null, 2) + "\n");
  console.log(`${style}: ${look.items.map((i) => `${i.n} kept ${i.kept}`).join(", ")}`);
}
