// Renders the example's permit set to a PDF for review: the review copy as the owner first sees it,
// and the submit copy with every readiness item answered. Usage: tsx scripts/permit-render.ts <outDir>
import { readFileSync, writeFileSync } from "node:fs";
import { buildPermitPackage, permitStatus } from "../server/permit/package";
import type { StoredState } from "../server/workspace";

const out = process.argv[2] ?? ".";
const result = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const profile = { owners: [{ first: "Sam", last: "Rivera" }], phone: "519-555-0100", email: "sam@example.com", postalCode: "N2L 2C1" };
const base = { result, municipality: "waterloo-on", address: "The sample basement", profile, site: null, aerialJpeg: null, favourites: [], today: "2026-10-30", fetchPdf: async () => null };

// Every item answered: the tape, the windows, the bedrooms upstairs, the lot line, each sheet.
export function answered(state: StoredState): StoredState {
  const st = permitStatus({ ...base, state });
  const m = st.model!;
  const next: StoredState = {
    ...state,
    tape: { ceilingMm: 2085, beamMm: 1960, ...state.tape },
    permit: {
      ...state.permit,
      walls: m.mainWalls.map((w) => ({ id: w.id, mm: Math.round(w.scanM * 1000) })),
      windows: m.windows.filter((w) => w.change !== "new").map((w) => ({ id: w.id, widthMm: 610, heightMm: 762, sillMm: 1120 })),
      upstairs: { bedrooms: [{ floor: 1, at: [0.25, 0.7] }, { floor: 1, at: [0.75, 0.7] }] },
      lotLines: m.windows.map((w) => ({ id: w.id, mm: 1800 })),
    },
  };
  const again = permitStatus({ ...base, state: next });
  next.permit!.reviewed = again.sheets.map((s) => ({ sheet: s.number, key: again.reviewKey }));
  return next;
}

const review = await buildPermitPackage({ ...base, state: {}, copy: "review" });
writeFileSync(`${out}/sample-review.pdf`, review.bytes);
console.log("review", review.pages, "pages,", review.readiness.left, "left");
const state = answered({});
const submit = await buildPermitPackage({ ...base, state, copy: "submit" });
writeFileSync(`${out}/sample-submit.pdf`, submit.bytes);
console.log("submit", submit.pages, "pages; sheets", submit.sheets.map((s) => `${s.number}@${s.scale?.label ?? "-"}`).join(" "));
