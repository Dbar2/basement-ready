import { Cited, MarketingPage, PageHead, Ref, ScanCta, SourceList } from "./parts";
import { PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = [
  "codeDefinitions",
  "waterlooBasementFinish",
  "waterlooAru",
  "codePart9",
  "costKw",
  "costToronto",
  "aruRegulation",
  "mhrtc",
  "regionLoan",
];

const QUESTIONS: { q: string; a: React.ReactNode }[] = [
  {
    q: "What does it cost?",
    a: (
      <>
        <p>
          Nothing, for homeowners. Scanning, the answer, the 3D view and the brief are free. Designers and builders will
          pay for qualified leads, and that's how it stays free for you. Right now even founding pros use it free.
        </p>
      </>
    ),
  },
  {
    q: "Is this a permit or an approval?",
    a: (
      <p>
        No. It's a screening aid that shows what to fix and what to ask. Only your City can issue a building permit,
        and its inspectors check the work. We'll never tell you you're "approved." We'll say "looks possible if…" and
        what a designer or the City needs to confirm.
      </p>
    ),
  },
  {
    q: "What is a second unit?",
    a: (
      <>
        <p>
          A separate home inside your house, with its own kitchen, bathroom, sleeping area and way in. Ontario's
          Building Code calls it a secondary suite<Ref id="codeDefinitions" />. Waterloo and Cambridge call it an
          additional residential unit (ARU), and Kitchener calls it an additional dwelling unit (ADU).
        </p>
      </>
    ),
  },
  {
    q: "What's the difference between a basement finish and a second unit?",
    a: (
      <>
        <p>
          A basement finish adds living space to your home. It stays one home with one household, so the normal rules
          apply, like an escape window for any bedroom.
        </p>
        <p>
          A second unit is a separate home, so it needs more: fire and smoke separation between the homes, connected
          alarms, a safe exit, no shared air, and a permit for a new unit<Ref id="codePart9" />. In Waterloo, a basement
          finish permit is a flat $351 with about 10 business days to review<Ref id="waterlooBasementFinish" />. A
          second unit is $392 per unit plus $0.62 per sq ft, with 15 business days<Ref id="waterlooAru" />.
        </p>
        <p>We'll tell you which route fits your basement, and what each one would take.</p>
      </>
    ),
  },
  {
    q: "How accurate is it?",
    a: (
      <>
        <p>
          It's a good first look, not a site visit. Phone video isn't a tape measure, and readings can be off in dim
          light or tight corners. When a measurement is close to a limit, we'll ask you to check it with a tape.
        </p>
        <p>
          The scan can only see what's in the video. Anything hidden, like wiring, pipes or framing inside walls, is
          marked "confirm on site." Every finding shows the video frame it came from, so you can see what we saw.
        </p>
      </>
    ),
  },
  {
    q: "How rough are the costs?",
    a: (
      <p>
        Rough. They come from published price guides and contractor pages, and those disagree a lot. One basement escape
        window runs $3,000–$6,000 in a Kitchener-Waterloo guide<Ref id="costKw" /> and $7,500–$17,000 in a Toronto
        one<Ref id="costToronto" />. We show a range and its source. Only a contractor who has seen your basement can
        give you a quote.
      </p>
    ),
  },
  {
    q: "Can the suite be for family?",
    a: (
      <>
        <p>
          Yes. In Ontario, zoning can't require the owner to live on the property, and anyone can live in the unit
          <Ref id="aruRegulation" />.
        </p>
        <p>
          Who it's for changes the money. The federal tax credit fits a suite for a relative who is 65 or older, or
          eligible for the disability tax credit<Ref id="mhrtc" />. The Region of Waterloo's loan needs a tenant whose
          income is checked, at a capped rent<Ref id="regionLoan" />. That's why we ask who it's for before you film.
        </p>
      </>
    ),
  },
  {
    q: "What happens to my video?",
    a: (
      <p>
        We use it to scan your basement. The raw video is deleted after 30 days unless you save your project. Nothing
        goes to a designer or builder unless you choose them and press send. Please don't film people, mail or anything
        with your address on it. <a href={PATHS.privacy}>Read the privacy policy</a>.
      </p>
    ),
  },
  {
    q: "Which cities do you cover?",
    a: (
      <p>
        Waterloo, Kitchener and Cambridge. Anywhere else in Ontario, you get the provincial rules with a note on what to
        confirm with your City. <a href={PATHS.cities}>See what's covered</a>.
      </p>
    ),
  },
  {
    q: "Who's behind this?",
    a: (
      <p>
        David Barry, a product designer in Waterloo. It isn't run by any City, the Region or the Province, and the code
        is open source. <a href={PATHS.about}>More about why</a>.
      </p>
    ),
  },
];

export function Faq() {
  return (
    <MarketingPage path={PATHS.faq} motion="unfold">
      <Cited ids={CITED}>
        <PageHead title="Questions, answered plainly." lede="What it costs, how far to trust it, what happens to your video, and what a second unit actually is." />

        <div className="mk-faq">
          {QUESTIONS.map((item, i) => (
            <details key={item.q} className="mk-q" data-reveal style={{ "--i": i } as React.CSSProperties}>
              <summary>
                <span>{item.q}</span>
                <svg className="mk-q-icon" viewBox="0 0 20 20" aria-hidden>
                  <path d="M4 10H16" />
                  <path className="mk-q-v" d="M10 4V16" />
                </svg>
              </summary>
              <div className="mk-q-body">{item.a}</div>
            </details>
          ))}
        </div>

        <ScanCta />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
