// One-click applications: for each program they qualify for (decided in server/eligibility.ts),
// everything needed to apply in one or two clicks: the filled PDF where the program uses one, a ready
// email to the right address with what to attach, or the online form's answers laid out to copy.
// The documents checklist ticks off what the workspace already holds. Nothing here re-asks a
// question: rent, who lives there and the rest come from the answers already given.
import type { Profile, StoredState } from "../workspace";

export type Doc = { label: string; have: boolean; how: string };
export type FormField = { label: string; value: string | null; note?: string | null };
export type Application = {
  id: string;
  shortName: string;
  qualify: "yes" | "ask";
  worth: string;
  kind: "pdf" | "online_form" | "email" | "portal" | "tax" | "lender";
  when: string;
  steps: string[];
  pdf: { path: string; title: string } | null;
  email: { to: string; subject: string; body: string; attachments: string[] } | null;
  form: { url: string; sections: { title: string; fields: FormField[] }[] } | null;
  documents: Doc[];
  warnings: string[];
  link: { label: string; url: string } | null;
  source: { title: string; url: string };
};

export type ApplyInput = {
  scanId: string;
  result: any;
  profile: Profile | null;
  state: StoredState;
  address: string;
  municipality: string; // city name
  site: unknown; // the lot and house shapes; no legal description, since no open parcel data has one
  areaM2: number | null;
  bedrooms: 0 | 1;
  scope: string;
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const mailOf = (where: { label: string; url: string }[] | undefined) => where?.find((w) => w.url.startsWith("mailto:"))?.url.slice(7) ?? null;
const answers = (r: any): Record<string, unknown> => Object.fromEntries((r?.moneyAnswered ?? []).map((q: { id: string; answer: unknown }) => [q.id, q.answer]));

export function names(p: Profile | null) {
  return p?.owners.map((o) => `${o.first} ${o.last}`.trim()).filter(Boolean).join(" and ") ?? "";
}

// "PLAN 364 LOT 31 ..." → the plan and the lot, for forms that ask for them apart.
export function planAndLot(legal: string | null) {
  if (!legal) return { plan: null, lot: null };
  const plan = legal.match(/\bPLAN\s+([0-9A-Z-]+)/i)?.[1] ?? null;
  const lot = legal.match(/\bLOTS?\s+([0-9A-Z]+)/i)?.[1] ?? null;
  return { plan, lot };
}

function worth(g: any) {
  if (g.value === "cash" && g.amountCAD != null) return `${money(g.amountCAD)}${g.kind === "forgivable_loan" ? " forgivable loan" : g.kind === "refundable_tax_credit" ? " tax credit" : " grant"}`;
  if (g.value === "financing") return "Financing";
  return "Saves fees";
}

export function holdingsOf(input: ApplyInput) {
  const pros = input.state.build?.pros ?? [];
  return {
    profile: Boolean(input.profile?.owners.length && input.profile.email),
    legal: Boolean(input.profile?.legalDescription),
    drawings: Boolean(input.result?.plan),
    quotesWsib: pros.filter((p) => p.quoteCAD != null && p.wsib === true).length,
    quotes: pros.filter((p) => p.quoteCAD != null).length,
  };
}

export function applications(input: ApplyInput): Application[] {
  const r = input.result;
  const a = answers(r);
  const has = holdingsOf(input);
  const who = names(input.profile);
  const legal = input.profile?.legalDescription || null;
  const pkg = `/api/scans/${input.scanId}/permit.pdf`;
  const out: Application[] = [];
  const live = (r?.grants ?? []).filter((g: any) => g.qualify !== "no" && !["cancelled", "closed"].includes(g.status));
  const signOff = `${who || "[your name]"}${input.profile?.phone ? `\n${input.profile.phone}` : ""}`;

  for (const g of live) {
    const base = { id: g.id, shortName: g.shortName, qualify: g.qualify, worth: worth(g), source: { title: g.source.title, url: g.source.url } } as const;
    const bring: string[] = g.apply?.bring ?? [];

    if (g.id === "region_ontario_renovates_secondary_suites") {
      const to = mailOf(g.apply?.where) ?? "OntarioRenovates@regionofwaterloo.ca";
      const documents: Doc[] = [
        { label: "The application, filled in", have: has.profile, how: has.profile ? "Download it below, then each owner signs page 9." : "Add your names, phone and email first." },
        ...bring.map((b) => ({ label: b, have: false, how: /zoned|zoning/i.test(b) ? "Ask the City's planning department by email; your result's zoning check helps." : "A photo or scan from your phone is fine." })),
      ];
      out.push({
        ...base,
        kind: "pdf",
        when: "Before any work starts",
        steps: ["Download the filled application and sign page 9", "Email it with the documents below"],
        pdf: { path: `/api/scans/${input.scanId}/apply/${g.id}.pdf`, title: "Ontario Renovates application (filled)" },
        email: {
          to,
          subject: `Ontario Renovates secondary suite application: ${input.address}`,
          body: [
            "Hello,",
            "",
            `Please find attached our application to the Ontario Renovates program for a secondary suite at ${input.address}, ${input.municipality}.`,
            `The suite will be ${input.bedrooms === 0 ? "a bachelor" : "a one-bedroom"} unit in the basement${input.areaM2 ? `, about ${Math.round(input.areaM2)} m²` : ""}. No work has started.`,
            "",
            "Attached:",
            ...documents.map((d) => `- ${d.label}`),
            "",
            "Thank you,",
            signOff,
          ].join("\n"),
          attachments: documents.map((d) => d.label),
        },
        form: null,
        documents,
        warnings: [
          "After conditional approval the Region needs 3 quotes from contractors with WSIB coverage and liability insurance. The Build tab tracks them.",
          "Work started before written approval doesn't qualify.",
        ],
        link: null,
      });
      continue;
    }

    if (g.id === "city_waterloo_aru_grant_interior") {
      const url = g.apply?.where?.find((w: { url: string }) => w.url.startsWith("http"))?.url ?? "https://forms.waterloo.ca/Grants/Apply-for-an-additional-residential-unit-grant";
      const { plan, lot } = planAndLot(legal);
      const contractor = (input.state.build?.pros ?? []).some((p) => p.role === "general" && p.quoteCAD != null);
      const diy = input.state.build?.path === "diy" || input.state.build?.path === "mix";
      const mailing = input.profile?.mailingAddress || `${input.address}, ${input.municipality}${input.profile?.postalCode ? `, ${input.profile.postalCode}` : ""}`;
      out.push({
        ...base,
        kind: "online_form",
        when: "Before any work starts",
        steps: ["Open the City's form", "Copy each answer below, tick the acknowledgements and sign"],
        pdf: null,
        email: null,
        form: {
          url,
          sections: [
            {
              title: "Section 1: About the applicant",
              fields: [
                { label: "Owner full name", value: input.profile?.owners[0] ? `${input.profile.owners[0].first} ${input.profile.owners[0].last}` : null },
                { label: "Owner email address", value: input.profile?.email || null },
                { label: "Owner telephone number", value: input.profile?.phone || null },
                { label: "Owner street address (including street address, city, postal code)", value: mailing },
                { label: "Is there an additional owner of the property?", value: input.profile ? (input.profile.owners.length > 1 ? "Yes" : "No") : null },
              ],
            },
            {
              title: "Section 2: About the property and the project",
              fields: [
                { label: "Subject property street address", value: input.address },
                { label: "Postal code", value: input.profile?.postalCode || null },
                { label: "Legal description", value: legal },
                { label: "Registered plan number", value: plan },
                { label: "Lot no", value: lot },
                { label: "What is the existing use of the subject property?", value: "Single detached house" , note: "Change it if your house is semi-detached or a townhouse." },
                { label: "What type of ARU are you building?", value: "Interior ARU" },
                { label: "How many bedrooms will the ARU contain?", value: input.bedrooms === 0 ? "Bachelor unit" : "1-bedroom" },
                { label: "Is there a contractor or commercial builder retained for the project?", value: contractor ? "Yes" : "No" },
                { label: "Describe the project you are planning", value: input.scope },
              ],
            },
            {
              title: "Section 3: Upload documents (optional)",
              fields: [
                { label: "Preliminary drawings", value: has.drawings ? "Your permit package (Permit tab)" : null },
                { label: "Project plan with a timeline", value: "The build order on the Build tab" },
              ],
            },
          ],
        },
        documents: [
          { label: "Your property's legal description", have: has.legal, how: has.legal ? "Filled in above." : "It's on your tax bill or deed; add it to your profile." },
          { label: "A signature from each owner", have: false, how: "Drawn on the form when you submit." },
          { label: "Preliminary drawings (optional)", have: has.drawings, how: "Download the permit package from the Permit tab." },
        ],
        warnings: [
          ...(diy ? ["The City's form asks you to confirm that \"a qualified professional will construct the unit\". Building it yourself may not fit this grant: ask ARU@waterloo.ca before you apply."] : []),
          `You agree to rent at ${a.rent && typeof a.rent === "number" ? money(a.rent) : "the affordable rent"} or less for 5 years, get a building permit within 120 days of approval, and finish within a year.`,
        ],
        link: { label: "Open the City's form", url },
      });
      continue;
    }

    if (g.id === "city_kitchener_adu_grant") {
      const to = mailOf(g.apply?.where) ?? "HousingIncentives@kitchener.ca";
      const form = g.apply?.where?.find((w: { url: string }) => w.url.endsWith(".pdf"))?.url ?? null;
      out.push({
        ...base,
        kind: "email",
        when: "When your permit invoice arrives",
        steps: ["Fill in the City's form (link below)", "Email it with your permit invoice"],
        pdf: null,
        email: {
          to,
          subject: `ADU grant application: ${input.address}`,
          body: ["Hello,", "", `Please find attached our application for the Additional Dwelling Unit grant for ${input.address}, Kitchener: a second unit in the basement of our house.`, "", "Attached:", ...bring.map((b: string) => `- ${b}`), "- The application form", "", "Thank you,", signOff].join("\n"),
          attachments: [...bring, "The application form"],
        },
        form: null,
        documents: bring.map((b: string) => ({ label: b, have: false, how: /invoice/i.test(b) ? "It comes with your building permit." : "Order it online (a parcel register from OnLand) or from your lawyer." })),
        warnings: g.note ? [g.note] : [],
        link: form ? { label: "The City's application form (PDF)", url: form } : null,
      });
      continue;
    }

    if (g.id === "city_cambridge_aru_grant") {
      out.push({
        ...base,
        kind: "portal",
        when: "After occupancy, once the permit is closed",
        steps: ["Open the portal: Financial Incentives, New Application, Additional Residential Unit Community Improvement Plan", "Upload the documents below"],
        pdf: null,
        email: null,
        form: null,
        documents: bring.map((b: string) => ({ label: b, have: false, how: /invoice/i.test(b) ? "Keep every receipt; the Build tab's materials list helps." : "Order it online (a parcel register from OnLand) or from your lawyer." })),
        warnings: [],
        link: g.apply?.where?.[0] ?? null,
      });
      continue;
    }

    if (g.id === "federal_mhrtc") {
      out.push({
        ...base,
        kind: "tax",
        when: "On your tax return for the year it's finished",
        steps: ["Claim line 45355 on your return", "Keep the receipts"],
        pdf: null,
        email: null,
        form: null,
        documents: [{ label: "Every receipt for the work", have: false, how: "Keep them as you go; your own labour doesn't count." }],
        warnings: [],
        link: g.apply?.where?.[0] ?? null,
      });
      continue;
    }

    if (g.id === "cmhc_refinance_secondary_suite") {
      out.push({
        ...base,
        kind: "lender",
        when: "Before construction",
        steps: ["Email your mortgage lender", "Attach your quotes"],
        pdf: null,
        email: {
          to: "",
          subject: `Refinancing to build a secondary suite: ${input.address}`,
          body: ["Hello,", "", `We'd like to refinance our mortgage on ${input.address} to build a secondary suite in the basement, using CMHC's refinance for secondary suites. Can you tell us if you offer it and what you need from us?`, "", `We have ${has.quotes || "no"} quote${has.quotes === 1 ? "" : "s"} so far and the permit drawings are ready.`, "", "Thank you,", signOff].join("\n"),
          attachments: ["Your quotes for the work"],
        },
        form: null,
        documents: [{ label: "Quotes for the work", have: has.quotes > 0, how: has.quotes ? `${has.quotes} on the Build tab.` : "Ask for quotes on the Build tab." }],
        warnings: ["Only CMHC-approved lenders offer it, and CMHC approves it before construction starts."],
        link: g.apply?.where?.[0] ?? null,
      });
    }
  }
  return out;
}
