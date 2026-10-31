// We never publish accuracy or error figures: no "±", no "5-20%" beside a size, on any sheet, in the book,
// the quote, the materials list or the answer. And the bedroom's window is called an escape window only
// once a size that meets the rule is known, on every sheet.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBook } from "../../server/book/book";
import { diyPlan } from "../../server/diy/plan";
import { currentModel } from "../../server/model/current";
import { chosenDesign } from "../../server/model/legacy";
import { permitModel } from "../../server/permit/model";
import { buildPermitPackage } from "../../server/permit/package";
import { pricedSample } from "../../server/priced";
import { quote } from "../../server/quote/quote";
import type { StoredState } from "../../server/workspace";
import { readPdf } from "../e2e/support/pdf";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const base = { municipality: "waterloo-on", address: "The sample basement", profile: null, site: null, aerialJpeg: null, favourites: [], today: "2026-10-31", fetchPdf: async () => null };
const W1 = permitModel(sample, {})!.windows.find((w) => w.tag === "W1")!.id;
const pdfText = async (bytes: Uint8Array) => (await readPdf(bytes)).pages.map((p) => p.text.replace(/\s+/g, " ")).join(" ");
// An error figure: a ± anywhere, or a percentage said of sizes, the video, the scan or its accuracy (a
// cost contingency's percentage is not one).
const figure = /±|\+\/-|(size|video|scan|accura)[^.]{0,40}\d+\s*(?:[-–]\s*\d+\s*)?%/i;

describe("no error figures", () => {
  it("on the permit set, in the book, the quote, the materials list and the answer", async () => {
    const permit = await pdfText((await buildPermitPackage({ ...base, result: sample, state: {}, copy: "review" })).bytes);
    expect(permit).toContain("Sizes from the video until taped: tape one wall on the Permit tab");
    expect(permit).not.toMatch(figure);
    const model = currentModel(sample, {}, "sample")!.model;
    const priced = pricedSample(sample, {});
    const book = await pdfText((await buildBook({ address: "The sample basement", municipality: "waterloo-on", result: priced, model, pictures: [], mood: [], today: "2026-10-31" })).bytes);
    expect(book).not.toMatch(figure);
    const q = quote(model, chosenDesign(model)!, { municipality: "waterloo-on" });
    expect(q.assumptions.join(" ")).not.toMatch(figure);
    expect(JSON.stringify(diyPlan(sample, {}, "waterloo-on"))).not.toMatch(figure);
    expect(JSON.stringify(priced)).not.toMatch(/±/);
  });
});

describe("the bedroom's window on every sheet", () => {
  const sheet = async (state: StoredState, n: string) => {
    const pdf = await readPdf((await buildPermitPackage({ ...base, result: sample, state, copy: "review" })).bytes);
    return pdf.pages[pdf.sheets.find((s) => s.number === n)!.page - 1].text.replace(/\s+/g, " ");
  };

  it("is 'escape size to be taped' on A2 and A5 while only its width is known", async () => {
    const a2 = await sheet({}, "A2");
    expect(a2).toContain('W1 18" (450) WIDE');
    expect(a2).toContain("EXISTING, ESCAPE SIZE TO BE TAPED");
    expect(a2).not.toMatch(/EXISTING, ESCAPE(?! SIZE)/);
    expect(await sheet({}, "A5")).toContain("W1: EXISTING WINDOW: ESCAPE SIZE TO BE TAPED");
  });

  it("is an escape window once a taped size meets the rule, and enlarged when it doesn't", async () => {
    const meets = { permit: { windows: [{ id: W1, widthMm: 610, heightMm: 762, sillMm: 1120 }] } };
    expect(await sheet(meets, "A2")).toMatch(/EXISTING, ESCAPE(?! SIZE)/);
    const small = { permit: { windows: [{ id: W1, widthMm: 450, heightMm: 600, sillMm: 1200 }] } };
    expect(await sheet(small, "A2")).toContain("ENLARGED, ESCAPE");
  });
});
