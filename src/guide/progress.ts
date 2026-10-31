// Where the basement stands against its goal: the three milestones, Answer · Design · Build, each done,
// next or still to come, and whether /scans/:id opens the guide instead of the home base. It reads the
// guide's thread (GuideState.done) and, for a scan from before the guide, the step the old flow saved
// (state.flow). Replaces src/flow/flow.ts.
import type { WorkspaceState } from "../workspaceApi";
import type { GuideState, Milestone } from "./types";

export const MILESTONES: { id: Milestone; label: string }[] = [
  { id: "answer", label: "Answer" },
  { id: "design", label: "Design" },
  { id: "build", label: "Build" },
];

export type MilestoneStatus = "done" | "next" | "todo";
export type Progress = { status: Record<Milestone, MilestoneStatus>; next: Milestone | null; openGuide: boolean };

type FlowStep = NonNullable<WorkspaceState["flow"]>["step"];

// The old flow, as far as the milestones go: past the style deck they'd had the answer (the plan check
// came after it), and on the book the design was done.
function fromFlow(step: FlowStep | undefined): Partial<Record<Milestone, boolean>> {
  if (!step || step === "style") return {};
  if (step === "book") return { answer: true, design: true };
  return { answer: true };
}

// `measured`: the scan is done. While it measures, and until they've had their answer, /scans/:id opens
// the guide: that's where the wait and the answer happen.
export function progress({ guide, state, measured }: { guide: GuideState | null; state?: WorkspaceState | null; measured: boolean }): Progress {
  const legacy = fromFlow(state?.flow?.step);
  const done = (m: Milestone) => Boolean(guide?.done[m] || legacy[m]);
  const next = MILESTONES.find((m) => !done(m.id))?.id ?? null;
  const status = Object.fromEntries(MILESTONES.map((m) => [m.id, done(m.id) ? "done" : m.id === next ? "next" : "todo"])) as Record<Milestone, MilestoneStatus>;
  return { status, next, openGuide: !measured || !done("answer") };
}

export const isMilestone = (s: unknown): s is Milestone => MILESTONES.some((m) => m.id === s);

// The guide at a milestone (a Continue, an older link). Without one, the guide resumes where it is.
export const guideUrl = (scanId: string, at?: Milestone | null) => `/scans/${scanId}/guide${at ? `?at=${at}` : ""}`;
