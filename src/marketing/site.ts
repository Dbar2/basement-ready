// Paths and the few facts every marketing page shares. Fill the placeholders
// before launch; anything still null renders as a visible "[to come]" note.

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

export const SITE = {
  name: "Basement Ready",
  builder: "David Barry",
  // Placeholder until the domain and inbox exist.
  contactEmail: null as string | null,
  // David's own line on why this matters to him (PLAN.md, to-dos). Not written yet.
  firsthandLine: null as string | null,
  legalDraftDate: "October 28, 2026",
};
