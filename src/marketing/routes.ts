// The marketing and legal pages, for the app router to mount.
// Each page renders its own header and footer; links between them are plain
// <a href> paths from site.ts, so they work with or without client routing.
import type { ComponentType } from "react";
import { About } from "./About";
import { Cities } from "./Cities";
import { Faq } from "./Faq";
import { ForPros } from "./ForPros";
import { HowItWorks } from "./HowItWorks";
import { Privacy } from "./Privacy";
import { PATHS } from "./site";
import { Terms } from "./Terms";

export type MarketingRoute = {
  path: string;
  title: string;
  description: string;
  component: ComponentType;
};

export const marketingRoutes: MarketingRoute[] = [
  {
    path: PATHS.howItWorks,
    title: "How it works | Basement Ready",
    description:
      "Film your basement, get a 3D scan, and see what it would take to make it a legal second unit: the fixes, rough costs, grants and who can build it.",
    component: HowItWorks,
  },
  {
    path: PATHS.forPros,
    title: "For designers and builders | Basement Ready",
    description:
      "Homeowners' basement plans that come with a scan, measurements, a fix list and a rough cost. A pro inbox is coming; founding pros are free while pricing is set.",
    component: ForPros,
  },
  {
    path: PATHS.cities,
    title: "Cities | Basement Ready",
    description:
      "All of Ontario, with Waterloo Region in depth: what Basement Ready checks in Waterloo, Kitchener and Cambridge, and for every other Ontario address.",
    component: Cities,
  },
  {
    path: PATHS.faq,
    title: "FAQ | Basement Ready",
    description:
      "What it costs, how accurate it is, what happens to your video, and the difference between a basement finish and a second unit.",
    component: Faq,
  },
  {
    path: PATHS.privacy,
    title: "Privacy | Basement Ready",
    description: "What Basement Ready collects, why, who processes it, how long it's kept, and how to have it deleted.",
    component: Privacy,
  },
  {
    path: PATHS.terms,
    title: "Terms | Basement Ready",
    description: "Estimates aren't quotes, results aren't advice or approvals, and pros are independent. The terms in plain words.",
    component: Terms,
  },
  {
    path: PATHS.about,
    title: "About | Basement Ready",
    description: "Who builds Basement Ready and why: helping Waterloo Region homeowners see if their basement can become a home.",
    component: About,
  },
];

export function findMarketingRoute(path: string): MarketingRoute | undefined {
  const clean = path.replace(/\/+$/, "") || "/";
  return marketingRoutes.find((r) => r.path === clean);
}

// Sets the tab title and meta description for a route.
export function applyRouteMeta(route: MarketingRoute) {
  document.title = route.title;
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.name = "description";
    document.head.appendChild(meta);
  }
  meta.content = route.description;
}
