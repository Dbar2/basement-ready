import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "./components/Logo";
import { inApp, newScanHref } from "./inApp";
import { ContactEmail, MarketingPage, PageHead } from "./marketing/parts";
import { applyRouteMeta, marketingRoutes, type MarketingRoute } from "./marketing/routes";
import { PATHS } from "./marketing/site";
import { Brief } from "./screens/Brief";
import { Dashboard } from "./screens/Dashboard";
import { Home } from "./guide/Home";
import { guideUrl } from "./guide/progress";
import type { Milestone } from "./guide/types";
import { Start } from "./screens/Start";

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Start });

// The basement's home base (src/guide/Home.tsx), and the guide: the one screen after the upload
// (ux-guide-build-spec.md). The guide loads with its page. Older links name the workspace's tabs: the
// book is on the home base now, and the rest open the guide at their milestone.
const TAB_AT: Record<string, Milestone | "home"> = { book: "home", ideas: "home", decision: "answer", plan: "answer", permit: "build", money: "build", build: "build" };
export const scanRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/scans/$scanId",
  beforeLoad: ({ params, location }) => {
    const at = TAB_AT[String((location.search as { tab?: unknown }).tab ?? "")];
    if (at) throw redirect({ href: at === "home" ? `/scans/${params.scanId}` : guideUrl(params.scanId, at) });
  },
  component: Home,
});
const GuideRoute = lazyRouteComponent(() => import("./guide/GuideScreen"), "GuideRoute");
const guideRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/guide", component: GuideRoute });

// The one-page plan to hand a designer, made to print or save as a PDF.
const briefRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/brief", component: Brief });

// The old flow's pages (01 Style … 05 Pictures) all lived inside what is now Design; the book page is the
// home base's book.
const toDesign = ({ params }: { params: { scanId: string } }) => {
  throw redirect({ href: guideUrl(params.scanId, "design") });
};
const legacyRoutes = [
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/style", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/plan", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/layouts", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/studio", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/pictures", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/ideas", beforeLoad: toDesign }),
  createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/book", beforeLoad: ({ params }) => { throw redirect({ href: `/scans/${params.scanId}` }); } }),
];

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: Dashboard });

// Marketing and legal pages come from their own manifest (src/marketing/routes.ts).
function withMeta(route: MarketingRoute) {
  return function Page() {
    useEffect(() => applyRouteMeta(route), []);
    const Component = route.component;
    return <Component />;
  };
}
const pageRoutes = marketingRoutes.map((r) => createRoute({ getParentRoute: () => rootRoute, path: r.path, component: withMeta(r) }));

// Pro accounts open with the pro side of the product; until then, a plain way in.
function ProJoin() {
  useEffect(() => {
    document.title = "Join as a founding pro | Basement Ready";
  }, []);
  return (
    <MarketingPage path={PATHS.proSignUp} motion="join">
      <PageHead
        title="Pro sign-up opens soon."
        lede={<>Founding designers and builders in Waterloo Region are free while pricing is set. Write to <ContactEmail /> and we'll set you up as soon as pro accounts open.</>}
      />
    </MarketingPage>
  );
}
const proJoinRoute = createRoute({ getParentRoute: () => rootRoute, path: PATHS.proSignUp, component: ProJoin });

// The living reference of the UI system (brand/ui.md), on a dev server only: the production build drops it.
const devRoutes = import.meta.env.DEV
  ? [
      createRoute({ getParentRoute: () => rootRoute, path: "/dev/ui", component: lazyRouteComponent(() => import("./dev/UiReference"), "UiReference") }),
      // Every visual and card kind of the guide, mounted as the guide mounts them (src/dev/GuideReference.tsx).
      createRoute({ getParentRoute: () => rootRoute, path: "/dev/guide", component: lazyRouteComponent(() => import("./dev/GuideReference"), "GuideReference") }),
    ]
  : [];

function NotFound() {
  return (
    <main className="not-found">
      <Logo />
      <h1>We couldn't find that page.</h1>
      <a href={newScanHref()} className="btn btn-primary">
        {inApp() ? "New scan" : "Back to the start"}
      </a>
    </main>
  );
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, scanRoute, guideRoute, briefRoute, ...legacyRoutes, dashboardRoute, proJoinRoute, ...pageRoutes, ...devRoutes]),
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
