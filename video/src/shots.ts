// Real footage of the live site (https://www.basementready.com, the example basement), recorded with
// Playwright into public/footage/ (git-ignored; see public/footage/manifest.md). `start` is where the
// shot starts in its clip, in seconds. A missing shot falls back to the drawn version.
export type Shot = { file: string; start: number; kind: "desktop" | "phone" };

export const SHOTS: Partial<Record<
  "home" | "wait" | "scan3d" | "answer" | "explain" | "plan" | "layouts" | "looks" | "build" | "money" | "book" | "homebase",
  Shot
>> = {};
