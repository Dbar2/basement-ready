import { LegalDoc, type LegalSection } from "./Legal";
import { ContactEmail, DraftNotice, MarketingPage, PageHead } from "./parts";
import { PATHS, SITE } from "./site";

const SECTIONS: LegalSection[] = [
  {
    id: "what",
    title: "What Basement Ready is",
    body: (
      <p>
        Basement Ready is a screening aid. From a video of your basement, it estimates whether the space could become a
        second unit, what would have to change, roughly what that costs, which programs may fit, and who nearby could
        help. It's run by {SITE.builder} in Waterloo, Ontario. By using it, you agree to these terms.
      </p>
    ),
  },
  {
    id: "estimates",
    title: "Estimates are not quotes",
    body: (
      <p>
        Every cost we show is a rough range from published price guides and contractor pages. It isn't a quote or an
        offer. Real prices depend on your home, your choices and the market. Only a contractor who has seen your
        basement can quote the work.
      </p>
    ),
  },
  {
    id: "advice",
    title: "Not advice, and not an approval",
    body: (
      <>
        <p>
          Basement Ready doesn't give legal, financial, tax, engineering or building-code advice. It isn't a permit
          decision, and nothing it says means your project is approved. Your City decides through a building permit and
          inspections.
        </p>
        <p>
          When we say you "look eligible" for a program, the program decides. Programs change, close or run out of
          money. Check with each one before you count on it.
        </p>
      </>
    ),
  },
  {
    id: "measure",
    title: "Measurements and findings",
    body: (
      <p>
        Measurements come from phone video and can be wrong, and the scan can't see inside walls or anything that isn't
        in the video. Confirm measurements and hidden conditions on site, with a qualified designer or builder, before
        you buy materials, sign a contract or start work.
      </p>
    ),
  },
  {
    id: "pros",
    title: "Designers and builders are independent",
    body: (
      <>
        <p>
          Designers and builders who get briefs are independent businesses, not our employees, agents or partners.
          We don't do, supervise or guarantee their work. Nobody pays to be ranked higher, and listing a pro isn't a
          recommendation.
        </p>
        <p>
          Before you hire anyone, check their registration, insurance and references yourself. Any agreement for
          design or building work is between you and the pro.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Your account",
    body: (
      <p>
        You need to be 18 or older to make an account. Keep your sign-in details to yourself and your information
        accurate. You're responsible for what happens under your account.
      </p>
    ),
  },
  {
    id: "content",
    title: "Your video and project",
    body: (
      <p>
        You own your video and project. You let us store and process them to run Basement Ready for you, as the{" "}
        <a href={PATHS.privacy}>privacy policy</a> describes, and to send your brief to the pros you choose. You confirm
        you own the home you film or have permission to film it.
      </p>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <>
        <p>Everyone agrees not to:</p>
        <ul className="mk-bullets">
          <li>upload video of a home without permission, or of people who haven't agreed to be filmed</li>
          <li>upload anything illegal, or that isn't a home you're asking about</li>
          <li>pretend to be someone else, or give false registration or licence details</li>
          <li>overload, break into or scrape the service, or get around its limits</li>
          <li>use Basement Ready's results to mislead someone, such as presenting an estimate as a quote or an approval</li>
        </ul>
        <p>Pros also agree to:</p>
        <ul className="mk-bullets">
          <li>use a homeowner's details only to respond to the brief they sent</li>
          <li>not sell or pass on leads, or add homeowners to marketing lists</li>
          <li>hold the registration, licences and insurance their work requires</li>
        </ul>
      </>
    ),
  },
  {
    id: "fees",
    title: "Fees",
    body: (
      <p>
        Basement Ready is free for homeowners. Pros will pay for qualified leads; founding pros use it free until
        pricing is set. We'll tell pros the price, in writing, before we charge anything, and nobody is charged without
        agreeing first.
      </p>
    ),
  },
  {
    id: "code",
    title: "Open source",
    body: (
      <p>
        Basement Ready's code is open source and comes with its own licence. These terms cover the hosted service, not
        the code.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Limits on our responsibility",
    body: (
      <p>
        We work hard to get things right, but the service is provided as is. To the extent the law allows, we aren't
        responsible for decisions you make based on its estimates, or for work done by any designer or builder. Nothing
        in these terms takes away rights you have under Ontario consumer protection law.
      </p>
    ),
  },
  {
    id: "ending",
    title: "Ending",
    body: (
      <p>
        You can stop using Basement Ready and delete your account at any time. We may suspend an account that breaks
        these terms, and we'll tell you why.
      </p>
    ),
  },
  {
    id: "law",
    title: "Changes and the law",
    body: (
      <>
        <p>
          When these terms change, we'll post the new version here with its date, and email you about big changes.
          These terms are governed by the laws of Ontario and the federal laws of Canada that apply there.
        </p>
        <p>
          Questions: <ContactEmail />.
        </p>
      </>
    ),
  },
];

export function Terms() {
  return (
    <MarketingPage path={PATHS.terms} motion="legal">
      <DraftNotice subject="These terms are" />
      <PageHead title="Terms." lede="The deal, in plain words: what Basement Ready is, what it isn't, and what we ask of everyone who uses it." />
      <LegalDoc sections={SECTIONS} />
    </MarketingPage>
  );
}
