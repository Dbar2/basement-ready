// The one flow: every page works from the same model (server/model/current.ts), the readers that came
// before it (the quote, the book, the permit set, the materials list, the pictures) draw the design the
// homeowner picked, and the example's pictures never spend.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync as read } from "node:fs";
import { currentModel, savedModel } from "../../server/model/current";
import { applyEdit } from "../../server/model/edit";
import { mountModel } from "../../server/model/routes";
import { ModelSchema } from "../../server/model/schema";
import { designHash } from "../../server/model/furniture";
import { chosenDesign, layoutOf } from "../../server/model/legacy";
import type { Model } from "../../server/model/types";
import { basementGeometry } from "../../server/permit/plans";
import { permitModel } from "../../server/permit/model";
import { modelFor } from "../../server/quote/fromScan";
import { designAngles, designFor, newWallSegs } from "../../server/views/load";
import { mountViews } from "../../server/views/routes";
import { StateSchema } from "../../server/workspace";
import { isStep, neighbours, STEPS, stepUrl } from "../../src/flow/flow";

const sample = JSON.parse(readFileSync("public/samples/sample/result.json", "utf8"));
const seeded = () => currentModel(sample, {})!.model;
// The homeowner picked the studio and saved.
const pickedStudio = (): Model => {
  const m = seeded();
  return { ...m, designs: m.designs.map((d) => ({ ...d, chosen: d.layout === "studio" })) };
};

describe("one model for every page", () => {
  it("seeds the same furnished designs every time until one is saved", () => {
    const a = currentModel(sample, {}, "sample")!, b = currentModel(sample, {})!;
    expect(a.saved).toBe(false);
    expect(a.model.designs.map(designHash)).toEqual(b.model.designs.map(designHash));
    expect(a.model.designs.every((d) => d.proposed.furniture.length > 0)).toBe(true);
    expect(chosenDesign(a.model)?.layout).toBe("one_bedroom");
  });

  it("uses the saved model once there is one, and a board saved before it", () => {
    const saved = pickedStudio();
    expect(currentModel(sample, { model: saved })).toEqual({ model: saved, saved: true });
    expect(savedModel({ model: { version: 1, mood: saved.mood } })).toBeNull();
    const mood = { liked: ["card-3"], disliked: [], style: "warm", finishes: { style: "warm", floor: "Walnut floor" }, colours: { sofa: "Rust velvet" } };
    const m = currentModel(sample, { model: { version: 1, mood } })!;
    expect(m.saved).toBe(false);
    expect(m.model.mood).toEqual(mood);
    const d = chosenDesign(m.model)!;
    expect(d.finishes.floor).toBe("Walnut floor");
    expect(d.proposed.furniture.find((f) => f.kind === "sofa")?.colour).toBe("Rust velvet");
  });

  it("the quote, the permit set, the materials list and the pictures all draw the chosen design", async () => {
    const state = { model: pickedStudio() };
    const studio = chosenDesign(state.model)!;
    expect(chosenDesign(modelFor(sample, state))?.id).toBe(studio.id);
    const permit = permitModel(sample, state)!;
    expect(permit.from).toBe("studio");
    expect(permit.design.id).toBe(studio.id);
    // The materials list and the sheets' geometry: the studio's layout, its alarms.
    const geo = basementGeometry(sample, state)!;
    expect(geo.layout?.kind).toBe("studio");
    expect(geo.layout?.zones).toEqual(layoutOf(state.model.existing, studio)!.layout.zones);
    expect(geo.alarms.length).toBe(studio.proposed.alarms.length);
    // The example's pictures take the design by id (its model lives in the browser).
    expect((await designFor("sample", "studio"))?.layout).toBe("studio");
    expect((await designFor("sample"))?.layout).toBe("one_bedroom");
  });

  it("keeps every picture's key when the plan is confirmed as it is", async () => {
    const { seedDesigns } = await import("../../server/model/seed");
    const m = seeded();
    const confirmed = { ...m.existing, walls: m.existing.walls.map((w) => ({ ...w, guess: false })), fixtures: m.existing.fixtures.map((f) => ({ ...f, guess: false })), confirmedAt: "2026-10-31T00:00:00.000Z" };
    expect(seedDesigns(confirmed, {}).map(designHash)).toEqual(m.designs.map(designHash));
  });

  it("keeps the step it was on with the workspace", () => {
    expect(StateSchema.safeParse({ flow: { step: "studio", at: "2026-10-30T12:00:00.000Z" } }).success).toBe(true);
    expect(StateSchema.safeParse({ flow: { step: "somewhere" } }).success).toBe(false);
  });
});

describe("the flow's steps", () => {
  it("runs style, plan, layouts, studio, pictures, book, each with a way back and a way on", () => {
    expect(STEPS.map((s) => s.id)).toEqual(["style", "plan", "layouts", "studio", "pictures", "book"]);
    expect(neighbours("plan")).toMatchObject({ prev: { id: "style" }, next: { id: "layouts" } });
    expect(neighbours("style").prev).toBeNull();
    expect(neighbours("book").next).toBeNull();
    expect(stepUrl("abc", "pictures")).toBe("/scans/abc/pictures");
    expect(stepUrl("abc", "book")).toBe("/scans/abc?tab=book");
    expect(isStep("layouts")).toBe(true);
    expect(isStep("ideas")).toBe(false);
  });
});

describe("the example's committed pictures", () => {
  // What a fresh visitor's browser gets from the live site, exactly: the model route's JSON.
  const served = async () => {
    const app = new Hono();
    mountModel(app, async () => null);
    return ((await (await app.request("/api/scans/sample/model")).json()) as { model: Model }).model;
  };

  it("a design hashes the same fresh from the seed and read back from a save", async () => {
    const model = await served();
    const parsed = ModelSchema.parse(JSON.parse(JSON.stringify(model))) as Model;
    expect(parsed.designs.map(designHash)).toEqual(model.designs.map(designHash));
    // Keys in any order: the same design.
    const shuffled = model.designs.map((d) => ({ ...d, finishes: { walls: d.finishes.walls, floor: d.finishes.floor, style: d.finishes.style }, proposed: { ...d.proposed, furniture: d.proposed.furniture.map(({ roomId, sizeM, rotDeg, at, kind, id }) => ({ roomId, sizeM, rotDeg, at, kind, id })) } }));
    expect(shuffled.map(designHash)).toEqual(model.designs.map(designHash));
  });

  // The pictures step and the layout cards ask for a design's pictures by its hash; a design without
  // committed ones falls back to the 3D render (and the example never makes new ones), so this fails as
  // soon as the example's designs change without its pictures being made again (scripts in the
  // round-3 notes: gen-sample.mjs with SAMPLE_VIEWS_WRITE=1).
  it("cover every design a fresh visitor sees, in each of the studio's finishes, from every angle shown", async () => {
    const model = await served();
    const missing: string[] = [];
    for (const d of model.designs) {
      for (const style of ["light", "warm", "deep"]) {
        const design = d.finishes.style === style ? d : applyEdit(d, { op: "set_finishes", finishes: { style } });
        const hash = designHash(design);
        const angles = [...(await designAngles("sample", 5, design.proposed.furniture, newWallSegs(design))), ...(await designAngles("sample", 4, design.proposed.furniture, newWallSegs(design))).slice(0, 1)];
        expect(angles.length, `${d.id} has angles`).toBeGreaterThan(0);
        for (const a of angles) {
          const pointer = `public/samples/sample/views/${a.id}-d-${hash}.json`;
          if (!existsSync(pointer)) {
            missing.push(`${d.id} ${style} ${a.id} (${hash})`);
            continue;
          }
          const { viewKey } = JSON.parse(read(pointer, "utf8")) as { viewKey: string };
          for (const ext of ["jpg", "json"]) if (!existsSync(`public/samples/sample/views/${a.id}-${viewKey}.${ext}`)) missing.push(`${d.id} ${style} ${a.id} ${viewKey}.${ext}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("the example's pictures never spend", () => {
  const app = new Hono();
  mountViews(app);

  it("answers a picture it has no committed copy of with the render, and keeps nothing", async () => {
    const before = process.env.MODEL_API_KEY;
    process.env.MODEL_API_KEY = "test-key-never-used";
    try {
      const views = (await (await app.request("/api/scans/sample/views?designId=studio")).json()) as { angles: { id: string }[]; design: { id: string } };
      expect(views.design.id).toBe("studio");
      const angle = views.angles[0].id;
      const form = new FormData();
      form.append("guide", new File([Buffer.from("not-a-real-render")], "g.jpg", { type: "image/jpeg" }));
      form.append("meta", JSON.stringify({ designHash: "zzz123", viewKey: "zzz999", items: [], finishes: {} }));
      const res = await app.request(`/api/scans/sample/views/${angle}`, { method: "POST", body: form });
      const body = (await res.json()) as { kind: string; attempts: number; url: string | null };
      expect(body).toMatchObject({ kind: "render", attempts: 0, url: null });
    } finally {
      if (before === undefined) delete process.env.MODEL_API_KEY;
      else process.env.MODEL_API_KEY = before;
    }
  });
});
