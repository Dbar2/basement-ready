import { UnitsArt } from "./drawings";
import { Cited, MarketingPage, PageHead, Ref, ScanCta, Section, SourceList } from "./parts";
import { PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = [
  "buildingCode",
  "planningAct",
  "aruRegulation",
  "dcAct",
  "mhrtc",
  "waterlooZoning",
  "waterlooAru",
  "waterlooGrant",
  "regionFactSheet",
  "kitchenerAdu",
  "cambridgeAru",
];

// Coverage, per city. Waterloo's rules pack is data/rules/waterloo-on.json.
// Kitchener and Cambridge packs are being compiled; flip `pack` to "full" and
// fill in permit and money details once their JSON lands.
type City = {
  name: string;
  units: number;
  unitsLabel: string;
  pack: "full" | "in-progress";
  rows: { label: string; value: React.ReactNode }[];
};

const CITIES: City[] = [
  {
    name: "Waterloo",
    units: 4,
    unitsLabel: "Up to four homes on the lot",
    pack: "full",
    rows: [
      { label: "Called", value: "Additional residential unit (ARU)" },
      {
        label: "Homes per lot",
        value: <>Up to 4: the house plus up to 3 more units, with at most one in a backyard building<Ref id="waterlooZoning" /></>,
      },
      {
        label: "Permit",
        value: <>$392 per unit plus $0.62 per sq ft, with a 15-business-day review<Ref id="waterlooAru" /></>,
      },
      {
        label: "Money we check",
        value: (
          <>
            City ARU grant, up to $20,000 for a basement unit<Ref id="waterlooGrant" />; Region of Waterloo loan, up to
            $25,000<Ref id="regionFactSheet" />; the federal tax credit<Ref id="mhrtc" />
          </>
        ),
      },
      { label: "Coverage", value: "Full: zoning, the Building Code, City permit steps and fees, and City, Region and federal money." },
    ],
  },
  {
    name: "Kitchener",
    units: 4,
    unitsLabel: "Up to four homes on many lots",
    pack: "in-progress",
    rows: [
      { label: "Called", value: "Additional dwelling unit (ADU)" },
      {
        label: "Homes per lot",
        value: (
          <>
            Up to 4 on many residential lots. Some lots can only take one or two, because of lot width, servicing or
            natural hazards<Ref id="kitchenerAdu" />
          </>
        ),
      },
      {
        label: "Permit",
        value: <>A building permit, and a zoning (occupancy) certificate for most ADUs<Ref id="kitchenerAdu" /></>,
      },
      { label: "Money we check", value: <>The federal tax credit<Ref id="mhrtc" />. Region and City programs are being added.</> },
      { label: "Coverage", value: "The Building Code and Kitchener's unit limit. City steps and fees are being added." },
    ],
  },
  {
    name: "Cambridge",
    units: 3,
    unitsLabel: "Up to three homes on the lot",
    pack: "in-progress",
    rows: [
      { label: "Called", value: "Additional residential unit (ARU)" },
      {
        label: "Homes per lot",
        value: <>Up to 3: all three in the house, or two in the house and one in a backyard building<Ref id="cambridgeAru" /></>,
      },
      {
        label: "Permit",
        value: <>A building permit, and the City's Building Services must approve occupancy<Ref id="cambridgeAru" /></>,
      },
      {
        label: "Charges",
        value: <>The City and Region don't collect development charges for ARUs; school boards may in some cases<Ref id="cambridgeAru" /></>,
      },
      { label: "Money we check", value: <>The federal tax credit<Ref id="mhrtc" />. Region and City programs are being added.</> },
      { label: "Coverage", value: "The Building Code and Cambridge's unit limit. City steps and fees are being added." },
    ],
  },
];

export function Cities() {
  return (
    <MarketingPage path={PATHS.cities} motion="ledger">
      <Cited ids={CITED}>
        <PageHead
          title="Waterloo, Kitchener and Cambridge."
          lede="Basement Ready checks the rules for these three cities. Each one sets its own zoning. Ontario's Building Code is the same everywhere in the province."
        />

        <div className="mk-cities">
          {CITIES.map((c) => (
            <article key={c.name} className="mk-city" data-reveal aria-labelledby={`city-${c.name}`}>
              <div className="mk-city-name">
                <h2 id={`city-${c.name}`}>{c.name}</h2>
                <UnitsArt units={c.units} label={c.unitsLabel} />
                <span className="mk-spec">{c.pack === "full" ? "Rules checked 2026-10-28" : "City details in progress"}</span>
              </div>
              <dl className="mk-city-rows">
                {c.rows.map((r) => (
                  <div key={r.label}>
                    <dt>{r.label}</dt>
                    <dd>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>

        <Section
          id="everywhere"
          title="Anywhere else in Ontario."
          intro="Outside these three cities, you still get a result: the provincial rules, with a clear note on what to confirm with your City."
        >
          <div className="mk-elsewhere" data-reveal>
            <UnitsArt units={3} label="Up to three homes, Ontario's minimum" />
            <ul className="mk-rows">
              <li>
                <strong>Up to 3 homes</strong>
                <span>
                  Zoning can't ban up to three homes on a serviced residential lot: three in the house, or two in the
                  house and one in a backyard building<Ref id="planningAct" />. Your city may allow more.
                </span>
              </li>
              <li>
                <strong>The same Building Code</strong>
                <span>Ceiling heights, escape windows, fire separation, alarms and exits are checked the same way<Ref id="buildingCode" />.</span>
              </li>
              <li>
                <strong>Province-wide limits</strong>
                <span>
                  Zoning can't require more than one parking space per extra unit, or require the owner to live there.
                  Anyone can live in the unit<Ref id="aruRegulation" />.
                </span>
              </li>
              <li>
                <strong>Development charges</strong>
                <span>
                  City and regional development charges don't apply to a second or third unit in an existing house
                  <Ref id="dcAct" />. School-board charges can differ.
                </span>
              </li>
              <li>
                <strong>Confirm locally</strong>
                <span>
                  Your city's zoning, fees and grants aren't checked. Every result says so, and lists what to ask your
                  City's planning and building staff.
                </span>
              </li>
            </ul>
          </div>
          <p className="mk-note mk-note-page">
            Rules change. Every fact here links to its source and the date we checked it. If you spot something out of
            date, tell us and we'll fix it.
          </p>
        </Section>

        <ScanCta />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
