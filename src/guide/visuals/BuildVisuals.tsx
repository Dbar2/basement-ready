// The Build milestone's pictures, in the visual pane above (or beside) the thread. "permit": the set
// they'll hand in, drawn as a stack of sheets, with "9 of 13 ready" and what's left. "money": what they
// may be eligible for, program by program. "builders": who does what, from the drawings to move-in,
// for the path they picked. All drawn in code (Drawing Set); they read the same data as the cards
// (src/guide/cards/data.ts), so a saved answer moves them at once.
import type { ReactNode } from "react";
import type { VisualProps } from "../mount";
import { dollars, useBuild } from "../cards/data";
import "./build-visuals.css";

export function PermitVisual({ scanId }: VisualProps<"permit">) {
  const { status, result } = useBuild(scanId);
  const city = result?.authority ?? (result?.city ? `City of ${result.city}` : null);
  if (!status) return <Pane caption={city ? `Your permit set, ${city}` : "Your permit set"} note="Opening your permit set…" />;
  const total = status.items.length;
  const ready = total - status.left;
  // One line per kind of thing, in the order the guide asks.
  const groups: { group: string; label: string }[] = [
    { group: "design", label: "Your design meets the rules" },
    { group: "tape", label: "Tape numbers" },
    { group: "windows", label: "Window sizes" },
    { group: "owner", label: "Owner's name" },
    { group: "upstairs", label: "Bedrooms upstairs" },
    { group: "lot", label: "Distance to the lot line" },
    { group: "water", label: "Water meter" },
    { group: "designer", label: "Your designer" },
    { group: "review", label: "Each sheet looked over" },
  ];
  const all = [
    { label: "Drawings to scale", done: true },
    { label: "City forms filled", done: true },
    ...groups.filter((g) => status.items.some((i) => i.group === g.group)).map((g) => ({ label: g.label, done: status.items.filter((i) => i.group === g.group).every((i) => i.done) })),
  ];
  // A computer's pane shows every line. A phone's (build-visuals.css, by the pane's own width) shows
  // what's still open, three at most and the rest as a count; once nothing is, the last three done.
  const todo = all.filter((l) => !l.done);
  const onPhone = todo.length ? todo.slice(0, 3) : all.slice(-3);
  const more = Math.max(0, todo.length - onPhone.length);
  const lines = all.map((l) => ({ ...l, phone: onPhone.includes(l) }));
  return (
    <Pane caption={city ? `Your permit set, ${city}` : "Your permit set"} kind="permit">
      <div className="bv-permit">
        <svg className="bv-sheets" viewBox="0 0 170 220" role="img" aria-label={`The permit set: ${status.sheets.length} sheets`}>
          <rect x="18" y="14" width="150" height="200" className="bv-sheet-back" />
          <rect x="9" y="7" width="150" height="200" className="bv-sheet-back" />
          <rect x="1" y="1" width="150" height="200" className="bv-sheet" />
          <path d="M14 30 h90" className="bv-ink-thick" />
          <path d="M14 44 h120 M14 54 h100" className="bv-hair" />
          <rect x="14" y="68" width="122" height="80" className="bv-ink" />
          <path d="M14 104 h60 v44 M74 120 h62" className="bv-ink" />
          <rect x="96" y="168" width="40" height="22" className="bv-ink" />
          <text x="116" y="183" textAnchor="middle" className="bv-tiny">
            {status.sheets[0]?.number ?? "A1"}
          </text>
          {status.canSubmit ? null : <text x="76" y="132" textAnchor="middle" transform="rotate(-24 76 132)" className="bv-draft">DRAFT</text>}
        </svg>
        <div className="bv-ready">
          <p className="bv-big">
            {ready} of {total}
          </p>
          <p className="bv-sub">{status.canSubmit ? "ready to hand in" : "ready"}</p>
          <div className="bv-bar" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={ready} aria-label="Ready to hand in">
            <span style={{ width: `${(ready / Math.max(1, total)) * 100}%` }} />
          </div>
          <ul className="bv-checks">
            {lines.map((l) => (
              <li key={l.label} data-done={l.done || undefined} data-phone={l.phone || undefined}>
                <span className="bv-box" aria-hidden>
                  {l.done ? "✓" : ""}
                </span>
                {l.label}
                <span className="visually-hidden">{l.done ? ", done" : ", to do"}</span>
              </li>
            ))}
            {more > 0 && <li className="bv-more">and {more} more to do</li>}
          </ul>
        </div>
      </div>
    </Pane>
  );
}

export function MoneyVisual({ scanId }: VisualProps<"money">) {
  const { result } = useBuild(scanId);
  if (!result) return <Pane caption="The money" note="Adding up the money…" />;
  const grants = (result.grants ?? []).filter((g) => g.qualify !== "no");
  const total = result.money?.total ?? 0;
  const ifYes = result.money?.ifYes ?? 0;
  const worth = (g: (typeof grants)[number]) => (g.value === "cash" ? (g.amountCAD ? `up to ${dollars(g.amountCAD)}` : "to be worked out") : g.value === "financing" ? "a loan" : "saves fees");
  return (
    <Pane caption="Each program makes the final call" kind="money">
      <div className="bv-money">
        <div className="bv-money-head">
          <p className="bv-sub">You may be eligible for up to</p>
          <p className="bv-big">{dollars(total)}</p>
          {ifYes > 0 && <p className="bv-sub">and up to {dollars(ifYes)} more, one answer away</p>}
        </div>
        <ul className="bv-programs">
          {grants.map((g) => (
            <li key={g.id} data-qualify={g.qualify}>
              <span className="bv-program-name">{g.shortName}</span>
              <span className="mono">{worth(g)}</span>
              <span className="bv-program-state">{g.qualify === "yes" ? (g.apply?.when === "tax_time" ? "At tax time" : g.apply?.when === "before_work" ? "Apply first" : "Fits") : "One answer away"}</span>
            </li>
          ))}
        </ul>
      </div>
    </Pane>
  );
}

const STEPS: Record<"hire" | "mix" | "diy" | "none", { who: string; what: string }[]> = {
  hire: [
    { who: "Designer", what: "signs the drawings" },
    { who: "The City", what: "issues the permit" },
    { who: "Contractor", what: "builds it, with licensed trades" },
    { who: "Inspector", what: "checks each stage" },
  ],
  mix: [
    { who: "Designer", what: "signs the drawings" },
    { who: "The City", what: "issues the permit" },
    { who: "You", what: "run the job, do some of it" },
    { who: "Trades", what: "electrical, gas, plumbing" },
    { who: "Inspector", what: "checks each stage" },
  ],
  diy: [
    { who: "You", what: "draw and sign it, where the City allows" },
    { who: "The City", what: "issues the permit" },
    { who: "You", what: "build it" },
    { who: "Trades", what: "only what needs a licence" },
    { who: "Inspector", what: "checks each stage" },
  ],
  none: [
    { who: "Drawings", what: "signed" },
    { who: "Permit", what: "issued" },
    { who: "Builders", what: "hired, or you" },
    { who: "Inspections", what: "each stage" },
  ],
};
const PATH_TITLE = { hire: "Hire it out", mix: "A mix", diy: "Do it yourself" } as const;

export function BuildersVisual({ scanId }: VisualProps<"builders">) {
  const { ws } = useBuild(scanId);
  const path = ws?.state.build?.path ?? null;
  const pros = ws?.state.build?.pros ?? [];
  const quotes = pros.filter((p) => p.quoteCAD != null).length;
  const steps = STEPS[path ?? "none"];
  return (
    <Pane caption={path ? `${PATH_TITLE[path]}${pros.length ? ` · ${pros.length} ${pros.length === 1 ? "person" : "people"} asked, ${quotes} ${quotes === 1 ? "quote" : "quotes"} in` : ""}` : "Who builds it"} kind="builders">
      <ol className="bv-path" aria-label="From the drawings to move-in">
        {steps.map((s, i) => (
          <li key={`${s.who}-${i}`}>
            <span className="bv-path-n mono">{String(i + 1).padStart(2, "0")}</span>
            <span className="bv-path-who">{s.who}</span>
            <span className="bv-path-what">{s.what}</span>
          </li>
        ))}
        <li data-end>
          <span className="bv-path-n mono">{String(steps.length + 1).padStart(2, "0")}</span>
          <span className="bv-path-who">Move-in</span>
          <span className="bv-path-what">a second home downstairs</span>
        </li>
      </ol>
    </Pane>
  );
}

// The pane's paper and its caption. With nothing loaded yet it stays a quiet sheet, never empty or spinning.
function Pane({ caption, kind, note, children }: { caption: string; kind?: string; note?: string; children?: ReactNode }) {
  return (
    <div className="bv" data-build-visual={kind ?? "loading"}>
      <div className="bv-body">{children ?? <p className="bv-sub bv-note">{note}</p>}</div>
      <p className="bv-cap">{caption}</p>
    </div>
  );
}
