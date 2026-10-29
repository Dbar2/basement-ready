import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startScan, type AddressHit, type Household } from "../api";
import type { CaptureMeta } from "../capture/Capture";
import { AddressField, PropertyCard } from "../components/AddressStep";
import { AccountNav } from "../auth";
import { Capture } from "../capture";
import { HeroScan } from "../components/HeroScan";
import { Logo } from "../components/Logo";
import { SiteFooter } from "../marketing/parts";
import { NAV, PATHS } from "../marketing/site";

// Stored as relative | renter | unsure, the same values the server and the money section read.
const HOUSEHOLD: { id: Household; label: string }[] = [
  { id: "relative", label: "Parent or relative" },
  { id: "renter", label: "Rental" },
  { id: "unsure", label: "Not sure yet" },
];

const FEATURES = [
  { title: "Know what's legal", body: "Waterloo's rules and the building code, checked against your space." },
  { title: "See what needs to change", body: "A 3D scan and a clear fix list, with proof from your own video." },
  { title: "Find costs & grants", body: "Rough costs, the money you may get, and who nearby can build it." },
];

export function Start() {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [household, setHousehold] = useState<Household | null>(null);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<AddressHit | null>(null);
  const [upload, setUpload] = useState<{ progress: number; error: string | null } | null>(null);
  const [filming, setFilming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLDivElement>(null);

  // The page behind the sheet stays put, so Safari's toolbars don't resize the sheet mid-question.
  useEffect(() => {
    if (!asking) return;
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = overflow;
    };
  }, [asking]);

  const showWho = () => whoRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  useEffect(() => {
    if (picked) showWho();
  }, [picked]);

  const uploading = !!upload && !upload.error;
  const close = () => !uploading && setAsking(false);
  // Who it's for decides which grants fit, so it's asked before filming, not guessed later.
  const ready = () => {
    if (household) return true;
    setMissing(true);
    requestAnimationFrame(showWho);
    return false;
  };

  const begin = async (video: File, meta?: Pick<CaptureMeta, "rooms" | "ideas" | "spoken">) => {
    setUpload({ progress: 0, error: null });
    try {
      const where = picked
        ? { address: picked.address, addressMunicipality: picked.municipality, municipality: picked.city ?? "other-on" }
        : { address: "", municipality: "other-on" };
      const id = await startScan(video, { household: household ?? "unsure", ...where, ...meta }, (progress) =>
        setUpload({ progress, error: null }),
      );
      navigate({ to: "/scans/$scanId", params: { scanId: id } });
    } catch (err) {
      setUpload({ progress: 0, error: err instanceof Error ? err.message : "Upload failed." });
    }
  };

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

      {filming && (
        <Capture
          onComplete={(file, meta) => {
            setFilming(false);
            void begin(file, meta);
          }}
          onCancel={() => setFilming(false)}
        />
      )}

      {asking && (
        <div className="sheet-backdrop" onClick={close}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sheet-title"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.key === "Escape" && close()}
          >
            <button className="sheet-close" aria-label="Close" onClick={close} disabled={uploading}>
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
            <div className="sheet-body">
              <h2 id="sheet-title">Where's the house?</h2>
              <p className="sheet-lede">We look up your zoning and lot, so you don't have to.</p>
              <AddressField
                picked={picked}
                onPick={setPicked}
                help={!picked && "Outside Waterloo Region? Skip the address: we'll use Ontario's rules."}
              />
              {picked && <PropertyCard address={picked} onLoad={showWho} />}
              <div className="field" ref={whoRef} role="group" aria-labelledby="who-label" aria-describedby={missing && !household ? "who-error" : undefined}>
                <label id="who-label">Who's it for?</label>
                <div className="chips">
                  {HOUSEHOLD.map((h) => (
                    <button key={h.id} className="chip" aria-pressed={household === h.id} onClick={() => setHousehold(h.id)}>
                      {h.label}
                    </button>
                  ))}
                </div>
                {missing && !household && (
                  <p className="field-error" id="who-error" role="alert">
                    Pick one. Not sure yet is fine.
                  </p>
                )}
              </div>
            </div>
            {upload && uploading ? (
              <div className="sheet-foot upload" role="status">
                <div className="upload-bar"><span style={{ width: `${Math.round(upload.progress * 100)}%` }} /></div>
                <p className="mono">{upload.progress < 1 ? `Uploading your video · ${Math.round(upload.progress * 100)}%` : "Starting your scan…"}</p>
              </div>
            ) : (
              <div className="sheet-foot sheet-actions">
                {upload?.error && <p className="error" role="alert">{upload.error}</p>}
                <button className="btn btn-primary" onClick={() => ready() && setFilming(true)}>
                  Film my basement <span className="arrow" aria-hidden>→</span>
                </button>
                <button className="btn btn-ghost" onClick={() => ready() && fileRef.current?.click()}>Upload a video</button>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="video/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const video = e.target.files?.[0] ?? null;
                if (video) void begin(video);
              }}
            />
          </div>
        </div>
      )}
    </main>
  );
}
