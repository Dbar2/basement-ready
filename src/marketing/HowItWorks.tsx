import { ScanSection, StepArt, type StepGlyph } from "./drawings";
import { EXAMPLE } from "./example";
import { Cited, MarketingPage, PageHead, Ref, ScanCta, Section, SourceList } from "./parts";
import { PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = ["codePart9", "codeDefinitions", "waterlooZoning", "planningAct", "mhrtc", "regionLoan", "quarts"];

const STEPS: { glyph: StepGlyph; title: string; spec: string; body: React.ReactNode }[] = [
  {
    glyph: "film",
    title: "Film",
    spec: "Up to 5 min",
    body: (
      <>
        Walk your basement with your phone. A checklist on screen reminds you what to get: the stairs, every window,
        the ceiling, the furnace room and any outside door. Talk as you go, like "kitchen here" or "Mom sleeps here,"
        and we'll take notes.
      </>
    ),
  },
  {
    glyph: "scan",
    title: "Scan",
    spec: `Ceiling ${EXAMPLE.ceiling}`,
    body: (
      <>
        SAM 3.1 finds the windows, stairs, ducts, beams, furnace and electrical panel in your video. From the same
        footage, Meta's MapAnything builds a measured 3D model in about 2–3 minutes, so we can read ceiling heights,
        the clearance under ducts and the size of each window. If a reading isn't clear, we ask you to check it with a
        tape.
      </>
    ),
  },
  {
    glyph: "answer",
    title: "Answer",
    spec: "Rule + source",
    body: (
      <>
        Muse Spark checks what was found against Ontario's Building Code and your city's zoning, and gives a straight
        answer, like "Looks possible if you fix 3 things." Each fix shows the frame from your video, the rule in plain
        words with its source, and a rough cost. If something can't be seen, it asks you instead of guessing.
      </>
    ),
  },
  {
    glyph: "model",
    title: "See it in 3D",
    spec: "1 starting layout",
    body: (
      <>
        See your own basement with a starting layout that meets the rules: a bedroom by an escape window, a bathroom,
        a kitchen, with the real windows and stairs where they are. It's virtually staged, to show the idea, and a
        designer turns it into a real plan.
      </>
    ),
  },
  {
    glyph: "money",
    title: "Find the money",
    spec: "Source + date",
    body: (
      <>
        We check the grants, loans and tax credits that fit your plan, with each program's conditions, its source and
        the date we checked it. A suite for a parent and a rental suite fit different programs: the federal tax
        credit is for a relative who is 65 or older, or eligible for the disability tax credit
        <Ref id="mhrtc" />, while the Region's secondary-suite loan needs a tenant at a capped rent
        <Ref id="regionLoan" />. We'll say "you may be eligible if…", and the program decides.
      </>
    ),
  },
  {
    glyph: "build",
    title: "Get it built",
    spec: "1-page plan",
    body: (
      <>
        We draft your permit drawings and fill in the forms, for you or a designer to check before you submit them.
        Save a one-page plan to hand to designers and builders: your scan, measurements, fix list and rough cost.
        Designers can be checked on Ontario's public registry
        <Ref id="quarts" />. Sending plans to pros from here is coming.
      </>
    ),
  },
];

const CHECKS: { what: string; detail: React.ReactNode }[] = [
  { what: "Ceiling height", detail: <>1.95 m in the suite, 1.85 m under beams and ducts<Ref id="codePart9" /></> },
  { what: "Bedroom escape window", detail: <>An opening of at least 0.35 m², with no side under 380 mm<Ref id="codePart9" /></> },
  { what: "Fire and smoke separation", detail: <>Between the two homes, and around the furnace room<Ref id="codePart9" /></> },
  { what: "Smoke and CO alarms", detail: "Connected, so an alarm in one home sounds in both" },
  { what: "A way out", detail: "A safe exit from the suite to the outside" },
  { what: "Shared air", detail: <>Whether the furnace and ducts mix air between the homes<Ref id="codePart9" /></> },
  { what: "Kitchen, bathroom, water", detail: "And the suite's own water shut-off" },
  { what: "Zoning", detail: <>How many homes your lot allows, parking, and City water and sewer<Ref id="waterlooZoning" /></> },
];

const LIMITS: { what: string; detail: string }[] = [
  { what: "It isn't an approval", detail: "Only your City can issue a building permit, and its inspectors sign off the work." },
  { what: "It can't see inside walls", detail: "Wiring, insulation, pipes and framing behind drywall are marked “confirm on site.”" },
  { what: "Its drawings are drafts", detail: "Sizes come from video. You or a designer check them with a tape, and nothing is submitted for you." },
  { what: "It doesn't inspect electrical", detail: "A second unit needs its own electrical permit and inspection." },
  { what: "Two homes in the house, not three", detail: "The Code's secondary-suite rules cover a house with exactly two units." },
  { what: "No garden suites yet", detail: "Backyard and garage homes aren't covered." },
  { what: "It isn't advice", detail: "Not legal, financial or engineering advice. Costs are rough ranges, not quotes." },
];

export function HowItWorks() {
  return (
    <MarketingPage path={PATHS.howItWorks} motion="steps">
      <Cited ids={CITED}>
        <PageHead
          title="How it works."
          lede="Film your basement for up to 5 minutes. We measure it, check it against the rules for your address, and tell you plainly what would have to change."
        >
          <div className="mk-scan-frame" data-reveal>
            <ScanSection />
          </div>
        </PageHead>

        <ol className="mk-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="mk-step" data-reveal>
              <span className="mk-step-num" aria-hidden>
                0{i + 1}
              </span>
              <div className="mk-step-copy">
                <h2>{s.title}</h2>
                <p>{s.body}</p>
              </div>
              <div className="mk-step-side">
                <StepArt kind={s.glyph} />
                <span className="mk-spec">{s.spec}</span>
              </div>
            </li>
          ))}
        </ol>

        <Section
          id="checks"
          title="What it checks, and what it doesn't."
          intro={
            <>
              The checks come from Ontario's 2024 Building Code<Ref id="codePart9" /> and your city's zoning. Ontario
              lets most serviced residential lots hold up to three homes<Ref id="planningAct" />; Waterloo allows
              four<Ref id="waterlooZoning" />.
            </>
          }
        >
          <div className="mk-split">
            <div data-reveal>
              <h3 className="mk-list-title">It checks</h3>
              <ul className="mk-rows">
                {CHECKS.map((c) => (
                  <li key={c.what}>
                    <strong>{c.what}</strong>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div data-reveal>
              <h3 className="mk-list-title">It doesn't</h3>
              <ul className="mk-rows mk-rows-quiet">
                {LIMITS.map((c) => (
                  <li key={c.what}>
                    <strong>{c.what}</strong>
                    <span>{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        <section className="mk-statement" data-reveal aria-labelledby="decides-h">
          <h2 id="decides-h">It's not an approval. The City decides.</h2>
          <p>
            What you get is a head start: what to fix, what to ask, and roughly what it costs. A designer confirms the
            plan, the City reviews it for a permit, and inspectors check the work. A second unit is a separate home
            under the Code<Ref id="codeDefinitions" />, so the City treats it more strictly than a basement finish.
          </p>
          <a className="link-quiet" href={PATHS.faq}>
            Basement finish or second unit? Read the FAQ
          </a>
        </section>

        <ScanCta />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
