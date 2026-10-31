// The plan editor in the guide's visual pane (src/guide/visuals/PlanEdit.tsx): the plan filling a phone's
// pane with every word on it inside the pane, a picked wall's callout beside it and clear of it, labels
// that don't run off the edge, and lengths typed or said the way people read a tape.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { currentModel } from "../../server/model/current";
import { withTape } from "../../server/model/edit";
import { wallLength } from "../../server/model/geometry";
import { placeCallout, placeTags, textBox } from "../../src/studio/labels";
import { parseLength } from "../../src/studio/LengthInput";
import { frameOf, planScale, PlanSvg } from "../../src/studio/PlanSvg";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const existing = currentModel(sample, {}, "sample")!.model.existing;
const phone = { w: 390, h: 330, top: 44, bottom: 30 };

const draw = (props: Partial<Parameters<typeof PlanSvg>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PlanSvg, { layer: existing, frame: frameOf(existing, 0.3), units: "m", label: "Your basement's plan", selected: null, onSelect: () => {}, canDragWall: () => true, canDragOpening: () => true, canDragFixture: () => true, fit: phone, focusable: true, knobs: true, ...props }),
  );

describe("the plan in a phone's pane", () => {
  it("fills the pane at its own shape, its words at screen sizes, all of them inside it", () => {
    const svg = draw();
    const [, , W, H] = svg.match(/viewBox="([^"]+)"/)![1].split(" ").map(Number);
    expect(W / H).toBeCloseTo(390 / 330, 3);
    expect(svg).toContain("data-fit");
    // 11 px plan labels, whatever the drawing's units.
    const u = W / 390;
    expect(svg).toContain(`--t-tag:${11 * u}px`);
    // The overall width and depth, as the e2e reads them off the drawing.
    expect(svg).toContain("7.56 m");
    expect(svg).toContain("5.52 m");
    // Every word on the plan sits inside the pane, under its tools and above its caption.
    const texts = [...svg.matchAll(/<text x="([^"]+)" y="([^"]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
    expect(texts.length).toBeGreaterThan(5);
    for (const [x, y] of texts) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(W);
      expect(y).toBeGreaterThan(phone.top * u);
      expect(y).toBeLessThan(H - phone.bottom * u);
    }
  });

  it("draws the walls inside the pane, clear of the tools on top and the caption below", () => {
    const frame = frameOf(existing, 0.3);
    const { s, ox, oz, u, W, H } = planScale(frame, phone);
    const px = (x: number, z: number) => [(ox + (x - frame.minX) * s) / u, (oz + (z - frame.minZ) * s) / u];
    for (const w of existing.walls)
      for (const [x, y] of [px(...w.a), px(...w.b)]) {
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(W / u);
        expect(y).toBeGreaterThan(phone.top);
        expect(y).toBeLessThan(H / u - phone.bottom);
      }
  });

  it("shows the picked wall's green knobs, and makes walls, rooms and finds tab stops", () => {
    const wall = existing.walls[0];
    const svg = draw({ selected: { kind: "wall", id: wall.id } });
    expect(svg.match(/class="model-knob"/g)).toHaveLength(2);
    expect(svg).toContain('class="model-selband"');
    expect(svg).toMatch(new RegExp(`data-wall="${wall.id}" tabindex="0" role="button" aria-label="Outside wall, \\d\\.\\d\\d m`));
    expect(svg).toMatch(/data-room="[^"]+"[^>]*tabindex="0" role="button" aria-label="Room: /);
    expect(draw()).not.toContain('class="model-knob"');
  });

  it("dashes a guessed wall", () => {
    const guess = existing.walls.find((w) => w.guess);
    expect(guess).toBeTruthy();
    expect(draw()).toMatch(/data-guess="true"[^>]*><line[^>]*stroke-dasharray/);
  });
});

describe("a callout beside what it's about", () => {
  const box = { w: 232, h: 130 };
  const pane = { w: 390, h: 330, top: 44, bottom: 8 };

  it("sits inside the pane, under the tools, wherever the point is", () => {
    for (let x = 10; x <= 380; x += 30)
      for (let y = 50; y <= 320; y += 30) {
        const c = placeCallout([x, y], box, pane);
        expect(c.x).toBeGreaterThanOrEqual(8);
        expect(c.x + box.w).toBeLessThanOrEqual(pane.w - 8);
        expect(c.y).toBeGreaterThanOrEqual(pane.top);
        expect(c.y + box.h).toBeLessThanOrEqual(pane.h - pane.bottom);
      }
  });

  it("leaves the point it's about uncovered, with its leader running to it", () => {
    for (const at of [[350, 190], [30, 120], [195, 100], [195, 300], [200, 190]] as [number, number][]) {
      const c = placeCallout(at, box, pane);
      const outside = Math.max(c.x - at[0], at[0] - (c.x + box.w), c.y - at[1], at[1] - (c.y + box.h));
      expect(outside, `${at}`).toBeGreaterThanOrEqual(10);
      expect(c.leader[0]).toEqual(at);
    }
  });

  it("goes beside a wall on the right, to its left", () => {
    expect(placeCallout([350, 190], box, pane).side).toBe("left");
    expect(placeCallout([30, 190], box, pane).side).toBe("right");
  });
});

describe("labels on a plan that fills a pane", () => {
  it("never run off its edge: another spot, or the short text", () => {
    const within = { x0: 0, y0: 0, x1: 300, y1: 200 };
    const long = { id: "duct", text: "DUCT · 1.64 m CLEAR · DRAG TO PLACE", short: "DUCT · 1.64 m CLEAR", size: 11, spots: [[250, 100], [150, 100]] as [number, number][] };
    const at = placeTags([], [long], 4, within).get("duct")!;
    const b = textBox(at.x, at.y, at.text, 11);
    expect(b.x0).toBeGreaterThanOrEqual(0);
    expect(b.x1).toBeLessThanOrEqual(300);
    // A room name on the left, and no spot where the long text fits on the plan: the short one does.
    const name = { x0: 60, y0: 85, x1: 150, y1: 105 };
    const short = placeTags([name], [{ ...long, spots: [[105, 100], [230, 100]] }], 4, within).get("duct")!;
    expect(short).toEqual({ x: 230, y: 100, text: "DUCT · 1.64 m CLEAR" });
  });
});

describe("a length from a tape, typed or said", () => {
  it("reads metres, centimetres, feet and inches as people say them", () => {
    expect(parseLength("5.5", "m")).toBe(5.5);
    expect(parseLength("5.5 metres", "m")).toBe(5.5);
    expect(parseLength("5.5 meters", "ft")).toBe(5.5);
    expect(parseLength("5.5 m", "ft")).toBe(5.5);
    expect(parseLength("550 cm", "m")).toBeCloseTo(5.5);
    expect(parseLength("550 centimetres", "m")).toBeCloseTo(5.5);
    expect(parseLength(`18' 6"`, "m")).toBeCloseTo(5.639, 3);
    expect(parseLength("18 feet", "m")).toBeCloseTo(5.486, 3);
    expect(parseLength("18", "ft")).toBeCloseTo(5.486, 3);
    expect(parseLength("five", "m")).toBeNull();
  });

  it("scales the whole plan to the taped wall, as the thread's setWall does", () => {
    const wall = existing.walls.find((w) => w.kind === "foundation")!;
    const taped = withTape(existing, wall.id, 5.5);
    expect(wallLength(taped.walls.find((w) => w.id === wall.id)!)).toBeCloseTo(5.5, 2);
    expect(taped.scale.source).toBe("tape");
  });
});
