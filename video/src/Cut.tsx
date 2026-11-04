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
const Clip3D: React.FC<{ file: string; from?: number; rate?: number }> = ({ file, from = 0, rate = 1 }) => {
  const frame = useCurrentFrame();
  const push = 1 + frame * 0.0006;
  return (
    <div style={{ position: "absolute", left: 160, top: 40, width: 1600, height: 900, borderRadius: 6, overflow: "hidden", boxShadow: "0 28px 64px -30px rgb(15 42 30 / 0.5)", transform: `perspective(2600px) rotateY(${1.6 * Math.sin(frame / 90)}deg)` }}>
      <OffthreadVideo src={staticFile(`clips/${file}`)} startFrom={Math.round(from * FPS)} playbackRate={rate} muted style={{ width: 1600, height: 900, transform: `scale(${push})` }} />
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
  const i = prog(frame, 0, 9, easeOut);
  const o = 1 - prog(frame, dur - 8, 8, easeDraw);
  return <AbsoluteFill style={{ opacity: Math.min(i, o), transform: `translateX(${(1 - i) * 90 - (1 - o) * 90}px)`, filter: i < 1 || o < 1 ? `blur(${((1 - i) + (1 - o)) * 6}px)` : undefined }}>{children}</AbsoluteFill>;
};

// ---- sections (each gets local frames: 0 = its visual start)
type P = { s: Sec };
const local = (s: Sec, globalFrame: number) => globalFrame - Math.round(s.v0 * FPS);
const len = (s: Sec) => Math.round((s.v1 - s.v0) * FPS);

const Hook: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const wipe = prog(frame, 40, 34, easeDraw);
  const push = interpolate(frame, [0, len(s)], [1, 1.07]);
  const could = local(s, cue("Could it become"));
  const parent = local(s, cue("For a parent"));
  const kid = local(s, cue("For a grown kid"));
  const rental = local(s, cue("Or a rental"));
  const w = 1040, h = (w * 720) / 1280;
  return (
    <Part from={0} to={len(s)}>
      <div style={{ position: "absolute", left: 800, top: 120, width: w, height: h, borderRadius: 4, overflow: "hidden", transform: `perspective(2600px) rotateY(${-3 + 1.5 * Math.sin(frame / 80)}deg)`, boxShadow: "0 28px 64px -30px rgb(15 42 30 / 0.5)" }}>
        <div style={{ position: "absolute", inset: 0, transform: `scale(${push})` }}>
          <Img src={staticFile("sample/sample/frames/0000.jpg")} style={{ position: "absolute", width: w, height: h }} />
          <div style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)` }}>
            <Img src={staticFile("sample/sample/looks/warm/1.jpg")} style={{ position: "absolute", width: w, height: h }} />
          </div>
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: wipe * w - 2, width: 4, background: C.mint, opacity: wipe > 0.02 && wipe < 0.98 ? 1 : 0 }} />
      </div>
      <div style={{ position: "absolute", left: 800, top: 120 + h + 14, fontSize: 21, color: C.muted, fontFamily: SANS }}>The example basement in Ontario, and the same frame virtually staged by Muse Image</div>
      <div style={{ position: "absolute", left: 120, top: 70, fontFamily: SANS, fontSize: 20, color: C.muted, opacity: Math.min(prog(frame, 4, 10), 1 - prog(frame, 200, 12)) }}>
        Built during the Meta AI Developer Hackathon, from an empty repo on <span style={{ fontFamily: MONO, color: C.ink }}>Oct 28, 2026</span>.
      </div>
      <Punch text="A real basement." at={6} out={could - 6} x={120} y={300} size={104} width={640} />
      <Punch text="Could it become a second home?" at={could} x={120} y={260} size={104} width={660} mark={4} />
      {[["For a parent", parent], ["For a grown kid", kid], ["A rental", rental]].map(([t, at], i) => {
        const p = prog(frame, at as number, 10, easeOut);
        return (
          <span key={i} style={{ position: "absolute", left: 124 + [0, 200, 440][i], top: 760, padding: "10px 18px", border: `1.5px solid ${C.ink}`, borderRadius: 4, fontFamily: SANS, fontWeight: 600, fontSize: 26, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
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

const Input: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const L = len(s);
  const sam = local(s, cue("Meta's SAM"));
  const map = local(s, cue("Map Anything"));
  const wonder = local(s, cue("And Muse Wonder"));
  const active = frame >= wonder ? "wonder" : frame >= map ? "map" : frame >= sam ? "sam" : "video";
  return (
    <>
      {/* film it once: a real basement, on a phone */}
      <Part from={0} to={sam - 4}>
        <Phone x={1120} y={40} h={900} src="footage/david-phone.mp4" start={2} />
        <Punch text="Film it once." at={8} x={120} y={330} size={120} width={900} mark={2} />
        <div style={{ position: "absolute", left: 124, top: 500, fontFamily: SANS, fontSize: 28, color: C.muted, width: 700, opacity: prog(frame, 30, 12) }}>One slow walk through, on your phone. No special gear.</div>
      </Part>
      {/* SAM 3.1 on the example video: its real tracks, drawn */}
      <Part from={sam - 4} to={map - 4}>
        <div style={{ position: "absolute", left: 240, top: 210, width: 1440, height: 810, transform: `perspective(2600px) rotateY(${2.5 * Math.sin(frame / 90)}deg)`, boxShadow: "0 28px 64px -30px rgb(15 42 30 / 0.5)" }}>
          <SamVideo w={1440} />
        </div>
      </Part>
      {/* MapAnything: the points and the solid model, from the live site's own story */}
      <Part from={map - 4} to={wonder - 4}>
        <Clip3D file="01-assemble.mp4" rate={Math.min(1.15, 7 / Math.max(1, (wonder - map) / FPS))} />
        <Sequence from={Math.round((wonder - map) * 0.55)}>
          <Measured />
        </Sequence>
      </Part>
      {/* Wonder, and the live log of Meta calls (continues into the answer section) */}
      <Part from={wonder - 4} to={L + 4}>
        <Rec shot={SHOTS.wait!} from={1.0} x={180} y={170} w={770} cam={[[0, 1.32, 0, 0.5]]} />
        <LogPanel dur={L - wonder + 130} />
      </Part>
      <Pipeline frame={frame} enter={sam - 40} rise={sam - 40} leave={L + 200} active={active} />
    </>
  );
};

const Answer: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const drop = local(s, cue("And the answer"));
  const yes = local(s, cue("Yes. Not"));
  const not = local(s, cue("Not as it"));
  const after = local(s, cue("Or, yes"));
  const every = local(s, cue("Every fix"));
  const grants = local(s, cue("and the grants"));
  const L = len(s);
  const t0 = drop / FPS;
  // the stamp lands on the drop with a spring and a small shake
  const sp = spring({ frame: frame - drop, fps: FPS, config: { damping: 11, stiffness: 180, mass: 0.6 } });
  const shake = frame >= drop && frame < drop + 12 ? (1 - (frame - drop) / 12) * 4 : 0;
  const cam: CamKey[] = [[0, 1, 0.5, 0.5], [(yes + 6) / FPS - 0, 1, 0.5, 0.5], [(every - 4) / FPS, 1.3, 0.3, 0.42], [(every + 70) / FPS, 1.45, 0.28, 0.32]];
  return (
    <>
      {/* the log keeps going while Spark checks, then the answer lands on the drop */}
      <Part from={0} to={drop - 2}>
        <Rec shot={SHOTS.wait!} from={2.6} x={180} y={170} w={770} cam={[[0, 1.32, 0, 0.5]]} />
        <Sequence from={-130}>
          <LogPanel dur={drop + 130} />
          <LiveAnswer from={drop + 130 - 78} />
        </Sequence>
        <Pipeline frame={frame + 400} enter={0} rise={0} leave={drop + 400 - 6} active="spark" />
      </Part>
      <Part from={drop - 2} to={grants - 4}>
        <AbsoluteFill style={{ transform: `translate(${Math.sin(frame * 2.3) * shake}px, ${Math.cos(frame * 2.9) * shake}px)` }}>
          <Rec shot={SHOTS.answer!} from={2.2} cam={cam.map(([t, ...r]) => [t - (drop - 2) / FPS, ...r] as CamKey)} rate={0.8} />
          <div style={{ position: "absolute", left: 300, top: 330, opacity: Math.min(1, sp * 1.2) * (1 - prog(frame, yes + 4, 8)), transform: `rotate(-3deg) scale(${1.4 - 0.4 * sp})`, background: C.card, border: `7px solid ${C.ink}`, borderRadius: 6, padding: "20px 40px 26px", fontFamily: SANS, fontWeight: 900, fontSize: 96, letterSpacing: "-0.045em" }}>
            The answer comes first.
          </div>
          {/* the three answers it can give, in their verdict colours */}
          {[["Yes.", C.ok, yes], ["Not as it is.", C.stop, not], ["Yes, after a few fixes.", C.fix, after]].map(([t, col, at], i) => {
            const p = spring({ frame: frame - (at as number), fps: FPS, config: { damping: 12, stiffness: 200, mass: 0.5 } });
            const gone = prog(frame, every - 6, 8);
            return (
              <div key={i} style={{ position: "absolute", left: 300 + i * 0, top: 300 + i * 120, opacity: Math.min(1, p) * (1 - gone), transform: `rotate(-2deg) scale(${1.25 - 0.25 * Math.min(1, p)})`, transformOrigin: "left center", background: C.card, border: `6px solid ${col}`, color: col as string, borderRadius: 6, padding: "12px 30px 16px", fontFamily: SANS, fontWeight: 900, fontSize: 72, letterSpacing: "-0.04em" }}>
                {t as string}
              </div>
            );
          })}
          <FixPulse at={every + 66} />
          <CostCard at={every + 30} out={grants + 40} />
        </AbsoluteFill>
      </Part>
      <Part from={grants - 4} to={L}>
        <Rec shot={SHOTS.homebase!} cam={[[0, 1.45, 0.78, 0.18], [9, 1.5, 0.78, 0.18]]} />
        <Money />
      </Part>
    </>
  );
};

const Breakthrough: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const L = len(s);
  const drag = local(s, cue("drag it"));
  const type = local(s, cue("or just type"));
  const upd = local(s, cue("The plan updates"));
  const one = local(s, cue("It's one model"));
  // line the window drag in the recording (7.9 s into the clip) up with "drag it"
  const planFrom = Math.max(0.5, 7.6 - drag / FPS);
  return (
    <>
      <Part from={0} to={type - 4}>
        <Rec shot={SHOTS.plan!} from={planFrom} cam={[[0, 1.1, 0.2, 0.55], [(drag - 30) / FPS, 1.34, 0, 0.55], [(drag + 60) / FPS, 1.6, 0.12, 0.85]]} />
        <Punch text="Yours to check." at={14} out={drag - 10} x={1060} y={150} size={84} width={700} mark={2} />
      </Part>
      <Part from={type - 4} to={upd - 4}>
        <Rec shot={SHOTS.tape!} from={11.0} cam={[[0, 1.2, 1, 0.75], [2.5, 1.7, 1, 0.75]]} />
      </Part>
      <Part from={upd - 4} to={one - 4}>
        <Rec shot={SHOTS.answer!} from={6.5} cam={[[0, 1.25, 0.25, 0.4], [3, 1.5, 1, 0.82]]} />
        <Punch text="Drag a wall. Everything updates." at={6} x={140} y={640} size={76} width={1100} mark={3} />
      </Part>
      <Part from={one - 4} to={L}>
        <Clip3D file="03-plan-to-3d.mp4" rate={Math.max(1, 8 / Math.max(1, (L - one) / FPS))} />
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
      <Part from={0} to={walk - 4}>
        <Rec shot={SHOTS.layouts!} from={3.4} cam={[[0, 1.05, 0.2, 0.5], [3, 1.32, 0, 0.5], [7, 1.42, 0, 0.55]]} />
      </Part>
      <Part from={walk - 4} to={muse - 4}>
        <Clip3D file="04-flythrough.mp4" />
      </Part>
      <Part from={muse - 4} to={L}>
        <Rec shot={SHOTS.looks!} from={19.6} cam={[[0, 1.32, 0, 0.5], [9, 1.4, 0, 0.5]]} />
        <Punch text="Your basement, finished." at={fin - muse + 4} x={140} y={700} size={80} width={1200} mark={2} />
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
        <Rec shot={SHOTS.build!} from={4.2} cam={[[0, 1.2, 0.3, 0.5], [3, 1.6, 0.3, 0.5]]} />
        <SheetStack at={30} />
        <Punch text="Drafted. Filled." at={18} x={140} y={720} size={88} width={900} />
      </Part>
      <Part from={honest - 4} to={even - 4}>
        <Rec shot={SHOTS.build!} from={7.0} cam={[[0, 1.6, 0.3, 0.5], [2, 2.1, 0.36, 0.62]]} />
        <Punch text="Honest about what's left." at={8} x={140} y={130} size={80} width={1300} mark={3} />
      </Part>
      <Part from={even - 4} to={L}>
        <Rec shot={SHOTS.homebase!} cam={[[0, 1.3, 0.5, 0.2], [3, 1.7, 0.5, 0.3]]} />
      </Part>
    </>
  );
};

const Close: React.FC<P> = ({ s }) => {
  const frame = useCurrentFrame();
  const L = len(s);
  const plain = local(s, cue("And plain code"));
  const screens = local(s, cue("It screens"));
  const turns = local(s, cue("Basement Ready turns"));
  const tryIt = local(s, cue("Try it"));
  const rows = ["Every rule", "Every dimension", "Every dollar"];
  return (
    <>
      <Part from={0} to={plain - 4}>
        <Clip3D file="02-finds.mp4" rate={Math.max(1, 8 / Math.max(1, plain / FPS))} />
        <Pipeline frame={frame} enter={4} rise={34} leave={plain + 100} active={frame > 40 ? (["sam", "map", "wonder", "spark", "image"][Math.floor((frame - 40) / 22) % 5]) : ""} />
      </Part>
      <Part from={plain - 4} to={turns - 4}>
        <Rec shot={SHOTS.answer!} from={8.5} cam={[[0, 1.4, 0.28, 0.35], [6, 1.5, 0.28, 0.35]]} />
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
        <Punch text="It screens. The city decides." at={screens - plain + 4} x={140} y={720} size={72} width={1200} />
      </Part>
      <Part from={turns - 4} to={tryIt + 40}>
        <Rec shot={SHOTS.home!} from={0.4} rate={0.4} cam={[[0, 1.0, 0.5, 0.5], [4, 1.3, 0, 0.5]]} />
      </Part>
      <Sequence from={tryIt + 30}>
        <EndCard />
      </Sequence>
      <div style={{ display: "none" }}>{L}</div>
    </>
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

