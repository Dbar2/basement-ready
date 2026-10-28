// Every factual claim on the marketing pages points at one of these.
// Most come from data/rules/waterloo-on.json and data/rules/SOURCES.md; the
// Kitchener, Cambridge and privacy-law entries were read on the date shown.

export type Source = {
  title: string;
  publisher: string;
  url: string;
  section?: string;
  retrieved: string;
};

const CHECKED = "2026-10-28";

export const SOURCES = {
  planningAct: {
    title: "Planning Act, R.S.O. 1990, c. P.13",
    publisher: "Government of Ontario",
    url: "https://www.ontario.ca/laws/statute/90p13",
    section: "s. 35.1(1)",
    retrieved: CHECKED,
  },
  aruRegulation: {
    title: "O. Reg. 299/19: Additional Residential Units",
    publisher: "Government of Ontario",
    url: "https://www.ontario.ca/laws/regulation/190299",
    section: "s. 2 (parking, any occupant, no owner requirement)",
    retrieved: CHECKED,
  },
  buildingCode: {
    title: "O. Reg. 163/24: Building Code",
    publisher: "Government of Ontario",
    url: "https://www.ontario.ca/laws/regulation/240163",
    section: "ss. 1–2",
    retrieved: CHECKED,
  },
  codeDefinitions: {
    title: "2024 Building Code Compendium, Division A Part 1",
    publisher: "Ministry of Municipal Affairs and Housing",
    url: "https://www.ontario.ca/document/2024-building-code-compendium/part-1-compliance",
    section: "1.4.1.2. “Secondary suite”",
    retrieved: CHECKED,
  },
  codePart9: {
    title: "2024 Building Code Compendium, Division B Part 9",
    publisher: "Ministry of Municipal Affairs and Housing",
    url: "https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings",
    section: "9.5.3.1 (heights), 9.9.10.1 (escape windows), 9.10.9.16 (separation), 9.33.1.1 (shared air)",
    retrieved: CHECKED,
  },
  waterlooZoning: {
    title: "Zoning By-law 2018-050 (consolidated 23 March 2026)",
    publisher: "City of Waterloo",
    url: "https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/ybpnbhdm/zoning-bylaw.pdf",
    section: "s. 3.A.1B; Table 7A (R1), 4 dwelling units per lot",
    retrieved: CHECKED,
  },
  waterlooAru: {
    title: "Build an ARU on the main floor or basement",
    publisher: "City of Waterloo",
    url: "https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/",
    section: "Fees and review time",
    retrieved: CHECKED,
  },
  waterlooBasementFinish: {
    title: "Interior renovations and basements",
    publisher: "City of Waterloo",
    url: "https://www.waterloo.ca/building-and-renovating/get-a-building-permit/find-project-checklists-and-requirements/interior-renovations-and-basements/",
    section: "Permit fees; review",
    retrieved: CHECKED,
  },
  waterlooGrant: {
    title: "Apply for the ARU Grant",
    publisher: "City of Waterloo",
    url: "https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/apply-for-the-aru-grant/",
    section: "Interior ARU stream",
    retrieved: CHECKED,
  },
  regionLoan: {
    title: "Funding for Secondary Suites (Ontario Renovates)",
    publisher: "Region of Waterloo",
    url: "https://www.regionofwaterloo.ca/programs-and-services/employment-and-financial-supports/financial-support-for-renters-and-homeowners/funding-for-secondary-suites/",
    retrieved: CHECKED,
  },
  regionFactSheet: {
    title: "Ontario Renovates Fact Sheet for Secondary Suites (Dec 2025)",
    publisher: "Region of Waterloo",
    url: "https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf",
    section: "Up to $25,000, forgiven over 15 years",
    retrieved: CHECKED,
  },
  mhrtc: {
    title: "Line 45355: Multigenerational home renovation tax credit",
    publisher: "Canada Revenue Agency",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc.html",
    retrieved: CHECKED,
  },
  budget2025: {
    title: "Budget 2025, Annex 3",
    publisher: "Government of Canada",
    url: "https://budget.canada.ca/2025/report-rapport/anx3-en.html",
    section: "Canada Secondary Suite Loan Program will not be implemented",
    retrieved: CHECKED,
  },
  dcAct: {
    title: "Development Charges Act, 1997",
    publisher: "Government of Ontario",
    url: "https://www.ontario.ca/laws/statute/97d27",
    section: "s. 2(3.2)",
    retrieved: CHECKED,
  },
  quarts: {
    title: "QuARTS Public Search Registry",
    publisher: "Ministry of Municipal Affairs and Housing",
    url: "https://www.search.quarts.mah.gov.on.ca/en",
    retrieved: CHECKED,
  },
  kitchenerAdu: {
    title: "Additional dwelling units",
    publisher: "City of Kitchener",
    url: "https://www.kitchener.ca/ADUs",
    retrieved: CHECKED,
  },
  cambridgeAru: {
    title: "Additional residential units",
    publisher: "City of Cambridge",
    url: "https://www.cambridge.ca/business-building-development/building-planning/additional-residential-units",
    retrieved: CHECKED,
  },
  costKw: {
    title: "Basement renovation cost guide, Kitchener-Waterloo 2026",
    publisher: "Caliber Contracting (contractor, non-government)",
    url: "https://calibercontracting.ca/basement-renovation-cost-guide-kitchener-waterloo",
    section: "Egress window",
    retrieved: CHECKED,
  },
  costToronto: {
    title: "Basement apartment legalization, Toronto",
    publisher: "RenoHouse (contractor, non-government)",
    url: "https://renohouse.ca/blog/basement-apartment-legalization-toronto",
    section: "Egress window",
    retrieved: CHECKED,
  },
  costHeating: {
    title: "Basement development cost, Canada",
    publisher: "HomeStars (price guide, non-government)",
    url: "https://homestars.com/home-constructions-renovations/price-guides/basement-development-cost",
    section: "Independent heating for a legal suite",
    retrieved: CHECKED,
  },
  pipeda: {
    title: "Personal Information Protection and Electronic Documents Act (PIPEDA)",
    publisher: "Government of Canada",
    url: "https://laws-lois.justice.gc.ca/eng/acts/P-8.6/",
    section: "Schedule 1; s. 8(3), 30-day response",
    retrieved: CHECKED,
  },
  pipedaPrinciples: {
    title: "PIPEDA fair information principles",
    publisher: "Office of the Privacy Commissioner of Canada",
    url: "https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/",
    retrieved: CHECKED,
  },
  opcConcern: {
    title: "Report a concern",
    publisher: "Office of the Privacy Commissioner of Canada",
    url: "https://www.priv.gc.ca/en/report-a-concern/",
    retrieved: CHECKED,
  },
} satisfies Record<string, Source>;

export type SourceId = keyof typeof SOURCES;
