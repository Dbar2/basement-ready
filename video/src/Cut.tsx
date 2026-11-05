import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import take from "./data/take.json";
import { C } from "./theme";
import { MONO, SANS } from "./fonts";
import { Browser, CamKey, Phone, Sheet, INSET, W } from "./components/kit";
import { SamVideo } from "./components/SamVideo";
import { easeDraw, easeOut, prog } from "./anim";
import { SHOTS, Shot } from "./shots";
import { Drawn } from "./scenes/Question";
import { LiveAnswer, LogPanel, Measured, Pipeline } from "./scenes/Models";
import { CostCard, EndCard, FixPulse, Money, SheetStack } from "./scenes/Guide";

// The demo, cut to one continuous voice take (media/video-audio/voice-take-a.mp3, ElevenLabs), split at
// its section pauses with a little room added between sections. Timings come from Whisper's word
// timestamps (src/data/take.json), so every caption and cue lands on the word it belongs to.
export const FPS = 30;
type Word = [string, number, number];
const WORDS = take.words as Word[];

type Sec = { id: string; a: number; b: number; pause: number; start: number; end: number; v0: number; v1: number };
const SECS: Sec[] = (() => {
  let t = 0;
  const s = take.sections.map((x) => {
    const start = t + x.pause;
    const end = start + (x.b - x.a);
    t = end;
    return { ...x, start, end, v0: start - x.pause, v1: 0 };
  });
  s.forEach((x, i) => (x.v1 = i < s.length - 1 ? s[i + 1].v0 : x.end + take.tail));
  return s;
})();
export const TOTAL = Math.round(SECS[SECS.length - 1].v1 * FPS);
const sec = (id: string) => SECS.find((s) => s.id === id)!;

/** Edit time (s) of a voice time (s). */
const editOf = (vt: number) => {
  const s = SECS.find((x) => vt >= x.a - 0.05 && vt <= x.b + 0.3) ?? SECS[0];
  return s.start + (vt - s.a);
};
const norm = (w: string) => w.replace(/[^\w']/g, "").toLowerCase();
/** Edit frame where `phrase` starts, searching from voice time `after`. */
const cue = (phrase: string, after = 0) => {
  const p = phrase.split(" ").map(norm);
  for (let i = 0; i < WORDS.length; i++) {
    if (WORDS[i][1] < after) continue;
    if (p.every((q, k) => WORDS[i + k] && norm(WORDS[i + k][0]) === q)) return Math.round(editOf(WORDS[i][1]) * FPS);
  }
  throw new Error(`cue not found: ${phrase}`);
};

// ---- captions: the sentence being said, each word lighting up as it's spoken
const FIX: Record<string, string> = { metas: "Meta's", lidar: "LiDAR" };
const CHUNKS = (() => {
  const words = WORDS.map(([w, s, e], i) => {
    let t = FIX[norm(w)] ? w.replace(/[\w']+/, FIX[norm(w)]) : w;
    if (norm(w) === "map" && WORDS[i + 1] && norm(WORDS[i + 1][0]) === "anything") t = "MapAnything";
    if (norm(w) === "anything" && i > 0 && norm(WORDS[i - 1][0]) === "map") t = "";
    if (norm(w) === "basement" && WORDS[i + 1] && WORDS[i + 1][0].trim().startsWith("ready")) t = "Basement";
    if (w.trim().startsWith("ready") && i > 0 && norm(WORDS[i - 1][0]) === "basement") t = w.replace("ready", "Ready");
    return { t, s: editOf(s), e: editOf(e) };
  }).filter((w) => w.t);
  const out: { words: typeof words; s: number; e: number }[] = [];
  let cur: typeof words = [];
  words.forEach((w, i) => {
    cur.push(w);
    const end = /[.?!,]$/.test(w.t) && (cur.length >= 4 || /[.?!]$/.test(w.t));
    const gap = words[i + 1] ? words[i + 1].s - w.e > 0.5 : true;
    if (end || gap || cur.length >= 9) {
      out.push({ words: cur, s: cur[0].s, e: cur[cur.length - 1].e });
      cur = [];
    }
  });
  return out;
})();

const Captions: React.FC = () => {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const c = CHUNKS.find((x, i) => t >= x.s - 0.08 && t < (CHUNKS[i + 1] ? Math.min(CHUNKS[i + 1].s - 0.08, x.e + 0.9) : x.e + 0.9));
  if (!c) return null;
  return (
    <div style={{ position: "absolute", left: INSET + 32, bottom: INSET + 16, width: W - INSET * 2 - 600 - 64, fontFamily: SANS, fontWeight: 600, fontSize: 30, lineHeight: 1.25, color: C.ink }}>
      {c.words.map((w, i) => {
        const on = prog(frame, Math.round(w.s * FPS) - 3, 5);
        return (
          <span key={i} style={{ opacity: 0.28 + 0.72 * on, display: "inline-block", transform: `translateY(${(1 - on) * 6}px)`, marginRight: "0.28em" }}>
            {w.t}
          </span>
        );
      })}
    </div>
  );
};

// ---- kinetic type: a few words rising in, one keyword swept with mint
const Punch: React.FC<{ text: string; at: number; out?: number; x: number; y: number; size?: number; mark?: number; width?: number; color?: string }> = ({ text, at, out, x, y, size = 96, mark, width = 900, color = C.ink }) => {
  const frame = useCurrentFrame();
  const fade = out === undefined ? 1 : 1 - prog(frame, out, 8, easeDraw);
  if (frame < at - 2 || fade <= 0) return null;
  const words = text.split(" ");
  return (
    <div style={{ position: "absolute", left: x, top: y, width, fontFamily: SANS, fontWeight: 900, fontSize: size, letterSpacing: "-0.045em", lineHeight: 1.0, color, opacity: fade }}>
      {words.map((w, i) => {
        const p = prog(frame, at + i * 3, 12, easeOut);
        const sweep = mark === i ? prog(frame, at + i * 3 + 8, 12, easeOut) : 0;
        return (
          <span key={i} style={{ display: "inline-block", position: "relative", overflow: "visible", marginRight: "0.22em", paddingBottom: size * 0.08 }}>
            {mark === i && <span style={{ position: "absolute", left: -6, right: -6, top: size * 0.18, bottom: size * 0.04, background: C.mint, transformOrigin: "left", transform: `scaleX(${sweep})`, zIndex: 0 }} />}
            <span style={{ position: "relative", display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 40}%)`, zIndex: 1 }}>{w}</span>
          </span>
        );
      })}
    </div>
  );
};

/** A recording in a tilted, floating device frame, filling the sheet. */
const Rec: React.FC<{ shot: Shot; from?: number; cam?: CamKey[]; rate?: number; x?: number; y?: number; w?: number }> = ({ shot, from, cam, rate = 1, x = 180, y = 46, w = 1560 }) => (
  <Browser x={x} y={y} w={w} src={shot.file} start={from ?? shot.start} url={shot.url} cam={cam ?? shot.cam} rate={rate} tilt tag="The example basement, replayed" />
);

/** One of the 3D clips (public/clips), framed on the sheet with a slow push-in. */
const Clip3D: React.FC<{ file: string; from?: number; rate?: number; x?: number; y?: number; w?: number }> = ({ file, from = 0, rate = 1, x = 160, y = 40, w = 1600 }) => {
  const frame = useCurrentFrame();
  const push = 1 + frame * 0.0006;
  const h = (w * 9) / 16;
  return (
    <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 6, overflow: "hidden", boxShadow: "0 50px 90px -40px rgb(15 42 30 / 0.55)", transform: `perspective(1800px) translateZ(${-120 + 160 * easeOut(Math.min(1, frame / 120))}px) rotateY(${-12 + 20 * easeOut(Math.min(1, frame / 160))}deg) rotateX(${6 - 4 * easeOut(Math.min(1, frame / 160))}deg)` }}>
      <OffthreadVideo src={staticFile(`clips/${file}`)} startFrom={Math.round(from * FPS)} playbackRate={rate} muted style={{ width: w, height: h, transform: `scale(${push})` }} />
    </div>
  );
};

/** One stretch of a section: fades and slides in, slides out. */
const Part: React.FC<{ from: number; to: number; children: React.ReactNode }> = ({ from, to, children }) => (
  <Sequence from={from} durationInFrames={Math.max(1, to - from + 8)}>
    <PartIn dur={to - from + 8}>{children}</PartIn>
  </Sequence>
);
const PartIn: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const i = prog(frame, 0, 10, easeOut);
  const o = 1 - prog(frame, dur - 8, 8, easeDraw);
  const scale = (0.88 + 0.12 * i) * (1 + 0.16 * (1 - o));
  return <AbsoluteFill style={{ opacity: Math.min(i, o), transform: `scale(${scale})`, filter: i < 1 || o < 1 ? `blur(${((1 - i) * 6 + (1 - o) * 9).toFixed(2)}px)` : undefined }}>{children}</AbsoluteFill>;
};

// ---- sections (each gets local frames: 0 = its visual start)
type P = { s: Sec };
const local = (s: Sec, globalFrame: number) => globalFrame - Math.round(s.v0 * FPS);
const len = (s: Sec) => Math.round((s.v1 - s.v0) * FPS);

// David's live run (media/video-david-run): screenshots of the live site, 1200 × 723.
const DAVID = 723 / 1200;
const Run: React.FC<{ n: string; cam?: CamKey[]; x?: number; y?: number; w?: number; tag?: string }> = ({ n, cam, x = 240, y = 44, w = 1440, tag = "A live run of this basement, Nov 4" }) => (
  <Browser x={x} y={y} w={w} src={`david/${n}.jpg`} start={0} aspect={DAVID} url="basementready.com/scans/…/guide" cam={cam} tilt tag={tag} />
);

const Hook: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const could = local(s, cue("Could it become"));
  const parent = local(s, cue("For a parent"));
  const kid = local(s, cue("For a grown kid"));
  const rental = local(s, cue("Or a rental"));
  return (
    <Part from={0} to={len(s)}>
      <Run n="04-answer-plan" x={780} y={150} w={1040} cam={[[0, 1.0, 0.5, 0.5], [3.5, 1.35, 0.3, 0.35], [10, 1.55, 0.3, 0.35]]} />
      <div style={{ position: "absolute", left: 780, top: 150 + 1040 * DAVID + 54, fontSize: 21, color: C.muted, fontFamily: SANS, width: 1040 }}>This basement's measured plan and its answer, from a live run on the site</div>
      <div style={{ position: "absolute", left: 120, top: 72, fontFamily: SANS, fontSize: 20, color: C.muted, opacity: Math.min(prog(frame, 4, 10), 1 - prog(frame, 220, 12)) }}>
        Built during the Meta AI Developer Hackathon, from an empty repo on <span style={{ fontFamily: MONO, color: C.ink }}>Oct 28, 2026</span>.
      </div>
      <Punch text="A real basement." at={6} out={could - 6} x={120} y={300} size={104} width={620} />
      <Punch text="Could it become a second home?" at={could} x={120} y={260} size={100} width={640} mark={4} />
      {[["For a parent", parent], ["For a grown kid", kid], ["A rental", rental]].map(([t, at], i) => {
        const p = prog(frame, at as number, 10, easeOut);
        return (
          <span key={i} style={{ position: "absolute", left: 124 + [0, 200, 0][i], top: 780 + [0, 0, 64][i], padding: "10px 18px", background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 4, fontFamily: SANS, fontWeight: 600, fontSize: 26, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
            {t as string}
          </span>
        );
      })}
    </Part>
  );
};

const Problem: React.FC<P> = ({ s }) => {
  const thousands = local(s, cue("and thousands"));
  return (
    <Part from={0} to={len(s)}>
      <Drawn l2={{ from: -999, dur: 0 }} l3={{ from: 0, dur: Math.max(30, 2 * thousands) }} />
    </Part>
  );
};

/** SAM's finds on his video, from the live wait screen: four frames popping in with a scan line. */
const FINDS = [["00-wait-finding", "Finding"], ["01-wait-sam-window", "Window"], ["03-wait-sam-doors", "Doors"]];
const SamGrid: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      {FINDS.map(([n, label], i) => {
        const p = prog(frame, 6 + i * 16, 14, easeOut);
        const sweep = prog(frame, 10 + i * 16, 22, easeDraw);
        const x = 120 + i * 570, y = 330;
        return (
          <div key={n} style={{ position: "absolute", left: x, top: y + (1 - p) * 30, width: 540, opacity: p, fontFamily: SANS }}>
            <div style={{ position: "relative", width: 540, height: 540 * (362 / 600), borderRadius: 4, overflow: "hidden", border: `1.5px solid ${C.ink}`, boxShadow: "0 20px 48px -28px rgb(15 42 30 / 0.5)" }}>
              <Img src={staticFile(`david/${n}.jpg`)} style={{ position: "absolute", left: 0, top: "-12%", width: "158%", transform: `scale(${1 + Math.max(0, frame - (6 + i * 16)) * 0.0012})`, transformOrigin: "30% 50%" }} />
              <div style={{ position: "absolute", left: 0, right: 0, top: `${sweep * 100}%`, height: 3, background: C.mint, opacity: sweep > 0 && sweep < 1 ? 0.9 : 0 }} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 24, marginTop: 8 }}>{label}</div>
          </div>
        );
      })}
    </>
  );
};

const Input: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const L = len(s);
  const sam = local(s, cue("Meta's SAM"));
  const map = local(s, cue("Map Anything"));
  const wonder = local(s, cue("And Muse Wonder"));
  const active = frame >= wonder ? "wonder" : frame >= map ? "map" : frame >= sam ? "sam" : "video";
  return (
    <>
      <Part from={0} to={sam - 4}>
        <Phone x={1120} y={40} h={900} src="footage/david-phone.mp4" start={0} />
        <Punch text="Film it once." at={8} x={120} y={330} size={120} width={900} mark={2} />
        <div style={{ position: "absolute", left: 124, top: 500, fontFamily: SANS, fontSize: 28, color: C.muted, width: 700, opacity: prog(frame, 30, 12) }}>One slow walk through, on your phone. No special gear.</div>
      </Part>
      <Part from={sam - 4} to={map - 4}>
        <SamGrid />
      </Part>
      <Part from={map - 4} to={wonder - 4}>
        <Run n="04-answer-plan" cam={[[0, 1.15, 0.22, 0.5], [7, 1.5, 0.22, 0.5]]} />
        <Sequence from={Math.round((wonder - map) * 0.5)}>
          <MeasuredHis />
        </Sequence>
      </Part>
      <Part from={wonder - 4} to={L + 4}>
        <div style={{ position: "absolute", left: 180, top: 260, width: 760, borderRadius: 4, overflow: "hidden", border: `1.5px solid ${C.ink}` }}>
          <Img src={staticFile("david/01-wait-sam-window.jpg")} style={{ width: 760, display: "block", transform: `scale(${1 + frame * 0.0008})` }} />
        </div>
        <div style={{ position: "absolute", left: 180, top: 260 + 760 * (362 / 600) + 12, fontFamily: SANS, fontSize: 20, color: C.muted, width: 760 }}>This basement on the live site's wait screen, with SAM's find</div>
        <LogPanel dur={L - wonder + 130} />
      </Part>
      <Pipeline frame={frame} enter={sam - 40} rise={sam - 40} leave={L + 200} active={active} />
    </>
  );
};

/** What MapAnything measured in his basement (the live plan's figures), counting up. */
const MeasuredHis: React.FC = () => {
  const frame = useCurrentFrame();
  const n = (v: number, d: number) => interpolate(frame, [8 + d, 34 + d], [0, v], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw });
  const rows: [string, string][] = [
    ["Floor", `${n(8.48, 0).toFixed(2)} × ${n(9.15, 0).toFixed(2)} m`],
    ["Rec room", `${n(42.6, 6).toFixed(1)} m²`],
    ["Storage", `${n(25.6, 10).toFixed(1)} m²`],
    ["Ceiling", `${n(2.64, 14).toFixed(2)} m`],
  ];
  const p = prog(frame, 2, 12);
  return (
    <div style={{ position: "absolute", left: 1220, top: 300, width: 520, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "22px 28px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
      <div style={{ fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", paddingBottom: 12 }}>Measured from the video</div>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontWeight: 600, fontSize: 24 }}>{k}</span>
            <span style={{ fontFamily: MONO, fontSize: 22 }}>{v}</span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 21, color: C.muted, marginTop: 14 }}>Estimates from an ordinary phone video. No LiDAR.</div>
    </div>
  );
};

/** His rough cost and money back, counting up. */
const CostHis: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const frame = useCurrentFrame();
  const p = Math.min(prog(frame, at, 14), 1 - prog(frame, out, 10, easeDraw));
  if (p <= 0) return null;
  const n = (v: number) => Math.round(interpolate(frame, [at + 4, at + 34], [0, v], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw }));
  return (
    <div style={{ position: "absolute", left: 280, top: 690, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "18px 26px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)`, display: "flex", gap: 44 }}>
      <div>
        <div style={{ fontSize: 21, color: C.muted }}>The first fix: its own way in</div>
        <div style={{ fontWeight: 900, fontSize: 50, letterSpacing: "-0.04em" }}>${n(12)}k–${n(30)}k</div>
      </div>
      <div>
        <div style={{ fontSize: 21, color: C.muted }}>All in, hired out</div>
        <div style={{ fontWeight: 900, fontSize: 50, letterSpacing: "-0.04em" }}>${n(69)}k–${n(132)}k</div>
      </div>
      <div>
        <div style={{ fontSize: 21, color: C.muted }}>Money back</div>
        <div style={{ fontWeight: 900, fontSize: 50, letterSpacing: "-0.04em" }}>up to ${n(7)},000</div>
      </div>
    </div>
  );
};

const Answer: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const drop = local(s, cue("And the answer"));
  const yes = local(s, cue("Yes, not"));
  const not = local(s, cue("not as it"));
  const after = local(s, cue("or yes, after"));
  const every = local(s, cue("Every fix"));
  const grants = local(s, cue("and the grants"));
  const L = len(s);
  const sp = spring({ frame: frame - drop, fps: FPS, config: { damping: 11, stiffness: 180, mass: 0.6 } });
  const shake = frame >= drop && frame < drop + 12 ? (1 - (frame - drop) / 12) * 4 : 0;
  const t = (f: number) => (f - (drop - 2)) / FPS;
  const cam: CamKey[] = [[0, 1, 0.5, 0.5], [t(yes + 6), 1, 0.5, 0.5], [t(every - 4), 1.55, 1, 0.62], [t(every + 80), 1.55, 1, 0.62], [t(every + 110), 1.3, 0.25, 0.5]];
  return (
    <>
      <Part from={0} to={drop - 2}>
        <div style={{ position: "absolute", left: 180, top: 260, width: 760, borderRadius: 4, overflow: "hidden", border: `1.5px solid ${C.ink}` }}>
          <Img src={staticFile("david/01-wait-sam-window.jpg")} style={{ width: 760, display: "block", transform: `scale(${1 + frame * 0.0008})` }} />
        </div>
        <Sequence from={-130}>
          <LogPanel dur={drop + 130} />
        </Sequence>
        <Pipeline frame={frame + 400} enter={0} rise={0} leave={drop + 400 - 6} active="spark" />
      </Part>
      <Part from={drop - 2} to={every - 4}>
        <AbsoluteFill style={{ transform: `translate(${Math.sin(frame * 2.3) * shake}px, ${Math.cos(frame * 2.9) * shake}px)` }}>
          <Run n="04-answer-plan" cam={cam} />
          <div style={{ position: "absolute", left: 300, top: 330, opacity: Math.min(1, sp * 1.2) * (1 - prog(frame, yes + 4, 8)), transform: `rotate(-3deg) scale(${1.4 - 0.4 * sp})`, background: C.card, border: `7px solid ${C.ink}`, borderRadius: 6, padding: "20px 40px 26px", fontFamily: SANS, fontWeight: 900, fontSize: 96, letterSpacing: "-0.045em" }}>
            The answer comes first.
          </div>
          {[["Yes.", C.ok, yes], ["Not as it is.", C.stop, not], ["Yes, after a few fixes.", C.fix, after]].map(([tx, col, at], i) => {
            const p = spring({ frame: frame - (at as number), fps: FPS, config: { damping: 12, stiffness: 200, mass: 0.5 } });
            const gone = prog(frame, every - 6, 8);
            return (
              <div key={i} style={{ position: "absolute", left: 300, top: 300 + i * 120, opacity: Math.min(1, p) * (1 - gone), transform: `rotate(-2deg) scale(${1.25 - 0.25 * Math.min(1, p)})`, transformOrigin: "left center", background: C.card, border: `6px solid ${col}`, color: col as string, borderRadius: 6, padding: "12px 30px 16px", fontFamily: SANS, fontWeight: 900, fontSize: 72, letterSpacing: "-0.04em" }}>
                {tx as string}
              </div>
            );
          })}
        </AbsoluteFill>
      </Part>
      <Part from={every - 4} to={grants - 4}>
        <Browser x={180} y={46} w={1560} src="footage/desktop-ask.mp4" start={0.6} rate={2.0} url="basementready.com/scans/sample/guide" cam={[[0, 1.55, 1, 0.97], [1.7, 1.55, 1, 0.97], [2.7, 1.25, 0.28, 0.45]]} tilt tag="The example basement, replayed" />
        <Punch text="Ask anything." at={8} x={140} y={760} size={76} width={900} mark={1} />
      </Part>
      <Part from={grants - 4} to={L}>
        <Run n="04-answer-plan" cam={[[0, 1.2, 0.2, 0.5], [6, 1.3, 0.2, 0.5]]} />
        <Money />
        <CostHis at={6} out={L + 60} />
      </Part>
    </>
  );
};

const Breakthrough: React.FC<P> = ({ s }) => {
  const L = len(s);
  const yours = local(s, cue("so the plan"));
  const drag = local(s, cue("If a wall"));
  const type = local(s, cue("or just type"));
  const upd = local(s, cue("The plan updates"));
  const one = local(s, cue("It's one model"));
  return (
    <>
      <Part from={0} to={drag - 4}>
        <Run n="05-plan-check-checked-against-video" cam={[[0, 1.1, 0.3, 0.4], [(yours) / FPS, 1.9, 0.12, 0.22]]} />
        <Punch text="Yours to check." at={yours} x={1080} y={760} size={76} width={760} mark={2} />
      </Part>
      <Part from={drag - 4} to={type - 4}>
        <Rec shot={SHOTS.plan!} from={7.0} rate={1.3} cam={[[0, 1.35, 0.4, 0.8], [2.2, 1.6, 0.4, 0.88]]} />
      </Part>
      <Part from={type - 4} to={upd - 4}>
        <Run n="07-plan-wall-by-tape" cam={[[0, 1.3, 0.4, 0.3], [1.8, 2.0, 0.42, 0.22]]} />
      </Part>
      <Part from={upd - 4} to={one - 4}>
        <Rec shot={SHOTS.plan!} from={11.4} cam={[[0, 1.2, 0.35, 0.55], [3, 1.4, 0.35, 0.6]]} />
        <Punch text="Drag a wall. Everything updates." at={6} x={140} y={720} size={72} width={1100} mark={3} />
      </Part>
      <Part from={one - 4} to={L}>
        <Clip3D file="example-03-plan-to-3d.mp4" rate={Math.min(1, 3.6 / Math.max(1, (L - one) / FPS))} />
        <div style={{ position: "absolute", left: 180, top: 900, fontFamily: SANS, fontSize: 20, color: C.muted }}>The example basement: its measured plan, drawn from the scan</div>
        <Punch text="One model, scan to drawings." at={10} x={200} y={70} size={60} width={1500} />
      </Part>
    </>
  );
};

const Design: React.FC<P> = ({ s }) => {
  const L = len(s);
  const muse = local(s, cue("Muse Image"));
  const fin = local(s, cue("so you see"));
  const walk = local(s, cue("and walk around"));
  return (
    <>
      <Part from={0} to={L}>
        <Rec shot={SHOTS.looks!} from={12.6} cam={[[0, 1.2, 0, 0.5], [14, 1.4, 0, 0.5]]} />
        <Punch text="Your basement, finished." at={fin + 4} x={140} y={720} size={80} width={1200} mark={2} />
      </Part>
    </>
  );
};

const Build: React.FC<P> = ({ s }) => {
  const L = len(s);
  const honest = local(s, cue("And it's honest"));
  const even = local(s, cue("It even"));
  return (
    <>
      <Part from={0} to={honest - 4}>
        {take.permitClip ? (
          <>
            <Clip3D file="permit-set.mp4" rate={Math.max(1, take.permitClip / Math.max(1, (honest - 4) / FPS))} />
            <Punch text="Drafted. Filled." at={18} x={200} y={780} size={80} width={900} />
          </>
        ) : (
          <>
            <Run n="10-build-permit-2of17" cam={[[0, 1.2, 0.25, 0.5], [3, 1.5, 0.25, 0.5]]} />
            <SheetStack at={30} />
            <Punch text="Drafted. Filled." at={18} x={140} y={740} size={88} width={900} />
          </>
        )}
      </Part>
      <Part from={honest - 4} to={L}>
        <Run n="10-build-permit-2of17" cam={[[0, 1.5, 0.25, 0.5], [2, 2.1, 0.2, 0.62]]} />
        <Punch text="Honest about what's left." at={8} x={790} y={826} size={62} width={940} mark={3} />
      </Part>
      <div style={{ display: "none" }}>{even}</div>
    </>
  );
};

const Close: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const L = len(s);
  const plain = local(s, cue("and plain code"));
  const screens = local(s, cue("It screens"));
  const turns = local(s, cue("Basement Ready turns"));
  const tryIt = local(s, cue("Try it"));
  const rows = ["Every rule", "Every dimension", "Every dollar"];
  return (
    <>
      {take.howClip ? (
        <Part from={0} to={turns - 4}>
          <Clip3D file="how-it-works.mp4" rate={Math.max(1, take.howClip / Math.max(1, (turns - 4) / FPS))} />
          <Punch text="It screens. The city decides." at={screens} x={200} y={760} size={68} width={1200} />
        </Part>
      ) : null}
      <Part from={take.howClip ? -999 : 0} to={take.howClip ? -990 : plain - 4}>
        <div style={{ position: "absolute", left: 180, top: 260, width: 760, borderRadius: 4, overflow: "hidden", border: `1.5px solid ${C.ink}` }}>
          <Img src={staticFile("david/03-wait-sam-doors.jpg")} style={{ width: 760, display: "block", transform: `scale(${1 + frame * 0.0008})` }} />
        </div>
        <LogPanel dur={70} />
        <Pipeline frame={frame} enter={4} rise={34} leave={plain + 100} active={frame > 40 ? (["sam", "map", "wonder", "spark", "image"][Math.floor((frame - 40) / 22) % 5]) : ""} />
      </Part>
      <Part from={take.howClip ? -999 : plain - 4} to={take.howClip ? -990 : turns - 4}>
        <Run n="04-answer-plan" cam={[[0, 1.3, 0.2, 0.5], [6, 1.4, 0.2, 0.5]]} />
        <div style={{ position: "absolute", left: 1080, top: 200, width: 640, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "24px 30px", fontFamily: SANS }}>
          <div style={{ fontWeight: 900, fontSize: 46, letterSpacing: "-0.035em", lineHeight: 1 }}>Checked in code</div>
          <div style={{ borderTop: `1.5px solid ${C.ink}`, marginTop: 20 }}>
            {rows.map((r, i) => {
              const p = prog(frame, plain + 10 + i * 12, 10, easeOut);
              return (
                <div key={r} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: `1px solid ${C.border}`, opacity: p, transform: `translateX(${(1 - p) * 20}px)` }}>
                  <span style={{ fontWeight: 700, fontSize: 30 }}>{r}</span>
                  <span style={{ color: C.ok, fontWeight: 700, fontSize: 28 }}>✓</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 14, opacity: prog(frame, plain + 50, 10) }}>The models describe; the rules, sizes and costs are worked out in code.</div>
        </div>
        <Punch text="It screens. The city decides." at={screens - (take.howClip ? screens - 4 : plain - 4)} x={140} y={740} size={72} width={1200} />
      </Part>
      <Part from={turns - 4} to={tryIt + 14}>
        <Browser x={180} y={46} w={1560} src="footage/desktop-home.mp4" start={0.4} rate={0.4} url="basementready.com" cam={[[0, 1.0, 0.5, 0.5], [4, 1.3, 0, 0.5]]} tilt />
      </Part>
      <Sequence from={tryIt + 16}>
        <EndHold />
      </Sequence>
      <div style={{ display: "none" }}>{L}</div>
    </>
  );
};

/** The end card on its own sheet, fading up once and held to the end. */
const EndHold: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ backgroundColor: C.bg, opacity: prog(frame, 0, 10) }}>
      <EndCard />
    </AbsoluteFill>
  );
};

const VIEWS: Record<string, { name: string; C: React.FC<P> }> = {
  hook: { name: "The question", C: Hook },
  problem: { name: "The problem", C: Problem },
  input: { name: "Film it once", C: Input },
  answer: { name: "The answer", C: Answer },
  breakthrough: { name: "Check the plan", C: Breakthrough },
  design: { name: "Design", C: Design },
  build: { name: "Build", C: Build },
  close: { name: "Under the hood", C: Close },
};

// Music (public/audio/music.wav, cues in take.json): its drop lands on "And the answer comes first". The
// voice needs more time before the drop than the track's intro has, so 8 bars of the calm intro play twice,
// cut on bar lines, and the track starts with the video.
const DROP_EDIT = cue("And the answer") / FPS;
const M = take.music2;
const barAt = (k: number) => M.drop - k * M.bar;
const LOOP_A = barAt(M.loopFromBars), LOOP_B = barAt(M.loopToBars); // repeat [LOOP_A, LOOP_B]
const REPEAT = M.drop >= DROP_EDIT ? 0 : LOOP_B - LOOP_A;
const M0 = M.drop + REPEAT - DROP_EDIT; // where the track starts at frame 0
const SEAM = LOOP_B - M0; // edit time of the jump back
const speaking = (t: number) => SECS.some((s) => t >= s.start - 0.25 && t <= s.end + 0.35);
const musicLevel = (f: number) => {
  // under the voice while it speaks, up in the gaps, with half-second ramps
  const t = f / FPS;
  let k = 0;
  for (const d of [-0.5, -0.25, 0, 0.25, 0.5]) k += speaking(t + d) ? 1 : 0;
  const under = k / 5;
  const level = M.free * (1 - under) + M.under * under;
  return level * interpolate(f, [0, 12, TOTAL - 75, TOTAL - 3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
};

// Sound design: a whoosh into each section, a riser into the drop, an impact on it, clicks on the verdicts.
const SFX: { at: number; file: string; vol: number }[] = (() => {
  const out: { at: number; file: string; vol: number }[] = [];
  SECS.slice(1).forEach((s, i) => out.push({ at: s.v0 - 0.25, file: ["whoosh-1", "whoosh-3", "whoosh-1"][i % 3], vol: 0.35 }));
  out.push({ at: DROP_EDIT - 1.77, file: "riser", vol: 0.45 });
  out.push({ at: DROP_EDIT, file: "impact", vol: 0.6 });
  for (const p of ["Yes. Not", "Not as it", "Or, yes"]) out.push({ at: cue(p) / FPS, file: "click", vol: 0.5 });
  return out;
})();

export const Cut: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const cur = SECS.find((s) => frame / FPS >= s.v0 && frame / FPS < s.v1) ?? SECS[SECS.length - 1];
  return (
    <Sheet name={VIEWS[cur.id].name} index={SECS.indexOf(cur) + 1} of={SECS.length}>
      <AbsoluteFill style={{ backgroundImage: `linear-gradient(${C.border} 1px, transparent 1px), linear-gradient(90deg, ${C.border} 1px, transparent 1px)`, backgroundSize: "80px 80px", backgroundPosition: `${-(frame * 0.35) % 80}px ${-(frame * 0.12) % 80}px`, opacity: 0.45, filter: "blur(0.6px)" }} />
      {SECS.map((s, i) => {
        const V = VIEWS[s.id].C;
        const from = Math.round(s.v0 * FPS);
        const dur = Math.round((s.v1 - s.v0) * FPS) + (i < SECS.length - 1 ? 8 : 0);
        return (
          <Sequence key={s.id} from={from} durationInFrames={dur}>
            <V s={s} />
          </Sequence>
        );
      })}
      {SECS.map((s, i) => {
        const next = SECS[i + 1];
        const pad = Math.min(0.3, next ? (next.a - s.b) / 2 : 0.4);
        return (
          <Sequence key={`v-${s.id}`} from={Math.round(s.start * FPS)} durationInFrames={Math.round((s.b - s.a + pad) * FPS)}>
            <Audio src={staticFile("audio/voice.mp3")} startFrom={Math.round(s.a * FPS)} volume={1} />
          </Sequence>
        );
      })}
      <Sequence from={0} durationInFrames={Math.round(SEAM * FPS) + 2}>
        <Audio src={staticFile("audio/music.wav")} startFrom={Math.round(M0 * FPS)} volume={(f) => musicLevel(f) * Math.min(1, (Math.round(SEAM * FPS) + 2 - f) / 3)} />
      </Sequence>
      <Sequence from={Math.round(SEAM * FPS)}>
        <Audio src={staticFile("audio/music.wav")} startFrom={Math.round(LOOP_A * FPS)} volume={(f) => musicLevel(f + Math.round(SEAM * FPS)) * Math.min(1, (f + 1) / 3)} />
      </Sequence>
      {SFX.map((x, i) => (
        <Sequence key={`sfx-${i}`} from={Math.max(0, Math.round(x.at * FPS))} durationInFrames={90}>
          <Audio src={staticFile(`audio/sfx/${x.file}.wav`)} volume={x.vol} />
        </Sequence>
      ))}
      <Captions />
      <div style={{ display: "none" }}>{durationInFrames}</div>
    </Sheet>
  );
};

