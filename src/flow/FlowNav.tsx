// The flow's frame on every step, drawn like a sheet of a drawing set (brand/ui.md): the sheet index across
// the top (the one they're on underlined, every other one a link), and along the bottom the title strip: a
// way back, the title block, and one clear way forward. Arriving on a step remembers it.
import { useRouter } from "@tanstack/react-router";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { AccountNav } from "../auth";
import { Logo } from "../components/Logo";
import { neighbours, rememberStep, STEPS, stepUrl, type Step } from "./flow";
import "./flow.css";

// A link that moves within the app without reloading it (a new tab or window still works).
export function FlowLink({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; "aria-current"?: "step"; "aria-label"?: string }) {
  const router = useRouter();
  const go = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.history.push(href);
  };
  return (
    <a href={href} className={className} onClick={go} {...rest}>
      {children}
    </a>
  );
}

const sheetNo = (i: number) => String(i + 1).padStart(2, "0");

export function FlowHead({ scanId, step, remember = true }: { scanId: string; step: Step; remember?: boolean }) {
  useEffect(() => {
    if (remember) void rememberStep(scanId, step);
  }, [scanId, step, remember]);
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <header className="flow-head">
      <Logo />
      <nav aria-label="Steps">
        <ol className="flow-steps">
          {STEPS.map((s, i) => (
            <li key={s.id} data-state={i < at ? "done" : i === at ? "current" : "todo"}>
              <FlowLink href={stepUrl(scanId, s.id)} aria-current={i === at ? "step" : undefined} aria-label={`Step ${i + 1}: ${s.label}`}>
                <span className="flow-n">{sheetNo(i)}</span>
                <span className="flow-name">{s.short}</span>
              </FlowLink>
            </li>
          ))}
        </ol>
      </nav>
      <span className="flow-account">
        <AccountNav />
      </span>
    </header>
  );
}

// `next`: the step's way forward (a button that does its work first, or the next step by default).
// `extra`: a quieter second action beside it.
export function FlowFoot({
  scanId,
  step,
  next,
  extra,
}: {
  scanId: string;
  step: Step;
  next?: { label: string; onClick?: () => void; disabled?: boolean; href?: string } | null;
  extra?: ReactNode;
}) {
  const { prev, next: after } = neighbours(step);
  const forward = next === undefined ? (after ? { label: after.label, href: stepUrl(scanId, after.id) } : null) : next;
  const at = STEPS.findIndex((s) => s.id === step);
  return (
    <div className="flow-foot">
      {prev ? (
        <FlowLink className="flow-back" href={stepUrl(scanId, prev.id)}>
          <span aria-hidden>←</span> {prev.short}
        </FlowLink>
      ) : (
        <span />
      )}
      <span className="title-block" aria-hidden>
        <span>
          <b>{sheetNo(at)} / {sheetNo(STEPS.length - 1)}</b>
          <i>Sheet</i>
        </span>
        <span>
          <b>{STEPS[at].label}</b>
          <i>Basement Ready</i>
        </span>
      </span>
      <span className="flow-foot-right">
        {extra}
        {forward &&
          (forward.href && !forward.onClick && !forward.disabled ? (
            <FlowLink href={forward.href} className="btn btn-primary">
              {forward.label} <span className="arrow" aria-hidden>→</span>
            </FlowLink>
          ) : (
            <button className="btn btn-primary" onClick={forward.onClick} disabled={forward.disabled}>
              {forward.label} <span className="arrow" aria-hidden>→</span>
            </button>
          ))}
      </span>
    </div>
  );
}
