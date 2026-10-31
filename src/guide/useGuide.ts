// The guide's state on the page: loaded once, then each tap or sentence posts an action and takes the
// server's new state. What they tapped shows at once as their message. While it measures, it looks again
// every few seconds, so the answer arrives on its own (the server moves the thread on).
import { useCallback, useEffect, useRef, useState } from "react";
import { getGuide, postGuide } from "./api";
import type { GuideAction, GuideMessage, GuideState } from "./types";

const POLL_MS = 4000;

// What their own message says for an action: the button's words, or what they typed.
export function said(action: GuideAction, label?: string): string | null {
  if (label) return label;
  if (action.type === "ask" || action.type === "describe") return action.text;
  return null;
}

// What the ask bar suggests typing at each step.
export function placeholderFor(state: Pick<GuideState, "step"> & { awaiting?: string | null }): string {
  if (state.awaiting === "wall" || state.step === "design.plan") return "The right wall is 5.5 metres";
  if (state.awaiting === "look" || state.step === "design.look") return "Darker floors, white kitchen";
  if (state.step === "design.layouts") return "Make the bedroom bigger";
  return "Ask anything about your basement";
}

const measuring = (s: GuideState | null) => Boolean(s && (s.step === "wait" || s.step.startsWith("wait.")));

export function useGuide(scanId: string) {
  const [state, setState] = useState<GuideState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The thread as the server last sent it: the example posts it back with the next action.
  const sent = useRef<GuideState | null>(null);

  useEffect(() => {
    let gone = false;
    setState(null);
    setError(null);
    getGuide(scanId)
      .then((s) => {
        if (gone) return;
        sent.current = s;
        setState(s);
      })
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [scanId]);

  // While it measures, the result lands on the server: look again until the thread moves on.
  const waiting = measuring(state) && scanId !== "sample" && !busy;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      getGuide(scanId)
        .then((s) => {
          if (s.messages.length <= (sent.current?.messages.length ?? 0)) return;
          sent.current = s;
          setState(s);
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [scanId, waiting]);

  const act = useCallback(
    (action: GuideAction, label?: string) => {
      if (action.type === "go" && action.to === "home") {
        window.location.assign(`/scans/${scanId}`);
        return;
      }
      const text = said(action, label?.replace(/\s*→$/, ""));
      if (text) {
        const mine: GuideMessage = { id: `you-${Date.now()}`, from: "you", text, at: new Date().toISOString() };
        setState((s) => (s ? { ...s, messages: [...s.messages, mine] } : s));
      }
      setBusy(true);
      setError(null);
      postGuide(scanId, action, sent.current)
        .then((r) => {
          sent.current = r.state;
          setState(r.state);
        })
        .catch((e: Error) => {
          // Their message goes with the action that failed.
          setState(sent.current);
          setError(e.message);
        })
        .finally(() => setBusy(false));
    },
    [scanId],
  );

  const placeholder = placeholderFor((state ?? { step: "" }) as GuideState & { awaiting?: string | null });
  return { state, busy, error, act, placeholder };
}
