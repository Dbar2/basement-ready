// Undo and redo for the plan and the studio. A drag shows as a preview while the finger is down and
// becomes one step when it lifts, so undo takes back the whole drag, not every pixel of it.
import { useCallback, useMemo, useState } from "react";

type State<T> = { past: T[]; present: T; future: T[]; preview: T | null };

const MAX_STEPS = 80;

export function useHistory<T>(initial: T) {
  const [s, setS] = useState<State<T>>({ past: [], present: initial, future: [], preview: null });
  const commit = useCallback((next: T) => setS((x) => ({ past: [...x.past, x.present].slice(-MAX_STEPS), present: next, future: [], preview: null })), []);
  const preview = useCallback((next: T | null) => setS((x) => ({ ...x, preview: next })), []);
  const undo = useCallback(() => setS((x) => (x.past.length ? { past: x.past.slice(0, -1), present: x.past.at(-1)!, future: [x.present, ...x.future], preview: null } : x)), []);
  const redo = useCallback(() => setS((x) => (x.future.length ? { past: [...x.past, x.present], present: x.future[0], future: x.future.slice(1), preview: null } : x)), []);
  // A new starting point (a different design, or the model reloaded): no history to go back through.
  const reset = useCallback((next: T) => setS({ past: [], present: next, future: [], preview: null }), []);
  return useMemo(
    () => ({ shown: s.preview ?? s.present, present: s.present, dragging: s.preview !== null, commit, preview, undo, redo, reset, canUndo: s.past.length > 0, canRedo: s.future.length > 0 }),
    [s, commit, preview, undo, redo, reset],
  );
}
