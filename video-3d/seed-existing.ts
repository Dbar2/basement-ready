// Writes a scan's as-built plan (walls, rooms, openings, fixtures) from its result.json, with the same
// seeding the server and scripts/landing-existing.ts use, so the clips draw the clean basement the app does.
//   pnpm exec tsx video-3d/seed-existing.ts <result.json> <out existing.json>
import { readFileSync, writeFileSync } from "node:fs";
import { seedModel } from "../server/model/seed";

const [src, out] = process.argv.slice(2);
const model = seedModel(JSON.parse(readFileSync(src, "utf8")), {}, "2026-11-04T00:00:00.000Z");
if (!model) throw new Error("That result has no plan to seed from.");
writeFileSync(out, JSON.stringify(model.existing) + "\n");
console.log(`${out}: ${model.existing.walls.length} walls, ${model.existing.fixtures.length} fixtures`);
