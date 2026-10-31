// Smoke and CO alarms for a design, by the code's rules: in each sleeping room, between the sleeping
// rooms and the rest of the suite, CO beside where people sleep when anything burns fuel, and CO in a
// fuel-burning furnace room (Building Code 9.10.19, 9.32.3.9A, 9.32.3.9B). The same placement as the
// permit sheets' (server/permit/plans.ts placeAlarms), on the model's rooms, so it runs after every edit.
import { along, bounds, clamp, dist, distToSegment, edges, inPolygon, largestBox, r2, sub, type Box } from "./geometry";
import type { Alarm, Design, Fixture, Pt, Room } from "./types";

// Anything that may burn gas: a furnace or a water heater.
export const burnsFuel = (fixtures: Fixture[]) => fixtures.some((f) => f.kind === "furnace" || f.kind === "water_heater");

// On the ceiling, a little off the room's middle so the room's name stays readable on the plan.
const spot = (r: Room): Pt => {
  const at = (b: Box): Pt => [r2((b.minX + b.maxX) / 2), r2(b.minZ + (b.maxZ - b.minZ) * 0.25)];
  const p = at(bounds(r.polygon));
  // An L-shaped room's box can put that spot outside it: then its main part's.
  return inPolygon(p, r.polygon) ? p : at(largestBox(r.polygon));
};

export function placeAlarms(design: Pick<Design, "layout" | "proposed">, fuelBurning: boolean): Alarm[] {
  const { rooms, openings, walls } = design.proposed;
  const suite = rooms.filter((r) => r.unit === 2);
  const beds = suite.filter((r) => r.kind === "bedroom");
  const main = [...suite.filter((r) => r.kind === "living")].sort((a, b) => area(b) - area(a))[0] ?? null;
  const studio = design.layout === "studio";
  const doors = openings.flatMap((o) => {
    const w = o.kind === "door" ? walls.find((x) => x.id === o.wallId) : null;
    return w ? [along(w, o.offsetM)] : [];
  });
  const out: Omit<Alarm, "id">[] = [];
  for (const bed of beds) {
    const c = spot(bed);
    out.push({ kind: studio && fuelBurning ? "combo" : "smoke", at: c, why: studio ? "In the sleeping area" : "In each bedroom" });
    if (studio || !main) continue;
    // Outside the bedroom door, in the living space: between the bedroom and the rest of the suite. Its
    // door is the one into a living space (not a furnace room's beside it), and that living space is where
    // the alarm goes (a suite can have more than one).
    const livings = suite.filter((r) => r.kind === "living");
    const intoLiving = doors.filter((d) => livings.some((l) => edges(l.polygon).some(([a, b]) => distToSegment(d, a, b) < 0.4)));
    const door = [...(intoLiving.length ? intoLiving : doors)].sort((p, q) => dist(p, c) - dist(q, c))[0];
    const living = (door && livings.find((l) => edges(l.polygon).some(([a, b]) => distToSegment(door, a, b) < 0.4))) || main;
    const lc = spot(living);
    const at = door ?? lc;
    const lb = bounds(living.polygon);
    let inLiving: Pt = [
      r2(clamp(at[0] + Math.sign(lc[0] - at[0] || 1) * 0.6, lb.minX + 0.4, lb.maxX - 0.4)),
      r2(clamp(at[1] + Math.sign(lc[1] - at[1] || 1) * 0.6, lb.minZ + 0.4, lb.maxZ - 0.4)),
    ];
    // Off the floor of an L-shaped living space: on the way from the door to its middle instead.
    if (!inPolygon(inLiving, living.polygon)) {
      const step = sub(lc, at), L = Math.hypot(step[0], step[1]) || 1;
      const p = [0.6, 0.8, 1, 1.2, 1.5, 2].map((t): Pt => [r2(at[0] + (step[0] / L) * t), r2(at[1] + (step[1] / L) * t)]).find((q) => inPolygon(q, living.polygon));
      if (p) inLiving = p;
    }
    out.push({ kind: fuelBurning ? "combo" : "smoke", at: inLiving, why: fuelBurning ? "Outside the bedroom: smoke, and CO next to where people sleep" : "Between the bedroom and the rest of the suite" });
  }
  if (!beds.length && main) out.push({ kind: fuelBurning ? "combo" : "smoke", at: spot(main), why: "One per storey of the suite" });
  // A service room with a fuel-burning furnace gets its own CO alarm, and a bedroom that shares a
  // wall with it gets CO inside the bedroom too.
  const mech = rooms.find((r) => r.kind === "mechanical");
  if (fuelBurning && mech) {
    out.push({ kind: "co", at: spot(mech), why: "In the room with the fuel-burning furnace" });
    const mb = bounds(mech.polygon);
    for (const alarm of out) {
      const bed = beds.find((b) => dist(spot(b), alarm.at) < 0.01);
      if (!bed) continue;
      const bb = bounds(bed.polygon);
      const touches = bb.minX <= mb.maxX + 0.05 && mb.minX <= bb.maxX + 0.05 && bb.minZ <= mb.maxZ + 0.05 && mb.minZ <= bb.maxZ + 0.05;
      if (touches) Object.assign(alarm, { kind: "combo", why: "In the bedroom, which shares a wall with the furnace room" });
    }
  }
  return out.map((a, i) => ({ id: `alarm-${i + 1}`, ...a }));
}

function area(r: Room) {
  const b = bounds(r.polygon);
  return (b.maxX - b.minX) * (b.maxZ - b.minZ);
}
