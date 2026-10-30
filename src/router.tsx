import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "./components/Logo";
import { ContactEmail, MarketingPage, PageHead } from "./marketing/parts";
import { applyRouteMeta, marketingRoutes, type MarketingRoute } from "./marketing/routes";
import { PATHS } from "./marketing/site";
import { IdeasPage } from "./ideas/IdeasPage";
import { Brief } from "./screens/Brief";
import { Dashboard } from "./screens/Dashboard";
import { ScanPage } from "./screens/ScanPage";
import { Start } from "./screens/Start";
import { PlanConfirm } from "./studio/PlanConfirm";
import { Studio } from "./studio/Studio";
import { PicturesPage } from "./views/PicturesPage";

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Start });

export const scanRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId", component: ScanPage });

// The one-page plan to hand a designer, made to print or save as a PDF.
const briefRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/brief", component: Brief });

// "Is this your basement?", then the design in 3D (src/studio).
const planRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/plan", component: PlanConfirm });
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/studio", component: Studio });
// Pictures of the design from the scan's best real angles, all agreeing (src/views/DesignPictures.tsx).
const picturesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/pictures", component: PicturesPage });
// Swipe your style, then pick a layout: on its own page until the wait screen deals the deck.
const ideasRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/ideas", component: IdeasPage });
// The book: the design, pictures, quote, permit readiness, money and timeline, with its PDF. Loaded
// on its own, so the price catalog the quote carries stays out of the first page's download.
const bookRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/book", component: lazyRouteComponent(() => import("./book/BookPage"), "BookPage") });

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

function NotFound() {
  return (
    <main className="not-found">
      <Logo />
      <h1>We couldn't find that page.</h1>
      <Link to="/" className="btn btn-primary">Back to the start</Link>
    </main>
  );
}

export const router = createRouter({
  routeTree: rootRoute.addChildren([homeRoute, scanRoute, briefRoute, planRoute, studioRoute, picturesRoute, ideasRoute, bookRoute, dashboardRoute, proJoinRoute, ...pageRoutes]),
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
