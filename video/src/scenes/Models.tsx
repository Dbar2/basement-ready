import React from "react";
import { Img, Loop, Sequence, staticFile, useCurrentFrame } from "remotion";
import { C, FIND } from "../theme";
import { MONO, SANS } from "../fonts";
import { Draw, Phone, Status } from "../components/kit";
import { Plan } from "../components/Plan";
import { SamVideo, firstSeen } from "../components/SamVideo";
import { easeDraw, prog } from "../anim";
import { SceneTiming, lineIn } from "../timeline";
import { SHOTS } from "../shots";

const NODES = [
  { id: "video", name: "Your video", role: "one take, on a phone", model: "" },
  { id: "sam", name: "SAM 3.1", role: "finds and tracks", model: "sam-3.1" },
  { id: "map", name: "MapAnything", role: "measures depth", model: "map-anything" },
  { id: "wonder", name: "Muse Wonder", role: "watches the take", model: "muse-wonder-1.0" },
  { id: "spark", name: "Muse Spark", role: "checks the code", model: "muse-spark-1.3" },
  { id: "image", name: "Muse Image", role: "restyles your frames", model: "muse-image-1.0" },
];
const NW = 252, NH = 118, NGAP = 44, NX = 96, NY = 74;

export const Models: React.FC<{ scene: SceneTiming }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const l5 = lineIn(scene, "L05"), l6 = lineIn(scene, "L06"), l7 = lineIn(scene, "L07"), l8 = lineIn(scene, "L08"), l9 = lineIn(scene, "L09");
  const end6 = l7.from - 8, end7 = l8.from - 8, end8 = l9.from - 8;
  const sparkAt = l8.from + Math.round(l8.dur * 0.4);
  const active =
    frame >= l9.from - 8 ? "" : frame >= sparkAt ? "spark" : frame >= l8.from - 8 ? "wonder" : frame >= l7.from - 8 ? "map" : frame >= l6.from - 8 ? "sam" : frame >= l5.from + 10 ? "video" : "";
  const pipeOut = prog(frame, l9.from - 10, 12, easeDraw);
  const panel = (start: number, end: number) => Math.min(prog(frame, start, 14), 1 - prog(frame, end, 10, easeDraw));

  return (
    <>
      {/* the pipeline, drawn */}
      <svg width={1920} height={400} style={{ position: "absolute", left: 0, top: 0, opacity: 1 - pipeOut * 0.0 }}>
        {NODES.slice(0, -1).map((n, i) => {
          const x1 = NX + (i + 1) * NW + i * NGAP, x2 = x1 + NGAP;
          const y = NY + NH / 2;
          const p = prog(frame, l5.from + 6 + i * 6, 12, easeDraw);
          const dot = (frame * 1.6 + i * 20) % 60;
          return (
            <g key={n.id}>
              <Draw d={`M${x1} ${y} L${x2 - 2} ${y}`} p={p} width={2} />
              <Draw d={`M${x2 - 10} ${y - 7} L${x2 - 2} ${y} L${x2 - 10} ${y + 7}`} p={p >= 1 ? 1 : 0} width={2} />
              {p >= 1 && dot < NGAP - 12 && <circle cx={x1 + dot} cy={y} r={4.5} fill={C.mint} />}
            </g>
          );
        })}
      </svg>
      {NODES.map((n, i) => {
        const p = prog(frame, l5.from + i * 6, 14);
        const on = active === n.id;
        return (
          <div
            key={n.id}
            style={{
              position: "absolute",
              left: NX + i * (NW + NGAP),
              top: NY + (1 - p) * 18,
              width: NW,
              height: NH,
              boxSizing: "border-box",
              border: `1.5px solid ${C.ink}`,
              borderRadius: 6,
              background: on ? C.ink : C.bg,
              color: on ? C.card : C.ink,
              padding: "16px 18px",
              opacity: p,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 29, letterSpacing: "-0.02em", lineHeight: 1 }}>{n.name}</div>
              <div style={{ fontSize: 19, marginTop: 8, color: on ? C.border : C.muted }}>{n.role}</div>
            </div>
            <div style={{ fontFamily: MONO, fontSize: 15, color: on ? C.mint : C.muted }}>{n.model || " "}</div>
          </div>
        );
      })}
      <div style={{ position: "absolute", left: NX, top: NY + NH + 22, width: 1730, borderTop: `1px solid ${C.border}`, opacity: prog(frame, l5.from + 30, 10) }} />

      {/* L05: the hand-off line under the diagram */}
      <div style={{ position: "absolute", left: NX, top: 330, opacity: panel(l5.from + 10, end6 - 30), fontFamily: SANS }}>
        <div style={{ fontWeight: 900, fontSize: 112, letterSpacing: "-0.045em", lineHeight: 0.95, width: 1200 }}>Meta's models go to work.</div>
      </div>

      {/* L06: SAM 3.1 on the real example video */}
      <Sequence from={l6.from - 8} durationInFrames={end6 - l6.from + 18}>
        <SamPanel o={1} />
      </Sequence>
      <div style={{ position: "absolute", inset: 0, opacity: 0 }} />

      {/* L07: MapAnything measures */}
      <div style={{ position: "absolute", inset: 0, opacity: panel(l7.from - 8, end7) }}>
        <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
          <Plan x={260} y={390} s={78} frame={frame - (l7.from - 8)} start={0} dims={18} finds={34} />
        </svg>
        {SHOTS.scan3d ? (
          <Sequence from={l7.from - 8}>
            <Img src={staticFile("sample/sample/frames/0000.jpg")} style={{ display: "none" }} />
          </Sequence>
        ) : null}
        <MeasureList frame={frame - l7.from} />
      </div>

      {/* L08: Wonder watches, Spark checks */}
      <div style={{ position: "absolute", inset: 0, opacity: panel(l8.from - 8, end8) }}>
        <WonderStrip frame={frame - l8.from} dur={sparkAt - l8.from} />
        <SparkRules frame={frame - sparkAt} />
      </div>

      {/* L09: the wait screen, real */}
      <Sequence from={l9.from - 10}>
        <WaitShot dur={scene.duration - (l9.from - 10)} />
      </Sequence>
    </>
  );
};

const SamPanel: React.FC<{ o: number }> = () => {
  const frame = useCurrentFrame();
  const p = prog(frame, 0, 14);
  const seen = firstSeen();
  const t = frame / 30;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: p }}>
      <div style={{ position: "absolute", left: NX, top: 260 }}>
        <Loop durationInFrames={360}>
          <SamVideo w={1080} />
        </Loop>
      </div>
      <div style={{ position: "absolute", left: 1250, top: 262, width: 576 }}>
        <div style={{ fontWeight: 800, fontSize: 30, letterSpacing: "-0.02em", paddingBottom: 14 }}>What SAM found</div>
        <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
          {seen.map((d, i) => {
            const show = prog(frame, Math.min(d.at, 4 + i * 0.5) * 30 * 0.6 + 6, 10);
            return (
              <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: `1px solid ${C.border}`, opacity: show }}>
                <span style={{ width: 14, height: 14, background: FIND[d.kind] }} />
                <span style={{ fontWeight: 600, fontSize: 25 }}>{d.label}</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 18, color: C.muted }}>tracked</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ display: "none" }}>{t}</div>
    </div>
  );
};

const MeasureList: React.FC<{ frame: number }> = ({ frame }) => {
  const rows: [string, string][] = [
    ["Floor", "7.55 × 5.52 m"],
    ["Area", "41.7 m²"],
    ["Ceiling", "2.09 m"],
    ["Window", "0.45 m wide"],
  ];
  return (
    <div style={{ position: "absolute", left: 1250, top: 300, width: 576 }}>
      <div style={{ fontWeight: 800, fontSize: 30, letterSpacing: "-0.02em", paddingBottom: 14 }}>Measured from video depth</div>
      <div style={{ borderTop: `1.5px solid ${C.ink}` }}>
        {rows.map(([k, v], i) => {
          const p = prog(frame, 10 + i * 8, 12);
          return (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "14px 0", borderBottom: `1px solid ${C.border}`, opacity: p }}>
              <span style={{ fontWeight: 600, fontSize: 26 }}>{k}</span>
              <span style={{ fontFamily: MONO, fontSize: 24 }}>{v}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 24, color: C.muted, marginTop: 22, opacity: prog(frame, 50, 12) }}>An ordinary phone video. No LiDAR.</div>
    </div>
  );
};

const STRIP = ["0000", "0015", "0021", "0034", "0042", "0049", "0055", "0059"];
const WonderStrip: React.FC<{ frame: number; dur: number }> = ({ frame, dur }) => {
  const head = prog(frame, 6, Math.max(30, dur), easeDraw);
  const tw = 196, gap = 10, x0 = NX, y0 = 300;
  const labels = [
    [0.05, "window"],
    [0.3, "ducts, low beam"],
    [0.62, "stairs"],
    [0.9, "furnace, water heater"],
  ] as const;
  return (
    <>
      <div style={{ position: "absolute", left: x0, top: y0 - 10, fontWeight: 800, fontSize: 30, letterSpacing: "-0.02em" }}>Wonder watches the whole take</div>
      <div style={{ position: "absolute", left: x0, top: y0 + 40, display: "flex", gap }}>
        {STRIP.map((f, i) => (
          <Img key={f} src={staticFile(`sample/sample/frames/${f}.jpg`)} style={{ width: tw, height: tw * 0.5625, objectFit: "cover", borderRadius: 4, opacity: prog(frame, i * 2, 8) }} />
        ))}
      </div>
      <svg width={1920} height={400} style={{ position: "absolute", left: 0, top: y0 + 20 }}>
        {(() => {
          const total = STRIP.length * tw + (STRIP.length - 1) * gap;
          const x = x0 + head * total;
          return (
            <g>
              <line x1={x} y1={0} x2={x} y2={150} stroke={C.ink} strokeWidth={2} />
              <rect x={x - 5} y={-6} width={10} height={10} fill={C.mint} stroke={C.ink} strokeWidth={1.5} />
              {labels.map(([at, text]) => {
                const lx = x0 + at * total;
                const o = head >= at ? prog(frame, 6 + at * dur, 8) : 0;
                return (
                  <g key={text} opacity={o}>
                    <line x1={lx} y1={150} x2={lx} y2={180} stroke={C.ink} strokeWidth={1.5} />
                    <text x={lx} y={204} fontFamily={MONO} fontSize={17} fill={C.ink}>
                      {text.toUpperCase()}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}
      </svg>
    </>
  );
};

const RULES: [string, string, "fix" | "check" | "ok"][] = [
  ["Ceiling height in the suite", "2.09 m measured", "check"],
  ["Bedroom escape window", "0.35 m² opening", "check"],
  ["Fire separation between the homes", "no drywall seen", "fix"],
  ["Furnace room separation", "open to the basement", "fix"],
];
const SparkRules: React.FC<{ frame: number }> = ({ frame }) => (
  <div style={{ position: "absolute", left: NX, top: 590, width: 1730, opacity: prog(frame, 0, 12) }}>
    <div style={{ display: "flex", alignItems: "baseline", gap: 24, paddingBottom: 12 }}>
      <span style={{ fontWeight: 800, fontSize: 30, letterSpacing: "-0.02em" }}>Spark checks the Ontario Building Code</span>
      <span style={{ fontSize: 22, color: C.muted }}>No proof in the video, no claim.</span>
    </div>
    <div style={{ borderTop: `1.5px solid ${C.ink}`, display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 56 }}>
      {RULES.map(([name, fig, st], i) => {
        const p = prog(frame, 8 + i * 7, 10);
        return (
          <div key={name} style={{ display: "flex", alignItems: "center", gap: 18, padding: "15px 0", borderBottom: `1px solid ${C.border}`, opacity: p }}>
            <span style={{ fontWeight: 600, fontSize: 25 }}>{name}</span>
            <span style={{ fontFamily: MONO, fontSize: 18, color: C.muted, marginLeft: "auto" }}>{fig}</span>
            <span style={{ width: 96 }}>
              <Status kind={st} size={21}>{st === "fix" ? "To fix" : st === "ok" ? "Ready" : "Check"}</Status>
            </span>
          </div>
        );
      })}
    </div>
  </div>
);

const WaitShot: React.FC<{ dur: number }> = ({ dur }) => {
  const frame = useCurrentFrame();
  const p = prog(frame, 0, 16);
  const shot = SHOTS.wait;
  return (
    <div style={{ position: "absolute", inset: 0, opacity: p }}>
      <div style={{ position: "absolute", left: 120, top: 330, width: 760, fontFamily: SANS }}>
        <div style={{ fontWeight: 900, fontSize: 92, letterSpacing: "-0.045em", lineHeight: 0.95 }}>It asks only what it can't see.</div>
        <div style={{ fontSize: 28, color: C.muted, marginTop: 30, lineHeight: 1.35, width: 620 }}>Each question says why it's asking. Answer anything, or "Not sure".</div>
      </div>
      {shot ? (
        <Phone x={1120} y={60} h={880} src={shot.file} start={shot.start} p={p} />
      ) : (
        <Phone x={1120} y={60} h={880} p={p}>
          <Loop durationInFrames={360}>
            <div style={{ position: "absolute", top: 90, left: 0 }}>
              <SamVideo w={402} />
            </div>
          </Loop>
        </Phone>
      )}
      <div style={{ display: "none" }}>{dur}</div>
    </div>
  );
};
