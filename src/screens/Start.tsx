import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AccountNav } from "../auth";
import { HeroScan } from "../components/HeroScan";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../marketing/parts";
import { NAV, PATHS } from "../marketing/site";
import { StartSheet } from "./StartSheet";

const FEATURES = [
  { title: "Know what's legal", body: "Waterloo's rules and the building code, checked against your space." },
  { title: "See what needs to change", body: "A 3D scan and a clear fix list, with proof from your own video." },
  { title: "Find costs & grants", body: "Rough costs, the money you may get, and who nearby can build it." },
];

export function Start() {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  return (
    <main className="home">
      <header className="nav">
        <Logo />
        <nav className="nav-links" aria-label="Main">
          {NAV.filter((n) => n.path !== PATHS.about).map((n) => (
            <a key={n.path} href={n.path}>{n.label}</a>
          ))}
          <AccountNav />
        </nav>
      </header>

      <section className="hero">
        <HeroScan />
        <div className="hero-copy">
          <h1>Could your basement be a home?</h1>
          <p className="sub">
            Film your basement. Understand what's possible.
            <small>Check the rules, plan the changes, estimate costs and discover grants.</small>
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary" onClick={() => setAsking(true)}>
              Check my basement <span className="arrow" aria-hidden>→</span>
            </button>
            <button className="link-quiet" onClick={() => navigate({ to: "/scans/$scanId", params: { scanId: "sample" } })}>
              Try a sample basement
            </button>
          </div>
          <span className="step-label" id="how">
            <span className="mono">01 /</span> Your basement, scanned
          </span>
        </div>
      </section>

      <section className="become" id="become">
        <div className="become-head">
          <h2>What it could become.</h2>
          <p>
            <span className="step-label"><span className="mono">02 /</span> Your space, finished</span>
            <br />
            Walk through a legal second unit in your own basement, with the real windows and stairs where they
            are, and see what each change costs.
          </p>
        </div>
        <div className="cutaway">
          <img src="/img/cutaway-suite.jpg" alt="A cutaway of a finished basement apartment: living room, kitchen, stairs, bedroom and bathroom." />
          <div className="callout" style={{ left: "17%", top: "38%", animationDelay: "0.3s" }}>
            <span className="tag">Egress window <b>0.38 m²</b></span>
          </div>
          <div className="callout" style={{ left: "44%", top: "30%", animationDelay: "0.5s" }}>
            <span className="tag">Fire-rated ceiling <b>45 min</b></span>
          </div>
          <div className="callout" style={{ left: "70%", top: "62%", animationDelay: "0.7s" }}>
            <span className="tag">Bedroom <b>11.2 m²</b></span>
          </div>
        </div>
      </section>

      <section className="features" id="features">
        {FEATURES.map((f, i) => (
          <div className="feature" key={f.title}>
            <span className="num">0{i + 1}</span>
            <div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          </div>
        ))}
      </section>

      <SiteFooter />

      {/* The start sheet: the address or the demo house, who it's for, then film or upload. */}
      {asking && <StartSheet onClose={() => setAsking(false)} />}
    </main>
  );
}
