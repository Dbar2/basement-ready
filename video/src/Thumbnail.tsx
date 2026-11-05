import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { C } from "./theme";
import { SANS } from "./fonts";
import { Mark } from "./components/kit";

// The YouTube thumbnail: David's real basement before and after, from his live run on the site (the
// app's own "Before" and "After · virtually staged" labels stay on), and the question in the brand's type.
// Image: public/david/thumb-pair.jpg, cropped from media/video-david-run/09-before-after.jpg.
export const Thumbnail: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.bg, fontFamily: SANS, color: C.ink }}>
    <div style={{ position: "absolute", left: 44, top: 44, width: 640, fontWeight: 900, fontSize: 104, letterSpacing: "-0.045em", lineHeight: 0.93 }}>
      Could your basement be a home?
    </div>
    <div style={{ position: "absolute", left: 48, top: 470, fontSize: 30, fontWeight: 600, color: C.ink }}>Film it once. Get the answer, the plan and the permit set.</div>
    <div style={{ position: "absolute", left: 44, right: 520, top: 560, height: 2, background: C.ink }} />
    <div style={{ position: "absolute", left: 44, top: 600, display: "flex", alignItems: "center", gap: 16 }}>
      <Mark h={60} />
      <span style={{ fontWeight: 800, fontSize: 46, letterSpacing: "-0.03em" }}>Basement Ready</span>
    </div>
    <span style={{ position: "absolute", left: 470, top: 604, background: C.mint, color: C.ink, fontWeight: 700, fontSize: 26, padding: "12px 20px", borderRadius: 6 }}>basementready.com</span>
    <div style={{ position: "absolute", left: 862, top: 30, width: 374, height: 663, borderRadius: 6, overflow: "hidden", border: `2px solid ${C.ink}` }}>
      <Img src={staticFile("david/thumb-pair.jpg")} style={{ width: 374, height: 663, display: "block" }} />
    </div>
  </AbsoluteFill>
);
