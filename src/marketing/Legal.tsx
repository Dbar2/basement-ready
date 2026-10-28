// Shared layout for the Privacy and Terms pages: a contents list that follows
// your place on the page, and numbered, hairline-ruled sections.
import { useEffect, useState, type ReactNode } from "react";

export type LegalSection = { id: string; title: string; body: ReactNode };

export function LegalDoc({ sections }: { sections: LegalSection[] }) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter((e): e is HTMLElement => !!e);
    if (!("IntersectionObserver" in window) || els.length === 0) return;
    const seen = new Map<string, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.isIntersecting);
        const first = sections.find((s) => seen.get(s.id));
        if (first) setActive(first.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections]);

  return (
    <div className="mk-legal">
      <nav className="mk-toc" aria-label="On this page">
        <ol>
          {sections.map((s, i) => (
            <li key={s.id}>
              <a href={`#${s.id}`} aria-current={active === s.id ? "location" : undefined}>
                <span className="mk-toc-n">{String(i + 1).padStart(2, "0")}</span>
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="mk-legal-body">
        {sections.map((s, i) => (
          <section key={s.id} id={s.id} className="mk-clause" aria-labelledby={`${s.id}-h`}>
            <h2 id={`${s.id}-h`}>
              <span className="mk-clause-n" aria-hidden>
                {String(i + 1).padStart(2, "0")}
              </span>
              {s.title}
            </h2>
            {s.body}
          </section>
        ))}
      </div>
    </div>
  );
}
