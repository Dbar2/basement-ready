import React from "react";
import { Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { MONO, SANS } from "../fonts";
import { Browser, Mark, Phone, Status } from "../components/kit";
import { Milestones } from "../components/Milestones";
import { Plan } from "../components/Plan";
import { easeDraw, easeOut, prog } from "../anim";
import { SceneTiming, lineIn } from "../timeline";
import { SHOTS, Shot } from "../shots";
import type { CamKey } from "../components/kit";

/** A span of the scene: fades in at `from`, out at `to` (scene frames). */
export const Span: React.FC<{ from: number; to: number; children: React.ReactNode; fade?: number }> = ({ from, to, children, fade = 10 }) => (
  <Sequence from={from} durationInFrames={Math.max(1, to - from + fade)}>
    <Fader dur={to - from + fade} fade={fade}>{children}</Fader>
  </Sequence>
);
const Fader: React.FC<{ dur: number; fade: number; children: React.ReactNode }> = ({ dur, fade, children }) => {
  const frame = useCurrentFrame();
  const o = Math.min(prog(frame, 0, fade), 1 - prog(frame, dur - fade, fade, easeDraw));
  return <div style={{ position: "absolute", inset: 0, opacity: o }}>{children}</div>;
};

/** Real footage, laid out for its kind: a browser across the sheet, or a phone beside a headline. */
export const ShotView: React.FC<{ shot: Shot; span?: number; headline?: string; sub?: string; offset?: number }> = ({ shot, span = 0, headline, sub, offset = 0 }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, 0, 16);
  // slow the clip a touch if the voice needs longer than what's left of it
  const left = (shot.clip - shot.start - offset - 0.1) * 30;
  const rate = span > left ? Math.max(0.6, left / span) : 1;
  if (shot.kind === "desktop") {
    return <Browser x={180} y={38} w={1560} src={shot.file} start={shot.start + offset} p={p} url={shot.url} cam={shot.cam} rate={rate} />;
  }
  return (
    <>
      {headline && (
        <div style={{ position: "absolute", left: 120, top: 300, width: 820, fontFamily: SANS, opacity: p }}>
          <div style={{ fontWeight: 900, fontSize: 88, letterSpacing: "-0.045em", lineHeight: 0.95 }}>{headline}</div>
          {sub && <div style={{ fontSize: 28, color: C.muted, marginTop: 28, lineHeight: 1.35, width: 640 }}>{sub}</div>}
        </div>
      )}
      <Phone x={1160} y={150} h={800} src={shot.file} start={shot.start + offset} p={p} />
    </>
  );
};

/** The answer's verdict, landing like a stamp on the sheet. */
const Verdict: React.FC = () => {
  const frame = useCurrentFrame();
  const q = prog(frame, 0, 12);
  const s = prog(frame, 10, 9, easeOut);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: SANS, paddingTop: 40 }}>
      <div style={{ fontSize: 40, fontWeight: 600, color: C.muted, opacity: q, marginBottom: 44 }}>Can this basement be a second home?</div>
      <div
        style={{
          border: `7px solid ${C.fix}`,
          borderRadius: 6,
          padding: "26px 56px 34px",
          color: C.fix,
          fontWeight: 900,
          fontSize: 132,
          letterSpacing: "-0.045em",
          lineHeight: 1,
          opacity: s,
          transform: `rotate(-3deg) scale(${1.35 - 0.35 * s})`,
        }}
      >
        Yes, after 4 fixes
      </div>
      <div style={{ marginTop: 52, display: "flex", gap: 40, alignItems: "baseline", opacity: prog(frame, 26, 12) }}>
        <span style={{ fontSize: 30, fontWeight: 600 }}>The first: a fire separation between the two homes</span>
        <Status kind="fix" size={26}>To fix</Status>
      </div>
    </div>
  );
};

/** The verdict as a stamp landing on the real answer screen. */
export const Stamp: React.FC<{ out: number }> = ({ out }) => {
  const frame = useCurrentFrame();
  const s = prog(frame, 14, 9, easeOut);
  const o = Math.min(s, 1 - prog(frame, out, 12, easeDraw));
  return (
    <div
      style={{
        position: "absolute",
        left: 330,
        top: 380,
        background: C.card,
        border: `7px solid ${C.fix}`,
        borderRadius: 6,
        padding: "22px 44px 28px",
        color: C.fix,
        fontFamily: SANS,
        fontWeight: 900,
        fontSize: 104,
        letterSpacing: "-0.045em",
        lineHeight: 1,
        opacity: o,
        transform: `rotate(-3deg) scale(${1.35 - 0.35 * s})`,
      }}
    >
      Yes, after 4 fixes
      <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em", color: C.ink, marginTop: 14 }}>The first: a fire separation between the two homes</div>
    </div>
  );
};

/** The answer, drawn: the measured plan with the fix marked. Used when there's no footage. */
const AnswerDrawn: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Plan x={300} y={290} s={92} frame={frame} start={0} fix={20} />
      </svg>
      <div style={{ position: "absolute", left: 1180, top: 300, width: 640, fontFamily: SANS, opacity: prog(frame, 10, 12) }}>
        <div style={{ fontWeight: 900, fontSize: 64, letterSpacing: "-0.04em", lineHeight: 0.95, color: C.fix }}>Yes, after 4 fixes</div>
        <div style={{ borderTop: `1.5px solid ${C.ink}`, marginTop: 30 }}>
          {[["Fire separation", "To fix"], ["Rough cost", "a range"], ["Every rule", "with its source"]].map(([a, b]) => (
            <div key={a} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: `1px solid ${C.border}`, fontSize: 26 }}>
              <span style={{ fontWeight: 600 }}>{a}</span>
              <span style={{ color: C.muted }}>{b}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
};

const GRANTS: [string, string, number][] = [
  ["Multigenerational home tax credit", "Federal, at tax time", 7000],
  ["City of Waterloo ARU grant", "City of Waterloo", 20000],
  ["Region of Waterloo forgivable loan", "Region of Waterloo", 25000],
];
export const Money: React.FC = () => {
  const frame = useCurrentFrame();
  const p = prog(frame, 4, 14);
  return (
    <div style={{ position: "absolute", left: 1090, top: 150, width: 610, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "26px 30px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
      <div style={{ fontWeight: 900, fontSize: 52, letterSpacing: "-0.04em", lineHeight: 0.95 }}>The money that fits</div>
      <div style={{ borderTop: `1.5px solid ${C.ink}`, marginTop: 24 }}>
        {GRANTS.map(([name, who, max], i) => {
          const q = prog(frame, 12 + i * 12, 14);
          const n = Math.round(interpolate(frame, [16 + i * 12, 46 + i * 12], [0, max], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw }) / 100) * 100;
          return (
            <div key={name} style={{ padding: "16px 0", borderBottom: `1px solid ${C.border}`, opacity: q }}>
              <div style={{ fontWeight: 700, fontSize: 26, lineHeight: 1.2 }}>{name}</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                <span style={{ fontSize: 21, color: C.muted }}>{who}</span>
                <span>
                  <span style={{ fontSize: 20, color: C.muted, marginRight: 10 }}>up to</span>
                  <span style={{ fontWeight: 900, fontSize: 40, letterSpacing: "-0.03em" }}>${n.toLocaleString("en-CA")}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 21, color: C.muted, marginTop: 16 }}>Each with its source and how to apply.</div>
    </div>
  );
};

export const Answer: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const n7 = lineIn(scene, "N07b"), n8 = lineIn(scene, "N08"), l13 = lineIn(scene, "L13");
  const ans = SHOTS.answer!;
  const t7 = n7.from / 30;
  // hold wide while the stamp lands, ease in on the guide's verdict, then on the fix marked in the plan
  const cam: CamKey[] = [[0, 1, 0.5, 0.5], [t7 + 2.2, 1, 0.5, 0.5], [t7 + 3.8, 1.75, 1, 0.8], [t7 + 6.2, 1.75, 1, 0.8], [t7 + 7.8, 1.45, 0.28, 0.32]];
  return (
    <>
      <Span from={0} to={n8.from - 6} fade={8}>
        <ShotView shot={{ ...ans, cam }} span={n8.from} />
        <Stamp out={n7.from + 66} />
        <FixPulse at={n7.from + Math.round(7.9 * 30)} />
        <CostCard at={n7.from + 118} out={n7.from + 228} />
      </Span>
      <Span from={n8.from - 6} to={l13.from - 6}>
        <ShotView shot={{ ...SHOTS.homebase!, cam: [[0, 1.45, 0.78, 0.18], [9, 1.5, 0.78, 0.18]] }} span={l13.from - n8.from} />
        <Money />
      </Span>
      <Span from={l13.from - 6} to={scene.duration}>
        <ShotView shot={SHOTS.explain!} span={scene.duration - l13.from + 6} />
      </Span>
    </>
  );
};

/** The fix on the measured plan, ringed and pulsing once the camera is on it. */
export const FixPulse: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  const o = prog(frame, at, 10);
  if (o <= 0) return null;
  const k = ((frame - at) % 36) / 36;
  // where the stairs' fire separation sits on screen once the camera has eased in on the plan (frame 4 of the clip)
  const cx = 640, cy = 327;
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0, opacity: o }}>
      <ellipse cx={cx} cy={cy} rx={225 + k * 60} ry={110 + k * 40} fill="none" stroke={C.fix} strokeWidth={4} opacity={1 - k} />
      <ellipse cx={cx} cy={cy} rx={225} ry={110} fill="none" stroke={C.fix} strokeWidth={3} />
    </svg>
  );
};

/** The rough cost and the money back, counting up, over the answer. */
export const CostCard: React.FC<{ at: number; out: number }> = ({ at, out }) => {
  const frame = useCurrentFrame();
  const p = Math.min(prog(frame, at, 14), 1 - prog(frame, out, 10, easeDraw));
  if (p <= 0) return null;
  const n = (v: number) => Math.round(interpolate(frame, [at + 4, at + 34], [0, v], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: easeDraw }));
  return (
    <div style={{ position: "absolute", left: 230, top: 640, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "20px 28px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)`, display: "flex", gap: 48 }}>
      <div>
        <div style={{ fontSize: 22, color: C.muted }}>Rough cost, hired out</div>
        <div style={{ fontWeight: 900, fontSize: 56, letterSpacing: "-0.04em" }}>${n(49)}k–${n(85)}k</div>
      </div>
      <div>
        <div style={{ fontSize: 22, color: C.muted }}>Money back</div>
        <div style={{ fontWeight: 900, fontSize: 56, letterSpacing: "-0.04em" }}>up to ${n(7)},000</div>
      </div>
    </div>
  );
};

const AskDrawn: React.FC = () => (
  <div style={{ position: "absolute", left: 120, top: 320, fontFamily: SANS }}>
    <div style={{ fontWeight: 900, fontSize: 96, letterSpacing: "-0.045em", lineHeight: 0.95 }}>What's a fire separation?</div>
  </div>
);

const LOOKS = ["warm", "bright", "green", "cottage"] as const;
const LOOK_NAMES: Record<string, string> = { warm: "Warm", bright: "Bright", green: "Green", cottage: "Cottage" };

/** Before and after on the example's own frame: the real frame, then Muse Image's picture of it. */
export const BeforeAfter: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const w = 1100, h = (w * 720) / 1280;
  const wipe = prog(frame, 16, 34, easeDraw);
  const step = Math.max(40, Math.floor((dur - 60) / 3));
  const lookIdx = Math.min(3, Math.max(0, Math.floor((frame - 60) / step) + 1));
  const lk = frame < 60 ? 0 : lookIdx;
  const x = 120, y = 210;
  return (
    <>
      <div style={{ position: "absolute", left: x, top: y, width: w, height: h, borderRadius: 4, overflow: "hidden" }}>
        <Img src={staticFile("sample/sample/frames/0000.jpg")} style={{ position: "absolute", width: w, height: h }} />
        {LOOKS.map((l, i) => (
          <div key={l} style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`, opacity: i === lk ? 1 : i < lk ? 1 : 0 }}>
            <Img src={staticFile(`sample/sample/looks/${l}/1.jpg`)} style={{ position: "absolute", width: w, height: h, opacity: i <= lk ? 1 : 0 }} />
          </div>
        ))}
        <div style={{ position: "absolute", top: 0, bottom: 0, left: wipe * w - 1, width: 2, background: C.card, opacity: wipe > 0 && wipe < 1 ? 1 : 0 }} />
      </div>
      <div style={{ position: "absolute", left: x, top: y + h + 14, fontFamily: SANS, fontSize: 22, color: C.muted }}>
        Virtually staged · the example's own frame, restyled by Muse Image
      </div>
      <div style={{ position: "absolute", left: x + w + 60, top: y, width: 520, fontFamily: SANS }}>
        <div style={{ fontWeight: 900, fontSize: 72, letterSpacing: "-0.045em", lineHeight: 0.95 }}>Before and after</div>
        <div style={{ fontSize: 26, color: C.muted, marginTop: 22, lineHeight: 1.35 }}>In the look you picked. The window and stairs stay where they are.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 34 }}>
          {LOOKS.map((l, i) => (
            <span
              key={l}
              style={{
                padding: "10px 18px",
                borderRadius: 4,
                border: `1.5px solid ${C.ink}`,
                background: i === lk ? C.ink : "transparent",
                color: i === lk ? C.card : C.ink,
                fontSize: 24,
                fontWeight: 600,
              }}
            >
              {LOOK_NAMES[l]}
            </span>
          ))}
        </div>
      </div>
    </>
  );
};

export const Design: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const n9 = lineIn(scene, "N09"), n10 = lineIn(scene, "N10");
  const layoutsAt = n9.from + Math.round(n9.dur * 0.42);
  return (
    <>
      <Span from={0} to={layoutsAt} fade={8}>
        <ShotView shot={SHOTS.plan!} span={layoutsAt} />
      </Span>
      <Span from={layoutsAt} to={n10.from - 6}>
        <ShotView shot={SHOTS.layouts!} span={n10.from - layoutsAt} />
      </Span>
      <Span from={n10.from - 6} to={scene.duration}>
        <ShotView shot={SHOTS.looks!} span={scene.duration - n10.from + 6} />
      </Span>
    </>
  );
};

const LayoutDrawn: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        <Plan x={300} y={290} s={92} frame={frame + 40} start={0} zones={4} />
      </svg>
      <div style={{ position: "absolute", left: 1180, top: 300, fontFamily: SANS, fontWeight: 900, fontSize: 80, letterSpacing: "-0.045em", lineHeight: 0.95, width: 640 }}>Pick a layout.</div>
    </>
  );
};

const SHEETS = ["Site plan", "Floor plan", "Section", "Fire separation", "Forms"];
const PermitSheets: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <div style={{ position: "absolute", left: 120, top: 220, width: 600, fontFamily: SANS, opacity: prog(frame, 0, 12) }}>
        <div style={{ fontWeight: 900, fontSize: 96, letterSpacing: "-0.045em", lineHeight: 0.95 }}>The permit set</div>
        <div style={{ fontSize: 28, color: C.muted, marginTop: 26, lineHeight: 1.35 }}>Drawn and filled in from the scan.</div>
      </div>
      {SHEETS.map((name, i) => {
        const p = prog(frame, 8 + i * 9, 18, easeOut);
        const x = 760 + i * 190;
        const y = 230 + i * 26;
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: x + (1 - p) * 500,
              top: y,
              width: 420,
              height: 594,
              background: C.card,
              border: `1.5px solid ${C.ink}`,
              borderRadius: 4,
              opacity: p,
              fontFamily: SANS,
            }}
          >
            <svg width={420} height={594} style={{ position: "absolute", inset: 0 }}>
              <rect x={18} y={18} width={384} height={480} fill="none" stroke={C.border} />
              {/* a little drawing per sheet */}
              {i === 0 && <rect x={90} y={120} width={240} height={200} fill="none" stroke={C.ink} strokeWidth={2} />}
              {i === 0 && <rect x={60} y={90} width={300} height={300} fill="none" stroke={C.muted} strokeDasharray="6 6" />}
              {i === 1 && <path d="M70 120 H350 V380 H70 Z M70 250 H200 M200 250 V380 M260 120 V220" fill="none" stroke={C.ink} strokeWidth={2.5} />}
              {i === 2 && <path d="M50 240 H370 M90 240 V400 H330 V240 M80 240 L210 130 L340 240" fill="none" stroke={C.ink} strokeWidth={2.5} />}
              {i === 3 && <path d="M70 160 H350 M70 172 H350 M70 184 H350 M120 200 V400 M300 200 V400" fill="none" stroke={C.fix} strokeWidth={3} />}
              {i === 4 && [0, 1, 2, 3, 4, 5, 6].map((r) => <rect key={r} x={60} y={110 + r * 48} width={300} height={28} fill="none" stroke={C.border} />)}
              <line x1={0} y1={510} x2={420} y2={510} stroke={C.ink} />
            </svg>
            <div style={{ position: "absolute", left: 20, bottom: 26, fontWeight: 700, fontSize: 24 }}>{name}</div>
            <div style={{ position: "absolute", right: 20, bottom: 28, fontFamily: MONO, fontSize: 18 }}>A-{String(i + 1).padStart(2, "0")}</div>
          </div>
        );
      })}
    </>
  );
};

export const Build: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const n11 = lineIn(scene, "N11"), n12 = lineIn(scene, "N12");
  const tapeAt = n11.from + Math.round(n11.dur * 0.66);
  return (
    <>
      <Span from={0} to={tapeAt} fade={8}>
        <ShotView shot={SHOTS.build!} span={tapeAt} />
        <SheetStack at={n11.from + 40} />
      </Span>
      <Span from={tapeAt} to={n12.from - 6}>
        <ShotView shot={SHOTS.tape!} span={n12.from - tapeAt} />
      </Span>
      <Span from={n12.from - 6} to={scene.duration}>
        <ShotView shot={SHOTS.homebase!} span={scene.duration - n12.from + 6} />
      </Span>
    </>
  );
};

/** Permit sheets sliding in and stacking beside the app's own permit set. */
const STACK = ["Floor plan", "Section", "Fire separation", "City forms"];
export const SheetStack: React.FC<{ at: number }> = ({ at }) => {
  const frame = useCurrentFrame();
  return (
    <>
      {STACK.map((name, i) => {
        const p = prog(frame, at + i * 9, 16, easeOut);
        if (p <= 0) return null;
        return (
          <div key={name} style={{ position: "absolute", left: 1290 + (1 - p) * 420 + i * 14, top: 250 + i * 18, width: 360, height: 470, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 4, opacity: p, fontFamily: SANS, transform: `rotate(${(i - 1.5) * 1.2}deg)` }}>
            <svg width={360} height={470} style={{ position: "absolute", inset: 0 }}>
              <rect x={16} y={16} width={328} height={370} fill="none" stroke={C.border} />
              {i === 0 && <path d="M60 90 H300 V320 H60 Z M60 200 H170 V320 M220 90 V180" fill="none" stroke={C.ink} strokeWidth={2.5} />}
              {i === 1 && <path d="M40 200 H320 M70 200 V340 H290 V200 M60 200 L180 100 L300 200" fill="none" stroke={C.ink} strokeWidth={2.5} />}
              {i === 2 && <path d="M60 130 H300 M60 142 H300 M60 154 H300 M110 170 V340 M250 170 V340" fill="none" stroke={C.fix} strokeWidth={3} />}
              {i === 3 && [0, 1, 2, 3, 4, 5].map((r) => <rect key={r} x={50} y={80 + r * 46} width={260} height={26} fill="none" stroke={C.border} />)}
              <line x1={0} y1={400} x2={360} y2={400} stroke={C.ink} />
            </svg>
            <div style={{ position: "absolute", left: 18, bottom: 22, fontWeight: 700, fontSize: 22 }}>{name}</div>
            <div style={{ position: "absolute", right: 18, bottom: 24, fontFamily: MONO, fontSize: 16 }}>A-{String(i + 1).padStart(2, "0")}</div>
          </div>
        );
      })}
    </>
  );
};

const BigLine: React.FC<{ text: string }> = ({ text }) => (
  <div style={{ position: "absolute", left: 120, top: 360, fontFamily: SANS, fontWeight: 900, fontSize: 104, letterSpacing: "-0.045em", lineHeight: 0.95, width: 1400 }}>{text}</div>
);

export const Close: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const n13 = lineIn(scene, "N13"), n14 = lineIn(scene, "N14");
  const endAt = n14.from + n14.dur - 20;
  return (
    <>
      <Span from={0} to={n14.from - 8} fade={8}>
        <ShotView shot={{ ...SHOTS.home!, start: 11.6, clip: 17.3, cam: [[0, 1.35, 1, 0.5], [9, 1.42, 1, 0.5]] }} span={n14.from} />
        <Promise />
      </Span>
      <Span from={n14.from - 8} to={endAt + 8} fade={8}>
        <ShotView shot={SHOTS.home!} span={endAt - n14.from + 16} />
      </Span>
      <Span from={endAt} to={scene.duration + 10} fade={12}>
        <EndCard />
      </Span>
      <div style={{ display: "none" }}>{n13.id}</div>
    </>
  );
};

export const EndCard: React.FC = () => {
  const frame = useCurrentFrame();
  const p = (d: number) => prog(frame, d, 14);
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", fontFamily: SANS, paddingBottom: 60 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 28, opacity: p(0), transform: `translateY(${(1 - p(0)) * 16}px)` }}>
        <Mark h={120} />
        <span style={{ fontWeight: 800, fontSize: 104, letterSpacing: "-0.035em" }}>Basement Ready</span>
      </div>
      <div style={{ marginTop: 56, display: "flex", alignItems: "center", gap: 36, opacity: p(10) }}>
        <span style={{ background: C.mint, color: C.ink, fontWeight: 700, fontSize: 36, padding: "20px 34px", borderRadius: 6 }}>Try the example →</span>
        <span style={{ fontFamily: MONO, fontSize: 40 }}>basementready.com</span>
      </div>
      <div style={{ marginTop: 64, fontSize: 30, fontWeight: 600, opacity: p(22) }}>Built for the Meta AI Developer Hackathon</div>
      <div style={{ marginTop: 18, fontSize: 22, color: C.muted, opacity: p(30), textAlign: "center", lineHeight: 1.5 }}>
        sam-3.1 · muse-spark-1.3 · muse-wonder-1.0 · muse-image-1.0 · muse-voice-transcribe-1.0 · MapAnything · DINOv2
        <br />
        Voice and music made with ElevenLabs
      </div>
    </div>
  );
};

/** It screens; the city decides. The home base behind, quiet. */
const Promise: React.FC = () => {
  const frame = useCurrentFrame();
  const rows: [string, string][] = [
    ["Your scan is private", "only your phone or your account opens it"],
    ["Nothing is sent without you", "forms, emails and quote requests are drafts"],
    ["It screens; the city decides", "a designer confirms the details"],
  ];
  const p = prog(frame, 4, 14);
  return (
    <div style={{ position: "absolute", left: 220, top: 470, width: 760, background: C.card, border: `1.5px solid ${C.ink}`, borderRadius: 6, padding: "26px 32px", fontFamily: SANS, opacity: p, transform: `translateY(${(1 - p) * 14}px)` }}>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map(([a, b], i) => {
          const q = prog(frame, 10 + i * 12, 14);
          return (
            <div key={a} style={{ padding: "16px 0", borderBottom: `1px solid ${C.border}`, opacity: q }}>
              <div style={{ fontWeight: 800, fontSize: 32, letterSpacing: "-0.02em" }}>{a}</div>
              <div style={{ fontSize: 23, color: C.muted, marginTop: 4 }}>{b}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** The money to apply for, who builds it, and the book: pages coming up one after another. */
const PAGES = ["The answer", "Your plan", "The permit set", "The money", "Who builds it", "Next steps"];
const BookDrawn: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <>
      <Milestones current={2} />
      <div style={{ position: "absolute", left: 120, top: 220, width: 620, fontFamily: SANS, opacity: prog(frame, 0, 12) }}>
        <div style={{ fontWeight: 900, fontSize: 96, letterSpacing: "-0.045em", lineHeight: 0.95 }}>One book to hand over</div>
        <div style={{ borderTop: `1.5px solid ${C.ink}`, marginTop: 44 }}>
          {[["The money to apply for", "with how to apply"], ["Registered designers and trades", "you pick who gets asked"]].map(([a, b], i) => (
            <div key={a} style={{ padding: "18px 0", borderBottom: `1px solid ${C.border}`, opacity: prog(frame, 10 + i * 10, 12) }}>
              <div style={{ fontWeight: 700, fontSize: 30 }}>{a}</div>
              <div style={{ fontSize: 24, color: C.muted, marginTop: 4 }}>{b}</div>
            </div>
          ))}
        </div>
      </div>
      {PAGES.map((name, i) => {
        const p = prog(frame, 14 + i * 9, 16, easeOut);
        const col = i % 3, row = Math.floor(i / 3);
        return (
          <div
            key={name}
            style={{
              position: "absolute",
              left: 860 + col * 320,
              top: 190 + row * 380 + (1 - p) * 30,
              width: 290,
              height: 350,
              background: C.card,
              border: `1.5px solid ${C.ink}`,
              borderRadius: 4,
              opacity: p,
              fontFamily: SANS,
            }}
          >
            <svg width={290} height={350} style={{ position: "absolute", inset: 0 }}>
              <line x1={22} y1={40} x2={170} y2={40} stroke={C.ink} strokeWidth={6} />
              {[70, 88, 106].map((y) => <line key={y} x1={22} y1={y} x2={250} y2={y} stroke={C.border} strokeWidth={4} />)}
              {i === 1 && <path d="M40 140 H250 V280 H40 Z M40 210 H140 V280 M180 140 V200" fill="none" stroke={C.ink} strokeWidth={2.5} />}
              {i === 2 && <rect x={60} y={140} width={170} height={140} fill="none" stroke={C.ink} strokeWidth={2} />}
              {i === 3 && [0, 1, 2].map((r) => <line key={r} x1={22} y1={150 + r * 40} x2={268} y2={150 + r * 40} stroke={C.ink} strokeWidth={1} />)}
              {i === 0 && <rect x={22} y={140} width={200} height={56} fill="none" stroke={C.fix} strokeWidth={4} />}
            </svg>
            <div style={{ position: "absolute", left: 22, bottom: 20, fontWeight: 700, fontSize: 22 }}>{name}</div>
            <div style={{ position: "absolute", right: 18, bottom: 22, fontFamily: MONO, fontSize: 16, color: C.muted }}>{String(i + 1).padStart(2, "0")}</div>
          </div>
        );
      })}
    </>
  );
};
