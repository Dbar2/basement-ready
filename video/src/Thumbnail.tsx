import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C } from "./theme";
import { SANS } from "./fonts";
import { Mark } from "./components/kit";

// The YouTube thumbnail: David's basement as its measured plan built out in 3D (the last frame of the
// 3D session's plan-to-3D clip of his scan), and the question in the brand's type.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, color: C.ink }}>
    <div style={{ position: "absolute", left: 44, top: 44, width: 620, fontWeight: 900, fontSize: 100, letterSpacing: "-0.045em", lineHeight: 0.93 }}>
      Could your basement be a home?
    </div>
    <div style={{ position: "absolute", left: 48, top: 470, fontSize: 30, fontWeight: 600, color: C.ink }}>Film it once. Get the answer.</div>
    <div style={{ position: "absolute", left: 44, right: 600, top: 560, height: 2, background: C.ink }} />
    <div style={{ position: "absolute", left: 44, top: 600, display: "flex", alignItems: "center", gap: 16 }}>
      <Mark h={60} />
      <span style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-0.03em" }}>Basement Ready</span>
    </div>
    <span style={{ position: "absolute", left: 470, top: 604, background: C.mint, color: C.ink, fontWeight: 700, fontSize: 26, padding: "12px 20px", borderRadius: 6 }}>basementready.com</span>
    <div style={{ position: "absolute", left: 700, top: 36, width: 540, height: 510, borderRadius: 6, overflow: "hidden", border: `2px solid ${C.ink}` }}>
      <Img src={staticFile("david/thumb-3d.jpg")} style={{ position: "absolute", left: -330, top: -40, width: 1200, height: 675 }} />
    </div>
  </AbsoluteFill>
);
