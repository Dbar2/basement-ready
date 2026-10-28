import { HomeInside } from "./drawings";
import { Cited, ContactEmail, MarketingPage, PageHead, Ref, ScanCta, Section, SourceList } from "./parts";
import { PATHS, SITE } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = ["planningAct", "waterlooZoning", "budget2025"];

const PRINCIPLES = [
  { what: "Say what we know, and what we don't", detail: "Anything the scan can't prove becomes a question or a “confirm on site,” never a guess." },
  { what: "Every rule links to its source", detail: "With the section and the date we checked it." },
  { what: "Free for homeowners", detail: "Pros pay for qualified leads. Nobody pays to be ranked higher." },
  { what: "Your video stays yours", detail: "Nothing goes to a pro unless you choose them and press send." },
  { what: "Open source", detail: "The code is public, so anyone can see how the answer is reached." },
];

export function About() {
  return (
    <MarketingPage path={PATHS.about} motion="drawing">
      <Cited ids={CITED}>
        <PageHead
          title="Built in Waterloo."
          lede={`Basement Ready is made by ${SITE.builder}, a product designer in Waterloo, Ontario. David designs complex workflows and AI-enabled products: the kind of work that turns a hard process into clear next steps.`}
        >
          <div className="mk-home-frame" data-reveal>
            <HomeInside />
          </div>
        </PageHead>

        <Section id="why" title="Why a basement.">
          <div className="mk-prose" data-reveal>
            <p>
              Ontario now lets most serviced residential lots hold up to three homes<Ref id="planningAct" />, and
              Waterloo allows four<Ref id="waterlooZoning" />. In many houses, the space for that second home is already built: it's the basement.
            </p>
            <p>
              But the path from "could we?" to a permit is hard to see. A basement finish and a second unit are
              different permits. The rules sit in a provincial code and a city by-law. Grants are scattered, some
              conflict, and the federal secondary-suite loan was cancelled before it launched
              <Ref id="budget2025" />. Most people don't know who to call.
            </p>
            <p>
              So Basement Ready starts with what you already have: a phone and your basement. It tells you what's
              possible, what it takes, roughly what it costs, and who can help, and it's honest about what it can't
              see.
            </p>
            {SITE.firsthandLine && <p className="mk-firsthand">{SITE.firsthandLine}</p>}
          </div>
        </Section>

        <Section id="how" title="How we work.">
          <ul className="mk-rows" data-reveal>
            {PRINCIPLES.map((p) => (
              <li key={p.what}>
                <strong>{p.what}</strong>
                <span>{p.detail}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section id="contact" title="Say hello.">
          <div className="mk-prose" data-reveal>
            <p>
              Questions, a correction, or a rule we got wrong? Email <ContactEmail />. Basement Ready isn't run by or
              affiliated with any City, the Region of Waterloo or the Province.
            </p>
          </div>
        </Section>

        <ScanCta />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
