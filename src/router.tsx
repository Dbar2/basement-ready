import { createRootRoute, createRoute, createRouter, Link, Outlet } from "@tanstack/react-router";
import { Logo } from "./components/Logo";
import { Dashboard } from "./screens/Dashboard";
import { ScanPage } from "./screens/ScanPage";
import { Start } from "./screens/Start";

const rootRoute = createRootRoute({ component: Outlet });

const homeRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: Start });

export const scanRoute = createRoute({ getParentRoute: () => rootRoute, path: "/scans/$scanId", component: ScanPage });

const dashboardRoute = createRoute({ getParentRoute: () => rootRoute, path: "/dashboard", component: Dashboard });

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
  routeTree: rootRoute.addChildren([homeRoute, scanRoute, dashboardRoute]),
  defaultNotFoundComponent: NotFound,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
