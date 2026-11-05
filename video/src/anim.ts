import { Easing, interpolate } from "remotion";

// brand/tokens.css motion: --ease-out and --ease-draw
export const easeOut = Easing.bezier(0.22, 1, 0.36, 1);
export const easeDraw = Easing.bezier(0.65, 0, 0.35, 1);

/** 0→1 between `start` and `start + dur` frames, clamped. */
export const prog = (frame: number, start: number, dur: number, ease = easeOut) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });

/** Fades in at `start`, out at `end` (frames), `d` frames each way. */
export const window01 = (frame: number, start: number, end: number, d = 10) =>
  Math.min(prog(frame, start, d), 1 - prog(frame, end - d, d, easeDraw));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
