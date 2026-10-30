// Before "Is this your basement?": Muse Wonder looks at the plan we drew (from above, with its room list)
// beside the take itself, and says where the two disagree: a room the video shows that the plan lacks, two
// rooms drawn as one, rooms joined in the video but not on the plan, a window in the wrong room, a room
// named for something it isn't. Each becomes one plain yes-or-no question on that screen. Sizes, heights
// and escape windows are never questioned: they're measured, and the rules decide them in code.
import { polygonArea, bounds } from "./model/geometry";
import type { Existing } from "./model/types";
import { drawPlan, ROOM_COLOURS } from "./planDraw";
import { parseJson, wonderThenSpark, type TakeView } from "./watch";
import type { responses } from "./meta";

export const ISSUES = ["missing_room", "merged_rooms", "extra_room", "missing_door", "window", "name", "other"] as const;
export type PlanIssue = (typeof ISSUES)[number];

export type PlanQuestion = {
  kind: PlanIssue;
  roomId: string | null; // the plan room it's about (Existing.rooms[].id)
  atS: number | null; // where in the video to see it
  question: string; // to the homeowner, answered yes or no
  name: string | null; // kind "name": the better name
};
export type PlanCheck = { model: string; questions: PlanQuestion[]; costUsd: number; ms: number };


// The plan in words, numbered and coloured as drawn: "2 (green), named "Workshop": 3.5 × 2.9 m, 1 window,
// doors to 1 and 3".
export function roomList(e: Existing): string {
  const lines = e.rooms.map((r, i) => {
    const b = bounds(r.polygon);
    const near = (p: [number, number]) => p[0] >= b.minX - 0.25 && p[0] <= b.maxX + 0.25 && p[1] >= b.minZ - 0.25 && p[1] <= b.maxZ + 0.25;
    const openings = e.openings.flatMap((o) => {
      const w = e.walls.find((x) => x.id === o.wallId);
      if (!w) return [];
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]) || 1;
      const p: [number, number] = [w.a[0] + ((w.b[0] - w.a[0]) * o.offsetM) / len, w.a[1] + ((w.b[1] - w.a[1]) * o.offsetM) / len];
      return near(p) ? [{ o, p }] : [];
    });
    const windows = openings.filter((x) => x.o.kind === "window").length;
    const doorsTo = [
      ...new Set(
        openings
          .filter((x) => x.o.kind === "door")
          .flatMap(({ p }) => e.rooms.flatMap((other, k) => {
            if (k === i) return [];
            const q = bounds(other.polygon);
            return p[0] >= q.minX - 0.25 && p[0] <= q.maxX + 0.25 && p[1] >= q.minZ - 0.25 && p[1] <= q.maxZ + 0.25 ? [`${k + 1}`] : [];
          })),
      ),
    ];
    const fixtures = e.fixtures.filter((f) => near(f.at)).map((f) => f.kind.replace("_", " "));
    return `${i + 1} (${ROOM_COLOURS[i % ROOM_COLOURS.length].name}), named "${r.name}": ${(b.maxX - b.minX).toFixed(1)} × ${(b.maxZ - b.minZ).toFixed(1)} m (${polygonArea(r.polygon).toFixed(0)} m²), ${windows} window${windows === 1 ? "" : "s"}, ${doorsTo.length ? `doors to ${doorsTo.join(" and ")}` : "no doors to other rooms"}${fixtures.length ? `; ${[...new Set(fixtures)].join(", ")}` : ""}.`;
  });
  return `The plan has ${e.rooms.length} room${e.rooms.length === 1 ? "" : "s"}, by their number in the drawing:\n${lines.join("\n")}`;
}

export function checkInstructions(view: TakeView) {
  const take = "video" in view ? "the video it was measured from" : "the photos it was measured from";
  return `You check a basement's floor plan against ${take}, before the homeowner is asked "Is this your basement?".

The picture is the plan seen from above. Each room is filled in its own colour with its number in it. Black lines are walls; dashed grey walls were never seen by the camera, so their place is a guess. Blue marks on a wall are windows, green marks are doors. Dark red squares are a furnace, water heater or electrical panel; grey bands are low ducts, beams or bulkheads; parallel lines are stairs. The sizes come from a 3D measurement: never question a size, a ceiling height, or whether a window is big enough to escape through.

Compare the plan with the ${"video" in view ? "video" : "photos"} and list where they disagree, the most important first, at most 4:
- "missing_room": the ${"video" in view ? "video" : "photos"} show a room, or a room seen through a doorway, that the plan doesn't have.
- "merged_rooms": the plan shows one room where there are two with a wall between them.
- "extra_room": the plan has a room that isn't there, or one room drawn twice.
- "missing_door": two rooms that are joined by a door or opening, which the plan doesn't join.
- "window": a window the plan lacks, or one drawn in the wrong room.
- "name": a room whose name doesn't fit what is in it; give the better name in "name".
- "other": anything else that is clearly wrong.
For each: "room", the room's number in the drawing (or null); "atS", the second in the video where it shows best (null for photos); and "question", one plain question to the homeowner, under 25 words, that they answer yes or no, for example: "Your video shows a third room behind the door at 0:52. Is there a room there the plan is missing?". The homeowner sees the rooms' names, not the drawing's numbers: in the question, call a room by its name ("the room named Room 3", "the Workshop") or by what is in it ("the room with the furnace"), never by its number. Only list what you can see clearly. If the plan matches, return an empty list.

Return ONLY JSON: {"issues":[{"kind":"missing_room","room":null,"atS":52,"question":"...","name":null}]}`;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function cleanCheck(raw: any, e: Existing, view: TakeView): PlanQuestion[] {
  if (!raw || !Array.isArray(raw.issues)) throw new Error("The plan check did not return a list");
  const durationS = "video" in view ? view.video.durationS : 0;
  return raw.issues
    .flatMap((x: any): PlanQuestion[] => {
      const question = text(x?.question, 200);
      if (!question) return [];
      const n = Number(x?.room);
      const at = typeof x?.atS === "number" && Number.isFinite(x.atS) && x.atS >= 0 && durationS > 0 ? Math.round(Math.min(x.atS, durationS) * 10) / 10 : null;
      const kind = ISSUES.includes(x?.kind) ? (x.kind as PlanIssue) : "other";
      return [{ kind, roomId: Number.isInteger(n) && n >= 1 && n <= e.rooms.length ? e.rooms[n - 1].id : null, atS: at, question, name: kind === "name" ? text(x?.name, 40) || null : null }];
    })
    .slice(0, 4);
}

export async function checkPlan(e: Existing, view: TakeView, opts?: { ask?: typeof responses }): Promise<PlanCheck> {
  const content: any[] = [
    { type: "input_text", text: "The plan:" },
    { type: "input_image", image_url: `data:image/png;base64,${drawPlan(e).toString("base64")}` },
    { type: "input_text", text: roomList(e) },
  ];
  if ("video" in view) {
    content.push({ type: "input_text", text: "The video:" }, { type: "input_video", file_id: view.video.fileId });
  } else {
    content.push({ type: "input_text", text: "The photos:" }, ...view.photos.map((url) => ({ type: "input_image", image_url: url })));
  }
  const { model, value, costUsd, ms } = await wonderThenSpark(checkInstructions(view), content, (t) => cleanCheck(parseJson(t), e, view), opts);
  return { model, questions: value, costUsd, ms };
}
