// The full-page states around the camera: the brief, camera blocked, and camera problems.
import type { ReactNode } from "react";
import { MAX_SEC, MIN_SEC, TIPS } from "./checklist";
import { Icon } from "./drawing";
import { detectPlatform, formatTime, type Platform, type ProblemKind } from "./media";

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
    title: "Paint it all green",
    body: "Walls, ceiling and the floor by the walls fill in on screen as you film. Tilt up and down to finish them.",
    // The unrolled basement from the filming screen: ceiling above, three wall bands, floor below.
    art: (
      <>
        {Array.from({ length: 8 }, (_, c) => {
          const x = 4 + c * 10;
          const on = (row: number) => (row === 0 ? c >= 1 && c <= 3 : row === 4 ? c <= 2 : c <= 4);
          return (
            <g key={c}>
              <path d={`M${x} 14h9l-1.5-9h-6z`} className={on(0) ? "how-fill" : "how-empty"} />
              {[16, 27, 38].map((y, i) => (
                <rect key={y} x={x} y={y} width="9" height="9.5" className={on(i + 1) ? "how-fill" : "how-empty"} />
              ))}
              <path d={`M${x} 49h9l-1.5 9h-6z`} className={on(4) ? "how-fill" : "how-empty"} />
            </g>
          );
        })}
        <path d="M32 19v-5h5M50 14h5v5M32 44v5h5M50 49h5v-5" className="how-line" />
      </>
    ),
  },
  {
    title: "Say what you'd like",
    body: "The guide talks you through it and asks as you go. Not sure yet? Tap an idea.",
    // A speech bubble, and a phone listening.
    art: (
      <>
        <path d="M8 10h50v28H28l-10 10V38H8z" className="how-fill how-line" />
        <path d="M16 19h34M16 27h22" className="how-line" />
        <rect x="64" y="14" width="16" height="38" rx="3" className="how-line" />
        <path d="M68.5 38v4M72 34v8M75.5 36v6" className="how-line" />
      </>
    ),
  },
];

export function IntroPage({ recordable, busy, onStart, onUpload, onClose }: Common & { recordable: boolean; onStart: () => void }) {
  const ios = detectPlatform() === "ios-safari";
  return (
    <Page
      eyebrow={`About ${formatTime(MAX_SEC)} of filming`}
      title="Film it with a guide."
      onClose={onClose}
      actions={
        recordable ? (
          <>
            <button className="cap-btn cap-btn--primary" onClick={onStart} disabled={busy}>
              {busy ? "Waiting for the camera…" : "Start camera"} {!busy && <Icon.arrow />}
            </button>
            <button className="cap-btn cap-btn--ghost" onClick={onUpload} disabled={busy}>
              Upload a video instead
            </button>
            <p className="cap-fine" aria-live="polite">
              {busy
                ? "Tap Allow each time your phone asks."
                : `${ios ? "Allow the camera, mic and motion when your phone asks: motion is how we see what's filmed." : "Allow the camera and mic when your browser asks."} Turn your sound on to hear the guide. We use the 0.5× lens if your phone has one.`}
            </p>
          </>
        ) : (
          <>
            <button className="cap-btn cap-btn--primary" onClick={onUpload} disabled={busy}>
              Upload a video <Icon.arrow />
            </button>
            <p className="cap-fine">This browser can't film here. Film with your camera app, then upload the video.</p>
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
