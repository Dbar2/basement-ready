import { useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { startScan, type Household } from "../api";
import { HeroScan } from "../components/HeroScan";
import { AccountNav } from "../auth";
import { Logo } from "../components/Logo";

const CITIES: { id: string; label: string }[] = [
  { id: "waterloo-on", label: "Waterloo" },
  { id: "kitchener-on", label: "Kitchener" },
  { id: "cambridge-on", label: "Cambridge" },
  { id: "other-on", label: "Elsewhere in Ontario" },
];

const HOUSEHOLD: { id: Household; label: string }[] = [
  { id: "relative", label: "A parent or relative" },
  { id: "renter", label: "A renter" },
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
  const [household, setHousehold] = useState<Household>("relative");
  const [municipality, setMunicipality] = useState("waterloo-on");
  const [address, setAddress] = useState("");
  const [upload, setUpload] = useState<{ progress: number; error: string | null } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const begin = async (video: File) => {
    setUpload({ progress: 0, error: null });
    try {
      const id = await startScan(video, { household, address, municipality }, (progress) => setUpload({ progress, error: null }));
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
          <a href="#how">How it works</a>
          <a href="#become">What we check</a>
          <a href="#features">Grants</a>
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
              Scan my basement <span className="arrow" aria-hidden>→</span>
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

      {asking && (
        <div className="sheet-backdrop" onClick={() => !upload && setAsking(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="sheet-title">Two quick things.</h2>
            <div className="field">
              <label>Who's it for?</label>
              <div className="chips">
                {HOUSEHOLD.map((h) => (
                  <button key={h.id} className="chip" aria-pressed={household === h.id} onClick={() => setHousehold(h.id)}>
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Where is the house?</label>
              <div className="chips">
                {CITIES.map((c) => (
                  <button key={c.id} className="chip" aria-pressed={municipality === c.id} onClick={() => setMunicipality(c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="address">Your address</label>
              <input
                id="address"
                className="input"
                placeholder="Street address (optional)"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                autoComplete="street-address"
              />
            </div>
            {upload && !upload.error ? (
              <div className="upload" role="status">
                <div className="upload-bar"><span style={{ width: `${Math.round(upload.progress * 100)}%` }} /></div>
                <p className="mono">{upload.progress < 1 ? `Uploading your video · ${Math.round(upload.progress * 100)}%` : "Starting your scan…"}</p>
              </div>
            ) : (
              <div className="sheet-actions">
                <button className="btn btn-primary" onClick={() => fileRef.current?.click()}>
                  Film or choose a video <span className="arrow" aria-hidden>→</span>
                </button>
                <button className="link-quiet" onClick={() => setAsking(false)}>Not now</button>
              </div>
            )}
            {upload?.error && <p className="error" role="alert">{upload.error}</p>}
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
