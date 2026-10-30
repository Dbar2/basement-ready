// The full-page states around the camera: the brief, camera blocked, and camera problems.
import type { ReactNode } from "react";
import { MAX_SEC, MIN_SEC, TIPS } from "./checklist";
import { Icon } from "./drawing";
import { detectPlatform, type Platform, type ProblemKind } from "./media";

function Page({ eyebrow, title, onClose, children, actions }: { eyebrow: string; title: string; onClose: () => void; children: ReactNode; actions: ReactNode }) {
  return (
    <div className="cap-page">
      <header className="cap-page-bar">
        <span className="cap-eyebrow">{eyebrow}</span>
        <button className="cap-icon-btn" aria-label="Close" onClick={onClose}>
          <Icon.close />
        </button>
      </header>
      <div className="cap-page-body">
        <h1 className="cap-title" data-focus tabIndex={-1}>
          {title}
        </h1>
        {children}
      </div>
      <div className="cap-page-actions">{actions}</div>
    </div>
  );
}

type Common = { busy: boolean; onUpload: () => void; onClose: () => void };

// The brief, as three line drawings in the brand's plan style: forest lines, mint fills.
const HOW = [
  {
    title: "One take, the whole basement",
    body: "Walk it all, room to room, in one go. Stay about 2 m from the walls.",
    // A plan of connected rooms, the stairs in a corner, and one walk through all of it.
    art: (
      <>
        <rect x="10" y="12" width="12" height="16" className="how-fill" />
        <path d="M10 15.2h12M10 18.4h12M10 21.6h12M10 24.8h12" className="how-thin" />
        <path d="M6 8h76v48H6zM40 8v16M40 36v20M58 32h6M76 32h6" className="how-line" />
        <path d="M16 31c0 14 8 18 18 15s10-12 16-12 18 8 24 3-2-16-12-17-16 0-18 6" className="how-path" />
        <circle cx="44" cy="26" r="3.6" className="how-dot" />
      </>
    ),
  },
  {
    title: "Watch the map fill in",
    body: "A live map shows where you are and what's filmed. Dashed sides still need filming.",
    // The map from the filming screen: walls found, one side dashed, the camera and its view.
    art: (
      <>
        <path d="M74 10H14v44h60" className="how-line" />
        <path d="M74 10v44" className="how-path" />
        <path d="M50 32l15-9a17 17 0 0 1 0 18z" className="how-fill" />
        <circle cx="50" cy="32" r="3.6" className="how-dot" />
      </>
    ),
  },
  {
    title: "Just listen",
    body: "The guide talks you through it and says what it sees. Nothing to tap or answer.",
    // A speech bubble, and the guide's voice.
    art: (
      <>
        <path d="M8 10h50v28H28l-10 10V38H8z" className="how-fill how-line" />
        <path d="M16 19h34M16 27h22" className="how-line" />
        <path d="M66 18a14 14 0 0 1 0 20M73 12a22 22 0 0 1 0 32" className="how-line" />
      </>
    ),
  },
];

export function IntroPage({ recordable, busy, onStart, onUpload, onClose }: Common & { recordable: boolean; onStart: () => void }) {
  const ios = detectPlatform() === "ios-safari";
  return (
    <Page
      eyebrow={`Up to ${MAX_SEC / 60} minutes of filming`}
      title="Film it with a guide."
      onClose={onClose}
      actions={
        recordable ? (
          <>
            <p className="cap-fine" aria-live="polite">
              {busy
                ? "Tap Allow each time your phone asks."
                : `${ios ? "Allow the camera, mic and motion when your phone asks: motion is how we see what's filmed." : "Allow the camera and mic when your browser asks."} Turn your sound on to hear the guide. We use the 0.5× lens if your phone has one.`}
            </p>
            <button className="cap-btn cap-btn--primary" onClick={onStart} disabled={busy}>
              {busy ? "Waiting for the camera…" : "Start camera"} {!busy && <Icon.arrow />}
            </button>
            <button className="cap-btn cap-btn--ghost" onClick={onUpload} disabled={busy}>
              Upload a video
            </button>
          </>
        ) : (
          <>
            <p className="cap-fine">This browser can't film here. Film with your camera app, then upload the video.</p>
            <button className="cap-btn cap-btn--primary" onClick={onUpload} disabled={busy}>
              Upload a video <Icon.arrow />
            </button>
          </>
        )
      }
    >
      <ol className="cap-how">
        {HOW.map((h) => (
          <li key={h.title}>
            <svg viewBox="0 0 88 64" aria-hidden>
              {h.art}
            </svg>
            <span>
              <b>{h.title}</b>
              <span className="cap-muted">{h.body}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="cap-fine cap-fine--left">{TIPS.map((t) => t.label).join(" · ")} · at least {MIN_SEC} s</p>
    </Page>
  );
}

const FIXES: Record<Platform, { steps: string[]; more: string }> = {
  "ios-safari": {
    steps: [
      "Tap the page menu at the left of the address bar. It may show “aA”.",
      "Tap Website Settings.",
      "Set Camera and Microphone to Allow.",
      "Come back here and tap Try again.",
    ],
    more: "Still blocked? Open the Settings app, find Safari, then Camera, and choose Ask or Allow. Then reload this page.",
  },
  "ios-other": {
    steps: ["Open the Settings app.", "Find this browser in the list of apps.", "Turn on Camera and Microphone.", "Come back here and tap Try again."],
    more: "If nothing changes, close the browser fully and open this page again.",
  },
  android: {
    steps: ["Tap the icon to the left of the web address.", "Tap Permissions.", "Turn on Camera and Microphone.", "Come back here and tap Try again."],
    more: "If nothing changes, reload this page.",
  },
  desktop: {
    steps: ["Click the camera or site icon in the address bar.", "Allow the camera and microphone.", "Click Try again."],
    more: "If nothing changes, reload this page.",
  },
};

export function DeniedPage({ busy, onRetry, onUpload, onClose }: Common & { onRetry: () => void }) {
  const fix = FIXES[detectPlatform()];
  return (
    <Page
      eyebrow="Camera blocked"
      title="Turn the camera back on."
      onClose={onClose}
      actions={
        <>
          <button className="cap-btn cap-btn--primary" onClick={onRetry} disabled={busy}>
            {busy ? "Checking…" : "Try again"}
          </button>
          <button className="cap-btn cap-btn--ghost" onClick={onUpload} disabled={busy}>
            Upload a video instead
          </button>
        </>
      }
    >
      <p className="cap-lede">We need the camera and microphone to film your basement. Your browser is blocking them. Here's the fix:</p>
      <ol className="cap-shotlist cap-shotlist--steps">
        {fix.steps.map((s, i) => (
          <li key={s}>
            <span className="cap-num">{String(i + 1).padStart(2, "0")}</span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <p className="cap-muted cap-more">{fix.more}</p>
    </Page>
  );
}

const PROBLEMS: Record<Exclude<ProblemKind, "denied">, { title: string; body: string }> = {
  "no-camera": { title: "We couldn't find a camera.", body: "This device doesn't seem to have one we can use. You can upload a video you've already taken." },
  busy: { title: "The camera is busy.", body: "Another app or tab may be using it. Close it, then try again." },
  unsupported: { title: "This browser can't film here.", body: "Film with your camera app instead, then upload the video." },
  interrupted: {
    title: "Filming stopped early.",
    body: "The camera was interrupted, maybe by a call or by switching apps, before we had 30 seconds. Let's try that again.",
  },
  failed: { title: "The camera stopped working.", body: "Try again. If it keeps happening, film with your camera app and upload the video." },
};

export function ProblemPage({ kind, recordable, busy, onRetry, onUpload, onClose }: Common & { kind: Exclude<ProblemKind, "denied">; recordable: boolean; onRetry: () => void }) {
  const p = PROBLEMS[kind];
  const canRetry = recordable && kind !== "unsupported";
  return (
    <Page
      eyebrow="Camera problem"
      title={p.title}
      onClose={onClose}
      actions={
        <>
          {canRetry && (
            <button className="cap-btn cap-btn--primary" onClick={onRetry} disabled={busy}>
              {busy ? "Starting the camera…" : "Try again"}
            </button>
          )}
          <button className={`cap-btn ${canRetry ? "cap-btn--ghost" : "cap-btn--primary"}`} onClick={onUpload} disabled={busy}>
            Upload a video instead
          </button>
        </>
      }
    >
      <p className="cap-lede">{p.body}</p>
    </Page>
  );
}
