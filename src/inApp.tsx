// Inside the iPhone app. Its web view ends the user agent with "BasementReadyApp/1"
// (ios/BasementReady/Result/ResultView.swift), and there the web never links to the website: "New scan"
// goes back to the app's own start screen through basementready://new, which the app opens itself.
export const APP_AGENT = "BasementReadyApp/";
export const APP_NEW_SCAN = "basementready://new";

export function inApp(agent: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return agent.includes(APP_AGENT);
}

// Where starting a new scan goes: the app's start screen in the app, the website's start in a browser.
export const newScanHref = () => (inApp() ? APP_NEW_SCAN : "/");

// "New scan" for a top bar, in the app only (the app's own bar with it gives way to ours).
export function AppNewScan({ className = "link-quiet" }: { className?: string }) {
  if (!inApp()) return null;
  return (
    <a className={className} href={APP_NEW_SCAN}>
      New scan
    </a>
  );
}
