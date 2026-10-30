import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { startScan, type AddressHit, type Household, type Who } from "../api";
import type { CaptureMeta } from "../capture/Capture";
import { AddressField, PropertyCard } from "../components/AddressStep";
import { Capture } from "../capture";
import { Home } from "../marketing/Home";
import "../styles/ask.css";

// Who it's for, with the rent folded in: asked once, here, and never again. The server saves it as the
// household (relative | renter | unsure) plus the rent answer the money reads (server/eligibility.ts
// fromWho), so the wait screen and the result skip both.
const WHO: { id: Who; label: string; household: Household }[] = [
  { id: "family", label: "Family, no rent", household: "relative" },
  { id: "rental_capped", label: "Rental, about $1,200/mo or less", household: "renter" },
  { id: "rental_market", label: "Rental at market rent", household: "renter" },
  { id: "unsure", label: "Not sure", household: "unsure" },
];

export function Start() {
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  const [who, setWho] = useState<(typeof WHO)[number] | null>(null);
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
    if (who) return true;
    setMissing(true);
    requestAnimationFrame(showWho);
    return false;
  };

  const begin = async (video: File, meta?: Pick<CaptureMeta, "rooms" | "ideas" | "spoken" | "lens" | "wideAt">) => {
    setUpload({ progress: 0, error: null });
    try {
      const where = picked
        ? { address: picked.address, addressMunicipality: picked.municipality, municipality: picked.city ?? "other-on" }
        : { address: "", municipality: "other-on" };
      const id = await startScan(video, { who: who?.id ?? "unsure", household: who?.household ?? "unsure", ...where, ...meta }, (progress) =>
        setUpload({ progress, error: null }),
      );
      navigate({ to: "/scans/$scanId", params: { scanId: id } });
    } catch (err) {
      setUpload({ progress: 0, error: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  return (
    <main className="home">
      <Home onCheck={() => setAsking(true)} />

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
              <div className="field" ref={whoRef} role="group" aria-labelledby="who-label" aria-describedby={missing && !who ? "who-error" : "who-help"}>
                <label id="who-label">Who's it for?</label>
                <div className="who-options">
                  {WHO.map((w) => (
                    <button key={w.id} className="chip who-option" aria-pressed={who?.id === w.id} onClick={() => setWho(w)}>
                      {w.label}
                    </button>
                  ))}
                </div>
                {missing && !who ? (
                  <p className="field-error" id="who-error" role="alert">
                    Pick one. Not sure is fine.
                  </p>
                ) : (
                  <p className="field-help" id="who-help">Rent decides which grants fit. We won't ask again.</p>
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
