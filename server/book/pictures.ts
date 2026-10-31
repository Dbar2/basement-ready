// The book's pictures. The book doesn't make pictures: it's handed a list (BookInput.pictures) and
// lays it out, best first. Pictures of the design itself, drawn from the scan's best real angles
// (server/views, "Pictures that agree with each other"), go in `design` and lead; until they exist,
// the book shows what the homeowner already has: the photos they saved, the looks they tried, and the
// scan's own "what it could look like" photos. The example uses the looks committed with it.
import { existsSync, readFileSync } from "node:fs";
import { lookKey } from "../ideas/looks";
import { STYLES, type StyleId } from "../ideas/styles";
import type { Model } from "../model/types";
import { keys, storage } from "../storage";
import type { StoredState } from "../workspace";

export type PictureKind = "design" | "favourite" | "look" | "concept";
// A picture to show: where the page loads it from, and how the PDF reads its bytes.
export type Picture = { title: string; kind: PictureKind; url: string; caption: string; load: () => Promise<Buffer | null> };

const SAMPLE = "public/samples/sample";
const VIRTUAL = "Virtually staged";

async function read(key: string) {
  const s = await storage.get(key);
  if (!s) return null;
  const parts: Buffer[] = [];
  for await (const chunk of s) parts.push(chunk as Buffer);
  return Buffer.concat(parts);
}
const file = (path: string) => async () => (existsSync(path) ? readFileSync(path) : null);

// The looks committed with the example, as server/workspaceRoutes.ts serves them.
function sampleLooks(): { style: string; items: { n: number; title: string }[] }[] {
  const f = `${SAMPLE}/looks/looks.json`;
  if (!existsSync(f)) return [];
  return Object.values(JSON.parse(readFileSync(f, "utf8")) as Record<string, { style: string; status: string; items: { n: number; title: string }[] }>).filter((l) => l.status === "done");
}

// Each picture names itself: the room, what changed, and where in their video it was taken from (the
// scan's frames are 5 a second), so six pictures of one corner don't read as one picture six times.
export const fromVideo = (frame: number | null | undefined) =>
  frame == null || !Number.isFinite(frame) ? null : `from ${Math.floor(frame / 300)}:${String(Math.floor(frame / 5) % 60).padStart(2, "0")} in your video`;
export const named = (...parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
const lookName = (style: string | undefined) => (style ? `${STYLES[style as StyleId]?.label ?? style} look` : null);

// The idea cards they swiped right on (server/ideas/cards.ts keeps them at scans/<id>/cards/<n>.jpg).
const cardNumber = (id: string) => Number.parseInt(/(\d+)$/.exec(id)?.[1] ?? "", 10);

export async function picturesFor(scanId: string, result: any, state: StoredState, model: Model | null, design: Picture[] = []): Promise<{ pictures: Picture[]; mood: Picture[] }> {
  const out: Picture[] = [];
  const seen = new Set<string>();
  const push = (p: Picture) => {
    if (seen.has(p.url)) return;
    seen.add(p.url);
    out.push(p);
  };
  const sample = scanId === "sample";
  // Where each look and idea was taken from, by its number.
  const conceptFrame = new Map<number, number>((result?.concepts?.items ?? []).map((c: { n: number; frame?: number }) => [c.n, c.frame]));
  const looks = sample ? sampleLooks() : Object.values(state.looks ?? {}).filter((l) => l.status === "done");
  const lookFrame = (style: string, n: number) => (looks.find((l) => l.style === style)?.items as { n: number; frame?: number }[] | undefined)?.find((it) => it.n === n)?.frame;
  const concept = (n: number, room: string, kind: PictureKind): Picture => {
    const title = named(room, "the first idea from your scan", fromVideo(conceptFrame.get(n)));
    return sample
      ? { title, kind, caption: VIRTUAL, url: `/samples/sample/concepts/${n}.jpg`, load: file(`${SAMPLE}/concepts/${n}.jpg`) }
      : { title, kind, caption: VIRTUAL, url: `/api/scans/${scanId}/concepts/${n}`, load: () => read(keys.concept(scanId, n)) };
  };
  const look = (style: string, n: number, room: string, kind: PictureKind): Picture => {
    const title = named(room, lookName(style), fromVideo(lookFrame(style, n)));
    return sample
      ? { title, kind, caption: VIRTUAL, url: `/samples/sample/looks/${style}/${n}.jpg`, load: file(`${SAMPLE}/looks/${style}/${n}.jpg`) }
      : { title, kind, caption: VIRTUAL, url: `/api/scans/${scanId}/looks/${style}/${n}`, load: () => read(lookKey(scanId, style, n)) };
  };

  for (const p of design) push({ ...p, kind: "design" });
  for (const f of state.ideas?.favourites ?? []) push(f.source === "look" && f.style ? look(f.style, f.n, f.title, "favourite") : concept(f.n, f.title, "favourite"));
  for (const l of looks) for (const it of l.items) push(look(l.style, it.n, it.title, "look"));
  for (const c of result?.concepts?.items ?? []) push(concept(c.n, c.title, "concept"));

  const mood: Picture[] = sample
    ? []
    : (model?.mood.liked ?? [])
        .map(cardNumber)
        .filter((n) => Number.isInteger(n))
        .slice(0, 12)
        .map((n) => ({ title: `Card ${n}`, kind: "favourite" as const, caption: VIRTUAL, url: `/api/scans/${scanId}/cards/${n}.jpg`, load: () => read(`scans/${scanId}/cards/${n}.jpg`) }));
  return { pictures: out, mood };
}

// The bytes, for the PDF; a picture that won't load is left out.
export async function loadPictures(ps: Picture[]) {
  const out: { title: string; jpeg: Buffer; kind: PictureKind; caption: string }[] = [];
  for (const p of ps) {
    const jpeg = await p.load().catch(() => null);
    if (jpeg) out.push({ title: p.title, jpeg, kind: p.kind, caption: p.caption });
  }
  return out;
}
