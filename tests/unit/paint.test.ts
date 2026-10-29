import { describe, expect, it } from "vitest";
import {
  BANDS,
  COLS,
  CoverageGrid,
  FILL_SEC,
  LENS_FOV,
  Steady,
  cameraHeading,
  cellIndex,
  describeGap,
  nextGap,
  seen,
  type View,
} from "../../src/capture/paint";

const band = (name: (typeof BANDS)[number]) => BANDS.indexOf(name);
const wide = LENS_FOV.wide;

// Holds the phone at one heading and tilt for `ms`, one reading every 16 ms (60 Hz).
function hold(grid: CoverageGrid, view: View, ms: number, from = 0, fov = wide, ok = true) {
  for (let t = from; t <= from + ms; t += 16) grid.push(view, t, fov, ok);
  return from + ms;
}

// Turns through 360° at one tilt, at 60 Hz: 0.5° a reading is about 30°/s.
function sweep(grid: CoverageGrid, elev: number, from = 0, fov = wide, step = 0.5) {
  let t = from;
  for (let h = 0; h <= 360; h += step, t += 16) grid.push({ heading: h % 360, elev }, t, fov);
  return t;
}

describe("painting the basement from heading and tilt", () => {
  it("fills the wall cells straight ahead when the phone is level, and nothing behind", () => {
    const g = new CoverageGrid();
    hold(g, { heading: 90, elev: 0 }, 2000);
    const col = 90 / 15; // the slice from 90° to 105° sits just right of centre, 75°–90° just left
    expect(g.fill(cellIndex(band("mid"), col))).toBe(1);
    expect(g.fill(cellIndex(band("mid"), col - 1))).toBe(1);
    expect(g.fill(cellIndex(band("high"), col))).toBe(1);
    // Behind, and the ceiling and floor, stay unpainted.
    expect(g.fill(cellIndex(band("mid"), (col + 12) % COLS))).toBe(0);
    expect(g.fill(cellIndex(band("ceiling"), col))).toBe(0);
    expect(g.fill(cellIndex(band("floor"), col))).toBe(0);
  });

  it("paints the ceiling when tilted up, and the floor when tilted down", () => {
    const g = new CoverageGrid();
    let t = hold(g, { heading: 0, elev: 55 }, 2000);
    hold(g, { heading: 180, elev: -60 }, 2000, t + 1);
    expect(g.fill(cellIndex(band("ceiling"), 0))).toBe(1);
    expect(g.fill(cellIndex(band("mid"), 0))).toBe(0);
    expect(g.fill(cellIndex(band("floor"), 12))).toBe(1);
    expect(g.fill(cellIndex(band("ceiling"), 12))).toBe(0);
  });

  it("covers the whole wall band in one slow turn, and the 0.5x lens covers more per turn", () => {
    const g = new CoverageGrid();
    sweep(g, 0);
    expect(g.percent("walls")).toBeGreaterThan(0.95);
    expect(g.percent("ceiling")).toBe(0);
    // Turning twice as fast, the normal lens leaves gaps; the 0.5x lens still gets it all, and some
    // of the ceiling besides.
    const quick = new CoverageGrid();
    sweep(quick, 0, 0, wide, 1);
    const u = new CoverageGrid();
    sweep(u, 0, 0, LENS_FOV.ultrawide, 1);
    expect(quick.percent("walls")).toBeLessThan(0.9);
    expect(u.percent("walls")).toBeGreaterThan(0.95);
    expect(u.percent("ceiling")).toBeGreaterThan(0);
  });

  it("pointing straight up paints the ceiling all round, wobbly compass and all", () => {
    const g = new CoverageGrid();
    // Near straight up the compass swings wildly, but the camera barely moves.
    for (let t = 0, i = 0; t < 4000; t += 16, i++) g.push({ heading: (i * 37) % 360, elev: 88 }, t, wide);
    for (let c = 0; c < COLS; c++) expect(g.paint[cellIndex(band("ceiling"), c)]).toBeGreaterThan(0);
  });

  it("only counts steady, bright filming: not in the dark, not whipping round", () => {
    const dark = new CoverageGrid();
    hold(dark, { heading: 0, elev: 0 }, 2000, 0, wide, false);
    expect(dark.percent("walls")).toBe(0);
    const fast = new CoverageGrid();
    // 180°/s: a blur.
    for (let t = 0; t < 2000; t += 16) fast.push({ heading: ((t / 1000) * 180) % 360, elev: 0 }, t, wide);
    expect(fast.percent("walls")).toBe(0);
  });

  it("takes about 0.7 s of steady filming to fill a cell", () => {
    const g = new CoverageGrid();
    hold(g, { heading: 7.5, elev: 0 }, (FILL_SEC * 1000) / 2);
    const half = g.fill(cellIndex(band("mid"), 0));
    expect(half).toBeGreaterThan(0.4);
    expect(half).toBeLessThan(0.6);
  });

  it("fades the old paint quietly when the basement looks different", () => {
    const g = new CoverageGrid();
    sweep(g, 0);
    const before = g.percent("walls");
    g.fade();
    expect(g.percent("walls")).toBeLessThan(before * 0.4);
    expect(g.percent("walls")).toBeGreaterThan(0);
  });

  it("sees part of a cell at the edge of the picture", () => {
    const share = seen({ heading: 0, elev: 0 }, wide);
    // 18° either side of north: the slices 0–15° and 345–360° fully, the next ones not at all.
    expect(share[cellIndex(band("mid"), 0)]).toBe(1);
    expect(share[cellIndex(band("mid"), 23)]).toBe(1);
    expect(share[cellIndex(band("mid"), 2)]).toBe(0);
    // The low wall band is only partly in the picture with the phone level.
    expect(share[cellIndex(band("low"), 0)]).toBeGreaterThan(0);
    expect(share[cellIndex(band("low"), 0)]).toBeLessThan(1);
  });
});

describe("the compass heading of the rear camera", () => {
  it("matches the plain alpha rule when the phone is upright", () => {
    expect(cameraHeading(0, 90, 0)).toBeCloseTo(0);
    expect(cameraHeading(90, 90, 0)).toBeCloseTo(270);
    expect(cameraHeading(270, 90, 0)).toBeCloseTo(90);
  });

  it("stays put when the phone tilts up or down", () => {
    expect(cameraHeading(90, 120, 0)).toBeCloseTo(270);
    expect(cameraHeading(90, 60, 0)).toBeCloseTo(270);
  });
});

describe("the next direction", () => {
  it("points at the biggest stretch of wall not filmed, by the shortest turn", () => {
    const g = new CoverageGrid();
    // Filmed the walls from 0° to about 180°, facing 90°.
    let t = 0;
    for (let h = 0; h <= 180; h += 0.5, t += 16) g.push({ heading: h, elev: 0 }, t, wide);
    const gap = nextGap((i) => g.fill(i), { heading: 90, elev: 0 }, "walls");
    expect(gap?.turn).toBe("around");
    expect(gap?.side).toBe("behind");
    const right = nextGap((i) => g.fill(i), { heading: 180, elev: 0 }, "walls");
    expect(right?.turn).toBe("right");
  });

  it("aims at the middle of the wall when the whole stretch is missing: no tilt needed", () => {
    const g = new CoverageGrid();
    let t = 0;
    for (let h = 0; h <= 180; h += 0.5, t += 16) g.push({ heading: h, elev: 0 }, t, wide);
    const gap = nextGap((i) => g.fill(i), { heading: 90, elev: -5 }, "walls");
    expect(gap?.band).toBe(band("mid"));
    expect(gap?.tilt).toBeNull();
  });

  it("says tilt up for the ceiling, tilt down for the floor", () => {
    const g = new CoverageGrid();
    sweep(g, 0);
    const up = nextGap((i) => g.fill(i), { heading: 0, elev: 0 }, "ceiling");
    expect(up).toMatchObject({ turn: null, tilt: "up", band: band("ceiling"), side: "ahead" });
    expect(describeGap(up!)).toBe("The ceiling over there");
    const down = nextGap((i) => g.fill(i), { heading: 0, elev: 0 }, "floor");
    expect(down?.tilt).toBe("down");
  });

  it("names the lower left wall", () => {
    expect(describeGap({ col: 0, band: band("low"), turn: "left", tilt: "down", side: "left" })).toBe("The lower left wall");
    expect(describeGap({ col: 0, band: band("mid"), turn: "around", tilt: null, side: "behind" })).toBe("The wall behind you");
  });

  it("stays quiet when the walls are done or only a sliver is missing", () => {
    const g = new CoverageGrid();
    sweep(g, 0);
    sweep(g, 0, 10_000);
    expect(nextGap((i) => g.fill(i), { heading: 0, elev: 0 }, "walls")).toBeNull();
  });
});

describe("holding a direction steady", () => {
  it("shows a direction only after it has held for 2.5 s", () => {
    const s = new Steady<string>(2500, 1200);
    expect(s.push("left", 0)).toBeNull();
    expect(s.push("left", 2400)).toBeNull();
    expect(s.push("left", 2500)).toBe("left");
  });

  it("ignores compass jitter flipping left and right", () => {
    const s = new Steady<string>(2500, 1200);
    s.push("left", 0);
    s.push("left", 2500);
    // A right that never holds for 2.5 s never shows; left stays.
    for (let t = 2600; t < 10_000; t += 200) expect(s.push(Math.floor(t / 1000) % 2 ? "right" : "left", t)).toBe("left");
  });

  it("switches once the new direction holds, and clears once it's gone for a moment", () => {
    const s = new Steady<string>(2500, 1200);
    s.push("left", 0);
    s.push("left", 2500);
    s.push("right", 3000);
    expect(s.push("right", 5400)).toBe("left");
    expect(s.push("right", 5500)).toBe("right");
    expect(s.push(null, 6000)).toBe("right");
    expect(s.push(null, 7200)).toBeNull();
  });
});
