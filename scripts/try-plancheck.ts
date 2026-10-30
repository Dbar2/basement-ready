// The plan check (server/planCheck.ts) on a saved scan: its plan as "Is this your basement?" shows it,
// drawn and listed, against its analysis video, the way the scan runs it. Writes the drawing beside the
// answer. About $0.10 on Wonder.
//   tsx --env-file=.env scripts/try-plancheck.ts <result.json> <analysis.mp4> [--out tmp/plancheck/<name>]
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { uploadFile } from "../server/meta";
import { existingFromScan } from "../server/model/seed";
import { checkPlan, roomList } from "../server/planCheck";
import { drawPlan } from "../server/planDraw";
import { watchVideoFile } from "../server/watch";

const run = promisify(execFile);
const [resultPath, analysis] = process.argv.slice(2);
const i = process.argv.indexOf("--out");
const out = i > 0 ? process.argv[i + 1] : join("tmp/plancheck", basename(resultPath).replace(/\.json$/, ""));
mkdirSync(out, { recursive: true });
const existing = existingFromScan(JSON.parse(readFileSync(resultPath, "utf8")));
if (!existing) throw new Error("No plan in that result");
writeFileSync(join(out, "plan.png"), drawPlan(existing));
console.log(roomList(existing));
const file = await watchVideoFile(analysis, null, join(out, "watch.mp4"));
const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
const check = await checkPlan(existing, { video: { fileId: await uploadFile(file, "video/mp4", "walkthrough.mp4"), durationS: Number(stdout) } });
writeFileSync(join(out, "check.json"), JSON.stringify(check, null, 1));
console.log(`\n${check.model}: ${(check.ms / 1000).toFixed(0)} s, $${check.costUsd.toFixed(3)}`);
for (const q of check.questions) console.log(`- [${q.kind}${q.roomId ? ` ${q.roomId}` : ""}${q.atS != null ? ` @${q.atS}s` : ""}] ${q.question}${q.name ? ` → ${q.name}` : ""}`);
