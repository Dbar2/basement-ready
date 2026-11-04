import React from "react";
import { useCurrentFrame } from "remotion";
import { C } from "../theme";
import { SANS } from "../fonts";
import { Mark } from "./kit";
import { easeDraw, prog } from "../anim";

const NAMES = ["Answer", "Design", "Build"] as const;
const X = [190, 400, 610];
const WIDTHS = [128, 120, 88];

/** The guide's three milestones across the top, like the app: the current one's underline draws in. */
export const Milestones: React.FC<{ current: 0 | 1 | 2; start?: number; enter?: boolean }> = ({ current, start = 0, enter = false }) => {
  const frame = useCurrentFrame();
  const appear = enter ? prog(frame, start, 14) : 1;
  const under = prog(frame, start + (enter ? 10 : 4), 10, easeDraw);
  return (
    <div style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 140, opacity: appear, fontFamily: SANS }}>
      <div style={{ position: "absolute", left: 96, top: 52 }}>
        <Mark h={40} />
      </div>
      {NAMES.map((n, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <div
            key={n}
            style={{
              position: "absolute",
              left: X[i],
              top: 56,
              fontSize: 30,
              fontWeight: now ? 800 : 600,
              color: i > current ? C.muted : C.ink,
              letterSpacing: "-0.01em",
            }}
          >
            {done ? "✓ " : ""}
            {n}
            {now && (
              <div style={{ position: "absolute", left: 0, top: 44, height: 3, width: WIDTHS[i] * under, background: C.ink }} />
            )}
          </div>
        );
      })}
      <div style={{ position: "absolute", left: 28, right: 28, top: 128, height: 1, background: C.ink, transformOrigin: "left", transform: `scaleX(${enter ? prog(frame, start, 20, easeDraw) : 1})` }} />
    </div>
  );
};
