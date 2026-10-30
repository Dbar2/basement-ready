import { createRootRoute, createRoute, createRouter, lazyRouteComponent, Link, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { Logo } from "./components/Logo";
import { ContactEmail, MarketingPage, PageHead } from "./marketing/parts";
import { applyRouteMeta, marketingRoutes, type MarketingRoute } from "./marketing/routes";
import { PATHS } from "./marketing/site";
import { Brief } from "./screens/Brief";
import { Dashboard } from "./screens/Dashboard";
import { ScanPage } from "./screens/ScanPage";
import { Start } from "./screens/Start";

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Start });

export const scanRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId", component: ScanPage });

// The one-page plan to hand a designer, made to print or save as a PDF.
const briefRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/brief", component: Brief });

// The flow after the upload (src/flow/flow.ts): while it measures, /scans/:id is the wait screen with
// the style deck; then each step has its own page, and the book is the workspace's first tab. Each
// step loads with its page, so the home page stays light.
const StylePage = lazyRouteComponent(() => import("./flow/StylePage"), "StylePage");
const PlanConfirm = lazyRouteComponent(() => import("./studio/PlanConfirm"), "PlanConfirm");
const LayoutsPage = lazyRouteComponent(() => import("./flow/LayoutsPage"), "LayoutsPage");
const Studio = lazyRouteComponent(() => import("./studio/Studio"), "Studio");
const PicturesPage = lazyRouteComponent(() => import("./views/PicturesPage"), "PicturesPage");
const styleRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/style", component: StylePage });
// "Is this your basement?", then the layouts, then the design in 3D (src/studio).
const planRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/plan", component: PlanConfirm });
const layoutsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/layouts", component: LayoutsPage });
const studioRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/studio", component: Studio });
// Pictures of the design from the scan's best real angles, all agreeing (src/views/DesignPictures.tsx).
const picturesRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/pictures", component: PicturesPage });
// Older links: the ideas page is the style step now, and the book is the workspace's first tab.
const ideasRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/ideas", beforeLoad: ({ params }) => { throw redirect({ href: `/scans/${params.scanId}/style` }); } });
const bookRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId/book", beforeLoad: ({ params }) => { throw redirect({ href: `/scans/${params.scanId}?tab=book` }); } });

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
  ? [createRoute({ getParentRoute: () => rootRoute, path: "/dev/ui", component: lazyRouteComponent(() => import("./dev/UiReference"), "UiReference") })]
  : [];

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
  routeTree: rootRoute.addChildren([homeRoute, scanRoute, briefRoute, styleRoute, planRoute, layoutsRoute, studioRoute, picturesRoute, ideasRoute, bookRoute, dashboardRoute, proJoinRoute, ...pageRoutes, ...devRoutes]),
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
