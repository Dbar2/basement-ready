import { Cited, MarketingPage, PageHead, Ref, Section, SourceList } from "./parts";
import { PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = ["quarts", "codePart9", "costKw", "costHeating"];

// The example brief uses the app's sample basement (src/data/sampleBasement.ts),
// not a real homeowner.
const MEASURES = [
  { label: "Ceiling, to joists", value: "2.10 m" },
  { label: "Clear under duct", value: "1.88 m" },
  { label: "Clear under beam", value: "1.94 m" },
  { label: "Window openings (3)", value: "0.28 m²" },
  { label: "Side door", value: "0.86 m" },
];

const FIXES = [
  { what: "Bedroom escape window", why: "0.28 m², needs 0.35 m²", cost: <>$3,000–$6,000<Ref id="costKw" /></> },
  { what: "Separate the air", why: "Furnace shared with upstairs", cost: <>$6,000–$12,000<Ref id="costHeating" /></> },
  { what: "Fire separation", why: "Ceiling not visible: confirm on site", cost: "Quote needed" },
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
          lede="Basement Ready helps homeowners in Waterloo Region find out if their basement can become a legal second unit. When one wants help, they send their brief to pros nearby. You see the scan, the measurements, the fix list and a rough cost before you call them back."
          actions={
            <>
              <a className="btn btn-primary" href={PATHS.proSignUp}>
                Join as a founding pro <span className="arrow" aria-hidden>→</span>
              </a>
              <span className="mk-aside">Free while we set pricing.</span>
            </>
          }
        />

        <Section id="lead" title="What a lead comes with." intro="Every lead is one homeowner, one basement and one brief. This example uses our sample basement.">
          <div className="mk-brief-wrap">
            <figure className="mk-brief" data-reveal aria-label="Example brief for the sample basement">
              <header className="mk-brief-top">
                <span className="mk-brief-title">Basement suite, Waterloo</span>
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
                <text x="150" y="86" className="mk-plan-label">duct 1.88 m clear</text>
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
              <figcaption>Rough costs from published price guides. Estimates, not quotes.</figcaption>
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

        <Section id="inbox" title="One inbox for your leads." intro="Briefs arrive in your lead inbox with the scan, frames and fix list together. Open one, look it over, and decide if it's a job for you.">
          <div className="mk-inbox" data-reveal aria-hidden>
            <div className="mk-inbox-row" style={{ "--i": 0 } as React.CSSProperties}>
              <span className="mk-inbox-dot" />
              <span className="mk-inbox-text">Basement suite, Waterloo</span>
              <span className="mk-inbox-mono">3 fixes, 1 to confirm</span>
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
              <span>A homeowner picks who gets their brief. Nobody pays to be ranked higher, and we don't label anyone "recommended."</span>
            </li>
            <li>
              <strong>You're independent</strong>
              <span>You quote and contract with the homeowner directly. Use their details only for the job they sent you.</span>
            </li>
            <li>
              <strong>Homeowners use it free</strong>
              <span>Pros will pay for qualified leads. That's how it stays free for the people filming their basements.</span>
            </li>
          </ul>
        </Section>

        <section className="mk-cta" data-reveal>
          <h2>Get the first briefs from your area.</h2>
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
