// The one flow: every page works from the same model (server/model/current.ts), the readers that came
// before it (the quote, the book, the permit set, the materials list, the pictures) draw the design the
// homeowner picked, and the example's pictures never spend.
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { currentModel, savedModel } from "../../server/model/current";
import { designHash } from "../../server/model/furniture";
import { chosenDesign, layoutOf } from "../../server/model/legacy";
import type { Model } from "../../server/model/types";
import { basementGeometry } from "../../server/permit/plans";
import { permitModel } from "../../server/permit/model";
import { modelFor } from "../../server/quote/fromScan";
import { designFor } from "../../server/views/load";
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
