// The guide's state on the page: loaded once, then each tap or sentence posts an action and takes the
// server's new state. What they tapped shows at once as their message. Track B owns this file.
import { useCallback, useEffect, useState } from "react";
import { getGuide, postGuide } from "./api";
import type { GuideAction, GuideMessage, GuideState } from "./types";

// What their own message says for an action: the button's words, or what they typed.
export function said(action: GuideAction, label?: string): string | null {
  if (label) return label;
  if (action.type === "ask" || action.type === "describe") return action.text;
  return null;
}

export function useGuide(scanId: string) {
  const [state, setState] = useState<GuideState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let gone = false;
    getGuide(scanId)
      .then((s) => !gone && setState(s))
      .catch((e: Error) => !gone && setError(e.message));
    return () => {
      gone = true;
    };
  }, [scanId]);

  const act = useCallback(
    (action: GuideAction, label?: string) => {
      const text = said(action, label);
      if (text) {
        const mine: GuideMessage = { id: `you-${Date.now()}`, from: "you", text, at: new Date().toISOString() };
        setState((s) => (s ? { ...s, messages: [...s.messages, mine] } : s));
      }
      setBusy(true);
      setError(null);
      postGuide(scanId, action)
        .then((r) => setState(r.state))
        .catch((e: Error) => setError(e.message))
        .finally(() => setBusy(false));
    },
    [scanId],
  );

  return { state, busy, error, act };
}
