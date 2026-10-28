# Rules pack schema (v1.0)

One JSON file per city, e.g. `waterloo-on.json`. The agent reads only this file at run time and never the live web. Every fact carries a source and the date it was checked.

## Top level

| Field | Meaning |
|---|---|
| `schemaVersion` | Version of this schema (`"1.0"`). |
| `jurisdiction` | `{city, province, country, region}`. |
| `compiledAt` | Date the pack was researched (ISO date). |
| `scope`, `disclaimer` | What the pack covers, and the "not advice / estimates only" text to show users. |
| `codeInForce` | The building code that applies now: `name`, `regulation`, `effective`, `transition`, `textUsed` (which copy of the code the section numbers came from), `existingBuildings` (when the relaxed rules for existing buildings apply, as a `check`), `secondarySuiteDefinition`, `source`, `relatedSources`, `verified`, `notes`. |
| `routes[]` | Permit routes: `id` (`basement_finish` or `second_unit`), `summary`, `permit` (type, fee, review time), `appliesRules`, `sources`. |
| `rules[]` | Checkable requirements (below). |
| `grants[]` | Money programs (below). |
| `process[]` | Ordered steps: `step`, `title`, `detail`, `source`, optional `verified` and `notes`. |
| `pros` | How to find qualified designers: `registry {name, url, searchable, suggestedSearch, termsNote, source}` plus notes. |
| `costs[]` | Cost estimates: `item`, `lowCAD`, `highCAD`, `unit` (`each`, `sqft` or `job`), `region`, `estimate: true`, `source`, `notes`. |

## `rules[]`

| Field | Meaning |
|---|---|
| `id` | Stable snake_case id. |
| `route` | Which routes it applies to: `["second_unit"]`, `["basement_finish"]` or both. |
| `category` | `egress`, `fire`, `height`, `exit`, `hvac`, `sound`, `electrical`, `plumbing`, `zoning` or `size`. |
| `priority` | `core` (the rules that decide most verdicts) or `supporting`. |
| `severity` | `required` or `advisory` (a recommendation, not a requirement). |
| `title`, `plain` | Short title and one plain-language sentence for the fix card. |
| `check` | `{metric, operator, value, unit}`. `operator` is `>=`, `<=`, `==` or `exists`. Optional `appliesWhen` says when the check is relevant. |
| `existingBuildingAlternative` | `null`, or the relaxed rule for houses 5+ years old: `{appliesIf, ref, text` or `options, check, orCheck, source, interpretationNote}`. Use it only when `appliesIf` holds. |
| `evidence` | `type` is the primary evidence: `video_object` (SAM can find it), `scan_measurement` (needs the 3D scan) or `ask_user`. `samConcept` is a short noun phrase for SAM 3.1; `alsoFind` lists other concepts; `scanMeasurement` says what to measure; `question` is what to ask if it can't be seen. |
| `fix` | `{description, costLowCAD, costHighCAD, costUnit, costSource, costNote}`. Costs are estimates; `null` means no published figure was found. |
| `source` | `{title, url, section, retrieved}`. `relatedSources[]` has the same shape. |
| `verified` | `true` when the stated rule was read on the cited source; `false` when sources conflict or something could not be confirmed (see `notes`). |
| `notes` | Caveats, interpretations and conflicts. |

## `grants[]`

| Field | Meaning |
|---|---|
| `id`, `name`, `level` | `level` is `federal`, `provincial`, `region` or `city`. |
| `kind` | `grant`, `forgivable_loan`, `refundable_tax_credit`, `fee_exemption`, `insured_financing` or `low_interest_loan`. |
| `status` | `open`, `waitlist`, `closed`, `cancelled` or `unknown`. |
| `amount` | Plain text. |
| `conditions` | Checkable fields, such as `requiresOwnerOccupied` (bool), `occupantRelation` (`relative65plus\|disabled`, `any`, `any_except_spouse_or_dependent`, `any_income_verified_tenant`), `rentCap` and `tenantIncomeLimit` (monthly rent and household income by unit size, with the year), `affordabilityYears`, `stackableWith`. `null` means it doesn't apply. |
| `fitsPlans` | `{family_suite, rental, market_rental?}`, each `fits`, `depends` or `no`; `fitsPlansNote` explains. |
| `nextStep`, `source`, `relatedSources`, `verified`, `notes` | As for rules. |

## Conventions

- Where sources disagree, the field holds `{"value": null, "conflict": [{...source A}, {...source B}]}` and the item has `verified: false`.
- Cost sources add `publisher`, `pageDate` and `sourceType` (`government`, `regulator` or `non-government`). Show every cost as an estimate, not a quote.
- Lengths are in `m` or `mm`, areas in `m2` or `sqft`, money in CAD.
- To add a city, copy this shape to `<city>-<prov>.json` and replace the contents. Keep the ids where the rule is the same provincial rule.
