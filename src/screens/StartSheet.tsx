// The start sheet: where the house is (or the demo house, for anyone outside Ontario), who it's for,
// then film or upload. Today's allowance is checked before anyone films (server/limits.ts), and a take
// the server turns away is never lost: it stays on this page to send again, or to save to the phone.
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getAllowance, startScan, type AddressHit, type Allowance, type Household, type Who } from "../api";
import type { CaptureMeta } from "../capture/Capture";
import { AddressField, PropertyCard } from "../components/AddressStep";
import { Capture } from "../capture";
import "../styles/ask.css";
import "../styles/journey.css";

// Who it's for, with the rent folded in: asked once, here, and never again. The server saves it as the
// household (relative | renter | unsure) plus the rent answer the money reads (server/eligibility.ts
// fromWho), so the wait screen and the result skip both.
const WHO: { id: Who; label: string; household: Household }[] = [
  { id: "family", label: "Family, no rent", household: "relative" },
  { id: "rental_capped", label: "Rental, about $1,200/mo or less", household: "renter" },
  { id: "rental_market", label: "Rental at market rent", household: "renter" },
  { id: "unsure", label: "Not sure", household: "unsure" },
];

type Meta = Pick<CaptureMeta, "rooms" | "ideas" | "spoken" | "lens" | "wideAt">;

const toSample = { to: "/scans/$scanId", params: { scanId: "sample" } } as const;

export function StartSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [who, setWho] = useState<(typeof WHO)[number] | null>(null);
  const [missing, setMissing] = useState(false);
  const [picked, setPicked] = useState<AddressHit | null>(null);
  const [demo, setDemo] = useState(false);
  const [upload, setUpload] = useState<{ progress: number; error: string | null } | null>(null);
  const [filming, setFilming] = useState(false);
  // undefined while it's checked; null when it couldn't be (the upload checks again anyway).
  const [allowed, setAllowed] = useState<Allowance | null | undefined>(undefined);
  // The take, kept until the server has it.
  const [kept, setKept] = useState<{ video: File; meta?: Meta; url: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLDivElement>(null);

  // The page behind the sheet stays put, so Safari's toolbars don't resize the sheet mid-question.
  useEffect(() => {
    const html = document.documentElement;
    const overflow = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    void getAllowance().then(setAllowed);
  }, []);
  useEffect(() => () => { if (kept) URL.revokeObjectURL(kept.url); }, [kept]);

  const showWho = () => whoRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  useEffect(() => {
    if (picked) showWho();
  }, [picked]);

  const uploading = !!upload && !upload.error;
  const close = () => !uploading && onClose();
  const blocked = allowed ? !allowed.ok : false;
  // Who it's for decides which grants fit, so it's asked before filming, not guessed later.
  const hasWho = () => {
    if (who) return true;
    setMissing(true);
    requestAnimationFrame(showWho);
    return false;
  };
  // And nobody films a take today's limit won't read: checked again right before.
  const ready = async () => {
    if (!hasWho()) return false;
    const now = await getAllowance();
    if (now) setAllowed(now);
    return !now || now.ok;
  };

  const begin = async (video: File, meta?: Meta) => {
    setKept((k) => (k?.video === video ? k : { video, meta, url: URL.createObjectURL(video) }));
    setUpload({ progress: 0, error: null });
    try {
      const where = demo
        ? { address: "", municipality: "waterloo-on", demo: true }
        : picked
          ? { address: picked.address, addressMunicipality: picked.municipality, municipality: picked.city ?? "other-on" }
          : { address: "", municipality: "other-on" };
      const id = await startScan(video, { who: who?.id ?? "unsure", household: who?.household ?? "unsure", ...where, ...meta }, (progress) =>
        setUpload({ progress, error: null }),
      );
      navigate({ to: "/scans/$scanId", params: { scanId: id } });
    } catch (err) {
      const refused = (err as { allowance?: Allowance | null }).allowance;
      if (refused) setAllowed(refused);
      setUpload({ progress: 0, error: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  const ext = kept?.video.type.includes("quicktime") ? "mov" : kept?.video.type.includes("webm") ? "webm" : "mp4";

  return (
    <>
      {filming && (
        <Capture
          onComplete={(file, meta) => {
            setFilming(false);
            void begin(file, meta);
          }}
          onCancel={() => setFilming(false)}
        />
      )}

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
            {demo ? (
              <>
                <p className="sheet-lede">No address needed: the demo house uses the City of Waterloo's rules.</p>
                <div className="demo-card" role="note">
                  <span className="tag-mono">Demo house</span>
                  <p>No real address, nothing sent anywhere. Film any room you like: the camera, the finds and the 3D work anywhere.</p>
                  <button className="link-quiet" onClick={() => setDemo(false)}>Use a real Ontario address instead</button>
                </div>
              </>
            ) : (
              <>
                <p className="sheet-lede">We look up your zoning and lot, so you don't have to.</p>
                <AddressField
                  picked={picked}
                  onPick={setPicked}
                  help={!picked && "Any Ontario address. Skip it and we'll use Ontario's rules."}
                />
                {picked && <PropertyCard address={picked} onLoad={showWho} />}
                {!picked && (
                  <button
                    className="link-quiet demo-link"
                    onClick={() => {
                      setDemo(true);
                      setPicked(null);
                    }}
                  >
                    Not in Ontario? Use a demo house in Waterloo
                  </button>
                )}
              </>
            )}
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
              {blocked && allowed?.message ? (
                <p className="sheet-limit" role="alert">{allowed.message}</p>
              ) : (
                upload?.error && <p className="error" role="alert">{upload.error}</p>
              )}
              {kept && (
                <p className="sheet-kept">
                  Your video is safe on this page.{" "}
                  <a href={kept.url} download={`basement-take.${ext}`}>Save it to your device</a> to send later.
                </p>
              )}
              {blocked ? (
                <>
                  <button className="btn btn-primary" onClick={() => navigate(toSample)}>
                    See the example <span className="arrow" aria-hidden>→</span>
                  </button>
                  {kept && (
                    <button className="btn btn-ghost" onClick={() => void ready().then((ok) => void (ok && begin(kept.video, kept.meta)))}>
                      Send it again
                    </button>
                  )}
                </>
              ) : kept ? (
                <>
                  <button className="btn btn-primary" onClick={() => void ready().then((ok) => void (ok && begin(kept.video, kept.meta)))}>
                    Send it again <span className="arrow" aria-hidden>→</span>
                  </button>
                  <button className="btn btn-ghost" onClick={() => void ready().then((ok) => ok && setFilming(true))}>Film again</button>
                </>
              ) : (
                <>
                  <button className="btn btn-primary" disabled={allowed === undefined} onClick={() => void ready().then((ok) => ok && setFilming(true))}>
                    Film my basement <span className="arrow" aria-hidden>→</span>
                  </button>
                  {/* The file picker has to open inside the tap itself, so it goes on the allowance checked when the sheet opened. */}
                  <button className="btn btn-ghost" disabled={allowed === undefined} onClick={() => hasWho() && fileRef.current?.click()}>
                    Upload a video
                  </button>
                </>
              )}
            </div>
          )}
          {/* No `capture`: on a phone this opens the library, so a take filmed earlier can be picked. */}
          <input
            ref={fileRef}
            type="file"
            accept="video/*"
            hidden
            onChange={(e) => {
              const video = e.target.files?.[0] ?? null;
              e.target.value = "";
              if (video) void begin(video);
            }}
          />
        </div>
      </div>
    </>
  );
}
