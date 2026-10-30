# Sources: permit package and do-it-yourself (Ontario-wide, and each city's `permitPackage`)

Checked on **2026-10-29** unless a row says otherwise. Government, regulator and city sources only, except one other-province regulator (British Columbia) marked unverified. Nothing came from the Gablebird/divinedesigner repository.

Files: `data/rules/ontario-diy.json` (drawing notes, alarm placement, who may do which work, what needs a pro, electrical rules and ESA fees) and the `permitPackage` section of each city pack (who signs, drawing checklist, forms with their URLs, portal, what to upload, owner-builder, inspections, plumbing fees).

## Conflicts and gaps

1. **Waterloo, who may draw.** The City's ARU page lets a homeowner draw their own house (up to 2 units); its ARU Guide 2025 (p. 20) says architect, engineer or BCIN designer. The Building Code (Div. C 3.2.5.1.(3)(b)) supports the web page. `signerVerified: false`; the app says to confirm with the City.
2. **Kitchener, who signs.** Kitchener's duplex guide allows the homeowner to draw a duplex ("Drawings must be completed by the homeowner or a qualified BCIN designer"), so Kitchener's package is owner-drawn, not a design brief. The design-brief mode stays available when the owner ticks "A designer will finish and sign it".
3. **Kitchener, separate heating.** Kitchener asks for a BCIN HVAC designer's Schedule 1 and heat-loss calculations for a separate heating system, which sits uneasily with the owner exemption. Listed under "needs a pro" with that note.
4. **Plumbing by the owner.** Plumbing is a compulsory trade (BOSTA s. 6; O. Reg. 876/21) and O. Reg. 877/21 lists no homeowner exemption. Kitchener's inspection guide (p. 28) lets a resident owner do it; Waterloo and Cambridge are silent. The app tags plumbing "Ask your City first" (`verified: false`). A provincial enforcement blitz on electrical and plumbing work runs 2026-10-01 to 2027-01-31.
5. **Electrical by the owner for a rental unit.** O. Reg. 570/05 s. 2 para. 3 and ESA's FAQ ("in their own home or rental building") support it; some contractor blogs say otherwise and were not used.
6. **Smoke alarm interconnection.** The 2024 Code (9.10.19.5.(2)) interconnects all alarms in a house with a secondary suite; Kitchener's inspection guide (June 2025) says not needed with a 30-min separation. The package follows the Code.
7. **Alarm power in existing houses.** Part 9 requires hard-wired smoke and CO alarms; Part 11 (C179, C200) accepts battery or plug-in in existing buildings. Kitchener requires new alarms hard-wired. The package and takeoff use hard-wired alarms.
8. **Sound.** Kitchener's guide says sound control isn't required for an existing house; Part 11 C181 sets a minimum (STC 43 / ASTC 40 or the insulation + resilient channel + 12.7 mm board assembly). The package uses the 9.11.1.1 note.
9. **Kitchener cites an old CO article (9.33.4).** The 2024 Code's CO rules are 9.32.3.9A to 9.32.3.9C; the package uses those.
10. **Electrical layout distances.** The 1.8 m floor-line and 900 mm counter receptacle rules come from Technical Safety BC quoting the national code; the 2024 Ontario Electrical Safety Code and ESA bulletins are paid CSA products. `verified: false`; the takeoff says so.
11. **Cambridge Owner Acknowledgement Form.** Required when the owner is the contractor; no public PDF exists (email building@cambridge.ca). The package prints a summary page instead.
12. **Kitchener Water Capacity Application.** Online form only; whether a basement unit in an existing house is exempt is unconfirmed (the staff report returned HTTP 403).
13. **ESA fee for a new unit.** No specific line in the 2026 guide; the takeoff uses the homeowner renovation rate by outlet count.
14. **Energy.** Renovations follow Part 11 (SB-12 1.1.1.1.(4)); no city states a fixed R-value for finishing ARU basement walls. Waterloo asks for an EEDS form when insulation changes.
15. **Cambridge plumbing and ARU fees.** The fee by-law has no ARU line and its plumbing fee is for work independent of a building permit; which applies is unconfirmed (`verified: false`).
16. **The 2026 provincial application asks whether the work is a "new home"** under the New Home Construction Licensing Act; whether a basement suite counts was not checked, so that box is left for the owner.
17. **City of Waterloo ARU grant and doing it yourself.** The City's online grant form asks the applicant to acknowledge "A qualified professional will construct the unit". The app warns do-it-yourselfers to ask ARU@waterloo.ca before applying.

## Forms read for field names (2026-10-29)

| Form | URL | Fillable? | Used for |
|---|---|---|---|
| Application for a Permit to Construct or Demolish (effective 2026-02-16), with Schedule 1 | https://www.ontario.ca/files/2026-01/mmah-building-development-application-for-a-permit-to-construct-or-demolish-2026-en-2026-01-27.pdf (Waterloo's copy: https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/ntiptfny/permit-application-to-construct-or-demolish.pdf, same 139 fields) | Yes, 139 fields; choices are checkboxes with one widget per option | `FIELD_MAPS.on_application` (server/permit/forms.ts). The published file ships with "ADE" typed in Section D's unit and lot boxes; the app clears them. |
| Owner/Designer Declaration (City of Waterloo) | https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/t4uazxbv/owner-declaration-form.pdf | Yes: Text1 name, Text2 date, Text3 address, Text4 permit number, Signature1 | `FIELD_MAPS.waterloo_owner_declaration` |
| Schedule 1: Designer Information (Waterloo's copy) | https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/uliohsmv/schedule-1-designer-information.pdf | Yes, 39 fields | `FIELD_MAPS.schedule_1`; Waterloo lists it for a designer only |
| Schedule 1, standalone (2026-07-16 file) | https://ontario.ca/files/2026-07/mmah-schedule-1-designer-form-en-2026-07-16.pdf | No fields | Not used: the application's own Schedule 1 is filled |
| Project Information: Residential (City of Kitchener) | https://www.kitchener.ca/media/b1elhjjb/dsd_build_project_information_residential.pdf | Yes, 149 fields (each twice) | `FIELD_MAPS.kitchener_project_info`; its Section G also sets the drawing standard: double-line walls, black and white, 1:75 or 3/16" = 1' |
| Ontario Renovates Secondary Suite Application v11 (Region of Waterloo, 2026-05-22) | https://media-003-ca.cdn.govstack.com/regionofwaterloo-018-ca/media/55bf0zge/docs_admin-2295447-v11-ontario_renovates_secondary_suite_application-aoda.pdf | No fields | Answers printed onto its blanks at positions read from its text layout (server/apply/regionForm.ts) |
| ADU grant application (City of Kitchener) | https://www.kitchener.ca/media/ys3dnroa/dsd_plan_application_for_cip_adu_grant.pdf | No fields | Linked from the email application |
| Apply for an additional residential unit grant (City of Waterloo, online) | https://forms.waterloo.ca/Grants/Apply-for-an-additional-residential-unit-grant | Online form | Its sections and questions, in order, for the answers laid out to copy |

Official forms are fetched from these addresses at run time and cached in storage; they are not shipped with the app.

## Other sources added

| Source | URL | Used for | Checked |
|---|---|---|---|
| WSIB eClearance: get a clearance certificate | https://clearances.wsib.ca/Clearances/eclearance/start?lang=en | Build tab: check a contractor's WSIB clearance (the Region loan needs WSIB-covered quotes) | 2026-10-29 |
| Region of Waterloo 2026 aerial imagery and the City/Region parcel and footprint layers | (layers listed in server/property.ts) | Site plan outlines (`returnGeometry=true`); PIN from Waterloo's property fabric and Cambridge's parcels; legal description and roll number from Kitchener's layer, behind `PROPERTY_KITCHENER` | 2026-10-29 |
| 2024 Building Code Compendium 9.33.5.1.; Kitchener process guide p. 1 | https://www.kitchener.ca/media/jt2cssy4/dsd_build_process_guide_duplex.pdf | Needs a pro: Separate heating for the unit | 2026-10-29 |
| 2024 Building Code Compendium, Division B Part 11 | https://www.ontario.ca/document/2024-building-code-compendium/part-11-renovation | Drawing note: Way out (Table 11.5.1.1.-C, C139) | 2026-10-28 |
| 2024 Building Code Compendium, Division B Part 9 | https://www.ontario.ca/document/2024-building-code-compendium/part-9-housing-and-small-buildings | Drawing note: Ceiling heights (9.5.3.1.(2), (3) and (4)); Drawing note: Fire separation between the homes (9.10.9.16.(1), (4) and (5)); Drawing note: Beams and posts (9.10.8.3.(2)); Drawing note: Furnace room (9.10.10.4.(1) and (2)(b)); Drawing note: Smoke alarms (9.10.19.3.(1)-(6), 9.10.19.4.(1), 9.10.19.5.(2)); Drawing note: Carbon monoxide alarms (9.32.3.9A.(2)-(4), 9.32.3.9B.(1), 9.32.3.9C.(1)); Drawing note: Bedroom escape window (9.9.10.1.(1), (3), (4) and (5)); Drawing note: Heating and air (9.33.1.1.(3)); Drawing note: Sound between the homes (9.11.1.1.(1)); Drawing note: Stairs (9.8.2.1.(2), 9.8.2.2.(1), (3) and (4)); Drawing note: Plumbing (9.31.4.1.(1)); Drawing note: Room sizes (9.5.3A.-9.5.3E.1., 9.5.3F.2.); Drawing note: Door sizes (9.5.5.1.(1) and (2), Table 9.5.5.1); Drawing note: New walls (Table 9.23.10.1, 9.23.11.2.(1), 9.23.11.3.(1), 9.23.2.3.(1)); Drawing note: Doors in the fire separation (Table 9.10.13.1, 9.10.13.2, 9.10.13.10.(1)); Alarm placement (9.10.19.3.(1), (3), (4) and (6)); Alarm placement (9.32.3.9A.(2)-(4), 9.32.3.9B.(1)); Who may do it: Structure; Who may do it: Heating; Needs a pro: A new or wider foundation window | 2026-10-28 |
| 2024 Building Code Compendium, Division C Part 3 | https://www.ontario.ca/document/2024-building-code-compendium/part-3-qualifications | Who may do it: Drawing the plans | 2026-10-29 |
| 2024 Ontario Amendments to the Canadian Electrical Code (ESA); Kitchener inspection guide | https://esasafe.com/assets/files/esasafe/pdf/amendments/2024/2024-Ontario-Amendments-Final.pdf | Drawing note: Kitchen range (Rule 26-744 4); Kitchener guide p. 31 citing 9.32.3.10.(6)) | 2026-10-29 |
| 2026 Electrical Safety Services Fees: Residential Fees Quick Reference Guide (ESA) | https://esasafe.com/assets/files/esasafe/pdf/Fees/2026-Residential-Fees-Reference-Guide.pdf | ESA homeowner (NC) fees by outlet count | 2026-10-29 |
| Adding a Second Unit in an Existing House: Guide to Successful Inspections (City of Kitchener, June 2025) | https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf | Drawing note: Fire stopping (pp. 8-10, citing 9.10.9.6. and 9.10.9.2.); Drawing note: Entrance to the unit (p. 27, citing 9.8.6. and 9.7.2.1.) | 2026-10-29 |
| Application for a Permit to Construct or Demolish (effective 2026-02-16) | https://www.ontario.ca/files/2026-01/mmah-building-development-application-for-a-permit-to-construct-or-demolish-2026-en-2026-01-27.pdf | Who may do it: Running the job | 2026-10-29 |
| Building Opportunities in the Skilled Trades Act, 2021, s. 6; O. Reg. 877/21; Kitchener inspection guide p. 28 | https://www.ontario.ca/page/compulsory-trades-and-enforcement | Who may do it: Plumbing; Needs a pro: Plumbing, unless your City says you may | 2026-10-29 |
| Notifications and Inspections (Electrical Safety Authority) | https://esasafe.com/compliance/what-you-need-to-know/ | Drawing note: Electrical | 2026-10-29 |
| O. Reg. 163/24: Building Code (e-Laws) | https://www.ontario.ca/laws/regulation/240163 | Drawing note: General (s. 1-2) | 2026-10-28 |
| O. Reg. 212/01 (Gaseous Fuels), s. 6(1) and s. 21(1) | https://www.ontario.ca/laws/regulation/010212 | Who may do it: Gas; Needs a pro: Any gas line or appliance | 2026-10-29 |
| O. Reg. 570/05, s. 2, para. 3; ESA FAQ 'Can a homeowner file a notification of work?' | https://esasafe.com/contractor-licensing-master-electricians/can-a-homeowner-file-a-notification/ | Who may do it: Electrical | 2026-10-29 |
| Residential building permits (City of Kitchener); Project Information: Residential | https://www.kitchener.ca/building-and-renovating/residential-building-permits/ | Needs a pro: Moving or adding beams, posts or load-bearing walls | 2026-10-29 |
| SB-12 1.1.1.1.(4); Part 11, 11.3.1.2 and C207; Kitchener inspection guide pp. 32-34 | https://www.ontario.ca/document/2024-building-code-compendium/sb-12-energy-efficiency-housing | Drawing note: Insulation (SB-12 1.1.1.1.(4); Part 11 11.3.1.2, C207) | 2026-10-29 |
| Technical Safety BC Directive D-EL 2016-01 (quoting the Canadian Electrical Code, Rule 26-722) | https://www.technicalsafetybc.ca/regulatory-resources/regulatory-notices/directive-bc-electrical-code-section-26-installation-electrical-equipment | Receptacle spacing for the takeoff (unverified for Ontario) | 2026-10-29 |

## City permit facts

### Waterloo

- Who signs: owner (unverified): Build an ARU on the main floor or basement (City of Waterloo), https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/
- Drawing checklist: Build an ARU on the main floor or basement (City of Waterloo), https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/
- Owner as builder: Additional Residential Units Guide 2025 (City of Waterloo), https://www.waterloo.ca/media/ghehnugv/additional-residential-units-guide.pdf
- Inspections: Additional Residential Units Guide 2025 (City of Waterloo), https://www.waterloo.ca/media/ghehnugv/additional-residential-units-guide.pdf
- Plumbing fees: Fees and Charges By-law 2026-047, Schedule C (City of Waterloo), https://www.waterloo.ca/media/zeqjquvr/fees-and-charges-bylaw.pdf (verified)
- Form: Application for a Permit to Construct or Demolish (with Schedule 1): https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/ntiptfny/permit-application-to-construct-or-demolish.pdf (from https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/)
- Form: Owner/Designer Declaration (City of Waterloo): https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/t4uazxbv/owner-declaration-form.pdf (from https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/)
- Form: Schedule 1: Designer Information: https://media-002-ca.cdn.govstack.com/waterloo-013-ca/media/uliohsmv/schedule-1-designer-information.pdf (from https://www.waterloo.ca/building-and-renovating/additional-residential-units-arus/build-an-aru-on-the-main-floor-or-basement/)

### Kitchener

- Who signs: owner (verified): Process Guide: Duplex (City of Kitchener, modified 2025-04-01), https://www.kitchener.ca/media/jt2cssy4/dsd_build_process_guide_duplex.pdf
- Drawing checklist: Process Guide: Duplex (City of Kitchener, modified 2025-04-01), https://www.kitchener.ca/media/jt2cssy4/dsd_build_process_guide_duplex.pdf
- Owner as builder: Adding a Second Unit in an Existing House: Guide to Successful Inspections (City of Kitchener, June 2025), https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf
- Inspections: Adding a Second Unit in an Existing House: Guide to Successful Inspections (City of Kitchener, June 2025), https://www.kitchener.ca/media/mjlpg14o/dsd_build_duplex_guide.pdf
- Plumbing fees: Permit Fee Schedule 2026 (City of Kitchener), https://www.kitchener.ca/media/kbkdq0kj/dsd_build_2026-permit-fee-schedule-aoda.pdf (verified)
- Form: Application for a Permit to Construct or Demolish (with Schedule 1): https://www.ontario.ca/files/2026-01/mmah-building-development-application-for-a-permit-to-construct-or-demolish-2026-en-2026-01-27.pdf (from https://www.ontario.ca/document/2024-building-code-compendium/building-code-forms)
- Form: Project Information: Residential (City of Kitchener): https://www.kitchener.ca/media/b1elhjjb/dsd_build_project_information_residential.pdf (from https://www.kitchener.ca/building-and-renovating/residential-building-permits/)
- Form: Water Capacity Application Form (City of Kitchener, online): no public PDF (from https://www.kitchener.ca/development-and-construction/kitchener-water-allocation-policy/)

### Cambridge

- Who signs: owner (verified): Building Permits (City of Cambridge), https://www.cambridge.ca/business-building-development/building-planning/building-permits/
- Drawing checklist: Building Permits (City of Cambridge), https://www.cambridge.ca/business-building-development/building-planning/building-permits/
- Owner as builder: Building Permits (City of Cambridge), https://www.cambridge.ca/business-building-development/building-planning/building-permits/
- Inspections: Building Inspections (City of Cambridge), https://www.cambridge.ca/business-building-development/building-planning/building-inspections/
- Plumbing fees: Municipal Fees and Charges By-law 25-079, Schedule A (City of Cambridge), https://www.cambridge.ca/media/nridbsyx/municipal-fees-and-charges-by-law-25-079.pdf (unverified)
- Form: Application for a Permit to Construct or Demolish (with Schedule 1): https://www.ontario.ca/files/2026-01/mmah-building-development-application-for-a-permit-to-construct-or-demolish-2026-en-2026-01-27.pdf (from https://www.ontario.ca/document/2024-building-code-compendium/building-code-forms)
- Form: Owner Acknowledgement Form (City of Cambridge): no public PDF (from https://www.cambridge.ca/business-building-development/building-planning/building-permits/)

