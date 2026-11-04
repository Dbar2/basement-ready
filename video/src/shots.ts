import type { CamKey } from "./components/kit";

// Real footage of the live site (https://www.basementready.com, the example basement), recorded with
// Playwright by tools/record/record.mjs into public/footage/ (git-ignored; each clip's .json lists its
// marks). `start` is where the shot starts in its clip, in seconds; `cam` eases the camera in on what
// the voice is talking about. A missing shot falls back to the drawn version.
export type Shot = { file: string; start: number; kind: "desktop" | "phone"; url?: string; cam?: CamKey[]; clip: number };

// clip lengths in seconds (ffprobe), so a shot never runs past the end of its clip
const CLIP: Record<string, number> = { answer: 13.93, build: 17.2, explain: 14.33, home: 24.67, homebase: 12.33, layouts: 145.83, looks: 34.17, plan: 16.83, wait: 15.0 };

const d = (file: string, start: number, cam?: CamKey[], url = "basementready.com/scans/sample/guide"): Shot => ({ file: `footage/desktop-${file}.mp4`, start, kind: "desktop", cam, url, clip: CLIP[file] });

export const SHOTS: Partial<Record<
  "home" | "wait" | "scan3d" | "answer" | "explain" | "plan" | "layouts" | "looks" | "build" | "tape" | "money" | "book" | "homebase",
  Shot
>> = {
  // SAM's outlines over the example video, and the first question with why it's asked
  wait: d("wait", 0.3, [[0, 1, 0.5, 0.5], [3.2, 1, 0.5, 0.5], [5.2, 1.7, 1, 0.92]]),
  // "Yes, your basement can be a second home after 4 fixes", the plan with the fire separation marked
  answer: d("answer", 2.0, [[0, 1, 0.5, 0.5], [1.6, 1, 0.5, 0.5], [3.6, 1.75, 1, 0.8], [7.6, 1.75, 1, 0.8], [9.6, 1.45, 0.28, 0.32]]),
  // What's a fire separation? A drawing in section with the rule's source
  explain: d("explain", 1.0, [[0, 1, 0.5, 0.5], [3.2, 1, 0.5, 0.5], [5.0, 1.45, 0.3, 0.5]]),
  // Is this your basement? The measured plan; the window dragged along the wall
  plan: d("plan", 3.4, [[0, 1, 0.5, 0.5], [1.4, 1, 0.5, 0.5], [3.4, 1.34, 0, 0.55]]),
  // the layouts in 3D, One bedroom recommended
  layouts: d("layouts", 3.2, [[0, 1, 0.5, 0.5], [2.5, 1, 0.5, 0.5], [5, 1.32, 0, 0.5]]),
  // before and after, "After · virtually staged", the divider dragged
  looks: d("looks", 18.6, [[0, 1.32, 0, 0.5], [9, 1.38, 0, 0.5]]),
  // Build: the permit set, "2 of 15 ready"
  build: { ...d("build", 3.6, [[0, 1, 0.5, 0.5], [1.6, 1, 0.5, 0.5], [3.6, 1.6, 0.3, 0.5]]), clip: 9.5 }, // stop before "Start" is tapped
  // only what it can't measure: the tape card
  tape: d("build", 10.4, [[0, 1.0, 0.5, 0.5], [1.4, 1.0, 0.5, 0.5], [3.0, 1.6, 1, 0.8]]),
  // the home base: the goal and the three milestones
  homebase: d("homebase", 0.3, [[0, 1.25, 0.5, 0.18], [3.5, 1.5, 0.5, 0.18]], "basementready.com/scans/sample"),
  // the home page hero and Try the example
  home: d("home", 19.2, [[0, 1, 0.5, 0.5]], "basementready.com"),
};
