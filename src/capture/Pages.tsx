// The full-page states around the camera: the brief, camera blocked, and camera problems.
import type { ReactNode } from "react";
import { CHECKLIST, MAX_SEC, MIN_SEC, TIPS } from "./checklist";
import { Dimension, Icon } from "./drawing";
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

export function IntroPage({ recordable, busy, onStart, onUpload, onClose }: Common & { recordable: boolean; onStart: () => void }) {
  const ios = detectPlatform() === "ios-safari";
  return (
    <Page
      eyebrow={`Scan · ${MIN_SEC} s to ${formatTime(MAX_SEC)}`}
      title="Film your basement."
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
              {busy ? "Tap Allow when your phone asks." : `Your phone will ask for the camera and microphone, so we can hear your plans.${ios ? " It may also ask about motion, so we know when you point up." : ""}`}
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
      <p className="cap-lede">Walk slowly from the stairs to the furnace room and talk as you go. Tell us what you'd like where.</p>

      <h2 className="cap-h2">What to show us</h2>
      <ol className="cap-shotlist">
        {CHECKLIST.map((c, i) => (
          <li key={c.id}>
            <span className="cap-num">{String(i + 1).padStart(2, "0")}</span>
            <span>
              <b>{c.label}</b>
              <span className="cap-muted">{c.hint}</span>
            </span>
          </li>
        ))}
      </ol>

      <h2 className="cap-h2">Three tips</h2>
      <ul className="cap-tiplist">
        {TIPS.map((t) => (
          <li key={t.label}>
            <b>{t.label}</b>
            <span className="cap-muted">{t.hint}</span>
          </li>
        ))}
      </ul>
      <Dimension className="cap-dim--length" label={`${MIN_SEC} s minimum · ${formatTime(MAX_SEC)} maximum`} />
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
