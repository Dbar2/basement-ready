// The start sheet: where the house is (or the demo house, for anyone outside Ontario), who it's for,
// then film, upload a video, or add 5–20 photos, each tagged with its room. Today's allowance is
// checked before anyone films (server/limits.ts), and a take the server turns away is never lost: it
// stays on this page to send again (a video can also be saved to the phone).
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { getAllowance, MAX_PHOTOS, MIN_PHOTOS, startPhotoScan, startScan, type AddressHit, type Allowance, type Household, type Who } from "../api";
import type { CaptureMeta } from "../capture/Capture";
import { shrinkPhoto } from "../capture/photos";
import { AddressField, PropertyCard } from "../components/AddressStep";
import { defaultRoom, inRoomOrder, PhotoPicker, roomNames, type Picked, type PhotoTakeDraft } from "../components/PhotoPicker";
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
  // A photo take, while it's put together; `view` is the sheet's page: the house, or the photos.
  const [take, setTake] = useState<PhotoTakeDraft | null>(null);
  const [view, setView] = useState<"start" | "photos">("start");
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const whoRef = useRef<HTMLDivElement>(null);
  // Which room the photos being picked go to, and every thumbnail made, to let go of them at the end.
  const addTo = useRef(0);
  const nextId = useRef(1);
  const urls = useRef(new Set<string>());

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
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

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

  const where = () => ({
    who: who?.id ?? "unsure",
    household: who?.household ?? "unsure",
    ...(demo
      ? { address: "", municipality: "waterloo-on", demo: true }
      : picked
        ? { address: picked.address, addressMunicipality: picked.municipality, municipality: picked.city ?? "other-on" }
        : { address: "", municipality: "other-on" }),
  });

  const send = async (start: (onProgress: (progress: number) => void) => Promise<string>) => {
    setUpload({ progress: 0, error: null });
    try {
      const id = await start((progress) => setUpload({ progress, error: null }));
      navigate({ to: "/scans/$scanId", params: { scanId: id } });
    } catch (err) {
      const refused = (err as { allowance?: Allowance | null }).allowance;
      if (refused) setAllowed(refused);
      setUpload({ progress: 0, error: err instanceof Error ? err.message : "Upload failed." });
    }
  };

  const begin = async (video: File, meta?: Meta) => {
    setKept((k) => (k?.video === video ? k : { video, meta, url: URL.createObjectURL(video) }));
    await send((onProgress) => startScan(video, { ...where(), ...meta }, onProgress));
  };

  // Photos picked for a room: added at once, then made small one by one (src/capture/photos.ts).
  const addPhotos = async (files: File[]) => {
    const room = addTo.current;
    const have = take?.photos.length ?? 0;
    const fits = files.slice(0, Math.max(0, MAX_PHOTOS - have));
    setPhotoNote(fits.length < files.length ? `Up to ${MAX_PHOTOS} photos, so we kept the first ${have + fits.length}.` : null);
    if (!fits.length) return;
    const added: Picked[] = fits.map((file) => ({ id: nextId.current++, file, blob: null, url: null, room, state: "working" }));
    setTake((t) => {
      const base = t ?? { photos: [], rooms: [defaultRoom(0)] };
      const rooms = room < base.rooms.length ? base.rooms : [...base.rooms, defaultRoom(base.rooms.length)];
      return { rooms, photos: [...base.photos, ...added] };
    });
    setView("photos");
    for (const p of added) {
      const blob = await shrinkPhoto(p.file);
      const url = blob ? URL.createObjectURL(blob) : null;
      if (url) urls.current.add(url);
      setTake((t) => t && { ...t, photos: t.photos.map((x) => (x.id === p.id ? { ...x, blob, url, state: blob ? "ready" : "raw" } : x)) });
    }
  };
  const removePhoto = (p: Picked) => {
    if (p.url) {
      URL.revokeObjectURL(p.url);
      urls.current.delete(p.url);
    }
    setPhotoNote(null);
    setTake((t) => t && { ...t, photos: t.photos.filter((x) => x.id !== p.id) });
  };
  // The library opens inside the tap itself, so this goes on the allowance checked when the sheet opened.
  const pickPhotos = (room: number) => {
    if (!hasWho()) return;
    addTo.current = room;
    photoRef.current?.click();
  };
  const sendPhotos = async () => {
    if (!take || !(await ready())) return;
    const names = roomNames(take);
    const photos = inRoomOrder(take).map((p) => ({ blob: p.blob ?? p.file, room: names[p.room] }));
    await send((onProgress) => startPhotoScan(photos, where(), onProgress));
  };
  const photoCount = take?.photos.length ?? 0;
  const photosWorking = take?.photos.some((p) => p.state === "working") ?? false;
  const roomsUsed = take ? new Set(take.photos.map((p) => p.room)).size : 0;

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
            {view === "photos" && take ? (
              <PhotoPicker take={take} onChange={setTake} onAdd={pickPhotos} onRemove={removePhoto} onBack={() => setView("start")} note={photoNote} />
            ) : (
              <>
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
              </>
            )}
          </div>
          {upload && uploading ? (
            <div className="sheet-foot upload" role="status">
              <div className="upload-bar"><span style={{ width: `${Math.round(upload.progress * 100)}%` }} /></div>
              <p className="mono">{upload.progress < 1 ? `Uploading your ${view === "photos" ? "photos" : "video"} · ${Math.round(upload.progress * 100)}%` : "Starting your scan…"}</p>
            </div>
          ) : view === "photos" && take ? (
            <div className="sheet-foot sheet-actions photo-foot">
              {blocked && allowed?.message ? (
                <p className="sheet-limit" role="alert">{allowed.message}</p>
              ) : upload?.error ? (
                <p className="error" role="alert">{upload.error}</p>
              ) : (
                <p className="photo-count mono">
                  {photoCount} of {MIN_PHOTOS}–{MAX_PHOTOS} photos{roomsUsed > 1 ? ` · ${roomsUsed} rooms` : ""}
                </p>
              )}
              {blocked ? (
                <button className="btn btn-primary" onClick={() => navigate(toSample)}>
                  See the example <span className="arrow" aria-hidden>→</span>
                </button>
              ) : (
                <button className="btn btn-primary" disabled={photoCount < MIN_PHOTOS || photosWorking} onClick={() => void sendPhotos()}>
                  {photosWorking ? "Getting your photos ready…" : photoCount < MIN_PHOTOS ? `Add ${MIN_PHOTOS - photoCount} more` : upload?.error ? "Send them again" : "Check my basement"}
                  {!photosWorking && photoCount >= MIN_PHOTOS && <span className="arrow" aria-hidden>→</span>}
                </button>
              )}
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
                  {take && photoCount > 0 ? (
                    <button className="btn btn-ghost" onClick={() => setView("photos")}>
                      Your {photoCount} photos <span className="arrow" aria-hidden>→</span>
                    </button>
                  ) : (
                    <button className="btn btn-ghost" disabled={allowed === undefined} onClick={() => pickPhotos(0)}>
                      Add photos
                    </button>
                  )}
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
          {/* Photos from the library, several at once: no `capture`, so a phone offers its library. */}
          <input
            ref={photoRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              const files = [...(e.target.files ?? [])];
              e.target.value = "";
              if (files.length) void addPhotos(files);
            }}
          />
        </div>
      </div>
    </>
  );
}
