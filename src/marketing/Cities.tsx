import { UnitsArt } from "./drawings";
import { Cited, MarketingPage, PageHead, Ref, ScanCta, Section, SourceList } from "./parts";
import { DATA_CREDIT, PATHS } from "./site";
import type { SourceId } from "./sources";

const CITED: SourceId[] = [
  "buildingCode",
  "planningAct",
  "aruRegulation",
  "dcAct",
  "mhrtc",
  "cmhcRefinance",
  "ontarioApplication",
  "waterlooZoning",
  "waterlooAru",
  "waterlooGrant",
  "regionFactSheet",
  "kitchenerAdu",
  "kitchenerPermits",
  "kitchenerGrant",
  "cambridgeAru",
  "cambridgeFees",
];

// Waterloo Region in depth: each city's rules pack is data/rules/<city>-on.json, checked on `checked`.
// Every other Ontario address gets the province's rules ("Anywhere else in Ontario" below).
type City = {
  name: string;
  units: number;
  unitsLabel: string;
  checked: string;
  rows: { label: string; value: React.ReactNode }[];
};

const CITIES: City[] = [
  {
    name: "Waterloo",
    units: 4,
    unitsLabel: "Up to four homes on the lot",
    checked: "2026-10-28",
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
      {
        label: "Coverage",
        value: "In depth: the City's zoning rules, fees, grants, forms and permit steps, plus Region and federal money. For your lot's zone, check the City's map.",
      },
    ],
  },
  {
    name: "Kitchener",
    units: 4,
    unitsLabel: "Up to four homes on many lots",
    checked: "2026-10-28",
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
        value: (
          <>
            $0.37 per sq ft of finished space, plus a $250 fee refunded after the final inspection; the City reviews a
            complete application within 10 business days<Ref id="kitchenerPermits" />. Most ADUs other than a duplex
            also need a zoning (occupancy) certificate<Ref id="kitchenerAdu" />
          </>
        ),
      },
      {
        label: "Money we check",
        value: (
          <>
            Region of Waterloo loan, up to $25,000<Ref id="regionFactSheet" />; the City's ADU grant, which covers
            school-board development charges for a 2nd or 3rd unit<Ref id="kitchenerGrant" />; the federal tax credit
            <Ref id="mhrtc" />
          </>
        ),
      },
      {
        label: "Coverage",
        value: "In depth: the City's zoning rules, fees, grants, forms and permit steps, plus Region and federal money. For your lot's zone, check the City's map.",
      },
    ],
  },
  {
    name: "Cambridge",
    units: 3,
    unitsLabel: "Up to three homes on the lot",
    checked: "2026-10-28",
    rows: [
      { label: "Called", value: "Additional residential unit (ARU)" },
      {
        label: "Homes per lot",
        value: <>Up to 3: all three in the house, or two in the house and one in a backyard building<Ref id="cambridgeAru" /></>,
      },
      {
        label: "Permit",
        value: (
          <>
            A building permit, and the City's Building Services must approve occupancy<Ref id="cambridgeAru" />. We
            estimate the fee from the City's interior-finish rate, $0.50 per sq ft plus a $25 zoning review; the City
            invoices the exact fee<Ref id="cambridgeFees" />
          </>
        ),
      },
      {
        label: "Charges",
        value: <>The City and Region don't collect development charges for ARUs; school boards may in some cases<Ref id="cambridgeAru" /></>,
      },
      {
        label: "Money we check",
        value: (
          <>
            City ARU grant, up to $10,000 per property while funds last<Ref id="cambridgeAru" />; Region of Waterloo
            loan, up to $25,000<Ref id="regionFactSheet" />; the federal tax credit<Ref id="mhrtc" />
          </>
        ),
      },
      {
        label: "Coverage",
        value: "In depth: the City's zoning rules, fees, grants, forms and permit steps, plus Region and federal money. Your lot's zone comes from the City's open data.",
      },
    ],
  },
];

export function Cities() {
  return (
    <MarketingPage path={PATHS.cities} motion="ledger">
      <Cited ids={CITED}>
        <PageHead
          title="All of Ontario. Waterloo Region in depth."
          lede="Every Ontario address gets the province's rules, under its own municipality's name. Waterloo, Kitchener and Cambridge also get their own zoning rules, fees, grants, forms and permit steps."
        />

        <div className="mk-cities">
          {CITIES.map((c) => (
            <article key={c.name} className="mk-city" data-reveal aria-labelledby={`city-${c.name}`}>
              <div className="mk-city-name">
                <h2 id={`city-${c.name}`}>{c.name}</h2>
                <UnitsArt units={c.units} label={c.unitsLabel} />
                <span className="mk-spec">Rules checked {c.checked}</span>
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
          id="townships"
          title="The Region's townships."
          intro="Woolwich, Wilmot, North Dumfries and Wellesley."
        >
          <ul className="mk-rows" data-reveal>
            <li>
              <strong>Ontario's rules, plus the Region's loan</strong>
              <span>
                Everything below for the rest of Ontario, plus the Region of Waterloo's forgivable loan of up to $25,000
                <Ref id="regionFactSheet" />. For zoning, ask your Township.
              </span>
            </li>
          </ul>
        </Section>

        <Section
          id="everywhere"
          title="Anywhere else in Ontario."
          intro="Outside Waterloo Region you still get a full answer, under your municipality's name. What isn't included: your municipality's zoning details, fees and grants."
        >
          <div className="mk-elsewhere" data-reveal>
            <UnitsArt units={3} label="Up to three homes, Ontario's minimum" />
            <ul className="mk-rows">
              <li>
                <strong>Up to 3 homes</strong>
                <span>
                  On a lot with municipal water and sewer, zoning can't ban up to three homes: three in the house, or
                  two in the house and one in a backyard building<Ref id="planningAct" />. Your municipality may allow
                  more.
                </span>
              </li>
              <li>
                <strong>The same Building Code</strong>
                <span>Ceiling heights, escape windows, fire separation, alarms and exits are checked the same way<Ref id="buildingCode" />.</span>
              </li>
              <li>
                <strong>Province-wide limits</strong>
                <span>
                  At most one parking space per added home, and no minimum unit size<Ref id="planningAct" />. Zoning
                  can't require the owner to live there: anyone can live in the unit<Ref id="aruRegulation" />.
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
                <strong>Federal money</strong>
                <span>
                  The multigenerational home renovation tax credit, up to $7,000<Ref id="mhrtc" />, and CMHC's refinance
                  for building a suite<Ref id="cmhcRefinance" />.
                </span>
              </li>
              <li>
                <strong>A permit package</strong>
                <span>
                  Drawings, and Ontario's own permit application filled in<Ref id="ontarioApplication" />, for you or a
                  designer to check before you submit.
                </span>
              </li>
              <li>
                <strong>Confirm locally</strong>
                <span>
                  Your municipality's zoning details, fees and grants aren't checked. Every result says so, and lists
                  what to ask your planning and building staff.
                </span>
              </li>
              <li>
                <strong>Outside Ontario</strong>
                <span>Basement Ready covers Ontario. Try the demo house.</span>
              </li>
            </ul>
          </div>
          <p className="mk-note mk-note-page">
            Rules change. Every fact here links to its source and the date we checked it. If you spot something out of
            date, tell us and we'll fix it. {DATA_CREDIT}
          </p>
        </Section>

        <ScanCta />
        <SourceList />
      </Cited>
    </MarketingPage>
  );
}
