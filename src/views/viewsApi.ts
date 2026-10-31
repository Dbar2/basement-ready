// The pictures API (server/views/routes.ts) and the edits a tap makes, through the model's own edits.
import { applyEdits } from "../../server/model/edit";
import { authHeaders } from "../api";
import type { Design, Edit } from "../../server/model/types";
import type { PictureMeta } from "../../server/views/photoreal";
import type { AngleView } from "./AngleRender";

// `url` is null when the server kept nothing (the example, past its committed pictures): show the render.
// `before`: the real frame the picture was made from, the same size (`size`) and framing: the "before"
// of a before/after slider (src/views/BeforeAfter.tsx).
export type Picture = PictureMeta & { url: string | null; before: string; size: [number, number] };
export type ViewsData = { angles: AngleView[]; design: Design | null; designHash: string | null; meshUrl: string; ceilingM: number | null; pictures: (PictureMeta & { url: string; before: string; size: [number, number] })[]; label: string };

// `designId`: which of the model's designs the angles are judged against (else the chosen one);
// `designHash`: which version of it the pictures already made are looked up for.
export async function getViews(scanId: string, designHash?: string, perRoom = 5, designId?: string): Promise<ViewsData> {
  const q = new URLSearchParams({ perRoom: String(perRoom), ...(designHash ? { design: designHash } : {}), ...(designId ? { designId } : {}) });
  const res = await fetch(`/api/scans/${scanId}/views?${q}`);
  if (!res.ok) throw new Error(`views ${res.status}`);
  return res.json();
}

export async function postPicture(scanId: string, angleId: string, guide: Blob, meta: { designHash: string; viewKey: string; items: unknown; walls?: unknown; doors?: unknown; finishes: Design["finishes"] }): Promise<Picture> {
  const form = new FormData();
  form.append("guide", guide, `${angleId}.jpg`);
  form.append("meta", JSON.stringify(meta));
  // A write: only the device that filmed it (its claim) or its signed-in owner (server/privacy.ts).
  const res = await fetch(`/api/scans/${scanId}/views/${angleId}`, { method: "POST", body: form, headers: await authHeaders() });
  if (!res.ok) throw new Error(`picture ${res.status}`);
  return res.json();
}

export function applyViewEdits(design: Design, edits: Edit[], now = new Date().toISOString()): Design {
  return edits.length ? applyEdits(design, edits, now) : design;
}
