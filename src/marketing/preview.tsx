// Views the marketing pages without the app router.
// Run `pnpm dev:web` and open /src/marketing/preview.html?page=/faq
// Links between pages are caught here and swapped in place.
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { applyRouteMeta, findMarketingRoute, marketingRoutes } from "./routes";
import "../styles/global.css";

function currentPath() {
  return new URLSearchParams(location.search).get("page") ?? marketingRoutes[0].path;
}

function Preview() {
  const [path, setPath] = useState(currentPath);
  const route = findMarketingRoute(path) ?? marketingRoutes[0];

  useEffect(() => applyRouteMeta(route), [route]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element).closest("a");
      const href = a?.getAttribute("href");
      if (!href || e.metaKey || e.ctrlKey || a?.target) return;
      const [p, hash] = href.split("#");
      if (!p || !findMarketingRoute(p)) return;
      e.preventDefault();
      history.pushState(null, "", `?page=${p}${hash ? `#${hash}` : ""}`);
      setPath(p);
      window.scrollTo(0, 0);
    };
    const onPop = () => setPath(currentPath());
    document.addEventListener("click", onClick);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  const Page = route.component;
  return <Page key={route.path} />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
