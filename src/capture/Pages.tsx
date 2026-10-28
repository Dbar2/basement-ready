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

const HOW = [
  {
    title: "One room at a time",
    body: "Walk slowly along the walls, about 2 m back, facing into the room.",
    icon: <path d="M6 30V12h28v18M3 30h34M14 22l4 4 8-8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    title: "Tilt up once",
    body: "Show the ceiling in each room. That's where we read its height.",
    icon: <path d="M5 8h30M20 32V15M13 21l7-7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    title: "Say what you'd like",
    body: "A voice guides you and asks as you go. Not sure yet? Tap an idea.",
    icon: <path d="M6 9h28v16H17l-7 6v-6H6z" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" />,
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
              {busy ? "Tap Allow when your phone asks." : `Allow the camera and mic${ios ? ", and motion so we know when you tilt up" : ""}. Turn your sound on to hear the guide.`}
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
            <svg viewBox="0 0 40 40" aria-hidden>
              {h.icon}
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
