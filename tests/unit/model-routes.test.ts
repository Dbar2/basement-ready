import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { mountModel } from "../../server/model/routes";
import type { Model } from "../../server/model/types";

const app = new Hono();
mountModel(app, async () => null);

describe("the model's routes", () => {
  it("seeds the example basement, saved nowhere", async () => {
    const res = await app.request("/api/scans/sample/model");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { model: Model; saved: boolean };
    expect(body.saved).toBe(false);
    expect(body.model.designs.map((d) => d.id)).toEqual(["one_bedroom", "studio"]);
  });

  it("draws the designs again on a confirmed plan", async () => {
    const { model } = (await (await app.request("/api/scans/sample/model")).json()) as { model: Model };
    const existing = { ...model.existing, confirmedAt: "2026-10-30T12:00:00.000Z" };
    const res = await app.request("/api/model/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ existing }) });
    expect(res.status).toBe(200);
    const { designs } = (await res.json()) as { designs: Model["designs"] };
    expect(designs.length).toBeGreaterThanOrEqual(2);
    expect(designs.filter((d) => d.chosen)).toHaveLength(1);
    const bad = await app.request("/api/model/designs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ existing: { walls: "no" } }) });
    expect(bad.status).toBe(400);
  });

  it("asks for the AI key before describing a change, and a real scan needs its owner", async () => {
    const { model } = (await (await app.request("/api/scans/sample/model")).json()) as { model: Model };
    const body = JSON.stringify({ ask: "Make the bedroom bigger", design: model.designs[0], existing: model.existing });
    const res = await app.request("/api/scans/sample/model/describe", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(res.status).toBe(503);
    const other = await app.request("/api/scans/not-a-scan/model/describe", { method: "POST", headers: { "Content-Type": "application/json" }, body });
    expect(other.status).toBe(404);
  });
});
