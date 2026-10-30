// The pictures API (server/views/routes.ts) and the edits a tap makes, applied to the design here
// until the studio's model edits (server/model applyEdit) land.
import { editFurniture } from "../../server/model/furniture";
import type { Design, Edit } from "../../server/model/types";
import type { PictureMeta } from "../../server/views/photoreal";
import type { AngleView } from "./AngleRender";

export type Picture = PictureMeta & { url: string };
export type ViewsData = { angles: AngleView[]; design: Design | null; designHash: string | null; meshUrl: string; ceilingM: number | null; pictures: Picture[]; label: string };

export async function getViews(scanId: string, designHash?: string, perRoom = 5): Promise<ViewsData> {
  const q = new URLSearchParams({ perRoom: String(perRoom), ...(designHash ? { design: designHash } : {}) });
  const res = await fetch(`/api/scans/${scanId}/views?${q}`);
  if (!res.ok) throw new Error(`views ${res.status}`);
  return res.json();
}

export async function postPicture(scanId: string, angleId: string, guide: Blob, meta: { designHash: string; viewKey: string; items: unknown; finishes: Design["finishes"] }): Promise<Picture> {
  const form = new FormData();
  form.append("guide", guide, `${angleId}.jpg`);
  form.append("meta", JSON.stringify(meta));
  const res = await fetch(`/api/scans/${scanId}/views/${angleId}`, { method: "POST", body: form });
  if (!res.ok) throw new Error(`picture ${res.status}`);
  return res.json();
}

export function applyViewEdits(design: Design, edits: Edit[], now = new Date().toISOString()): Design {
  const next = edits.reduce<Design>((d, e) => (e.op === "set_finishes" ? { ...d, finishes: { ...d.finishes, ...e.finishes } } : /_furniture$/.test(e.op) ? editFurniture(d, e) : d), design);
  return next === design ? design : { ...next, updatedAt: now };
}
