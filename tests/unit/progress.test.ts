// The milestones on the home base and the guide's top bar (src/guide/progress.ts): what's done, what's
// next, and when /scans/:id opens the guide instead.
import { describe, expect, it } from "vitest";
import { guideUrl, isMilestone, progress } from "../../src/guide/progress";
import type { GuideState } from "../../src/guide/types";

const guide = (done: Partial<GuideState["done"]>): GuideState => ({
  step: "answer",
  milestone: "answer",
  done: { answer: false, design: false, build: false, ...done },
  messages: [],
  visual: { kind: "plan" },
});

describe("progress", () => {
  it("opens the guide while it measures", () => {
    expect(progress({ guide: null, measured: false }).openGuide).toBe(true);
    expect(progress({ guide: guide({ answer: true }), measured: false }).openGuide).toBe(true);
  });

  it("opens the guide until they've had their answer, then the home base", () => {
    const first = progress({ guide: guide({}), measured: true });
    expect(first.openGuide).toBe(true);
    expect(first.next).toBe("answer");
    expect(first.status).toEqual({ answer: "next", design: "todo", build: "todo" });

    const later = progress({ guide: guide({ answer: true }), measured: true });
    expect(later.openGuide).toBe(false);
    expect(later.next).toBe("design");
    expect(later.status).toEqual({ answer: "done", design: "next", build: "todo" });
  });

  it("has nothing next once all three are done", () => {
    const p = progress({ guide: guide({ answer: true, design: true, build: true }), measured: true });
    expect(p.next).toBeNull();
    expect(Object.values(p.status)).toEqual(["done", "done", "done"]);
  });

  it("counts the old flow's step for a scan from before the guide", () => {
    expect(progress({ guide: null, state: { flow: { step: "style" } }, measured: true }).next).toBe("answer");
    expect(progress({ guide: null, state: { flow: { step: "studio" } }, measured: true }).next).toBe("design");
    const book = progress({ guide: guide({}), state: { flow: { step: "book" } }, measured: true });
    expect(book.next).toBe("build");
    expect(book.openGuide).toBe(false);
  });

  it("links the guide at a milestone, or where it is", () => {
    expect(guideUrl("abc", "build")).toBe("/scans/abc/guide?at=build");
    expect(guideUrl("abc")).toBe("/scans/abc/guide");
    expect(isMilestone("design")).toBe(true);
    expect(isMilestone("book")).toBe(false);
  });
});
