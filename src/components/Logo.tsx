import { inApp } from "../inApp";

// The B of Basement with a house cut out of its lower half. Source: brand/logo/mark.svg
export function Mark({ title = "Basement Ready" }: { title?: string }) {
  return (
    <svg viewBox="0 0 100 120" role="img" aria-label={title}>
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M0 0H56C76 0 90 13 90 30C90 42 84 50 76 55C90 60 98 72 98 87C98 106 84 120 62 120H0Z M12 120V84L39 61L66 84V120Z"
      />
      <rect x="31" y="92" width="16" height="28" fill="currentColor" />
    </svg>
  );
}

// The website's logo goes to the website's home. On a basement's pages, pass its home base (`/scans/:id`):
// there it never leaves the app. Inside the iPhone app the website is never linked, so a logo that would go
// there is just the logo.
export function Logo({ href = "/" }: { href?: string }) {
  if (href === "/" && inApp())
    return (
      <span className="logo">
        <Mark />
        <span>Basement Ready</span>
      </span>
    );
  return (
    <a className="logo" href={href} aria-label={href === "/" ? "Basement Ready home" : "Your basement"}>
      <Mark />
      <span>Basement Ready</span>
    </a>
  );
}
