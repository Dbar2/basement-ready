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

export function Logo() {
  return (
    <a className="logo" href="/" aria-label="Basement Ready home">
      <Mark />
      <span>Basement Ready</span>
    </a>
  );
}
