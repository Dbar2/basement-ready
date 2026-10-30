// Paths and the few facts every marketing page shares.

export const PATHS = {
  home: "/",
  howItWorks: "/how-it-works",
  forPros: "/for-pros",
  cities: "/cities",
  faq: "/faq",
  privacy: "/privacy",
  terms: "/terms",
  about: "/about",
  // Where "Join as a founding pro" goes. Point it at the Clerk sign-up flow.
  proSignUp: "/pros/join",
} as const;

export const NAV = [
  { path: PATHS.howItWorks, label: "How it works" },
  { path: PATHS.cities, label: "Cities" },
  { path: PATHS.forPros, label: "For pros" },
  { path: PATHS.faq, label: "FAQ" },
  { path: PATHS.about, label: "About" },
];

// The open data behind address and property look-ups (data/rules/SOURCES.md, "Data licences").
export const DATA_CREDIT = "Open data: Region of Waterloo, City of Cambridge. Addresses outside Waterloo Region: Natural Resources Canada.";

export const SITE = {
  name: "Basement Ready",
  builder: "David Barry",
  contactEmail: "davidbarry476@gmail.com" as string | null,
  legalDraftDate: "October 28, 2026",
};
