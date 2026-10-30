import { EXAMPLE } from "./example";
import { Cited, MarketingPage, PageHead, Ref, Section, SourceList } from "./parts";
import { PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = ["quarts", "codePart9", "costLegalToronto"];

// The example plan is the example basement anyone can try (public/samples/sample), with its own numbers
// (./example.ts). No real homeowner's details.
const opening = (kind: "window" | "door") => EXAMPLE.openings.find((o) => o.kind === kind)?.width ?? "To measure";
const MEASURES = [
  { label: "Basement, rough", value: EXAMPLE.size },
  { label: "Floor area", value: EXAMPLE.area },
  { label: "Ceiling", value: EXAMPLE.ceiling },
  { label: "Window width", value: opening("window") },
  { label: "Door width", value: opening("door") },
];

const FIXES = [
  ...(EXAMPLE.fix ? [{ what: "Fire and smoke separation", why: "Joists and ducts look exposed", cost: <>{EXAMPLE.fix.cost}<Ref id="costLegalToronto" /></> }] : []),
  { what: "A safe way out", why: "Waiting on the homeowner's answer", cost: "Quote needed" },
  { what: "Kitchen, bath, water shut-off", why: "Waiting on the homeowner's answer", cost: "Quote needed" },
];

const INCLUDES = [
  { what: "The scan", detail: "A 3D model of the basement and the video frames behind every finding." },
  { what: "Measurements", detail: "Ceiling heights, clearance under ducts and beams, window openings, door widths." },
  { what: "The fix list", detail: "Each item tied to the rule it fails, in plain words, with its source." },
  { what: "A rough cost", detail: "A range per fix and in total, labelled as an estimate, not a quote." },
  { what: "What they want", detail: "Who the suite is for, the address, and their own notes and questions." },
  { what: "What's unknown", detail: "Anything the scan couldn't confirm is marked “confirm on site.”" },
];

export function ForPros() {
  return (
    <MarketingPage path={PATHS.forPros} motion="brief">
      <Cited ids={CITED}>
        <PageHead
          title="For designers and builders."
          lede="Basement Ready helps Ontario homeowners find out if their basement can become a legal second unit. When one wants help, they can hand you a one-page plan with the scan, the measurements, the fix list and a rough cost, so you see the job before you visit."
          actions={
            <>
              <a className="btn btn-primary" href={PATHS.proSignUp}>
                Join as a founding pro <span className="arrow" aria-hidden>→</span>
              </a>
              <span className="mk-aside">Free while we set pricing.</span>
            </>
          }
        />

        <Section id="lead" title="What a plan comes with." intro="One homeowner, one basement, one page. This example is the example basement anyone can try, with its own numbers.">
          <div className="mk-brief-wrap">
            <figure className="mk-brief" data-reveal aria-label="Example plan for the example basement">
              <header className="mk-brief-top">
                <span className="mk-brief-title">Basement suite, the example</span>
                <span className="mk-brief-tag">Example</span>
              </header>
              <svg className="mk-art mk-plan" viewBox="0 0 320 170" aria-hidden>
                <g className="mk-line">
                  <rect data-s pathLength={1} x="10" y="10" width="300" height="150" rx="2" />
                  <path data-s pathLength={1} d="M10 70H62M10 110H62V160" />
                  <path data-s pathLength={1} d="M30 70V160M38 70V160M46 70V160M54 70V160" />
                  <path data-s pathLength={1} d="M260 10V56H310M260 34H288" />
                </g>
                <g className="mk-plan-finds">
                  <path className="mk-find" data-kind="window" d="M76 10H112M168 10H204M310 108V144" />
                  <path className="mk-find" data-kind="duct" d="M48 92H286" strokeDasharray="6 4" />
                  <path className="mk-find" data-kind="exit" d="M10 26V44" />
                  <rect className="mk-find-box" data-kind="mechanical" x="268" y="16" width="16" height="14" />
                </g>
                <text x="82" y="26" className="mk-plan-label">window</text>
                <text x="150" y="86" className="mk-plan-label">duct</text>
                <text x="18" y="62" className="mk-plan-label">stairs</text>
                <text x="212" y="28" className="mk-plan-label">furnace</text>
              </svg>
              <dl className="mk-brief-measures">
                {MEASURES.map((m) => (
                  <div key={m.label}>
                    <dt>{m.label}</dt>
                    <dd>{m.value}</dd>
                  </div>
                ))}
              </dl>
              <ol className="mk-brief-fixes">
                {FIXES.map((f) => (
                  <li key={f.what}>
                    <span>
                      <strong>{f.what}</strong>
                      <em>{f.why}</em>
                    </span>
                    <span className="mk-brief-cost">{f.cost}</span>
                  </li>
                ))}
              </ol>
              <figcaption>The drawing is for illustration. Rough costs from published price guides: estimates, not quotes.</figcaption>
            </figure>

            <ul className="mk-rows mk-includes">
              {INCLUDES.map((c) => (
                <li key={c.what} data-reveal>
                  <strong>{c.what}</strong>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="mk-note">
            Measurements come from phone video, not a tape. Treat them as a starting point and confirm on site. The
            rules behind each fix are from Ontario's 2024 Building Code<Ref id="codePart9" />.
          </p>
        </Section>

        <Section id="inbox" title="Coming: one inbox for plans." intro="We're building a pro side where plans arrive with the scan, frames and fix list together. It isn't open yet. Founding pros get it first.">
          <div className="mk-inbox" data-reveal aria-hidden>
            <div className="mk-inbox-row" style={{ "--i": 0 } as React.CSSProperties}>
              <span className="mk-inbox-dot" />
              <span className="mk-inbox-text">Basement suite, the example</span>
              <span className="mk-inbox-mono">1 fix, 2 to confirm</span>
              <span className="mk-inbox-mono">Example</span>
            </div>
            {[1, 2].map((i) => (
              <div key={i} className="mk-inbox-row" style={{ "--i": i } as React.CSSProperties}>
                <span className="mk-inbox-dot" />
                <span className="mk-inbox-bar" />
                <span className="mk-inbox-bar mk-inbox-bar-short" />
                <span className="mk-inbox-meta" />
              </div>
            ))}
          </div>
        </Section>

        <Section id="who" title="Who it's for.">
          <ul className="mk-who" data-reveal>
            <li>
              <h3>Designers</h3>
              <p>
                Registered designers with a BCIN, and architects and engineers who take on house projects. Homeowners
                can look up a designer's registration on Ontario's public registry<Ref id="quarts" />.
              </p>
            </li>
            <li>
              <h3>Builders</h3>
              <p>
                General contractors and renovators who build basement second units in Waterloo, Kitchener and
                Cambridge.
              </p>
            </li>
          </ul>
        </Section>

        <Section id="terms" title="How it works for you.">
          <ul className="mk-rows" data-reveal>
            <li>
              <strong>Founding pros are free</strong>
              <span>No charge while we work out pricing. We'll tell you before that changes, and you can leave at any time.</span>
            </li>
            <li>
              <strong>Homeowners choose</strong>
              <span>When sending opens, a homeowner picks who gets their plan. Nobody pays to be ranked higher, and we don't label anyone "recommended."</span>
            </li>
            <li>
              <strong>You're independent</strong>
              <span>You quote and contract with the homeowner directly. Use their details only for the job they bring you.</span>
            </li>
            <li>
              <strong>Homeowners use it free</strong>
              <span>Pros will pay for qualified leads. That's how it stays free for the people filming their basements.</span>
            </li>
          </ul>
        </Section>

        <section className="mk-cta" data-reveal>
          <h2>Be first when plans start arriving.</h2>
          <p>Tell us what you do and where you work.</p>
          <a className="btn btn-primary" href={PATHS.proSignUp}>
            Join as a founding pro <span className="arrow" aria-hidden>→</span>
          </a>
        </section>

        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
