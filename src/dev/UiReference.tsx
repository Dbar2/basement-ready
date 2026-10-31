// /dev/ui on a dev server: the Drawing Set UI system (brand/ui.md) drawn with the app's own classes, so a change
// to a token or a shared rule shows here first. The example basement's real frames and figures fill it.
import { useEffect, useState } from "react";
import { FlowFoot, FlowHead } from "../flow/FlowNav";
import "../flow/flow.css";
import "../ideas/ideas.css";
import "../studio/studio.css";
import "./ui-reference.css";

const COLOURS = [
  ["--color-bg", "The sheet"],
  ["--color-card", "Paper in a frame"],
  ["--color-surface", "3D, placeholders"],
  ["--color-border", "Hairlines"],
  ["--color-ink", "Text, frames, structure"],
  ["--color-ink-muted", "Secondary text"],
  ["--color-mint", "The one primary, fill only"],
  ["--color-mint-line", "Mint lines, large UI"],
  ["--color-accent-text", "Small green text"],
  ["--color-ok", "Ready"],
  ["--color-fix", "To fix"],
  ["--color-stop", "Stop"],
] as const;

const FINDS = [
  ["window", "Window", "45 cm"],
  ["exit", "Door", "70 cm"],
  ["stairs", "Stairs", "1.75 × 0.88 m"],
  ["duct", "Duct", "1.64 m clear"],
] as const;

function Swatch({ token, use }: { token: string; use: string }) {
  const [hex, setHex] = useState("");
  useEffect(() => setHex(getComputedStyle(document.documentElement).getPropertyValue(token).trim()), [token]);
  return (
    <li className="ref-swatch">
      <i style={{ background: `var(${token})` }} />
      <b>{use}</b>
      <span className="mono">{token}</span>
      <span className="mono">{hex}</span>
    </li>
  );
}

// A dimension line: 1 px ink with tick ends, the figure knocked out of the line.
function Dimension({ label }: { label: string }) {
  return (
    <svg className="ref-dim" viewBox="0 0 400 24" role="img" aria-label={label}>
      <line x1="1" y1="12" x2="399" y2="12" />
      <line x1="1" y1="6" x2="1" y2="18" />
      <line x1="399" y1="6" x2="399" y2="18" />
      <rect x="160" y="2" width="80" height="20" />
      <text x="200" y="16">{label}</text>
    </svg>
  );
}

// The example basement's shell, drawn like the plan step.
function Plan() {
  return (
    <svg className="plan ref-plan" viewBox="-60 -60 880 680" role="img" aria-label="The example basement's plan">
      <rect className="plan-paper" x="-60" y="-60" width="880" height="680" />
      <g className="plan-dim">
        <line x1="0" y1="-30" x2="756" y2="-30" />
        <line x1="0" y1="-38" x2="0" y2="-22" />
        <line x1="756" y1="-38" x2="756" y2="-22" />
        <text x="378" y="-38" textAnchor="middle">7.56 m</text>
      </g>
      <path className="plan-wall" d="M0 0H756V552H0Z" fill="none" strokeWidth="14" pathLength={1} />
      <g className="plan-stairs">
        <rect x="120" y="8" width="115" height="62" />
        {[0, 1, 2, 3, 4].map((i) => (
          <line key={i} x1={135 + i * 20} y1="8" x2={135 + i * 20} y2="70" />
        ))}
      </g>
      <g className="plan-window">
        <line x1="330" y1="552" x2="420" y2="552" />
      </g>
      <text className="plan-room-name" x="378" y="300" textAnchor="middle">
        Your basement
      </text>
      <text className="plan-room-meta" x="378" y="332" textAnchor="middle">
        41.7 m²
      </text>
    </svg>
  );
}

export function UiReference() {
  useEffect(() => {
    document.title = "UI reference | Basement Ready";
  }, []);
  const [toggle, setToggle] = useState<"3d" | "plan">("3d");
  const [chip, setChip] = useState("Light oak");
  return (
    <div className="flow-page">
      <FlowHead scanId="sample" step="layouts" remember={false} />
      <main className="ref">
        <div className="flow-title">
          <h1>Drawing Set</h1>
          <p className="lede">The UI system in brand/ui.md, drawn with the app's own classes. One clear thing per sheet, one mint button.</p>
        </div>

        <section className="ref-sec">
          <h2>Colour</h2>
          <ul className="ref-swatches">
            {COLOURS.map(([t, u]) => (
              <Swatch key={t} token={t} use={u} />
            ))}
          </ul>
        </section>

        <section className="ref-sec">
          <h2>Type</h2>
          <div className="ref-type">
            <p className="ref-display">Could your basement be a home?</p>
            <p className="ref-h2">What has to change</p>
            <p className="ref-h3">Fire separation at the stairs</p>
            <p>Body text for everything you read, at 16 px. Short sentences, one idea each, never more than 62 characters wide.</p>
            <p className="aside">Small text for captions and help under a field.</p>
            <p>
              Figures in Geist Mono: ceiling <span className="mono">2.08 m</span>, area <span className="mono">41.7 m²</span>, rough cost{" "}
              <span className="mono">$50k–$86k</span>.
            </p>
          </div>
        </section>

        <section className="ref-sec">
          <h2>Actions</h2>
          <div className="ref-row">
            <button className="btn btn-primary">
              Design it in 3D <span className="arrow" aria-hidden>→</span>
            </button>
            <button className="btn btn-ghost">A suite for family</button>
            <button className="btn btn-ghost" aria-pressed="true">
              Picked choice
            </button>
            <button className="link-quiet">Fix a wall</button>
          </div>
          <div className="ref-row">
            {["Light oak", "Warm wood", "Deep green"].map((c) => (
              <button key={c} className="chip" aria-pressed={chip === c} onClick={() => setChip(c)}>
                {c}
              </button>
            ))}
            <div className="segmented small" role="tablist" aria-label="View">
              <button role="tab" aria-selected={toggle === "3d"} onClick={() => setToggle("3d")}>
                3D
              </button>
              <button role="tab" aria-selected={toggle === "plan"} onClick={() => setToggle("plan")}>
                Plan
              </button>
            </div>
          </div>
          <p className="aside">One mint button per screen. Choices are hairline boxes that fill with ink; secondary actions are links.</p>
        </section>

        <section className="ref-sec ref-two">
          <div>
            <h2>Ruled list</h2>
            <ul className="ruled ref-list">
              <li>
                <b>Ceiling height</b>
                <span className="mono">2.08 m</span>
                <span className="status" data-status="ok">
                  Ready
                </span>
              </li>
              <li>
                <b>Smoke alarm in the bedroom</b>
                <span className="mono">1</span>
                <span className="status" data-status="fix">
                  To fix
                </span>
              </li>
              <li>
                <b>Fire separation</b>
                <span className="mono">30 min</span>
                <span className="status" data-status="check">
                  A designer confirms
                </span>
              </li>
            </ul>
          </div>
          <div>
            <h2>What the scan finds</h2>
            <ul className="ruled ref-list">
              {FINDS.map(([k, n, m]) => (
                <li key={k} data-kind={k}>
                  <b>
                    <span className="find-dot" /> {n}
                  </b>
                  <span className="mono">{m}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="ref-sec ref-two">
          <div>
            <h2>Plan and measurements</h2>
            <div className="plan-stage">
              <Plan />
            </div>
            <Dimension label="7.56 m" />
          </div>
          <div>
            <h2>3D viewer</h2>
            <div className="studio-3d ref-3d">
              <div className="stage-tools">
                <div className="segmented small" role="group" aria-label="How to look">
                  <button aria-pressed="true">From above</button>
                  <button aria-pressed="false">Walk</button>
                </div>
              </div>
              <p className="viewer-empty">The 3D draws here, on the light surface.</p>
              <p className="viewer-hint">Drag a wall to move it · drag elsewhere to turn</p>
            </div>
          </div>
        </section>

        <section className="ref-sec ref-two">
          <figure className="ref-photo">
            <img src="/samples/sample/frames/0021.jpg" alt="The example basement, as filmed" />
            <figcaption>
              <b>As filmed</b>
              <span className="aside">A frame from the example's video, lightly brightened.</span>
            </figcaption>
          </figure>
          <figure className="ref-photo">
            <img src="/samples/sample/concepts/1.jpg" alt="The example basement, virtually staged" />
            <figcaption>
              <b>Virtually staged</b>
              <span className="aside">The label sits under the photo, never on it.</span>
            </figcaption>
          </figure>
        </section>

        <section className="ref-sec">
          <h2>Notes, empty, loading and errors</h2>
          <div className="ref-states">
            <p className="note-inline">The photos are taking longer than usual. Refresh in a few minutes to see them.</p>
            <p className="changed">Your answer changed one check: the bedroom window now meets the exit size.</p>
            <div className="deck-empty">
              <p className="deck-empty-title">Your board</p>
              <p>Love a few cards and your style shows here.</p>
            </div>
            <div className="ref-loading">
              <div className="skeleton" />
              <p className="aside">Drawing your plan, about 10 seconds.</p>
            </div>
            <div className="ref-error" role="alert">
              <p>
                <b>We couldn't see the ceiling clearly.</b> Point your phone up for a few seconds and we'll measure it.
              </p>
              <button className="btn btn-ghost">Try again</button>
            </div>
          </div>
        </section>
      </main>
      <FlowFoot scanId="sample" step="layouts" next={{ label: "Design it in 3D", onClick: () => {} }} />
    </div>
  );
}
