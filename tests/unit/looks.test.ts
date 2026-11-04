import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { designHash } from "../../server/model/furniture";
import { seedModel } from "../../server/model/seed";
import { finishKeyFor, finishWords, LOOK_FINISHES, withLook, type FinishKey } from "../../server/views/finishWords";

describe("the four looks", () => {
  const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
  const model = seedModel(sample, {}, "2026-10-30T00:00:00.000Z")!;

  it("draws each look in its own 3D finish and asks its pictures for its own floor and walls", () => {
    for (const look of Object.keys(LOOK_FINISHES) as FinishKey[]) expect(finishKeyFor(LOOK_FINISHES[look])).toBe(look);
    const plain = finishWords(LOOK_FINISHES.plain);
    expect(plain.floor).toMatch(/pale grey/);
    expect(plain.walls).toBe("bright white");
    expect(plain.colour("kitchen")).toBe("white flat-front");
    expect(finishWords(LOOK_FINISHES.warm).floor).toBe("warm wood plank");
  });

  it("keeps a design seeded in Light oak as it is, so its pictures still match, and changes only the finishes for another look", () => {
    const d = model.designs[0];
    expect(designHash(withLook(d, "light"))).toBe(designHash(d));
    const warm = withLook(d, "warm");
    expect(designHash(warm)).not.toBe(designHash(d));
    expect(warm.proposed).toBe(d.proposed);
    expect(warm.finishes).toMatchObject({ style: "warm", floor: "Warm wood plank", walls: "Cream" });
  });

  it("has the example's pictures for every look of its recommended design", () => {
    const d = model.designs.find((x) => x.id === model.recommended?.designId) ?? model.designs[0];
    for (const look of Object.keys(LOOK_FINISHES) as FinishKey[]) {
      const kept = (() => {
        try {
          return JSON.parse(readFileSync(`public/samples/sample/views/0-0042-d-${designHash(withLook(d, look))}.json`, "utf8")) as { viewKey: string };
        } catch {
          return null;
        }
      })();
      expect(kept, look).not.toBeNull();
      const meta = JSON.parse(readFileSync(`public/samples/sample/views/0-0042-${kept!.viewKey}.json`, "utf8"));
      expect(meta).toMatchObject({ kind: "photo", kept: true });
    }
  });
});
