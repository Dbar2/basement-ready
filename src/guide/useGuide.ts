// The guide's thread in a component: load it, send a tap or typed words, and while it measures, look
// again every few seconds so the answer arrives on its own (the server moves the thread on).
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuide, sendGuide } from "./api";
import type { GuideAction, GuideState } from "./types";

const POLL_MS = 4000;

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
  const current = useRef<GuideState | null>(null);
  current.current = state;

  useEffect(() => {
    let live = true;
    setState(null);
    setError(null);
    loadGuide(scanId)
      .then((s) => live && setState(s))
      .catch((e) => live && setError(e instanceof Error ? e.message : "We couldn't open your guide."));
    return () => {
      live = false;
    };
  }, [scanId]);

  // While it measures, the result lands on the server: look again until the thread moves on.
  const waiting = measuring(state) && scanId !== "sample";
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      if (document.hidden) return;
      loadGuide(scanId)
        .then((s) => setState((was) => (was && s.messages.length > was.messages.length ? s : was)))
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [scanId, waiting]);

  const send = useCallback(
    async (action: GuideAction) => {
      const s = current.current;
      if (!s || busy) return;
      setBusy(true);
      setError(null);
      try {
        const sent = await sendGuide(scanId, action, s);
        setState(sent.state);
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn't go through. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [scanId, busy],
  );

  const ask = useCallback((text: string) => (text.trim() ? send({ type: "ask", text: text.trim() }) : Promise.resolve()), [send]);

  return { state, busy, error, send, ask, placeholder: state ? placeholderFor(state as GuideState & { awaiting?: string | null }) : placeholderFor({ step: "" }) };
}
