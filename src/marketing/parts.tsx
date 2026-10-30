// The shell and small pieces every marketing page uses: header, footer,
// page heading, source references, draft notice and the scroll reveal.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Logo, Mark } from "../components/Logo";
import { NAV, PATHS, SITE } from "./site";
import { SOURCES, type Source, type SourceId } from "./sources";
import "./marketing.css";

type PageProps = {
  path: string;
  // Names the page's own motion in marketing.css, e.g. "steps" or "ledger".
  motion: string;
  children: ReactNode;
};

export function MarketingPage({ path, motion, children }: PageProps) {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div className="mk" data-page={motion} ref={root}>
      <SiteHeader path={path} />
      <main className="mk-main" id="main">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

// Anything marked data-reveal gets data-in once it scrolls into view. CSS only
// hides those elements after this runs, so the page still reads without JS,
// and reduced-motion visitors see everything at once.
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const items = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]"));
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still || !("IntersectionObserver" in window)) {
      items.forEach((i) => (i.dataset.in = ""));
      return;
    }
    el.dataset.motion = "on";
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.in = "";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.15 },
    );
    items.forEach((i) => io.observe(i));
    return () => io.disconnect();
  }, [root]);
}

function SiteHeader({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  return (
    <header className="mk-header">
      <a className="mk-skip" href="#main">Skip to content</a>
      <Logo />
      <button
        className="mk-menu"
        aria-expanded={open}
        aria-controls="mk-nav"
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Close" : "Menu"}
      </button>
      <nav className="mk-nav" id="mk-nav" aria-label="Main" data-open={open || undefined}>
        {NAV.map((n) => (
          <a key={n.path} href={n.path} aria-current={n.path === path ? "page" : undefined}>
            {n.label}
          </a>
        ))}
        <a className="mk-nav-cta" href={PATHS.home}>
          Scan my basement
        </a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mk-footer">
      <div className="mk-footer-brand">
        <span className="mk-footer-mark" aria-hidden>
          <Mark />
        </span>
        <p>
          A screening aid, not a permit decision. The City decides. Basement Ready isn't run by or affiliated with any
          City, the Region of Waterloo or the Province.
        </p>
      </div>
      <nav className="mk-footer-links" aria-label="Footer">
        {NAV.map((n) => (
          <a key={n.path} href={n.path}>
            {n.label}
          </a>
        ))}
        <a href={PATHS.privacy}>Privacy</a>
        <a href={PATHS.terms}>Terms</a>
      </nav>
      <p className="mk-footer-small">
        Built in Waterloo, Ontario by {SITE.builder}. Free for homeowners. The code is open source.
      </p>
    </footer>
  );
}

type HeadProps = { title: ReactNode; lede: ReactNode; actions?: ReactNode; children?: ReactNode };

// children is the drawing beside the heading; actions sit under the lede.
export function PageHead({ title, lede, actions, children }: HeadProps) {
  return (
    <section className="mk-head">
      <div className="mk-head-copy">
        <h1>{title}</h1>
        <p className="mk-lede">{lede}</p>
        {actions && <div className="mk-head-actions">{actions}</div>}
      </div>
      {children && <div className="mk-head-art">{children}</div>}
    </section>
  );
}

export function Section({
  title,
  intro,
  id,
  children,
  className = "",
}: {
  title: ReactNode;
  intro?: ReactNode;
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mk-section ${className}`} id={id} aria-labelledby={id ? `${id}-h` : undefined}>
      <div className="mk-section-head">
        <h2 id={id ? `${id}-h` : undefined}>{title}</h2>
        {intro && <p>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

// ---------- Sources ----------
// A page lists its sources once; <Ref id> prints the matching number.

const CiteContext = createContext<SourceId[]>([]);

export function Cited({ ids, children }: { ids: SourceId[]; children: ReactNode }) {
  return <CiteContext.Provider value={ids}>{children}</CiteContext.Provider>;
}

export function Ref({ id }: { id: SourceId }) {
  const ids = useContext(CiteContext);
  const n = ids.indexOf(id) + 1;
  if (n === 0 && import.meta.env.DEV) console.warn(`Source "${id}" is cited but not in this page's list`);
  const s = SOURCES[id];
  return (
    <a className="mk-ref" href={`#src-${id}`} aria-label={`Source ${n}: ${s.title}, ${s.publisher}`}>
      {n}
    </a>
  );
}

export function SourceList({ title = "Sources" }: { title?: string }) {
  const ids = useContext(CiteContext);
  return (
    <section className="mk-sources" aria-labelledby="mk-sources-h">
      <h2 id="mk-sources-h">{title}</h2>
      <ol>
        {ids.map((id) => {
          const s: Source = SOURCES[id];
          return (
            <li key={id} id={`src-${id}`}>
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.title}
              </a>
              <span>
                {s.publisher}
                {s.section ? `, ${s.section}` : ""}
              </span>
              <span className="mk-date">Checked {s.retrieved}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ---------- Small pieces ----------

// `subject` carries its own verb: "This privacy policy is", "These terms are".
export function DraftNotice({ subject }: { subject: string }) {
  return (
    <div className="mk-draft" role="note">
      <span className="mk-draft-tag">Draft, pending legal review</span>
      <p>
        {subject} a draft written on {SITE.legalDraftDate}. A lawyer hasn't reviewed it yet. It says how we intend to
        work, and it will change before launch.
      </p>
    </div>
  );
}

export function Placeholder({ children }: { children: ReactNode }) {
  return <span className="mk-placeholder">[{children}]</span>;
}

export function ContactEmail() {
  return SITE.contactEmail ? (
    <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
  ) : (
    <Placeholder>contact email to come</Placeholder>
  );
}

export function ScanCta({ title = "Could your basement be a home?" }: { title?: string }) {
  return (
    <section className="mk-cta" data-reveal>
      <h2>{title}</h2>
      <p>Free for homeowners. You film for up to 5 minutes.</p>
      <a className="btn btn-primary" href={PATHS.home}>
        Scan my basement <span className="arrow" aria-hidden>→</span>
      </a>
    </section>
  );
}
