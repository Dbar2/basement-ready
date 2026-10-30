// /scans/:id?tab=…, the last step of the flow (src/flow/flow.ts): the homeowner's workspace. Five tabs:
// the book (the design, its pictures, the quote, the timeline, as a PDF too), the answer (the decision,
// what has to change, the scan), Permit (the set to submit and its readiness count), Money (what they
// qualify for, applied for in a click or two), Build (who builds it, or doing it yourself).
// The owner profile is asked once, the first time a tab needs it, and reused everywhere after.
// A shared link reads the answer and changes nothing; the example and the demo house say what they are.
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { answerQuestion, DEMO_LABEL, EXAMPLE_LABEL, getScan, sampleEarlyAnswers, type AnyAnswer, type ScanResult } from "../api";
import { AccountNav } from "../auth";
import { Applications, HowToApply, MoneySection } from "../components/Money";
import { Logo } from "../components/Logo";
import { FlowFoot, FlowHead } from "../flow/FlowNav";
import { SiteFooter } from "../marketing/parts";
import type { Design, Existing } from "../../server/model/types";
import { getWorkspace, saveWorkspace, type Profile, type Workspace as WorkspaceData, type WorkspaceState } from "../workspaceApi";
import { PlanTab, STATUS, type Changes } from "./Result";
import { BuildTab } from "./WorkspaceBuild";
import { PermitTab } from "./WorkspacePermit";
import { ProfileCard } from "./WorkspaceProfile";
import "../styles/workspace.css";
import "../styles/journey.css";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-CA")}`;

export type Tab = "book" | "decision" | "permit" | "money" | "build";
const TABS: { id: Tab; label: string }[] = [
  { id: "book", label: "Your book" },
  { id: "decision", label: "The answer" },
  { id: "permit", label: "Permit" },
  { id: "money", label: "Money" },
  { id: "build", label: "Build" },
];

// The book carries the quote's price catalog: it loads with its tab.
const BookView = lazy(() => import("../book/BookPage").then((m) => ({ default: m.BookView })));

// The photos usually land within a couple of minutes of the answer; past this the page stops asking.
const PHOTO_CHECKS = 45;
const PHOTO_EVERY_MS = 4000;

// The way on from each tab: through the permit, the money and the build.
const NEXT: Partial<Record<Tab, { label: string; tab: Tab }>> = {
  book: { label: "Your permit set", tab: "permit" },
  decision: { label: "Your permit set", tab: "permit" },
  permit: { label: "Money you can get", tab: "money" },
  money: { label: "Who builds it", tab: "build" },
};

// Older links name the tabs they had: the plan tab is the answer, the ideas tab is the book.
const tabFromUrl = (): Tab | null => {
  const t = new URLSearchParams(window.location.search).get("tab");
  if (t === "plan") return "decision";
  if (t === "ideas") return "book";
  return TABS.some((x) => x.id === t) ? (t as Tab) : null;
};

// What every tab gets: the result, the workspace, and a way to save part of it.
export type TabProps = {
  r: ScanResult;
  scanId: string;
  ws: WorkspaceData;
  save: (patch: { profile?: Profile | null; state?: WorkspaceState }) => Promise<void>;
  reload: () => Promise<void>;
  go: (tab: Tab) => void;
};

async function share() {
  const url = window.location.href.split("?")[0];
  if (navigator.share) await navigator.share({ title: "Our basement plan", url }).catch(() => {});
  else await navigator.clipboard?.writeText(url).catch(() => {});
}

export function Workspace({ scanId, onRestart }: { scanId: string; onRestart: () => void }) {
  const [r, setR] = useState<ScanResult | null>(null);
  const [ws, setWs] = useState<WorkspaceData | null>(null);
  const [tab, setTab] = useState<Tab>(() => tabFromUrl() ?? "book");
  // The chosen design, drawn in the scan on the answer's 3D (owner only: it's their workspace's).
  const [design, setDesign] = useState<{ existing: Existing; design: Design } | null>(null);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const [changes, setChanges] = useState<Changes>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The sample isn't saved anywhere, so its answers live here.
  const [sampleAnswers, setSampleAnswers] = useState<Record<string, AnyAnswer | null>>({});
  // Opened from a shared link: it reads, it doesn't answer.
  const [readOnly, setReadOnly] = useState(false);
  const [photosLate, setPhotosLate] = useState(false);

  useEffect(() => {
    void getScan(scanId).then(async (s) => {
      const shared = scanId !== "sample" && !s.canEdit;
      setReadOnly(shared);
      // A shared link has no book to open: it reads the answer.
      if (shared && tab === "book") setTab("decision");
      // The model's checks load with it, not with the first page.
      if (!shared)
        void import("../studio/api")
          .then(({ loadModel }) => loadModel(scanId))
          .then(({ model }) => {
            const d = model.designs.find((x) => x.chosen) ?? model.designs[0];
            if (d) setDesign({ existing: model.existing, design: d });
          })
          .catch(() => {});
      // A shared link never asks for the owner's workspace: it isn't theirs to open.
      if (shared) setWs({ profile: null, state: {}, prefill: { legalDescription: null, pin: null, rollNumber: null, fromOtherBasement: null }, site: null, locked: "This is a shared link: the permit, money and build tabs open on the device that filmed it, or when its owner signs in." });
      else
        void getWorkspace(scanId)
          .then(setWs)
          .catch(() => setWs({ profile: null, state: {}, prefill: { legalDescription: null, pin: null, rollNumber: null, fromOtherBasement: null }, site: null, locked: "We couldn't open your workspace. Try again in a moment." }));
      // The sample's answers from the wait screen, applied the way a real scan applies them, over
      // the money answers the sample comes with.
      const told = Object.fromEntries((s.result?.moneyAnswered ?? []).filter((q) => q.id !== "household").map((q) => [q.id, q.answer]));
      const early = scanId === "sample" ? { ...told, ...sampleEarlyAnswers() } : {};
      if (s.result && Object.keys(early).length) {
        const { household, ...answers } = early;
        const res = await fetch("/api/recheck", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ result: s.result, answers, household: household ?? s.result.household }),
        });
        if (res.ok) {
          setSampleAnswers(early);
          return setR((await res.json()).result);
        }
      }
      setR(s.result);
    });
  }, [scanId]);

  // The photos arrive a little after the answer: check back until they're in, for a few minutes at most.
  useEffect(() => {
    if (scanId === "sample" || r?.concepts?.status !== "pending") return;
    let checks = 0;
    const id = window.setInterval(() => {
      if (++checks > PHOTO_CHECKS) {
        clearInterval(id);
        setPhotosLate(true);
        return;
      }
      void getScan(scanId).then((s) => {
        if (s.result?.concepts?.status !== "pending") setR((prev) => (prev ? { ...prev, concepts: s.result!.concepts } : prev));
      });
    }, PHOTO_EVERY_MS);
    return () => clearInterval(id);
  }, [scanId, r?.concepts?.status]);

  // The tab is always in the address: /scans/:id on its own goes back to where they left off.
  const go = useCallback((next: Tab) => {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", next);
    window.history.replaceState(window.history.state, "", url);
    window.scrollTo({ top: 0 });
  }, []);

  const save = useCallback(
    async (patch: { profile?: Profile | null; state?: WorkspaceState }) => {
      setSaveError(null);
      // Show it straight away; the server's copy follows.
      setWs((w) => (w ? { ...w, ...(patch.profile !== undefined ? { profile: patch.profile } : {}), state: { ...w.state, ...(patch.state ?? {}) } } : w));
      try {
        const saved = await saveWorkspace(scanId, patch);
        setWs((w) => (w ? { ...w, profile: saved.profile, state: saved.state } : w));
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : "That didn't save.");
      }
    },
    [scanId],
  );

  // Fetch the saved workspace again (the looks fill in on the server).
  const reload = useCallback(async () => {
    const next = await getWorkspace(scanId).catch(() => null);
    if (next) setWs((w) => (w ? { ...w, state: next.state } : next));
  }, [scanId]);

  const answer = async (ruleId: string, value: AnyAnswer | null) => {
    if (!r) return;
    setBusyRule(ruleId);
    setAnswerError(null);
    try {
      const next = await answerQuestion(scanId, r, sampleAnswers, ruleId, value);
      if (scanId === "sample") setSampleAnswers((a) => ({ ...a, [ruleId]: value }));
      // Say what moved, in plain words.
      const lines = next.findings
        .filter((f) => r.findings.find((o) => o.ruleId === f.ruleId)?.status !== f.status)
        .map((f) => `${f.title} → ${STATUS[f.status]}`);
      if ((next.money?.total ?? 0) !== (r.money?.total ?? 0)) lines.push(`You may be eligible for up to ${money(next.money?.total ?? 0)}`);
      setChanges({ before: r.headline, after: next.headline, lines });
      setR(next);
    } catch (err) {
      setAnswerError(err instanceof Error ? err.message : "We couldn't check that.");
    } finally {
      setBusyRule(null);
    }
  };

  if (!r) return <main className="result-loading"><Logo /></main>;
  const p = r.property;
  const props: TabProps | null = ws ? { r, scanId, ws, save, reload, go } : null;
  // The tabs that put the owner's name on paper ask for the profile once, at the top.
  const needsProfile = (tab === "permit" || tab === "money" || tab === "build") && ws && !ws.profile && !ws.locked;
  // Nothing made for the example or the demo house may reach a real inbox.
  const example = scanId === "sample" || Boolean(r.demo);
  const next = NEXT[tab];

  return (
    <div className="flow-page">
    {!readOnly && <FlowHead scanId={scanId} step="book" />}
    <main className="result workspace" data-verdict={r.verdict}>
      {readOnly && (
        <header className="nav">
          <Logo />
          <span className="nav-right">
            <button className="link-quiet" onClick={onRestart}>Scan a basement</button>
            <AccountNav />
          </span>
        </header>
      )}
      <div className="ws-head">
        {/* One line above the tabs: whose basement this is (or that it's the example), and Share and New scan. */}
        <div className="ws-line">
          {scanId === "sample" ? (
            <p className="example-label" role="note">
              <span className="tag-mono">Example</span> {EXAMPLE_LABEL}
            </p>
          ) : r.demo ? (
            <p className="example-label" role="note">
              <span className="tag-mono">Demo house</span> {DEMO_LABEL}
            </p>
          ) : (
            <p className="ws-address">{p ? `${p.address}, ${p.municipality}` : (r.city ?? "Your basement")}</p>
          )}
          {!readOnly && (
            <p className="ws-tools">
              <button className="link-quiet" onClick={() => void share()}>Share</button>
              <button className="link-quiet" onClick={onRestart}>New scan</button>
            </p>
          )}
        </div>
        <nav className="ws-tabs" role="tablist" aria-label="Workspace">
          {TABS.filter((t) => !readOnly || t.id !== "book").map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </div>
      {saveError && <p className="error ws-save-error" role="alert">{saveError}</p>}
      {photosLate && tab === "decision" && <p className="note ws-locked">The photos are taking longer than usual. Refresh in a few minutes to see them.</p>}
      {ws?.locked && tab !== "decision" && tab !== "book" && <p className="ws-locked">{ws.locked}</p>}
      {needsProfile && props && <ProfileCard {...props} />}

      {tab === "book" && !readOnly && (
        <Suspense fallback={<div className="book" aria-busy="true" />}>
          <BookView scanId={scanId} />
        </Suspense>
      )}
      {tab === "decision" && (
        <div>
          <PlanTab r={r} scanId={scanId} design={design} busyRule={busyRule} changes={changes} answerError={answerError} readOnly={readOnly} onAnswer={(id, v) => void answer(id, v)} />
        </div>
      )}
      {props && tab === "permit" && (
        <div>
          <PermitTab {...props} />
        </div>
      )}
      {props && tab === "money" && (
        <div>
          <MoneySection r={r} busy={busyRule} readOnly={readOnly} example={scanId === "sample"} onAnswer={(id, v) => void answer(id, v)} />
          <Applications
            scanId={scanId}
            r={r}
            profile={props.ws.profile}
            state={props.ws.state}
            example={example}
            onSent={(id: string, sent: boolean) => void save({ state: { apply: { ...(props.ws.state.apply ?? {}), [id]: { sentAt: sent ? new Date().toISOString() : null } } } })}
          />
          {r.steps && <HowToApply steps={r.steps} example={example} />}
        </div>
      )}
      {props && tab === "build" && (
        <div>
          <BuildTab {...props} />
        </div>
      )}
      {!ws && tab !== "decision" && tab !== "book" && <p className="viewer-empty ws-wait">Opening your workspace…</p>}

      <SiteFooter />
      {readOnly && (
        <div className="result-bar">
          <button className="btn btn-ghost" onClick={() => void share()}>
            Share
          </button>
        </div>
      )}
    </main>
    {!readOnly && <FlowFoot scanId={scanId} step="book" next={next ? { label: next.label, onClick: () => go(next.tab) } : null} />}
    </div>
  );
}
