// The practice harness's scoring (scripts/practice/scoring.ts): when a find counts as landing on a
// labelled thing, how a photo's finds become hits, misses and false finds, and how Spark is graded.
import { describe, expect, it } from "vitest";
import { matches, scoreKey, sparkGrade, type Label } from "../../scripts/practice/scoring";

const label = (objects: Label["objects"], unsure: string[] = []): Label => ({ file: "x.png", keep: true, objects, unsure });

describe("matches", () => {
  it("counts a find whose centre lands in the label, with a little slack for boxes drawn by eye", () => {
    expect(matches([0.4, 0.4, 0.1, 0.1], [0.3, 0.3, 0.3, 0.3])).toBe(true);
    expect(matches([0.62, 0.3, 0.04, 0.04], [0.3, 0.3, 0.3, 0.3])).toBe(true); // centre 0.64: inside the 5% slack
    expect(matches([0.8, 0.8, 0.1, 0.1], [0.3, 0.3, 0.3, 0.3])).toBe(false);
  });

  it("counts a big find that overlaps the label well even when its centre is off", () => {
    expect(matches([0.1, 0.1, 0.6, 0.6], [0.3, 0.3, 0.5, 0.5])).toBe(true);
  });
});

describe("scoreKey", () => {
  it("matches each labelled thing once and counts finds on nothing", () => {
    const t = scoreKey(label({ window: [[0.1, 0.1, 0.2, 0.1], [0.6, 0.1, 0.2, 0.1]] }), "window", [
      { key: "window", box: [0.12, 0.1, 0.18, 0.1], c: 0.9 },
      { key: "window", box: [0.5, 0.7, 0.2, 0.2], c: 0.6 },
    ]);
    expect(t).toEqual({ photos: 1, hit: 1, miss: 0, falsePhotos: 0, tp: 1, fn: 1, fp: 1 });
  });

  it("doesn't call a second box on the same thing a false find", () => {
    const t = scoreKey(label({ door: [[0.2, 0.2, 0.3, 0.6]] }), "door", [
      { key: "door", box: [0.2, 0.2, 0.3, 0.6], c: 0.9 },
      { key: "door", box: [0.25, 0.3, 0.2, 0.4], c: 0.7 },
    ]);
    expect(t).toMatchObject({ tp: 1, fp: 0 });
  });

  it("marks a photo without the thing as a false find when something was found, and skips unsure ones", () => {
    expect(scoreKey(label({}), "drain", [{ key: "drain", box: [0.5, 0.8, 0.05, 0.05], c: 0.6 }])).toMatchObject({ photos: 0, falsePhotos: 1, fp: 1 });
    expect(scoreKey(label({}, ["drain"]), "drain", [{ key: "drain", box: [0.5, 0.8, 0.05, 0.05], c: 0.6 }])).toBeNull();
    expect(scoreKey(label({ furnace: [[0.1, 0.1, 0.3, 0.5]] }), "furnace", [])).toMatchObject({ photos: 1, miss: 1, fn: 1 });
  });
});

describe("sparkGrade", () => {
  it("grades a due claim, a hedge and the opposite claim", () => {
    expect(sparkGrade("fix", "likely_fix")).toBe("right");
    expect(sparkGrade("fix", "needs_measurement")).toBe("missed");
    expect(sparkGrade("fix?", "needs_measurement")).toBe("hedge");
    expect(sparkGrade("fix?", "likely_ok")).toBe("wrong");
    expect(sparkGrade("ok", "likely_fix")).toBe("wrong");
  });

  it("treats any claim as wrong when the photo can't settle the rule, and a held-back claim as no claim", () => {
    expect(sparkGrade("none", "likely_ok")).toBe("wrong");
    expect(sparkGrade("none", "needs_answer")).toBe("right");
    expect(sparkGrade("none", "held_back")).toBe("right");
    expect(sparkGrade("fix", "held_back")).toBe("missed");
  });
});
