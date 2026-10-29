# Sources: Waterloo, ON rules pack

All sources were checked on **2026-10-28**. Public sources only; nothing came from the Gablebird/divinedesigner repository.

## Conflicts between sources

1. **Region Ontario Renovates house-value cap.** The Region's web page says an assessed value of at most $600,000 (MPAC); the Region's fact sheet dated Dec 2025 says the "Province's Maximum House value of $505,469". Both are recorded; grant marked `verified: false`.
2. **Region Ontario Renovates start deadline.** The fact sheet says work must start within 90 days of approval (p. 4) and within 120 days (p. 7). The fact sheet also still prints "deadline … December 1, 2023", while the web page says applications are received on an ongoing basis.
3. **Region rent-cap year.** The fact sheet labels the rent caps "For 2025"; the application form (v11, 2026-05-22) labels the same figures "For 2024".
4. **Who may prepare ARU drawings.** The City's ARU basement page lists "Homeowner – for their own house (up to 2 units)" or an architect, engineer or BCIN designer. The City's ARU Guide 2025 (p. 20) says the plans must be by an architect, professional engineer or BCIN designer. The Building Code (Div. C 3.2.5.1.(3)(b)) exempts an owner designing their own house, which supports the web page. Process step marked `verified: false`.
5. **Education development charges.** The City's ARU Guide (p. 18) says education DCs still apply to ARUs; O. Reg. 20/98, s. 3 exempts up to 2 additional units in an existing single detached dwelling (1 in a semi or row house) when their gross floor area is no more than the existing unit's. `dc_exemption_aru` marked `verified: false`.
6. **Old provincial guide versus the 2024 Code.** Ontario's "Add a second unit to your house" (updated 2023-01-30) cites 2012 Code compliance alternatives (C.A. 102, 107, 136, 147, 152, 153, 194, 195, 197) and describes 30-minute or 15-minute separations. The 2024 Code uses different numbers (e.g. C105, C139, C150, C156, C157, C201) and adds the 15.9 mm Type X smoke-tight barrier option (9.10.9.16.(4)). The pack uses the 2024 compendium.
7. **City grant maximum.** The City's "Learn about ARUs" page says "up to $30,000"; that is the Detached stream. A basement unit is the Interior stream, maximum $20,000 (grant page, staff report).
8. **Permit review time.** Ontario's guide says applicants hear back "within 10 business days"; the City lists 15 business days for secondary dwelling units in houses (10 for a basement finish). The pack uses the City figures.
9. **Contractor cost ranges** disagree by two to three times for the same item: egress window $3,000–$6,000 (KW) vs $7,500–$17,000 (Toronto); sound insulation $3–$5/sq ft vs $15–$25/sq ft; kitchenette $7,000–$15,000 vs $20,000–$35,000; full suite $50,000–$80,000 up to $100,000–$150,000+.

## Unverified or partly verified items

- **October 1, 2026 amendment document.** O. Reg. 325/26 changed the Ontario Amendment Document date to October 1, 2026. The compendium HTML used for section numbers says it reflects amendments only up to O. Reg. 242/26 (July 22, 2026). Any changes in the October document were not reviewed.
- **ESA permit for the suite** (`electrical_esa_permit`, `verified: false`). The "separate electrical permit" statement comes from Ontario's 2023 guide (written for the 2012 Code). ESA's own rules were not read on a listed source; the ESA fee figures come from esasafe.com (Ontario's delegated electrical regulator, not on the preferred source list).
- **MHRTC 2026 rate.** The CRA page shows 14.5% for 2025 (max $7,250). The 14% rate for 2026 (max $7,000) is inferred from Finance Canada's statement on the lowest tax rate; the CRA page did not yet show 2026.
- **Funding left.** Neither the City grant nor the Region loan publishes a remaining balance. Both are listed `open` because their pages say they accept applications while funds last.
- **C140 (existing bedroom egress acceptable "where there is direct access to the exterior")**: the Code does not say whose access (bedroom, floor level or suite); the pack tells the agent to ask the City rather than auto-pass.
- **C112 (stairs 700 mm / 1,800 mm)** covers replacing or extending stairs; whether an existing stair left as is gets accepted is the City's call.
- **Visual (strobe) alarm component** required by the 2024 Code for smoke and CO alarms: Part 11 has no specific alternative; how the City applies it to conversions was not confirmed.
- **Parking.** Only the R1 zone table (Table 7A) and Schedule A1 mention were checked; other zones and the parking overlay may differ.
- **Floodplain reading.** That a basement unit below the regulatory flood elevation fails s. 3.F.1.2 is an interpretation.
- **Exit rules for houses under 5 years old** are not mapped; the pack covers the Part 11 (C139) options.
- **Three units in the house.** The Code's secondary-suite rules cover two-unit houses only; the three-unit case is not covered.
- **Costs.** Most cost figures come from non-government contractor and cost-guide pages (flagged `sourceType: non-government`), because the listed government sources do not publish construction prices beyond the City's "$100 per square foot" rule of thumb and fees. No standalone Ontario price was found for interconnected alarms, a duct smoke detector, a Type X ceiling per sq ft, ceiling-height fixes or stair fixes.
- **CMHC refinance page** shows no publish date.

## Sources

### Building code (Government of Ontario)

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| O. Reg. 163/24 Building Code (e-Laws; consolidation from 2026-10-02; also versions v1, v6) | https://www.ontario.ca/laws/regulation/240163 | Code in force, adoption of NBC 2020 + Ontario Amendments, transition (s. 2) | 2026-10-28 |
| O. Reg. 325/26 | https://www.ontario.ca/laws/regulation/r26325 | Amendment document date October 1, 2026 | 2026-10-28 |
| O. Reg. 247/25 | https://www.ontario.ca/laws/regulation/r25247 | Re-made s. 1, in force 2025-11-03 | 2026-10-28 |
| O. Reg. 5/25, 110/26, 119/26, 242/26 | https://www.ontario.ca/laws/regulation/r25005 (and r26110, r26119, r26242) | Amendment history | 2026-10-28 |
| 2024 Building Code Compendium (MMAH) | https://www.ontario.ca/document/2024-building-code-compendium | Official free text; current to O. Reg. 242/26 | 2026-10-28 |
| Compendium: Revisions | https://www.ontario.ca/document/2024-building-code-compendium/volume-1-revisions | Which amendments the HTML reflects | 2026-10-28 |
| Compendium: Division A Part 1 | https://www.ontario.ca/document/2024-building-code-compendium/part-1-compliance | 1.3.3.3B (Part 11 for buildings 5+ years), 1.3.3.3C, 1.4.1.2 definitions (secondary suite, dwelling unit) | 2026-10-28 |
| Compendium: Division B Part 9 | https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings | 9.5.1, 9.5.3.1 + Table, 9.5.3A–F, 9.5.5.1, 9.8.2.1–2, 9.9.7.2, 9.9.9, 9.9.10.1, 9.10.8.3, 9.10.8.10, 9.10.9.2, 9.10.9.16, 9.10.10.3–4, 9.10.13.13, 9.10.19, 9.11.1.1, 9.31.4, 9.32.3.9–9C, 9.33.1.1, 9.34.2.3 | 2026-10-28 |
| Compendium: Division B Part 11 | https://www.ontario.ca/document/2024-building-code-compendium/part-11-renovation | 11.5.1.1; Table 11.5.1.1.-C C97, C105, C112, C139, C140, C150, C156, C157, C160, C172, C179, C181, C200, C201 | 2026-10-28 |
| Compendium: Division B Part 6 | https://www.ontario.ca/document/2024-building-code-compendium/part-6-heating-ventilating-and-air-conditioning | 6.3.2.7.(1) no air circulated between suites | 2026-10-28 |
| Compendium: Division B Part 7 | https://www.ontario.ca/document/2024-building-code-compendium/part-7-plumbing | 7.6.1.3.(5) shut-off per dwelling unit; 7.4.6.4 backwater valves | 2026-10-28 |
| Compendium: Division C Part 3 | https://www.ontario.ca/document/2024-building-code-compendium/part-3-qualifications | 3.2.4.1, 3.2.5.1.(3)(b) designer registration and owner exemption | 2026-10-28 |
| Compendium: Appendix A | https://www.ontario.ca/document/2024-building-code-compendium/appendix-a-explanatory-material | Notes A-1.4.1.2.(1), A-9.9.10.1.(1)–(3), A-9.10.8.3.(2), A-9.10.19.5.(2), A-11.5.1 | 2026-10-28 |
| Building Code Act, 1992 | https://www.ontario.ca/laws/statute/92b23 | s. 8(1) permit required | 2026-10-28 |
| O. Reg. 164/99 Electrical Safety Code | https://www.ontario.ca/laws/regulation/990164 | ss. 1–2 electrical work must comply | 2026-10-28 |
| Add a second unit to your house (updated 2023-01-30) | https://www.ontario.ca/page/add-second-unit-your-house | ESA permit statement, duct smoke detector (UL 268A), cross-check of older Code numbers | 2026-10-28 |

### Planning and charges (Government of Ontario)

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Planning Act, R.S.O. 1990, c. P.13 (consolidated 2026-07-01) | https://www.ontario.ca/laws/statute/90p13 | s. 1(1) "parcel of urban residential land"; s. 35.1(1)–(1.3) units, parking cap, no minimum size | 2026-10-28 |
| O. Reg. 299/19 Additional Residential Units | https://www.ontario.ca/laws/regulation/190299 | s. 1(2), s. 2 (parking, tandem, any occupant, no owner requirement), s. 3–5 | 2026-10-28 |
| O. Reg. 462/24 Additional Residential Units (amending) | https://www.ontario.ca/laws/regulation/r24462 | Lot coverage, FSI, separation changes (context) | 2026-10-28 |
| Development Charges Act, 1997 | https://www.ontario.ca/laws/statute/97d27 | s. 2(3.2) DC exemption for 2nd/3rd unit in existing house | 2026-10-28 |
| O. Reg. 20/98 Education Development Charges – General | https://www.ontario.ca/laws/regulation/980020 | s. 3 additional dwelling unit exemption (conflict 5) | 2026-10-28 |

### City of Waterloo

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Learn about Additional Residential Units (ARUs) | https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/learn-about-additional-residential-units-arus/ | Up to 4 units; permits and rental licence; links | 2026-10-28 |
| Build an ARU on the main floor or basement | https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/ | Who may draw, drawing list, forms, fees ($392/unit + $0.62/sq ft), 15-day review, inspections | 2026-10-28 |
| Apply for the ARU Grant | https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/apply-for-the-aru-grant/ | Grant streams, conditions, 2026 rent and income limits, status | 2026-10-28 |
| Staff report IPPW2025-035, ARU Grant Program (2025-06-23), linked from the grant page | https://hdp-ca-prod-app-wr-engage-files.s3.ca-central-1.amazonaws.com/1717/5249/9557/2025_06_23_-_IPPW2025-035_-_HAF_Initiative_6_-_ARU_Grant_Program.pdf | Program procedure: family members as tenants, eligibility, stacking with Region | 2026-10-28 |
| News: City of Waterloo now offering grants for ARUs (2025-11-13) | https://www.waterloo.ca/news/posts/city-of-waterloo-now-offering-grants-for-additional-residential-units/ | Target of 25 ARUs, waitlist once full | 2026-10-28 |
| Additional Residential Units Guide 2025 (PDF) | https://www.waterloo.ca/media/ghehnugv/additional-residential-units-guide.pdf | Zoning summary (p. 13), budget and $100/sq ft (p. 17), DCs (p. 18), permit and letter of compliance (p. 20), inspections (p. 23), rental licence and Region loan (p. 24) | 2026-10-28 |
| Zoning By-law and map page | https://www.waterloo.ca/planning-and-development/check-zoning-and-land-use-rules/zoning-bylaw-and-map/ | Link to consolidated by-law and schedules | 2026-10-28 |
| Zoning By-law 2018-050, consolidated 23 March 2026 (PDF) | https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/ybpnbhdm/zoning-bylaw.pdf | s. 3.A.1B (ARUs), Detached Building definition, Table 7A (R1) units and parking | 2026-10-28 |
| Check building permit timelines and fees | https://www.waterloo.ca/building-and-renovating/get-a-building-permit/check-building-permit-timelines-and-fees/ | 15 business days for secondary units; fee table | 2026-10-28 |
| Interior renovations and basements | https://www.waterloo.ca/building-and-renovating/get-a-building-permit/find-project-checklists-and-requirements/interior-renovations-and-basements/ | Basement-finish route: $351, 10 business days | 2026-10-28 |
| Get a long-term rental licence | https://www.waterloo.ca/building-and-renovating/residential-rental-licences/get-a-long-term-rental-licence/ | Licence classes, July 2026 requirements, fees | 2026-10-28 |

### Region of Waterloo

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Funding for Secondary Suites | https://www.regionofwaterloo.ca/programs-and-services/employment-and-financial-supports/financial-support-for-renters-and-homeowners/funding-for-secondary-suites/ | Eligibility, $600,000 cap, ongoing intake, OPHI funding | 2026-10-28 |
| Ontario Renovates Fact Sheet for Secondary Suites (Dec 2025) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf | $25,000, 15 years, owner-occupied, $505,469 cap, rent and income limits, default rules | 2026-10-28 |
| Ontario Renovates Secondary Suite Application (v11, 2026-05-22) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/55bf0zge/docs_admin-2295447-v11-ontario_renovates_secondary_suite_application-aoda.pdf | Rent caps, tenant income limits, house type | 2026-10-28 |

### Government of Canada, CRA and CMHC

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Line 45355 – Multigenerational home renovation tax credit (page date 2026-01-20) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc.html | 14.5%, $50,000, $7,250 (2025), refundable | 2026-10-28 |
| MHRTC – Who can claim | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc/who-claim-mhrt.html | Qualifying individual and relation, unit requirements, one claim per lifetime | 2026-10-28 |
| MHRTC – Expenses you can claim | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc/expenses-claim-mhrtc.html | Eligible and ineligible expenses | 2026-10-28 |
| Delivering a middle-class tax cut (Finance Canada, 2025-05-27) | https://www.canada.ca/en/department-finance/news/2025/05/delivering-a-middle-class-tax-cut.html | Lowest rate 14.5% (2025), 14% (2026+) | 2026-10-28 |
| Budget 2025, Annex 3 (modified 2025-11-04) | https://budget.canada.ca/2025/report-rapport/anx3-en.html | Canada Secondary Suite Loan Program cancelled ("will not be implemented") | 2026-10-28 |
| 2024 Fall Economic Statement: secondary suites (2024-12-10) | https://www.canada.ca/en/department-finance/news/2024/12/2024-fall-economic-statement-making-it-easier-for-homeowners-to-build-secondary-suites.html | Loan terms as announced ($80,000, 2%, 15 years); refinance from 2025-01-15 | 2026-10-28 |
| CMHC Refinance for Building Secondary Suites | https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/refinance | Product terms (90% LTV, < $2M, 30 years, up to 4 units, no equity take-out) | 2026-10-28 |

### Finding designers (BCIN)

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| QuARTS Public Search Registry | https://www.search.quarts.mah.gov.on.ca/en | Registry name, search filters (BCIN, name, registration type, class, principal authority, location; list/map) | 2026-10-28 |
| Become a registered building practitioner | https://www.ontario.ca/page/become-registered-building-practitioner | Confirms QuARTS lists all registered practitioners | 2026-10-28 |
| Copyright information (King's Printer for Ontario) | https://www.ontario.ca/page/copyright-information-c-queens-printer-ontario | Reuse terms: non-commercial with credit; commercial needs a licence | 2026-10-28 |
| BCIN files dataset (Ontario Data Catalogue) | https://data.ontario.ca/dataset/building-code-identification-number-bcin-files | Bulk data not available (privacy) | 2026-10-28 |

### Cost estimates (labelled estimates; mostly non-government)

| Source | URL | Used for | Page date | Retrieved |
|---|---|---|---|---|
| ESA 2026 Residential Fees Quick Reference Guide (regulator) | https://esasafe.com/assets/files/esasafe/pdf/Fees/2026-Residential-Fees-Reference-Guide.pdf | ESA notification fee | 2026-04-01 | 2026-10-28 |
| HomeStars: Basement egress window cost (Canada) | https://homestars.com/windows-doors/price-guides/basement-egress-window-cost | Egress window | 2026-08-21 | 2026-10-28 |
| HomeStars: Basement renovation cost Toronto | https://homestars.com/home-constructions-renovations/price-guides/basement-renovation-cost-toronto | Kitchen, bathroom rough-in, sound, drawings, full suite | 2026-08-21 | 2026-10-28 |
| HomeStars: Basement development cost Canada | https://homestars.com/home-constructions-renovations/price-guides/basement-development-cost | HVAC, mini-split, electrical | 2026-08-21 | 2026-10-28 |
| Caliber Contracting: Basement cost guide Kitchener-Waterloo 2026 | https://calibercontracting.ca/basement-renovation-cost-guide-kitchener-waterloo | Egress window, bathroom, full suite (local) | 2026-04 | 2026-10-28 |
| RenoHouse: Basement apartment legalization Toronto | https://renohouse.ca/blog/basement-apartment-legalization-toronto | Side entry, firestop/dampers, egress (conflict) | 2026-05-05 | 2026-10-28 |
| RenoHouse: Cost to make a basement legal in Toronto | https://renohouse.ca/blog/basement-apartment-conversion-toronto-cost | Fire separation | 2026-03-06 (upd. 2026-06-26) | 2026-10-28 |
| RenoHouse: Drywall replacement costs Toronto | https://renohouse.ca/blog/drywall-guide-toronto | Ceiling drywall per sq ft, Type X upgrade | 2026-03-06 (upd. 2026-06-09) | 2026-10-28 |
| RenoHouse: Soundproofing cost Toronto 2026 | https://renohouse.ca/blog/soundproofing-cost-toronto-comparison | Sound insulation | 2026-05-05 | 2026-10-28 |
| RenoQuotes: Convert your basement into an apartment (Toronto) | https://www.renoquotes.com/en/blog/convert-your-basement-into-an-apartment-a-guide-for-toronto-homeowners | Separate entrance, kitchenette | 2025-07-24 | 2026-10-28 |
| RenoAssistance: Legal basement apartment | https://www.renoassistance.ca/en/basement/legal-basement-apartment/ | Full suite "starts at $85,000 + tx" | 2024-09-12 | 2026-10-28 |

HomeStars pages were read through the `r.homestars.com` mirror of the same paths because `www.homestars.com` blocked automated fetching.

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

## Sources: how to apply (added 2026-10-29)

### Region, federal, registries and trades

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| QuARTS Public Search Registry, filtered | https://www.search.quarts.mah.gov.on.ca/en?mf=3%3D4%264%3D*House*%266%3D*Waterloo* | Deep link to independent designers (`3=4`) or design firms (`3=3`) registered for houses near the city. The page reads its filter from the `mf` query parameter; text needs `*` on both sides; Principal Authority returns nothing for designers, so location (key 6) is used | 2026-10-29 |
| ESA Contractor Locator Tool | https://licensing.esasafe.com/contractor-locator-tool/ | Check an electrician holds an ESA licence (no deep-link filters) | 2026-10-29 |
| ESA: Finding the right contractor | https://esasafe.com/compliance/finding-the-right-contractor/ | The ESA permit step | 2026-10-29 |
| TSSA Authorized Heating Fuel Contractors | https://www.tssa.org/fuels-contractor?address_combine=Waterloo&field_fuel_type_natural_gas_value=Yes | Gas contractors registered with TSSA, filtered by city (a GET form); "Find or verify companies with a valid TSSA Registration" | 2026-10-29 |
| Region: Ontario Renovates application form v11 (2026-05-22) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/55bf0zge/docs_admin-2295447-v11-ontario_renovates_secondary_suite_application-aoda.pdf | Where to apply, documents to attach, 3 quotes after conditional approval, 90-day start, tenant income check | 2026-10-29 |
| Region: Ontario Renovates fact sheet (Dec 2025) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf | Eligibility, steps and payout (pp. 1-7); contractor WSIB and liability insurance | 2026-10-29 |
| Region: Funding for Secondary Suites | https://www.regionofwaterloo.ca/programs-and-services/employment-and-financial-supports/financial-support-for-renters-and-homeowners/funding-for-secondary-suites/ | Submit by email, fax, mail or in person; "annual funding is limited" | 2026-10-29 |
| CMHC Refinance for Building Secondary Suites | https://www.cmhc-schl.gc.ca/professionals/project-funding-and-mortgage-financing/mortgage-loan-insurance/mortgage-loan-insurance-homeownership-programs/refinance | Owner or close relative lives there; approval before construction; through a lender | 2026-10-29 |
| MHRTC: Expenses you can claim (CRA) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-45355-mhrtc/expenses-claim-mhrtc.html | Reimbursed expenses excluded; keep receipts | 2026-10-29 |
| 2024 Building Code Compendium, Division C Part 3 | https://www.ontario.ca/document/2024-building-code-compendium/part-3-qualifications | Div. C 3.2.5.1.(3)(b): an owner designing their own house needs no registration | 2026-10-28 |
| HomeStars: Basement renovation cost Toronto (updated 2026-08-21) | https://homestars.com/home-constructions-renovations/price-guides/basement-renovation-cost-toronto | Designer drawings $2,000–$5,000: "Architectural or designer drawings, which are required for permit applications" | 2026-10-29 |

Every URL above, and every link in the packs' `apply`, `process[].where`, `pros.selfDraw` and `pros.trades`, returned HTTP 200 on 2026-10-29 (the CRA page answered a browser fetch; plain `curl` timed out).

### City of Waterloo

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| City of Waterloo: Apply for the ARU Grant | https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/apply-for-the-aru-grant/ | Apply before construction; 120 days to a permit; finish and occupy within a year; paid only after the work is finished, on the registered grant agreement, occupancy permit, lease, the tenant's Notice of Assessment, home insurance and paid invoices | 2026-10-29 |
| City of Waterloo: ARU grant application form | https://forms.waterloo.ca/Grants/Apply-for-an-additional-residential-unit-grant | What the form asks (legal description, bedrooms, project, contractor, each owner's signature; optional plan, drawings, contract) | 2026-10-29 |
| City of Waterloo: Owner/Designer Declaration (PDF) | https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/t4uazxbv/owner-declaration-form.pdf | Permit form; cites the owner exemption, Div. C 3.2.5.1.(3)(b) | 2026-10-29 |
| City of Waterloo: Schedule 1 Designer Information (PDF) | https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/uliohsmv/schedule-1-designer-information.pdf | Permit form when a designer draws the plans | 2026-10-29 |
| City of Waterloo: building permit portal | https://building-permits.waterloo.ca/ | Apply, pay and book inspections | 2026-10-29 |
| City of Waterloo: Build an ARU on the main floor or basement | https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/#prepare-drawings | Owner may draw their own house (up to 2 units); the drawings list to print and use as a checklist; $392 per unit + $0.62/sq ft; 15 business days | 2026-10-29 |
| City of Waterloo: Get a long-term rental licence | https://www.waterloo.ca/building-and-renovating/residential-rental-licences/get-a-long-term-rental-licence/ | Rental licence after occupancy; from 2026-07-01 new applications need electrical and gas-appliance inspection forms, floor and parking plans | 2026-10-29 |
