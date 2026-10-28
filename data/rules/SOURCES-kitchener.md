# Sources: Kitchener, ON rules pack

All sources were checked on **2026-10-28**. Public official sources only; nothing came from the Gablebird/divinedesigner repository or the `/Volumes/Crucial X9` drive.

Building Code rules (ceiling heights, egress windows, fire separation, alarms, exits, HVAC, sound, stairs, ESA, plumbing, room sizes), the Region of Waterloo loan and the federal programs are reused from the Waterloo pack with their sources; see [SOURCES.md](SOURCES.md) for those. This file lists what is new or different for Kitchener.

Kitchener calls ARUs **additional dwelling units (ADUs)**; a house with one ADU is a **duplex** in City material.

## Conflicts between sources

1. **Duplex permit minimum fee.** The City's residential permits page and the duplex process guide say $0.37/sq ft "(or $163 minimum)". The 2026 Permit Fee Schedule lists the same $0.37 interior-finish/duplexing rate with only a general "Minimum Permit Fee (unless otherwise noted) $95.00"; $163 appears there only for single partitions, washrooms, new entries and demising walls. Route marked `verified: false`.
2. **Permit review time.** The permits page and duplex guide: "within 10 business days". The 2026 ADU guide (p. 29): "10 or 15 business days ... (depending on the type of ADU proposed)". The Building Code (Div. C Table 1.3.1.3) sets 10 days only for "a house where no dwelling unit is located above another dwelling unit"; a basement unit falls in Item 2 (15 days). The pack reports the City's 10-day promise and the 15-day legal maximum.
3. **City DC by-law wording.** DC By-law 2022-071 s. 2.7(f) and Schedule D exempt up to two additional units in an existing single detached house only if their total floor area is no more than the existing unit's (one in a semi). The current Development Charges Act s. 2(3.2) exempts a 2nd and 3rd unit in an existing detached, semi or row house with no floor-area test. The statute should prevail; `dc_exemption_aru` marked `verified: false`.
4. **Education development charges.** The City's Feb 2025 ADU guide says school board exemptions "are different from those of the City and Region"; O. Reg. 20/98 s. 3 exempts up to 2 additional units in an existing single detached dwelling (1 in a semi or row) when their gross floor area is no more than the existing unit's. The WRDSB/WCDSB by-laws were not read.
5. **ADU Grant launch date.** Program page: applications open 2026-01-19. HAF Q3 2026 report: launched 2026-01-05. News release dated 2026-01-15. All agree permits must be issued on or after 2026-01-05.
6. **ADU Grant funding.** CIP By-law 2025-155: "$4,214,000" of HAF funding. Key Decisions, 2025-12-15: "$6.21 million".
7. **85-1 duplex parking.** The 85-1 parking schedule lists "Duplex Dwelling: 1 for each dwelling unit"; 85-1 s. 5.22.2.1 treats a duplex as a house plus one ADU, whose rate is 0 / 0.3 / 0.6. `zoning_parking` marked `verified: false`.
8. **Region loan house-value cap** (same as Waterloo): $600,000 on the Region page vs $505,469 in the Dec 2025 fact sheet.
9. **Lodging house fee.** Lodging houses page: "2025 licensing fee is $750"; 2026 Appendix E: $780 new. The page looks out of date. (Not used in the pack because a self-contained unit is not a lodging house.)
10. **Zoning phone number.** ADU page and guide: 519-741-2426; duplex process guide: "(519) 741-2317". The pack uses 519-741-2426.

## Unverified or partly verified items

- **Water allocation** (`kitchener_water_allocation`, `verified: false`). Zoning s. 4.24 (By-law 2026-090) and 85-1 s. 38 require a Water Allocation Confirmation Letter unless the Water Allocation Policy (By-law 2026-091) excludes the project. Interior renovations that do not "materially" increase demand are excluded, but whether a new basement unit is material is the General Manager's call. The policy copy read is the version attached to the 2026-06-29 agenda.
- **Parking rounding.** Whether staff round 1 + 0.3 or 1 + 0.6 up to 2 is not confirmed.
- **Zoning inspection for a duplex.** The zoning certificate page says a zoning inspection is required "where residential units are added"; whether that applies to a duplex (which needs no certificate) is not confirmed.
- **ADU Grant value for a basement unit.** For a 2nd or 3rd unit the grant only covers applicable education DCs, which a basement unit in an existing house is usually exempt from; funding remaining after 2026-09-14 is not published.
- **No general rental licence.** Based on the City's licence list and 2026 fee schedule; there is no explicit City statement. The Rental Renovation Licensing By-law (in force 2027-01-01) final number and fees were not confirmed.
- **GRCA and basement units.** No GRCA clause naming basement units was found; the floodplain rule relies on GRCA policy s. 8.1.13 (internal renovations allowed only where they add no dwelling units). The pack cites the GRCA policy effective 2025-09-26; a May 2024 version (https://www.grandriver.ca/media/f4zljaqe/policies-for-admin-of-ont-reg-41-24-final.pdf) has the same s. 8.1.13 wording.
- **Consolidation dates.** The 2019-051 section PDFs have no printed consolidation date; dates come from the PDF files and the latest amendment each cites (List of Amendments PDF created 2026-09-09, latest entry By-law 2026-107, 2026-08-27). The City warns the consolidation "may not always represent the most up-to-date information."
- **ADU addressing sign ($208)** is in the 2026 fee table; whether it is charged for every basement unit was not confirmed.
- **Council PDFs on eScribe** (`pub-kitchener.escribemeetings.com/filestream.ashx?...`) refuse plain HTTP clients; they were read in a browser.

## Sources

### City of Kitchener: zoning

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Zoning bylaw page | https://www.kitchener.ca/development-and-construction/zoning/zoning-bylaw/ | Two by-laws (85-1 about 20% of lots, 2019-051), consolidation caveat | 2026-10-28 |
| Property zoning viewer | https://experience.arcgis.com/experience/c870484f904744b8bb4f1bdecf18dddb | Which by-law and zone apply | 2026-10-28 |
| By-law 2019-051 Section 3, Definitions | https://app2.kitchener.ca/appdocs/Zonebylaw2019/publishedcurrenttext/section%203%20-%20definitions//Section%203.pdf | Dwelling unit, ADU (attached), unobstructed walkway | 2026-10-28 |
| By-law 2019-051 Section 4, General Regulations (PDF created 2026-08-13) | https://app2.kitchener.ca/appdocs/Zonebylaw2019/publishedcurrenttext/SECTION%204%20-%20General%20Regulations//Section%204.pdf | s. 4.12 c)-d), 4.12.1 a)-d), 4.12.2, 4.12.5 walkway, 4.14.10 b), 4.14.11 a), 4.23, 4.24 water allocation | 2026-10-28 |
| By-law 2019-051 Section 5, Parking (PDF created 2026-04-23) | https://app2.kitchener.ca/appdocs/Zonebylaw2019/PublishedCurrentText/SECTION%205%20-%20Parking,%20Loading,%20and%20Stacking//Section%205.pdf | Table 5-5, Table 5-5-1, s. 5.3.3 a) ii)-iii), 5.4, 5.6 d) | 2026-10-28 |
| By-law 2019-051 Section 7, Residential Zones | https://app2.kitchener.ca/appdocs/Zonebylaw2019/PublishedCurrentText/SECTION%207%20-%20Residential%20(RES)%20Zones//Section%207.pdf | Table 7-1 (ADUs in RES-1 to RES-5), Table 7-2 notes | 2026-10-28 |
| By-law 2019-051 Section 14, EUF Zones | https://app2.kitchener.ca/appdocs/Zonebylaw2019/PublishedCurrentText/SECTION%2014%20-%20Existing%20Use%20Floodplain%20(EUF)%20Zones//Section%2014.pdf | Table 14-1 (no added units in EUF-1) | 2026-10-28 |
| By-law 2019-051 Section 17, Overlays | https://app2.kitchener.ca/appdocs/Zonebylaw2019/PublishedCurrentText/SECTION%2017%20-%20Overlays//Section%2017.pdf | s. 17.2.1 Flooding Hazard, 17.2.2 Slope Erosion | 2026-10-28 |
| List of Zoning By-law Amendments (PDF created 2026-09-09) | https://app2.kitchener.ca/appdocs/Zonebylaw2019/PublishedCurrentText//List%20of%20Zoning%20By-law%20Amendments.pdf | 2024-074 (four units), 2025-013, 2025-125, 2026-024, 2026-029, 2026-090 | 2026-10-28 |
| By-law 85-1 Section 5 (Office Consolidation June 29, 2026) | https://app2.kitchener.ca/appdocs/Zonebylaw/PublishedCurrentText/Sections//Section%205%20-%20General%20Regulations.pdf | s. 5.18, 5.22 a), c), f), 5.22.2 | 2026-10-28 |
| By-law 85-1 Section 6 (Office Consolidation March 10, 2026) | https://app2.kitchener.ca/appdocs/Zonebylaw/PublishedCurrentText/Sections//Section%206%20-%20Off-Street%20Parking%20and%20Off-Street%20Loading.pdf | s. 6.1.1.1 tandem, 6.1.2 schedule (conflict 7) | 2026-10-28 |

### City of Kitchener: permits, fees and guides

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Additional dwelling units page | https://www.kitchener.ca/en/building-and-renovating/additional-dwelling-units.aspx | Unit combinations, designer for 3+ units, GRCA note, zoning certificate rule | 2026-10-28 |
| Home Owners' Guide to ADUs (2026) | https://www.kitchener.ca/media/jxzar2i0/dsd_plan_hhme-owners-adu-guide-april-2026-reduced-file-size.pdf | Pre-reviewed CMHC designs (p. 10), services (p. 16), parking (p. 20), budget (p. 24), review time (p. 29), inspections (p. 33) | 2026-10-28 |
| Home Owners' Guide to ADUs (Feb 2025) | https://www.kitchener.ca/media/jm4fh2td/dsd_plan_home-owners-additional-dwelling-units-guide.pdf | DC note and range (p. 23) | 2026-10-28 |
| Residential building permits | https://www.kitchener.ca/building-and-renovating/residential-building-permits/ | Duplex and basement-finish fees, rebate fee, 10 business days, contact | 2026-10-28 |
| Process Guide: Duplex (modified 2025-04-01) | https://www.kitchener.ca/media/jt2cssy4/dsd_build_process_guide_duplex.pdf | Who may draw, drawing list, HVAC Schedule 1, inspections | 2026-10-28 |
| Adding a Second Unit in an Existing House: Guide to Successful Inspections (June 2025) | https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf | Inspection guide | 2026-10-28 |
| Permit Fee Schedule 2026 | https://www.kitchener.ca/media/kbkdq0kj/dsd_build_2026-permit-fee-schedule-aoda.pdf | $0.37 interior finish/duplexing, $95 minimum, $250 rebate, $95 HVAC per suite | 2026-10-28 |
| 2026 Budget Appendix E, User Fees | https://www.kitchener.ca/media/rnppeqzf/cok_fin_budget_2026_appendix-e_user-fees.pdf | Zoning certificate $348, ADU addressing sign $208, licensing fees | 2026-10-28 |
| Zoning (occupancy) certificate | https://www.kitchener.ca/development-and-construction/zoning/zoning-occupancy-certificate/ | Not needed for a duplex; 15 business days; zoning inspection | 2026-10-28 |
| Online services portal | https://onlineserviceportal2.kitchener.ca/citizenportal/ | Where to apply and book inspections | 2026-10-28 |
| Kitchener Water Allocation Policy page | https://www.kitchener.ca/development-and-construction/kitchener-water-allocation-policy/ | By-law 2026-091, form, confirmation letter | 2026-10-28 |
| Water Allocation Policy (2026-06-29 agenda attachment) | https://pub-kitchener.escribemeetings.com/filestream.ashx?DocumentId=36862 | s. 7 exclusions, Schedule B-1 | 2026-10-28 |
| Water Capacity Application Form | https://form.kitchener.ca/DSD/PLAN/Water-Capacity-Application-Form | Form link | 2026-10-28 |

### City of Kitchener: grants, charges and licensing

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Missing Middle and Affordable Housing CIP page | https://www.kitchener.ca/taxes-utilities-and-finance/grants-and-incentives/the-missing-middle-and-affordable-housing-community-improvement-plan/ | ADU Grant amounts, first-come status | 2026-10-28 |
| CIP By-law 2025-155 | https://www.kitchener.ca/media/yzedsrse/missing-middle-and-affordable-housing-cip.pdf | s. 4.2.1-4.2.2, 5.2-5.3, HAF amount | 2026-10-28 |
| Application for CIP ADU Grant (2026) | https://www.kitchener.ca/media/ys3dnroa/dsd_plan_application_for_cip_adu_grant.pdf | Permit date, short-term rental ban, legalizing existing units, 4th-unit affordability | 2026-10-28 |
| Staff report DSD-2026-343, HAF update (2026-09-14) | https://pub-kitchener.escribemeetings.com/filestream.ashx?DocumentId=38398 | 26 ADU grants (59 units); "Enabling 4 Units ... COMPLETE" | 2026-10-28 |
| DSD-2026-343 Attachment B, HAF Projects Q3 2026 | https://pub-kitchener.escribemeetings.com/filestream.ashx?DocumentId=38400 | Grant status "IN PROGRESS", program review Winter 2027 | 2026-10-28 |
| Development charges page | https://www.kitchener.ca/development-and-construction/resources-for-builders-and-developers/development-charges/ | DCs collected at permit issuance | 2026-10-28 |
| DC By-law 2022-071 | https://www.kitchener.ca/media/4woh1bcb/dsd_build_dc_bylaw.pdf | s. 2.7(f), Schedule D (conflict 3) | 2026-10-28 |
| Key decisions of Council, April 13, 2026 | https://www.kitchener.ca/news/posts/key-decisions-of-kitchener-council-april-13-2026/ | DC by-law extension; Rental Renovation Licensing | 2026-10-28 |
| Licences page | https://www.kitchener.ca/business-in-kitchener/licences/ | No residential rental licence listed | 2026-10-28 |
| Lodging houses page | https://www.kitchener.ca/business-in-kitchener/licences/lodging-houses/ | Lodging house definition (not a self-contained unit) | 2026-10-28 |
| Rental Renovation Licensing By-law, final version (COR-2026-045 Att. A) | https://pub-kitchener.escribemeetings.com/filestream.ashx?DocumentId=34248 | In force 2027-01-01, rental unit definition | 2026-10-28 |
| COR-2026-045 Att. B, proposed fees | https://pub-kitchener.escribemeetings.com/filestream.ashx?DocumentId=34249 | $650 new, $425 renewal | 2026-10-28 |

### Region of Waterloo, Province and GRCA (new for this pack)

| Source | URL | Used for | Retrieved |
|---|---|---|---|
| Ontario Renovates Fact Sheet for Secondary Suites (Dec 2025) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/qorb1jgf/secondary-suite-fact-sheet.pdf | Kitchener is in the "Remainder of Waterloo Region" income band | 2026-10-28 |
| Mannheim Service Area: Information on development (updated 2026-06-11) | https://www.regionofwaterloo.ca/programs-and-services/water-and-wastewater/mannheim-service-area-water-capacity-information-hub/information-on-development/ | Water constraint; building permits are the CBO's call | 2026-10-28 |
| Update on development that can proceed (2026-05-11) | https://www.regionofwaterloo.ca/news-public-notices-and-council-info/posts/update-on-development-that-can-proceed/ | No-increased-demand conditions | 2026-10-28 |
| 2024 Building Code Compendium, Division C Part 1 | https://www.ontario.ca/document/2024-building-code-compendium/part-1-general-0 | 1.3.1.3 and Table 1.3.1.3 review periods (conflict 2) | 2026-10-28 |
| GRCA Policies for the Administration of O. Reg. 41/24 (effective 2025-09-26) | https://www.grandriver.ca/media/savhp2yv/final-approved-version_permitting-policy-document.pdf | s. 8.1.13, 8.1.31 | 2026-10-28 |

### Cost estimates (City figures; the contractor cost table is reused from the Waterloo pack)

| Source | URL | Used for | Page date | Retrieved |
|---|---|---|---|---|
| Residential building permits | https://www.kitchener.ca/building-and-renovating/residential-building-permits/ | $0.37/sq ft duplex and basement finish | no date shown | 2026-10-28 |
| Permit Fee Schedule 2026 | https://www.kitchener.ca/media/kbkdq0kj/dsd_build_2026-permit-fee-schedule-aoda.pdf | $250 rebate fee, $95 HVAC | 2026 | 2026-10-28 |
| 2026 Budget Appendix E | https://www.kitchener.ca/media/rnppeqzf/cok_fin_budget_2026_appendix-e_user-fees.pdf | $348 zoning certificate, $208 addressing sign | 2026 | 2026-10-28 |
| Home Owners' Guide to ADUs (2026) | https://www.kitchener.ca/media/jxzar2i0/dsd_plan_hhme-owners-adu-guide-april-2026-reduced-file-size.pdf | "less than $100 per square foot (for renovations)" | 2026 | 2026-10-28 |

The Caliber Contracting cost guide reused from the Waterloo pack covers "Kitchener-Waterloo & Cambridge"; it gives no Kitchener-only figures. The City of Waterloo's $100/sq ft rule of thumb is not carried into this pack because Kitchener publishes its own range.
