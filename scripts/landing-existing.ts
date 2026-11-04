// Writes the example's as-built plan (walls, rooms, openings, stairs, furnace) for the home page's scroll
// story, src/marketing/example-existing.json: the same plan the server seeds the example's guide with
// (server/model/routes.ts), so the home page draws the same clean basement the app does, without
// bundling the seeding code. Re-run after the example's result changes:  pnpm exec tsx scripts/landing-existing.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seedModel } from "../server/model/seed";

const root = join(import.meta.dirname, "..");
const result = JSON.parse(readFileSync(join(root, "public/samples/sample/result.json"), "utf8"));
const model = seedModel(result, {}, "2026-10-30T00:00:00.000Z");
if (!model) throw new Error("The example's result has no plan to seed from.");
const { existing } = model;
writeFileSync(join(root, "src/marketing/example-existing.json"), JSON.stringify(existing) + "\n");
console.log(`example-existing.json: ${existing.walls.length} walls, ${existing.fixtures.length} fixtures`);
