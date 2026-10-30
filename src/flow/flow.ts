// The one flow after the upload, in order: swipe your style while it measures, check the plan, pick a
// layout, design it in 3D, see it in pictures, then the book with the permit, money and build tabs.
// Each step remembers itself, so coming back to /scans/:id lands where they left off: on the workspace
// for a real scan (state.flow, so another device signed in as the owner lands there too), in this
// browser for the example.
import { getWorkspace, saveWorkspace } from "../workspaceApi";

export type Step = "style" | "plan" | "layouts" | "studio" | "pictures" | "book";

export const STEPS: { id: Step; label: string; short: string }[] = [
  { id: "style", label: "Swipe your style", short: "Style" },
  { id: "plan", label: "Is this your basement?", short: "Plan" },
  { id: "layouts", label: "Pick a layout", short: "Layout" },
  { id: "studio", label: "Your design in 3D", short: "Design" },
  { id: "pictures", label: "Pictures of it", short: "Pictures" },
  { id: "book", label: "Your book", short: "Book" },
];

export const isStep = (s: unknown): s is Step => STEPS.some((x) => x.id === s);

// Where each step lives. The book is the workspace's first tab.
export function stepUrl(scanId: string, step: Step): string {
  return step === "book" ? `/scans/${scanId}?tab=book` : `/scans/${scanId}/${step}`;
}

export const neighbours = (step: Step) => {
  const i = STEPS.findIndex((s) => s.id === step);
  return { prev: STEPS[i - 1] ?? null, next: STEPS[i + 1] ?? null };
};

const SAMPLE_KEY = "br-sample-step";

// Saved as they arrive at a step. Only the person who filmed it can save; for anyone else it's a no-op.
export async function rememberStep(scanId: string, step: Step) {
  if (scanId === "sample") {
    try {
      localStorage.setItem(SAMPLE_KEY, step);
    } catch {
      // Private mode: the example starts over next time.
    }
    return;
  }
  await saveWorkspace(scanId, { state: { flow: { step, at: new Date().toISOString() } } }).catch(() => {});
}

// Where they left off, or null the first time.
export async function lastStep(scanId: string): Promise<Step | null> {
  if (scanId === "sample") {
    try {
      const s = localStorage.getItem(SAMPLE_KEY);
      return isStep(s) ? s : null;
    } catch {
      return null;
    }
  }
  const ws = await getWorkspace(scanId).catch(() => null);
  const s = ws?.state.flow?.step;
  return isStep(s) ? s : null;
}
