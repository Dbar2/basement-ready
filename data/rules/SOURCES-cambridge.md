# Sources: Cambridge, ON rules pack

All sources were checked on **2026-10-28**. Public official sources only; nothing came from the Gablebird/divinedesigner repository or the `/Volumes/Crucial X9` drive.

Building Code rules (ceiling heights, egress windows, fire separation, alarms, exits, HVAC, sound, stairs, ESA, plumbing, room sizes), the Region of Waterloo loan and the federal programs are reused from the Waterloo pack with their sources; see [SOURCES.md](SOURCES.md) for those. This file lists what is new or different for Cambridge.

## Which zoning by-law applies

Two zoning by-laws are in force for different lands:

- **By-law 26-007** (Phase One residential zones), enacted 2026-02-03. City staff memos dated 2026-05-01 and 2026-09-04 say it "is now in force" following the appeal period. ARU rules: s. 4.19.
- **By-law 150-85 as amended by the ARU By-law 23-077** for deferred lands: core areas, the Preston and Hespeler Road secondary plan study areas, site-specific zones, Blue Heron Ridge, River Road, and non-residential zones. The City's zoning map labels these "Deferred Area Subject to By-Law 150-85".

The pack's rules follow 26-007 and note where 23-077 differs.

## Conflicts between sources

1. **Which by-law the City's ARU page cites.** The ARU page and Report 24-109-CD cite "ARU By-law 23-077"; the same page also says ARUs must meet "Section 4.19 of the City's Zoning By-law 26-007". Both are right for different lands (above). Differences: maximum street-to-entrance distance 30 m (26-007 s. 4.19(i)) vs 45 m (23-077 s. 3.1.1.11.9); floodplain wording "Floodway (F) Zone or any Floodplain Overlay Zone" vs "hazard lands"; detached-ARU separation, coverage and height.
2. **Outdated 150-85 PDF.** The zoning page links a "CONSOLIDATION: JANUARY 2012" copy of 150-85 that does not contain the 23-077 ARU rules. The pack cites 23-077 directly for deferred lands, and the 2012 consolidation only for s. 1.1 and s. 2.1.8 (Galt Special Policy Area), which were not checked for later amendments.
3. **Permit review time.** The City's Q2 2026 permit statistics describe "Housing and minor permits (Category 1 – 10-day mandated turnaround time)". The Building Code (Div. C Table 1.3.1.3) sets 10 days only for "a house where no dwelling unit is located above another dwelling unit"; a basement ARU falls in Item 2 (15 days). The pack uses 15 days for the second-unit route and 10 days for a basement finish.
4. **DCs on an ARU built with a new house.** Report 24-109-CD (p. 6) says no City or Regional DCs are paid on ARUs "except where the ARU is being created at the same time as the principle dwelling"; DC By-law 24-040 s. 3.4.2 exempts second and third units "in existing or new houses". Both agree for a basement ARU in an existing house.
5. **School board DCs.** The ARU page: school boards collect DCs "under certain circumstances"; Report 24-109-CD: "the School Boards apply development charges in all cases"; O. Reg. 20/98 s. 3 exempts up to 2 additional units in an existing single detached dwelling (1 in a semi or row) when their gross floor area is no more than the existing unit's. `dc_exemption_aru` marked `verified: false`.
6. **Floodplain overlays.** 26-007 s. 13.1.1 says "There are two Floodplain Overlay Zones" (F1, F2), but the maps and Report 25-034-PG also show F3. The s. 4.19(h) ARU ban covers "any Floodplain Overlay Zone".
7. **Region loan house-value cap** (same as Waterloo): $600,000 on the Region page vs $505,469 in the Dec 2025 fact sheet.

## Unverified or partly verified items

- **Permit fee for a new ARU.** Fees By-law 25-079 has no ARU or per-unit building permit line. The alterations / interior-finish rate ($0.50/sq ft, $143 minimum) plus the $25 zoning review is the likely line, but the City invoices after review. The $383 and $199 "per unit" figures in the by-law are for a Certificate of Compliance under minimum standards, not a building permit.
- **Water allocation** (`cambridge_water_allocation`, `verified: false`). By-law 26-063 (Water Allocation Policy ADM 06, passed 2026-07-21) applies in the Mannheim Water Service Area to development "where an extension, upgrade, and/or provision of new main line/water supply is required"; that a basement ARU on an existing service is outside it is a reading of the Scope, and the City may still ask for a water capacity form. Which parts of Cambridge are in the service area is shown only on the City map.
- **Parking total.** The 3-space total adds Table 5.8 row 12 (2 per house) and s. 4.19(f)(i) (1 per ARU); how a legal non-complying existing driveway is treated was not confirmed. No ARU parking waiver was found in 26-007; deferred core areas were not checked.
- **Table 7.2 special provision 5** (maximum four dwelling units on lots with an existing single or semi-detached dwelling) and how it combines with the 2-ARU cap.
- **Grant.** The enacted CIP by-law number (draft "24-XXX") and any funding balance after 2026-03-31 ($880,000 left then) were not found; no closure, waitlist or fully-subscribed notice exists as of 2026-10-28.
- **Region DC exemption** is stated by the City (ARU page, Report 24-109-CD) and by the Development Charges Act; the Region's own by-law text was not read. Only DC By-law 24-040 of the City's eight service by-laws was read.
- **No rental licence or ARU registration** is an absence finding (licensing page, Business Licensing By-law 142-16, council portal searches).
- **Heritage districts.** Whether a heritage permit is needed for a new entrance in a heritage district was not checked.
- **OLT appeals** against 26-007 were not checked on the Tribunal's site.
- **WRDSB / WCDSB EDC rates** listed on the City DC page were not used.
- **Council PDFs on eScribe** (`pub-cambridge.escribemeetings.com/filestream.ashx?...`) refuse plain HTTP clients; they were read in a browser.

## Sources

### City of Cambridge: zoning

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Zoning page | https://www.cambridge.ca/business-building-development/building-planning/zoning/ | Phase One in effect 2026-02-03; 150-85 for deferred lands | 2026-10-28 |
| Interactive zoning map | https://experience.arcgis.com/experience/c9f28e5db04e4ff487cd62229dff156b | Which by-law, zone and overlay apply | 2026-10-28 |
| Zoning By-law 26-007, certified as enacted | https://media-003-ca.cdn.govstack.com/cambridge-ca/media/jhijomn5/certified_26-007-zba.pdf | s. 1.2.2, 1.6, 4.19, 4.19.1, 5.3, Table 5.8, Table 7.2, Table 11.2, s. 13.1-13.2 | 2026-10-28 |
| Zoning By-law 150-85 (Consolidation: January 2012) | https://media-003-ca.cdn.govstack.com/cambridge-ca/media/er5l4qtu/zoningbylaw150-85.pdf | s. 1.1 "hazard lands"; s. 2.1.8.1-2.1.8.2 Galt Special Policy Area | 2026-10-28 |
| By-law 23-077, ARU amendment to 150-85 (2023-09-12) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=8407 | s. 3.1.1.11.4-3.1.1.11.9 (deferred lands) | 2026-10-28 |
| OPA 68 (By-law 23-078) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=8408 | Deleted ARU size-subordination policy; parking cap summary | 2026-10-28 |
| Report 25-034-PG, Comprehensive Zoning By-law Review Phase 1 (2026-02-03) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=19054 | Deferred lands list, HAF Initiative 4, F3 overlay | 2026-10-28 |
| IM26-008(PG), Planning Services Update Q1 2026 (2026-05-01) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=18708 | 26-007 in force; grant funding at Q1 2026 | 2026-10-28 |
| IM26-015(PG), Planning Services Update Q2 2026 (2026-09-04) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=22463 | Same; minor variance A30/26 (entrance distance) | 2026-10-28 |

### City of Cambridge: permits, grant, charges and licensing

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Additional Residential Units page | https://www.cambridge.ca/business-building-development/building-planning/additional-residential-units/ | Up to 3 units, permit and occupancy approval, grant, DCs, contacts | 2026-10-28 |
| Building Permits page | https://www.cambridge.ca/business-building-development/building-planning/building-permits/ | Portal, application form, who may draw, drawing list, inspections | 2026-10-28 |
| Building Inspections page | https://www.cambridge.ca/business-building-development/building-planning/building-inspections/ | 24-hour notice | 2026-10-28 |
| Fast-track approvals (AI PreCheck) | https://www.cambridge.ca/business-building-development/building-planning/fast-track-approvals/ | Zoning pre-check tool | 2026-10-28 |
| Housing Design Catalogue | https://www.cambridge.ca/business-building-development/building-planning/housing-design-catalogue/ | Pre-reviewed CMHC designs, not approvals | 2026-10-28 |
| Municipal Fees and Charges By-law 25-079 (2026 rates) | https://www.cambridge.ca/media/nridbsyx/municipal-fees-and-charges-by-law-25-079.pdf | Schedule A pp. 11, 18-22: alterations $0.50/sq ft, $143 minimum, $25 zoning review, re-inspection, special permit fee | 2026-10-28 |
| IM26-013(PG), Building Permit Statistics 2026 Q2 (2026-08-07) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=21675 | "10-day mandated turnaround" wording (conflict 3) | 2026-10-28 |
| ARU Community Improvement Plan (Report 24-109-CD Appendix A, Sept 2024) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=11867 | s. 6.1-6.3, 8.2 grant terms | 2026-10-28 |
| Report 24-109-CD, ARU CIP (Council 2024-10-08) | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=11866 | Average ARU cost $47,232 (p. 4); DCs (p. 6) | 2026-10-28 |
| News: Turn extra space into new opportunities with an ARU (2026-08-21) | https://www.cambridge.ca/news/posts/turn-extra-space-into-new-opportunities-with-an-aru/ | Grant still promoted | 2026-10-28 |
| Development Charges page | https://www.cambridge.ca/business-building-development/building-planning/development-charges/ | DC By-laws 24-040 to 24-047 | 2026-10-28 |
| DC By-law 24-040 (Fire) | https://media-003-ca.cdn.govstack.com/cambridge-ca/media/sknldw5t/24-040.pdf | s. 3.4.2.1-3.4.2.3 | 2026-10-28 |
| Licensing page | https://www.cambridge.ca/business-building-development/licensing/ | No residential rental licence | 2026-10-28 |
| Business Licensing By-law 142-16 | https://www.cambridge.ca/media/kczbh5j4/business-licensing-142-16.pdf | No lodging or rental licence | 2026-10-28 |
| Property Standards By-law 26-021 (2026-02-24) | https://www.cambridge.ca/media/cwuj1dwg/property-standards-by-law-26-021.pdf | Rental unit standards | 2026-10-28 |
| Water Supply Allocation page | https://www.cambridge.ca/business-building-development/building-planning/water-supply-allocation/ | Policy adopted 2026-07-21; no permit without letter where it applies; quarterly release | 2026-10-28 |
| By-law 26-063, Water Allocation Policy ADM 06 (revised copy 2026-08-28, .docx) | https://media-003-ca.cdn.govstack.com/cambridge-ca/media/y1ohlfrf/by-law-to-adopt-water-allocation-policy-revised-fs-ro-28aug26docx.docx | Scope, exemptions, "Material" definition, priorities | 2026-10-28 |
| Mannheim Water Service Area map | https://experience.arcgis.com/experience/cd6f99a61ee348be99246582f39f952e | Which lots the policy covers | 2026-10-28 |
| Water Supply Capacity Application | https://form.cambridge.ca/Water-Supply-Capacity-Application | Form link | 2026-10-28 |
| City Application Portal | https://permits.cambridge.ca/ | Permit and grant applications | 2026-10-28 |

### Region of Waterloo, Province and GRCA (new for this pack)

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Ontario Renovates Fact Sheet for Secondary Suites (Dec 2025) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf | Cambridge is in the "Remainder of Waterloo Region" income band | 2026-10-28 |
| Mannheim Service Area: Information on development (updated 2026-06-11) | https://www.regionofwaterloo.ca/programs-and-services/water-and-wastewater/mannheim-service-area-water-capacity-information-hub/information-on-development/ | Area supplies "parts of Cambridge" | 2026-10-28 |
| Update on development that can proceed (2026-05-11) | https://www.regionofwaterloo.ca/news-public-notices-and-council-info/posts/update-on-development-that-can-proceed/ | No-increased-demand conditions | 2026-10-28 |
| 2024 Building Code Compendium, Division C Part 1 | https://www.ontario.ca/document/2024-building-code-compendium/part-1-general-0 | 1.3.1.3 and Table 1.3.1.3 review periods | 2026-10-28 |
| GRCA Policies for the Administration of O. Reg. 41/24 (effective 2025-09-26) | https://www.grandriver.ca/media/savhp2yv/final-approved-version_permitting-policy-document.pdf | s. 8.1.13, 8.1.31; Cambridge (Galt) Special Policy Area | 2026-10-28 |

### Cost estimates (City figures; the contractor cost table is reused from the Waterloo pack)

| Source | URL | Used for | Page date | Retrieved |
|---|---|---|---|---|
| Municipal Fees and Charges By-law 25-079 | https://www.cambridge.ca/media/nridbsyx/municipal-fees-and-charges-by-law-25-079.pdf | $0.50/sq ft, $143 minimum, $25 zoning review, $100 re-inspection | 2025-12-15 (2026 rates) | 2026-10-28 |
| Report 24-109-CD | https://pub-cambridge.escribemeetings.com/filestream.ashx?DocumentId=11866 | Average ARU cost $47,232 | 2024-10-08 | 2026-10-28 |

The Caliber Contracting cost guide reused from the Waterloo pack covers "Kitchener-Waterloo & Cambridge"; it gives no Cambridge-only figures. The City of Waterloo's $100/sq ft rule of thumb is kept and relabelled as a City of Waterloo figure, because Cambridge publishes no per-sq-ft figure.

## Money: what the app decides, and from what (added 2026-10-29)

`server/eligibility.ts` reads each open program's `conditions` and gives one of three answers: yes, no, or one plain question away. Nothing is a model call. The facts it relies on, each read on the source on 2026-10-29:

- **Region of Waterloo forgivable loan.** The owner must live in the house ("sole and principal residence"), may not own any other property ("including a cottage or have partial ownership of another property"), and the home must be a single family home valued at or below the cap. The tenant's income is checked by the Region before a lease is signed, and a signed lease is required (fact sheet Dec 2025 pp. 1, 4, 7; application form v11 s. 10). Rent at or under the cap for 15 years. Work must not start before approval ("Any modifications performed prior to loan approval" are ineligible, fact sheet p. 3).
  - **How the app decides the house-value conflict:** it asks against the stricter figure, $505,469, and the result names the web page's $600,000 so anyone between the two knows to ask the Region.
  - **Family living free:** every occupant is a tenant who signs a lease at or under the cap after an income check, so a relative paying no rent is a "no". This is the app's reading of the fact sheet and form; neither says "rent-free family" in those words.
  - **Order of steps** (fact sheet p. 7): apply with zoning confirmation; conditional approval; building permit; 3 contractor quotes (WSIB and liability insurance); loan agreement and security; start work; invoices and occupancy permit; Region inspects and pays; tenant's income verified and lease sent. The form v11 (s. 8.5) says work starts within 90 days of final approval; the fact sheet (p. 7) says 120 days. Recorded as a conflict in `conditions.workStartWithinDaysOfApproval`.
  - **Documents to attach** (fact sheet p. 2; form v11): written zoning confirmation from the City, photo ID, status in Canada and proof of age for each owner, latest tax bill or MPAC notice, confirmation that mortgage, property tax and insurance are up to date, mortgage balance and the lender's OK for a second mortgage if the project exceeds $25,000.
- **CMHC refinance.** "Borrowers must own the home and they, or a close relative, must live in it"; "Insured financing must be approved by CMHC prior to the start of construction or at least at an early stage"; up to 4 units including existing ones. Applied for through a lender.
- **Multigenerational home renovation tax credit.** Needs a qualifying individual (65+, or 18–64 with the disability tax credit) living with a qualifying relation, so the app asks "Will someone 65 or older, or with a disability, live in the house?" and says no for a rental to an unrelated tenant. Expenses "that can reasonably be considered to have been reimbursed" are excluded (CRA expenses page), so the app counts only costs no grant or loan paid for. Treating the forgivable loan as a reimbursement is the app's cautious reading.
- **Money never adds up to more than the work.** Each cash program is capped by its own rule (the City of Waterloo grant at 50% of costs), and together they are capped at the result's own high cost estimate: grants first, then the loan, then the tax credit. This is the app's arithmetic, not a program rule.
- **Rent and income caps** are read for a one-bedroom suite.

## Unverified: money and how to apply (added 2026-10-29)

- **Cost of permit drawings in Waterloo Region.** No public body publishes one: the City of Waterloo ARU Guide 2025 (blank "Design Consulting Fees" line), the City of Kitchener ADU guide 2026, the City of Cambridge ARU page and Report 24-109-CD, Oxford County's guide, and local contractor cost guides were checked, along with local news. The app keeps the Toronto figure ($2,000–$5,000, HomeStars, updated 2026-08-21) and says on screen that it is a Toronto figure. HomeStars' Canada-wide guide gives $1,500–$4,000 for engineering assessments and stamped drawings when structure changes, which is a different service, so it is not used.
- **QuARTS filters.** `*House*` also matches "HVAC-House" and "Plumbing-House", and the location text can match a street name in another town (e.g. "Waterloo St., Port Elgin"). The app tells homeowners to check for "House" in the designer's classes. Counts on 2026-10-29: Waterloo 16 independent designers, 13 firms; Kitchener 36 and 25; Cambridge 21 and 18.
- **ESA and TSSA.** ESA's locator has no URL filters; the TSSA city filter can also match street names elsewhere. Both are the regulators' own public lists; the app names no business.
- **Cambridge permit fee for a second unit.** The by-law has no ARU line; the app estimates with the interior-finish rate ($0.50/sq ft, $143 minimum, plus $25 zoning review) and labels it an estimate. The City invoices the exact fee after review.
- **Cambridge ARU Financial Assistance program document** is only available by email request and was not read.

## Sources: how to apply (added 2026-10-29)

### Region, federal, registries and trades

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| QuARTS Public Search Registry, filtered | https://www.search.quarts.mah.gov.on.ca/en?mf=3%3D4%264%3D*House*%266%3D*Cambridge* | Deep link to independent designers (`3=4`) or design firms (`3=3`) registered for houses near the city. The page reads its filter from the `mf` query parameter; text needs `*` on both sides; Principal Authority returns nothing for designers, so location (key 6) is used | 2026-10-29 |
| ESA Contractor Locator Tool | https://licensing.esasafe.com/contractor-locator-tool/ | Check an electrician holds an ESA licence (no deep-link filters) | 2026-10-29 |
| ESA: Finding the right contractor | https://esasafe.com/compliance/finding-the-right-contractor/ | The ESA permit step | 2026-10-29 |
| TSSA Authorized Heating Fuel Contractors | https://www.tssa.org/fuels-contractor?address_combine=Cambridge&field_fuel_type_natural_gas_value=Yes | Gas contractors registered with TSSA, filtered by city (a GET form); "Find or verify companies with a valid TSSA Registration" | 2026-10-29 |
| Region: Ontario Renovates application form v11 (2026-05-22) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/55bf0zge/docs_admin-2295447-v11-ontario_renovates_secondary_suite_application-aoda.pdf | Where to apply, documents to attach, 3 quotes after conditional approval, 90-day start, tenant income check | 2026-10-29 |
| Region: Ontario Renovates fact sheet (Dec 2025) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf | Eligibility, steps and payout (pp. 1-7); contractor WSIB and liability insurance | 2026-10-29 |
| Region: Funding for Secondary Suites | https://www.regionofwaterloo.ca/programs-and-services/employment-and-financial-supports/financial-support-for-renters-and-homeowners/funding-for-secondary-suites/ | Submit by email, fax, mail or in person; "annual funding is limited" | 2026-10-29 |
| CMHC Refinance for Building Secondary Suites | https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/refinance | Owner or close relative lives there; approval before construction; through a lender | 2026-10-29 |
| MHRTC: Expenses you can claim (CRA) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc/expenses-claim-mhrtc.html | Reimbursed expenses excluded; keep receipts | 2026-10-29 |
| 2024 Building Code Compendium, Division C Part 3 | https://www.ontario.ca/document/2024-building-code-compendium/part-3-qualifications | Div. C 3.2.5.1.(3)(b): an owner designing their own house needs no registration | 2026-10-28 |
| HomeStars: Basement renovation cost Toronto (updated 2026-08-21) | https://homestars.com/home-constructions-renovations/price-guides/basement-renovation-cost-toronto | Designer drawings $2,000–$5,000: "Architectural or designer drawings, which are required for permit applications" | 2026-10-29 |

Every URL above, and every link in the packs' `apply`, `process[].where`, `pros.selfDraw` and `pros.trades`, returned HTTP 200 on 2026-10-29 (the CRA page answered a browser fetch; plain `curl` timed out).

### City of Cambridge

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| City of Cambridge: Building Permits | https://www.cambridge.ca/business-building-development/building-planning/building-permits/ | Drawings "prepared by either the owner" or a qualified designer; the on-page drawing requirements used as the checklist | 2026-10-29 |
| City of Cambridge: City Application Portal | https://permits.cambridge.ca/ | Apply for the permit; apply for the ARU grant after occupancy (Financial Incentives, Additional Residential Unit Community Improvement Plan) with a parcel register and invoices | 2026-10-29 |
| City of Cambridge: Building Inspections | https://www.cambridge.ca/business-building-development/building-planning/building-inspections/ | Inspection step link | 2026-10-29 |
| City of Cambridge: Zoning map | https://experience.arcgis.com/experience/c9f28e5db04e4ff487cd62229dff156b | Zoning step link | 2026-10-29 |
| City of Cambridge: Additional Residential Units | https://www.cambridge.ca/business-building-development/building-planning/additional-residential-units/ | The grant covers "Professionally prepared permit drawings" | 2026-10-29 |
