// The home page. The example's real scan puts itself together as you scroll (src/three/LandingScan.tsx),
// then what knowing early is worth, sourced, then the way in. The start sheet, upload and filming stay in
// src/screens/Start.tsx, which renders this and opens the sheet through `onCheck`.
// Reduced motion, or no WebGL, gets the same story as still frames rendered from the same scene.
import { useNavigate } from "@tanstack/react-router";
import { useMotionValueEvent, useScroll, useTransform, type MotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AccountNav } from "../auth";
import { Logo } from "../components/Logo";
import { View3DBoundary } from "../components/View3D";
import type { LandingScan } from "../three/LandingScan";
import { EXAMPLE } from "./example";
import { Cited, Ref, SiteFooter, SourceList } from "./parts";
import { NAV, PATHS } from "./site";
import type { SourceId } from "./sources";
import "./home.css";

const VIDEO = "/samples/sample-basement.mp4";
const VIDEO_POSTER = "/samples/sample/frames/0000.jpg";
const still = (n: number) => `/img/scan-${n}.webp`;

const zone = (kind: string) => EXAMPLE.zones.find((z) => z.kind === kind)?.area;

// Each step finishes at its number on the scroll: the hero is 0.
const STEPS: { title: string; body: ReactNode; alt: string }[] = [
  {
    title: "Walk it once.",
    body: (
      <>
        Film your basement with your phone for up to 5 minutes, and talk as you go: “kitchen here,” “Mom sleeps here.”
        The line is the path the phone took in the example.
      </>
    ),
    alt: "The path the phone took while filming the example basement, drawn as a green line.",
  },
  {
    title: "Every frame, measured.",
    body: <>Meta's MapAnything reads the depth in each frame of the video. Points rise where the camera saw a surface: walls, floor, stairs and ducts.</>,
    alt: "Green and dark points rising into the shape of the example basement.",
  },
  {
    title: "Then one solid basement.",
    body: <>The points fuse into one surface, in the colours the camera saw. It's ready about 2–3 minutes after you upload, and you can walk through it.</>,
    alt: "The example basement as a solid 3D surface in its real colours: concrete walls, stairs and furnace.",
  },
  {
    title: "Measured, with the ceiling off.",
    body: (
      <>
        The plan comes from the scan: <span className="mono">{EXAMPLE.size}</span>, about <span className="mono">{EXAMPLE.area}</span>, ceiling{" "}
        <span className="mono">{EXAMPLE.ceiling}</span>. Sizes from video are rough, so a designer checks them with a tape.
      </>
    ),
    alt: `The example basement from above with its ceiling removed and the plan drawn on the floor: ${EXAMPLE.width} by ${EXAMPLE.depth}, ceiling ${EXAMPLE.ceiling}.`,
  },
  {
    title: "What it found.",
    body: (
      <>
        SAM 3.1 finds the window, door and stairs. Muse Spark checks them against Ontario's Building Code: the ceiling looks clear of
        the <span className="mono">{EXAMPLE.ceilingMin}</span> minimum, and
        {EXAMPLE.fix ? (
          <>
            {" "}
            {EXAMPLE.fix.count} fix is needed: {EXAMPLE.fix.title.toLowerCase()}, roughly <span className="mono">{EXAMPLE.fix.cost}</span>.
          </>
        ) : (
          " nothing has to change."
        )}
      </>
    ),
    alt: `The window, door and stairs outlined in the example basement. ${EXAMPLE.openings.map((o) => `${o.kind === "window" ? "Window" : "Door"} ${o.width} wide`).join(", ")}.`,
  },
  {
    title: "What it could become.",
    body: (
      <>
        A starting layout that fits the rules: a sleeping area by the window (<span className="mono">{zone("bedroom")}</span>), a bathroom
        (<span className="mono">{zone("bathroom")}</span>) and a living room with a kitchen (<span className="mono">{zone("living")}</span>).
        Virtually staged, to show the idea. It isn't a design.
      </>
    ),
    alt: "The example basement virtually staged with furniture: a sleeping area, a bathroom and a living room with a kitchen.",
  },
];

const CITED: SourceId[] = [
  "designerDrawings",
  "suiteCostToronto",
  "suiteCostKw",
  "waterlooGrant",
  "regionLoan",
  "cambridgeAru",
  "mhrtc",
  "waterlooAru",
  "kitchenerPermits",
  "mmahPlan",
  "ontarioSecondUnit",
];

function usePrefersStill() {
  const [still, setStill] = useState(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    try {
      const c = document.createElement("canvas");
      return reduced || !(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      return true;
    }
  });
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => q.matches && setStill(true);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return still;
}

function HeroCopy({ onCheck, onExample, level = 1 }: { onCheck: () => void; onExample: () => void; level?: 1 | 2 }) {
  const H = level === 1 ? "h1" : "h2";
  return (
    <>
      <H className="lp-title">Could your basement be a home?</H>
      <p className="lp-lede">
        Film it with your phone. Find out if it can be a legal second unit, what has to change, roughly what it costs, and the money
        you may be eligible for.
      </p>
      <div className="lp-actions">
        <button className="btn btn-primary" onClick={onCheck}>
          Check my basement <span className="arrow" aria-hidden>→</span>
        </button>
        <button className="link-quiet" onClick={onExample}>
          Try the example
        </button>
      </div>
      <p className="lp-where">All of Ontario, with Waterloo Region in depth. Free for homeowners.</p>
    </>
  );
}

// Opacity straight from the scroll, without re-rendering.
function useFade(ref: React.RefObject<HTMLElement | null>, opacity: MotionValue<number>) {
  useEffect(() => {
    const set = (v: number) => ref.current && (ref.current.style.opacity = String(v));
    set(opacity.get());
    return opacity.on("change", set);
  }, [ref, opacity]);
}

function ScrollStory({ onCheck, onExample }: { onCheck: () => void; onExample: () => void }) {
  const story = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const { scrollYProgress } = useScroll({ target: story, offset: ["start start", "end end"] });
  const t = useTransform(scrollYProgress, (p) => p * STEPS.length);
  const film = useRef<HTMLElement>(null);
  const stagedNote = useRef<HTMLParagraphElement>(null);
  useFade(film, useTransform(t, [0.1, 0.55], [1, 0]));
  useFade(stagedNote, useTransform(t, [5.35, 5.8], [0, 1]));
  const [stage, setStage] = useState(0);
  const [Scene, setScene] = useState<typeof LandingScan | null>(null);
  const [live, setLive] = useState(false);
  const [failed, setFailed] = useState(false);
  const [onScreen, setOnScreen] = useState(true);

  useMotionValueEvent(t, "change", (v) => {
    setStage(Math.round(v));
    const v0 = video.current;
    if (!v0) return;
    if (v > 0.7 && !v0.paused) v0.pause();
    else if (v <= 0.7 && v0.paused) void v0.play().catch(() => undefined);
  });

  // three.js and the scan load after the page has painted, so the headline never waits on them.
  useEffect(() => {
    let gone = false;
    const go = () =>
      setTimeout(() => {
        import("../three/LandingScan").then((m) => !gone && setScene(() => m.LandingScan)).catch(() => !gone && setFailed(true));
      }, 150);
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
    return () => {
      gone = true;
      window.removeEventListener("load", go);
    };
  }, []);

  // Frames are only drawn while the story is on screen.
  useEffect(() => {
    const el = story.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setOnScreen(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const ready = useCallback(() => setLive(true), []);
  const fail = useCallback(() => setFailed(true), []);

  return (
    <section className="lp-story" ref={story} aria-label="The example basement, scanned">
      <div className="lp-stage">
        <img className="lp-poster" src={still(Math.max(1, Math.min(STEPS.length, stage)))} alt="" data-hidden={(live && !failed) || undefined} />
        {Scene && !failed && (
          <View3DBoundary quiet>
            <Scene progress={t} active={onScreen} onReady={ready} onFail={fail} />
          </View3DBoundary>
        )}
        <figure className="lp-film" ref={film}>
          <video ref={video} src={VIDEO} poster={VIDEO_POSTER} muted loop playsInline autoPlay preload="metadata" aria-label="The example basement, filmed on a phone" />
          <figcaption>The example: a real unfinished basement, filmed on a phone.</figcaption>
        </figure>
        <p className="lp-staged-note" ref={stagedNote}>
          Virtually staged: a starting layout, not a design
        </p>
      </div>
      <div className="lp-steps">
        <div className="lp-step lp-step-hero">
          <HeroCopy onCheck={onCheck} onExample={onExample} />
        </div>
        {STEPS.map((s, i) => (
          <div className="lp-step" key={s.title} aria-current={stage === i + 1 ? "step" : undefined}>
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function StillStory({ onCheck, onExample }: { onCheck: () => void; onExample: () => void }) {
  return (
    <section className="lp-stills" aria-label="The example basement, scanned">
      <div className="lp-still lp-still-hero">
        <div className="lp-still-copy">
          <HeroCopy onCheck={onCheck} onExample={onExample} />
        </div>
        <figure className="lp-still-film">
          <video src={VIDEO} poster={VIDEO_POSTER} muted loop playsInline controls preload="none" aria-label="The example basement, filmed on a phone" />
          <figcaption>The example: a real unfinished basement, filmed on a phone.</figcaption>
        </figure>
      </div>
      {STEPS.map((s, i) => (
        <div className="lp-still" key={s.title}>
          <div className="lp-still-copy">
            <h2>{s.title}</h2>
            <p>{s.body}</p>
          </div>
          <img src={still(i + 1)} alt={s.alt} width={1200} height={1000} loading="lazy" decoding="async" />
        </div>
      ))}
    </section>
  );
}

export function Home({ onCheck }: { onCheck: () => void }) {
  const navigate = useNavigate();
  const stillFrames = usePrefersStill();
  const onExample = () => navigate({ to: "/scans/$scanId", params: { scanId: "sample" } });
  return (
    <>
      <header className="nav lp-nav">
        <Logo />
        <nav className="nav-links" aria-label="Main">
          {NAV.filter((n) => n.path !== PATHS.about).map((n) => (
            <a key={n.path} href={n.path}>
              {n.label}
            </a>
          ))}
          <AccountNav />
        </nav>
      </header>

      {stillFrames ? <StillStory onCheck={onCheck} onExample={onExample} /> : <ScrollStory onCheck={onCheck} onExample={onExample} />}

      <div className="mk lp-after">
        <Cited ids={CITED}>
          <section className="lp-ledger" aria-labelledby="ledger-h">
            <div className="lp-ledger-head">
              <h2 id="ledger-h">Know before you spend.</h2>
              <p>A basement suite is a big project. Find out early what yours needs, and what help there is.</p>
            </div>
            <dl>
              <div>
                <dt>5 minutes</dt>
                <dd>to film. Your basement is in 3D about 2–3 minutes after you upload it.</dd>
              </div>
              <div>
                <dt>$2,000–5,000</dt>
                <dd>
                  is what a designer typically charges to draw a basement for a permit<Ref id="designerDrawings" />. See what has to change before
                  you hire one.
                </dd>
              </div>
              <div>
                <dt>$90,000–150,000</dt>
                <dd>
                  is what published guides give for a full legal basement suite<Ref id="suiteCostToronto" />
                  <Ref id="suiteCostKw" />. Knowing the fixes early helps you budget, or stop before you spend.
                </dd>
              </div>
              <div>
                <dt>Up to $20,000</dt>
                <dd>
                  from the City of Waterloo's grant for a basement unit rented at an affordable rent for 5 years, if work hasn't started
                  <Ref id="waterlooGrant" />. You may also be eligible for the Region of Waterloo's loan of up to $25,000, forgiven over 15 years if
                  you live in the house and keep the rent capped<Ref id="regionLoan" />; Cambridge's grant of up to $10,000<Ref id="cambridgeAru" />;
                  or a federal tax credit of up to $7,000 when the suite is for a relative who is 65 or older, or eligible for the disability tax
                  credit<Ref id="mhrtc" />.
                </dd>
              </div>
              <div>
                <dt>10–15 business days</dt>
                <dd>
                  for the City to review a complete permit application in Waterloo or Kitchener<Ref id="waterlooAru" />
                  <Ref id="kitchenerPermits" />. Basement Ready drafts the drawings and fills in the forms, for you or a designer to check before
                  you submit them.
                </dd>
              </div>
            </dl>
            <p className="mk-note">
              Filming and scan times are our own, measured on our 3D service on October 29, 2026. Costs are published ranges, not quotes. Money
              depends on each program's conditions, and the program decides.
            </p>
          </section>

          <section className="lp-impact" aria-labelledby="impact-h">
            <h2 id="impact-h">More homes, in houses already built.</h2>
            <div>
              <p>
                Ontario has set a goal of building at least 1.5 million homes by 2031<Ref id="mmahPlan" />. Up to three homes are now allowed on
                most residential lots<Ref id="mmahPlan" />, and most second units are built in a basement or attic<Ref id="ontarioSecondUnit" />.
                A legal suite can give a parent a place of their own, or help pay the mortgage<Ref id="ontarioSecondUnit" />.
              </p>
              <p>
                Basement Ready covers all of Ontario, with Waterloo Region in depth: Waterloo, Kitchener and Cambridge get their own rules, fees
                and local money. Everywhere else gets Ontario's rules, and a list of what to confirm with your city.
              </p>
            </div>
          </section>

          <section className="lp-cta" aria-labelledby="cta-h">
            <h2 id="cta-h">See what yours could become.</h2>
            <p>Free. Film for up to 5 minutes, or try the example first.</p>
            <div className="lp-actions">
              <button className="btn btn-primary" onClick={onCheck}>
                Check my basement <span className="arrow" aria-hidden>→</span>
              </button>
              <button className="link-quiet" onClick={onExample}>
                Try the example
              </button>
            </div>
          </section>

          <SourceList />
        </Cited>
        <SiteFooter />
      </div>
    </>
  );
}
