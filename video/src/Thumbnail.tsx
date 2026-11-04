import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C } from "./theme";
import { SANS } from "./fonts";
import { Mark } from "./components/kit";

// The YouTube thumbnail: the example's real before/after from the app (its own "virtually staged"
// label stays on), and the question in the brand's type. Frame: public/footage/thumb-frame.jpg,
// cut from the looks recording (tools/record) at 30.6 s.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, color: C.ink }}>
    <div style={{ position: "absolute", left: 470, top: 40, width: 770, height: 434, borderRadius: 6, overflow: "hidden", border: `2px solid ${C.ink}` }}>
      <Img src={staticFile("footage/thumb-frame.jpg")} style={{ width: 770, height: 434, display: "block" }} />
    </div>
    <div style={{ position: "absolute", left: 470, top: 486, fontSize: 19, color: C.muted }}>
      The example basement, before and after · virtually staged
    </div>
    <div style={{ position: "absolute", left: 44, top: 40, width: 400, fontWeight: 900, fontSize: 82, letterSpacing: "-0.045em", lineHeight: 0.93 }}>
      Could your basement be a home?
    </div>
    <div style={{ position: "absolute", left: 44, right: 44, top: 560, height: 2, background: C.ink }} />
    <div style={{ position: "absolute", left: 44, top: 590, display: "flex", alignItems: "center", gap: 18 }}>
      <Mark h={64} />
      <span style={{ fontWeight: 800, fontSize: 52, letterSpacing: "-0.03em" }}>Basement Ready</span>
    </div>
    <div style={{ position: "absolute", right: 44, top: 600, display: "flex", alignItems: "center", gap: 22 }}>
      <span style={{ fontSize: 26, fontWeight: 600 }}>Film it on your phone</span>
      <span style={{ background: C.mint, color: C.ink, fontWeight: 700, fontSize: 26, padding: "12px 22px", borderRadius: 6 }}>basementready.com</span>
    </div>
  </AbsoluteFill>
);
