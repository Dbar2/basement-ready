// The QA capture plan (scripts/qa/plan.ts): what gets shot, in which browsers and sizes, and how
// --only narrows it.
import { describe, expect, it } from "vitest";
import { parseArgs } from "../../scripts/qa/args";
import { buildPlan, CAMERAS, matches, SCREENS, selectScreens, STORY_STEPS } from "../../scripts/qa/plan";
import { cameraPose, eyeCandidates } from "../../scripts/qa/three";

const plan = (o: Partial<Parameters<typeof buildPlan>[0]> = {}) => buildPlan({ scans: ["sample"], ...o });

describe("capture plan", () => {
  it("shoots every journey screen in both browsers at both sizes", () => {
    const shots = plan();
    const journey = SCREENS.filter((s) => s.group === "journey");
    for (const s of journey) {
      for (const b of ["chromium", "webkit"]) for (const v of ["phone", "desktop"]) expect(shots.some((x) => x.screen === s.id && x.browser === b && x.viewport === v), `${s.id} ${b} ${v}`).toBe(true);
    }
  });

  it("covers the screens the brief names", () => {
    const ids = plan().map((s) => s.screen);
    for (const id of ["home", "workspace-answer", "workspace-book", "workspace-permit", "plan-confirm", "style", "layouts", "studio", "pictures", "home-story", "studio-3d", "scan-3d", "plan-overlay", "permit-pdf", "book-pdf"]) expect(ids).toContain(id);
    const routes = new Set(plan().map((s) => s.route));
    for (const r of ["/", "/scans/sample", "/scans/sample/plan", "/scans/sample/style", "/scans/sample/layouts", "/scans/sample/studio", "/scans/sample/pictures"]) expect(routes).toContain(r);
    // Every workspace tab names the button it's opened with.
    for (const s of SCREENS.filter((x) => x.route === "/scans/{scan}" && x.kind === "page" && x.id.startsWith("workspace-"))) expect(s.tab?.length, s.id).toBeGreaterThan(0);
  });

  it("gives each 3D view the three fixed cameras, and the home story its scroll steps", () => {
    const shots = plan({ browsers: ["chromium"], viewports: ["desktop"] });
    for (const s of SCREENS.filter((x) => x.kind === "3d" && !x.optIn)) {
      expect(shots.filter((x) => x.screen === s.id && x.camera).map((x) => x.camera)).toEqual(CAMERAS);
    }
    expect(shots.filter((x) => x.screen === "home-story" && x.step).map((x) => x.step)).toEqual(STORY_STEPS);
  });

  it("draws the overlay and renders PDFs once, in desktop Chromium", () => {
    for (const id of ["plan-overlay", "permit-pdf", "book-pdf"]) {
      const shots = plan().filter((s) => s.screen === id);
      expect(shots).toHaveLength(1);
      expect(shots[0]).toMatchObject({ browser: "chromium", viewport: "desktop" });
    }
  });

  it("names every shot uniquely and safely for a file", () => {
    const ids = plan({ all: true, scans: ["sample", "3f2a-take"] }).map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9@.-]+$/i);
  });

  it("shoots the pictures page's hidden canvas only when asked", () => {
    expect(plan().some((s) => s.screen === "pictures-3d")).toBe(false);
    expect(plan({ only: ["pictures-3d"] }).filter((s) => s.camera)).toHaveLength(12);
  });

  it("leaves the marketing pages out unless asked", () => {
    expect(plan().some((s) => s.group === "marketing")).toBe(false);
    expect(plan({ all: true }).some((s) => s.group === "marketing")).toBe(true);
    expect(plan({ only: ["marketing"] }).every((s) => s.group === "marketing")).toBe(true);
  });

  it("narrows with --only by id, group or prefix", () => {
    expect(new Set(plan({ only: ["studio"] }).map((s) => s.screen))).toEqual(new Set(["studio"]));
    expect(new Set(plan({ only: ["workspace-*"] }).map((s) => s.screen))).toEqual(new Set(SCREENS.filter((s) => s.id.startsWith("workspace-")).map((s) => s.id)));
    expect(selectScreens({ only: ["docs"] }).map((s) => s.id).sort()).toEqual(["book-pdf", "permit-pdf"]);
    expect(plan({ only: ["nothing-like-this"] })).toEqual([]);
    expect(matches(SCREENS[0], [" "], false)).toBe(false);
  });

  it("shoots a second scan's screens but the home page once", () => {
    const shots = plan({ scans: ["sample", "abc"], browsers: ["chromium"], viewports: ["desktop"] });
    expect(shots.filter((s) => s.screen === "home")).toHaveLength(1);
    expect(shots.some((s) => s.id === "studio@abc.chromium.desktop" && s.route === "/scans/abc/studio")).toBe(true);
  });

  it("tells the reviewer what each screen is for", () => {
    for (const s of SCREENS) {
      expect(s.purpose.length, s.id).toBeGreaterThan(20);
      expect(s.title.length, s.id).toBeGreaterThan(3);
    }
  });
});

describe("fixed cameras", () => {
  const room = { min: [-3.8, 0, -2.7], max: [3.8, 2.1, 2.8] };

  it("puts the eye at 1.5 m inside the room, with the ceiling on", () => {
    const p = cameraPose("eye", room, 1.6);
    expect(p.position[1]).toBeCloseTo(1.5);
    expect(p.position[0]).toBeGreaterThan(room.min[0]);
    expect(p.position[2]).toBeLessThan(room.max[2]);
    expect(p.cut).toBeNull();
  });

  it("looks straight down from above with the ceiling cut away, and frames the whole room", () => {
    const p = cameraPose("above", room, 1.6);
    expect(p.position[0]).toBeCloseTo(0);
    expect(p.target[1]).toBe(0);
    expect(p.cut).toBeGreaterThan(1.5);
    expect(p.cut).toBeLessThan(2.1);
    const halfView = p.position[1] * Math.tan(((p.fov / 2) * Math.PI) / 180);
    expect(halfView * 2).toBeGreaterThan(5.5);
    expect(p.far).toBeGreaterThan(p.position[1]);
  });

  it("tries several places to stand at eye level, all inside the room", () => {
    const tries = eyeCandidates(room);
    expect(tries.length).toBeGreaterThanOrEqual(4);
    for (const t of tries) {
      expect(t.position[1]).toBeCloseTo(1.5);
      expect(t.position[0]).toBeGreaterThan(room.min[0]);
      expect(t.position[0]).toBeLessThan(room.max[0]);
      expect(t.position[2]).toBeGreaterThan(room.min[2]);
      expect(t.position[2]).toBeLessThan(room.max[2]);
    }
  });

  it("sees a corner from outside and above", () => {
    const p = cameraPose("corner", room, 1.6);
    expect(p.position[0]).toBeGreaterThan(room.max[0]);
    expect(p.position[2]).toBeGreaterThan(room.max[2]);
    expect(p.position[1]).toBeGreaterThan(room.max[1]);
  });
});

describe("command line", () => {
  it("defaults to the sample, both browsers and sizes, $3", () => {
    const a = parseArgs([]);
    expect(a).toMatchObject({ scans: ["sample"], browsers: ["chromium", "webkit"], viewports: ["phone", "desktop"], budget: 3, effort: "medium", captureOnly: false });
  });

  it("reads lists, numbers and = forms", () => {
    const a = parseArgs(["--only", "studio,book", "--budget=1.5", "--browsers", "chromium", "--viewports=phone"]);
    expect(a.only).toEqual(["studio", "book"]);
    expect(a.budget).toBe(1.5);
    expect(a.browsers).toEqual(["chromium"]);
    expect(a.viewports).toEqual(["phone"]);
  });

  it("reviews the latest capture with --review-only", () => {
    expect(parseArgs(["--review-only"]).from).toBe("latest");
  });

  it("refuses what it doesn't know", () => {
    expect(() => parseArgs(["--browsers", "firefox"])).toThrow(/unknown browser/);
    expect(() => parseArgs(["--budget", "lots"])).toThrow(/budget/);
    expect(() => parseArgs(["--frobnicate"])).toThrow(/unknown option/);
  });
});
