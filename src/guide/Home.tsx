// /scans/:id, the basement's home base (ux-guide-build-spec.md): the goal, the three milestones, each
// with a drawing, where it stands and one line, then Continue. While it measures, and until they've had
// their answer, it opens the guide instead: that's where the wait and the answer happen. Inside the app
// the logo always comes here. A shared link reads the answer and changes nothing.
import { useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { DEMO_LABEL, EXAMPLE_LABEL, getScan, type ScanResult } from "../api";
import { AccountNav } from "../auth";
import { AppNewScan, inApp, newScanHref } from "../inApp";
import { chosen, downloadBook } from "../book/bookApi";
import { Logo, Mark } from "../components/Logo";
import { getPermitStatus, getWorkspace, useDrawingsLink, type Workspace } from "../workspaceApi";
import type { Fixture, Model, Pt, Wall } from "../../server/model/types";
import { getGuide } from "./api";
import { guideUrl, MILESTONES, progress, type MilestoneStatus, type Progress } from "./progress";
import type { Milestone } from "./types";
import "./home.css";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;
const LOOKS: Record<string, string> = { light: "Light oak", warm: "Warm wood", deep: "Deep green", plain: "Plain, bright" };
const PATHS: Record<string, string> = { hire: "hiring it out", diy: "doing it yourself", mix: "some of each" };
const CONTINUE: Record<Milestone, string> = { answer: "See your answer", design: "Continue with the design", build: "Continue with the permit" };

// A shared link watching a scan that's still measuring checks back this often, for ten minutes at most.
const WATCH_EVERY_MS = 5000;
const WATCH_CHECKS = 120;

type View =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "measuring"; failed: boolean }
  | { kind: "home"; r: ScanResult; owner: boolean; p: Progress; ws: Workspace | null };

export function Home() {
  const { scanId } = useParams({ from: "/scans/$scanId" });
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: "loading" });
  const [model, setModel] = useState<Model | null>(null);
  const [permit, setPermit] = useState<{ done: number; total: number } | null>(null);
  const [checks, setChecks] = useState(0);

  useEffect(() => {
    document.title = "Your basement | Basement Ready";
  }, []);

  useEffect(() => {
    let gone = false;
    void (async () => {
      const s = await getScan(scanId).catch(() => null);
      if (gone) return;
      if (!s) return setView({ kind: "missing" });
      const owner = scanId === "sample" || Boolean(s.canEdit);
      const measured = s.status === "done" && Boolean(s.result);
      // The person who filmed it waits in the guide; so does a scan that failed (the guide says why).
      if (owner && !measured) return router.history.replace(guideUrl(scanId));
      if (!measured || !s.result) return setView({ kind: "measuring", failed: s.status === "error" });
      const [guide, ws] = owner ? await Promise.all([getGuide(scanId).catch(() => null), getWorkspace(scanId).catch(() => null)]) : [null, null];
      if (gone) return;
      const p = progress({ guide, state: ws?.state, measured });
      if (owner && p.openGuide) return router.history.replace(guideUrl(scanId));
      setView({ kind: "home", r: s.result, owner, p, ws });
      if (!owner) return;
      // The drawings and the permit count fill in after: the page doesn't wait for them.
      void import("../studio/api")
        .then(({ loadModel }) => loadModel(scanId))
        .then(({ model }) => !gone && setModel(model))
        .catch(() => {});
      if (p.status.design === "done")
        void getPermitStatus(scanId)
          .then((st) => !gone && setPermit({ done: st.items.filter((i) => i.done).length, total: st.items.length }))
          .catch(() => {});
    })();
    return () => {
      gone = true;
    };
  }, [scanId, checks]);

  // A shared link opened while it measures fills in by itself when it's done.
  useEffect(() => {
    if (view.kind !== "measuring" || view.failed || checks >= WATCH_CHECKS) return;
    const id = window.setTimeout(() => setChecks((n) => n + 1), WATCH_EVERY_MS);
    return () => clearTimeout(id);
  }, [view, checks]);

  if (view.kind === "loading") return <main className="result-loading"><Logo href={`/scans/${scanId}`} /></main>;
  if (view.kind === "missing")
    return (
      <main className="not-found">
        <Logo />
        <h1>We couldn't open that scan.</h1>
        <p className="muted">Scans are private: open it on the phone or computer you filmed with, or sign in to the account you saved it to.</p>
        <a href={newScanHref()} className="btn btn-primary">{inApp() ? "New scan" : "Scan a basement"}</a>
      </main>
    );
  if (view.kind === "measuring")
    return (
      <div className="hb">
        <Top scanId={scanId} />
        <main className="hb-main">
          <h1 className="hb-goal">{view.failed ? "This scan didn't finish." : "Still measuring this basement."}</h1>
          <p className="hb-for">{view.failed ? "The person who filmed it can try again from their phone." : "This page fills in by itself when it's done, usually in a few minutes."}</p>
        </main>
      </div>
    );
  return <HomeBase scanId={scanId} {...view} model={model} permit={permit} />;
}

function Top({ scanId }: { scanId: string }) {
  return (
    <header className="hb-top">
      <a className="hb-home" href={`/scans/${scanId}`} aria-label="Your basement">
        <Mark title="Your basement" />
      </a>
      <p className="hb-title">Your basement</p>
      <span className="hb-account">
        <AppNewScan className="link-quiet hb-new" />
        <AccountNav />
      </span>
    </header>
  );
}

function HomeBase({ scanId, r, owner, p, ws, model, permit }: { scanId: string; r: ScanResult; owner: boolean; p: Progress; ws: Workspace | null; model: Model | null; permit: { done: number; total: number } | null }) {
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [making, setMaking] = useState(false);
  const design = chosen(model);
  const look = ws?.state.ideas?.finish ?? null;
  const fixes = r.fixGroups.length;
  const goal = r.route === "basement_finish" ? "A finished basement, built to code" : "A legal second home downstairs";
  const where = scanId === "sample" ? "the example basement" : r.demo ? "the demo house" : r.property ? `${r.property.address}, ${r.property.municipality}` : (r.city ?? "your basement");

  const lines: Record<Milestone, ReactNode> = {
    answer: r.verdict === "yes" ? "Yes, as it is" : r.verdict === "fix" ? (fixes ? `Yes, after ${fixes} ${fixes === 1 ? "fix" : "fixes"}` : "Yes, after fixes") : "Not as it is",
    design: p.status.design === "done" && design ? `${design.name}${look && LOOKS[look] ? `, ${LOOKS[look]}` : ""}` : "Pick a layout and a look",
    build:
      p.status.build === "todo" ? (
        "Permit, money and who builds it"
      ) : (
        <>
          {permit ? (
            <>
              Permit <span className="mono">{permit.done} of {permit.total}</span>
            </>
          ) : (
            "Permit"
          )}
          {(r.money?.total ?? 0) > 0 && (
            <>
              {" · up to "}
              <span className="mono">{money(r.money!.total)}</span>
            </>
          )}
          {` · ${PATHS[ws?.state.build?.path ?? ""] ?? "builders"}`}
        </>
      ),
  };
  const thumbs: Record<Milestone, ReactNode> = {
    answer: model ? <PlanThumb walls={model.existing.walls} fixtures={model.existing.fixtures} /> : null,
    design: design && p.status.design === "done" ? <PlanThumb walls={design.proposed.walls} fixtures={design.proposed.fixtures} /> : null,
    build: <SheetThumb />,
  };
  // A shared link sees the answer; the design and the permit are the owner's.
  const shown = owner ? MILESTONES : MILESTONES.filter((m) => m.id === "answer");

  const book = async () => {
    setMaking(true);
    setNote({ text: "Making your book, about 10 seconds…" });
    try {
      await downloadBook(scanId, `basement-book-${scanId === "sample" ? "sample" : "yours"}.pdf`);
      setNote(null);
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : "The book didn't download. Try again.", error: true });
    } finally {
      setMaking(false);
    }
  };
  // For a designer: the drawings, by the signed link that opens for them although scans are private
  // (src/workspaceApi.ts drawingsLink). The example's one-page plan is public, so it shares that.
  const drawings = useDrawingsLink(scanId, owner && scanId !== "sample" && !r.demo);
  const shareUrl = scanId === "sample" ? `${window.location.origin}/scans/sample/brief` : drawings;
  const share = async () => {
    if (!shareUrl) return;
    if (navigator.share) return void (await navigator.share({ title: "Our basement plan", url: shareUrl }).catch(() => {}));
    const copied = await navigator.clipboard?.writeText(shareUrl).then(() => true).catch(() => false);
    setNote(copied ? { text: scanId === "sample" ? "Link copied. It opens the one-page plan." : "Link copied: the drawings only, no contact details." } : { text: shareUrl });
  };

  return (
    <div className="hb">
      <Top scanId={scanId} />
      <main className="hb-main">
        {scanId === "sample" ? (
          <p className="hb-example" role="note">
            <b>Example:</b> {EXAMPLE_LABEL}
          </p>
        ) : r.demo ? (
          <p className="hb-example" role="note">
            <b>Demo house:</b> {DEMO_LABEL}
          </p>
        ) : null}
        <h1 className="hb-goal">{goal}</h1>
        <p className="hb-for">{owner ? `Your goal for ${where}.` : r.headline}</p>
        <ol className="hb-miles" aria-label="Milestones">
          {shown.map((m) => (
            <Row key={m.id} label={m.label} state={p.status[m.id]} href={owner && p.status[m.id] !== "todo" ? guideUrl(scanId, m.id) : null} thumb={thumbs[m.id]} line={lines[m.id]} />
          ))}
        </ol>
        {owner ? (
          <p className="hb-links">
            <button type="button" className="link-quiet" onClick={() => void book()} disabled={making}>
              Your book (PDF)
            </button>
            {shareUrl && (
              <button type="button" className="link-quiet" onClick={() => void share()}>
                Share with a designer
              </button>
            )}
            {/* In the app, "New scan" is in the top bar. */}
            {!inApp() && (
              <a className="link-quiet" href="/">
                Scan another basement
              </a>
            )}
          </p>
        ) : (
          <p className="hb-links">
            <a className="link-quiet" href={newScanHref()}>
              Scan your own basement
            </a>
          </p>
        )}
        <p className={note?.error ? "error hb-note" : "hb-note"} role="status" aria-live="polite">
          {note?.text}
        </p>
      </main>
      <div className="hb-go">
        <div className="hb-go-in">
          {owner ? (
            <a className="btn btn-primary" href={guideUrl(scanId, p.next)}>
              {p.next ? CONTINUE[p.next] : "Open your guide"} <span className="arrow" aria-hidden>→</span>
            </a>
          ) : (
            <a className="btn btn-primary" href={`/scans/${scanId}/brief`}>
              See the one-page plan <span className="arrow" aria-hidden>→</span>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS: Record<MilestoneStatus, string> = { done: "Done", next: "Next", todo: "Later" };

function Row({ label, state, href, thumb, line }: { label: string; state: MilestoneStatus; href: string | null; thumb: ReactNode; line: ReactNode }) {
  const body = (
    <>
      <span className="hb-th" aria-hidden>
        {thumb}
      </span>
      <span className="hb-text">
        <span className="hb-name">{label}</span>
        <span className="hb-line">{line}</span>
      </span>
      <span className="hb-st">{STATUS[state]}</span>
    </>
  );
  return (
    <li className="hb-mile" data-state={state}>
      {href ? <a href={href}>{body}</a> : <div>{body}</div>}
    </li>
  );
}

// The basement's walls, drawn small: as it is for the answer, as designed for the design. New walls are
// drawn heavier; the stairs, the furnace and the rest sit inside in hairline.
function PlanThumb({ walls, fixtures = [] }: { walls: Wall[]; fixtures?: Fixture[] }) {
  if (!walls.length) return null;
  const pts: Pt[] = walls.flatMap((w) => [w.a, w.b]);
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
  const [w, h] = [Math.max(...xs) - x0 || 1, Math.max(...ys) - y0 || 1];
  const pad = Math.max(w, h) * 0.12;
  return (
    <svg viewBox={`${x0 - pad} ${y0 - pad} ${w + pad * 2} ${h + pad * 2}`} preserveAspectRatio="xMidYMid meet">
      {fixtures.map((f) =>
        f.sizeM ? <rect key={f.id} x={f.at[0] - f.sizeM[0] / 2} y={f.at[1] - f.sizeM[1] / 2} width={f.sizeM[0]} height={f.sizeM[1]} className="hb-fixture" vectorEffect="non-scaling-stroke" /> : null,
      )}
      {walls.map((wall) => (
        <line key={wall.id} x1={wall.a[0]} y1={wall.a[1]} x2={wall.b[0]} y2={wall.b[1]} className={wall.kind === "new" ? "hb-wall-new" : "hb-wall"} vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

// The permit set: a sheet with its title, a plan and the title block.
function SheetThumb() {
  return (
    <svg viewBox="0 0 64 48">
      <rect x="18" y="5" width="28" height="38" className="hb-sheet" />
      <path d="M22 11h14M22 16h18M22 19h12" className="hb-sheet-text" />
      <path d="M22 24h20v12H22zM22 30h10v6" className="hb-sheet-plan" />
      <rect x="35" y="38" width="9" height="3" className="hb-sheet-plan" />
    </svg>
  );
}
