import { describe, expect, it } from "vitest";
import type { Detection } from "../../server/pipeline";
import { roomName } from "../../server/rooms";
import { lowOverhead, type Scan3d } from "../../server/scan3d";

const find = (id: string, kind: string) => ({ id, kind, label: kind }) as unknown as Detection;
const room = {} as Scan3d;

describe("beams and ducts the 3D puts too low", () => {
  // Clearance under each find, as the 3D would measure it; null where the room's frames don't show it.
  const under: Record<string, number | null> = { shelf: 0.86, sofa: 0.6, beam: 1.78, duct: 1.66, unseen: null };
  const measure = (_: Scan3d, d: Detection) => under[d.id];

  it("leaves out a beam or duct whose underside sits at furniture height", () => {
    const low = lowOverhead([room], [find("shelf", "beam"), find("sofa", "duct"), find("beam", "beam"), find("duct", "duct")], measure);
    expect(low.map((d) => d.id)).toEqual(["shelf", "sofa"]);
  });

  it("keeps finds the 3D can't place, and never touches windows or doors", () => {
    expect(lowOverhead([room, null], [find("unseen", "beam"), find("shelf", "window")], measure)).toEqual([]);
    expect(lowOverhead([null], [find("shelf", "beam")], measure)).toEqual([]);
  });
});

describe("room names", () => {
  it("calls a room the furnace room only where the furnace was seen", () => {
    const named = new Set<string>();
    expect(roomName(0, 0, 100, [], named)).toBe("Room 1");
    expect(roomName(1, 100, 200, [150], named)).toBe("Furnace room");
  });
});
