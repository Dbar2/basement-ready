import { LegalDoc, type LegalSection } from "./Legal";
import { Cited, ContactEmail, DraftNotice, MarketingPage, PageHead, Placeholder, Ref, SourceList } from "./parts";
import { PATHS, SITE } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = ["pipedaPrinciples", "pipeda", "opcConcern"];

const COLLECTED = [
  { what: "Video", detail: "The video of your basement, including its sound." },
  { what: "Frames", detail: "Still images we pull from the video, and what the scan finds and measures in them." },
  { what: "Voice", detail: "What you say while filming, and the text notes we make from it." },
  { what: "Address", detail: "Your street address, to pick the right city's rules and programs." },
  { what: "Answers", detail: "Who the suite is for, and your answers to our follow-up questions." },
  { what: "Account", detail: "Your name, email and sign-in details. For pros, also your business name, registration and work area." },
];

const PURPOSES = [
  { what: "To scan your basement", detail: "Video and frames are used to find windows, stairs, ducts and other features, and to measure the space." },
  { what: "To understand your plan", detail: "Your voice notes and answers tell us what you want and where." },
  { what: "To check the right rules", detail: "Your address sets which city's zoning, fees and programs apply." },
  { what: "To keep your project", detail: "Your account lets you come back to a saved project and get your results by email." },
  { what: "To send your brief", detail: "Only when you choose a designer or builder and press send." },
];

const PROCESSORS = [
  { name: "Meta Model API", role: "Runs the AI models: SAM 3.1 finds features in your frames, Muse Spark writes the answer, and transcription turns your voice into notes.", data: "Frames, voice, answers, address" },
  { name: "Modal", role: "Runs the 3D reconstruction on graphics processors.", data: "Video frames" },
  { name: "Cloudflare R2", role: "Stores files.", data: "Video, frames, 3D model" },
  { name: "Railway", role: "Hosts our app and database.", data: "Your project and account details" },
  { name: "Clerk", role: "Handles accounts and sign-in.", data: "Name, email, sign-in details" },
  { name: "Resend", role: "Sends our emails, including briefs you choose to send.", data: "Email address, message content" },
  { name: "Natural Resources Canada", role: "Finds addresses outside Waterloo Region as you type, with its public Geolocator.", data: "What you type in the address box" },
  { name: "Region of Waterloo and City of Cambridge", role: "Their public map services give the building footprint, the aerial photo (Region of Waterloo, 2024) and, in Cambridge, the zone.", data: "Your address's location" },
];

const KEPT = [
  { what: "Raw video", detail: "Deleted 30 days after upload, unless you save your project." },
  { what: "Unsaved projects", detail: "Deleted with the raw video after 30 days, including frames and results." },
  { what: "Saved projects", detail: "Kept until you delete the project or your account." },
  { what: "Your account", detail: "Kept until you delete it." },
  { what: "Briefs you send", detail: "We keep a record of what went to whom while your account is open. The pro's copy is theirs." },
  { what: "Server logs", detail: <Placeholder>retention period to confirm</Placeholder> },
];

function Rows({ items }: { items: { what: string; detail: React.ReactNode }[] }) {
  return (
    <ul className="mk-rows">
      {items.map((r) => (
        <li key={r.what}>
          <strong>{r.what}</strong>
          <span>{r.detail}</span>
        </li>
      ))}
    </ul>
  );
}

const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who we are",
    body: (
      <>
        <p>
          Basement Ready is built and run by {SITE.builder} in Waterloo, Ontario. David is responsible for how your
          personal information is handled. You can reach us at <ContactEmail />.
        </p>
        <p>
          We follow the ten fair information principles of Canada's private-sector privacy law, PIPEDA
          <Ref id="pipedaPrinciples" />.
        </p>
      </>
    ),
  },
  { id: "collect", title: "What we collect", body: <Rows items={COLLECTED} /> },
  {
    id: "why",
    title: "Why we collect it",
    body: (
      <>
        <Rows items={PURPOSES} />
        <p>We collect only what we need for these purposes. We don't sell your information or use it for advertising.</p>
      </>
    ),
  },
  {
    id: "consent",
    title: "Your consent",
    body: (
      <p>
        We ask before you film, and again before anything goes to a designer or builder. You can withdraw your consent
        at any time. We'll tell you what that means for your project; for example, we can't finish a scan without the
        video.
      </p>
    ),
  },
  {
    id: "processors",
    title: "Who processes it for us",
    body: (
      <>
        <p>These companies process information for us, on our instructions, only to run Basement Ready.</p>
        <table className="mk-table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">What it does</th>
              <th scope="col">What it handles</th>
            </tr>
          </thead>
          <tbody>
            {PROCESSORS.map((p) => (
              <tr key={p.name}>
                <th scope="row">{p.name}</th>
                <td>{p.role}</td>
                <td>{p.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Some of these companies store or process information outside Canada, including in the United States. While
          it's there, it may be accessible to courts and authorities under that country's laws.
        </p>
      </>
    ),
  },
  {
    id: "pros",
    title: "Sharing with pros",
    body: (
      <>
        <p>
          We share your project with a designer or builder only when you choose them and press send. Before you send,
          we show you what's in the brief and who will get it.
        </p>
        <p>
          Pros are independent businesses. Once they have your brief, they're responsible for how they handle it. We
          ask them to use it only to respond to your project.
        </p>
        <p>Apart from that, we disclose personal information only when the law requires it, such as a court order.</p>
      </>
    ),
  },
  { id: "keep", title: "How long we keep it", body: <Rows items={KEPT} /> },
  {
    id: "safe",
    title: "Keeping it safe",
    body: (
      <p>
        Information is encrypted on its way to and from Basement Ready, and stored files are encrypted by our storage
        provider. Only the people who run Basement Ready can open a project, and only to run or fix the service.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights",
    body: (
      <>
        <p>
          You can ask to see the personal information we hold about you, correct it, or have it deleted. We'll answer
          within 30 days<Ref id="pipeda" />.
        </p>
        <p>
          If you're not happy with our answer, you can complain to the Office of the Privacy Commissioner of Canada
          <Ref id="opcConcern" />.
        </p>
      </>
    ),
  },
  {
    id: "delete",
    title: "Deleting your data",
    body: (
      <>
        <p>
          Email <ContactEmail /> from the address on your account, and tell us what to delete: one project, or
          everything. We'll confirm by email when it's done.
        </p>
        <p>
          We delete it from our app, database and file storage, and ask our processors to do the same. Copies in
          backups, if any, expire on their own schedule.
        </p>
      </>
    ),
  },
  {
    id: "filming",
    title: "Filming and other people",
    body: (
      <p>
        Film only a home you own or have permission to film. Try to keep people, faces, mail and your house number out
        of the shot. Basement Ready is for adults; please don't make an account if you're under 18.
      </p>
    ),
  },
  {
    id: "changes",
    title: "Changes",
    body: <p>When this policy changes, we'll post the new version here with its date, and email you about big changes.</p>,
  },
];

export function Privacy() {
  return (
    <MarketingPage path={PATHS.privacy} motion="legal">
      <Cited ids={CITED}>
        <DraftNotice subject="This privacy policy is" />
        <PageHead
          title="Privacy."
          lede="What we collect when you scan your basement, why, who handles it, and how to have it deleted. In plain words."
        />
        <LegalDoc sections={SECTIONS} />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
