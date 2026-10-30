"""Pictures of a floor plan: from above over the points, and its walls drawn into the video's frames.

Spark reads these to check the plan, and the eval harness saves them as overlays. Plan frame throughout
(scan3d/layout.py): world (x, z) turned by -rotation, metres.
"""

from __future__ import annotations

import cv2
import numpy as np

KIND_BGR = {"foundation": (60, 60, 60), "existing": (140, 70, 20), "new": (40, 140, 40)}
ROOM_BGR = [(214, 170, 120), (140, 200, 150), (120, 170, 230), (200, 150, 210), (150, 210, 220), (190, 190, 140), (160, 160, 230), (210, 200, 170)]


class Canvas:
    """A top-down picture of the plan frame at `ppm` pixels a metre, u to the right and v down."""

    def __init__(self, lo, hi, ppm: float = 60, pad: int = 40, top: int = 36):
        self.lo, self.ppm, self.pad, self.top = np.asarray(lo, float), ppm, pad, top
        size = (np.asarray(hi) - self.lo) * ppm
        self.img = np.full((int(size[1]) + 2 * pad + top, int(size[0]) + 2 * pad, 3), 250, np.uint8)

    def px(self, p) -> tuple[int, int]:
        q = (np.asarray(p, float) - self.lo) * self.ppm
        return int(q[0]) + self.pad, int(q[1]) + self.pad + self.top

    def poly(self, pts) -> np.ndarray:
        return np.array([self.px(p) for p in pts], np.int32)


def bounds(plan: dict, extra=None, margin: float = 0.6):
    pts = [p for r in plan["rooms"] for p in r["polygon"]] + [p for w in plan["walls"] for p in (w["a"], w["b"])]
    if extra is not None and len(extra):
        pts += [tuple(p) for p in np.asarray(extra)[:, :2]]
    if not pts:
        return np.zeros(2), np.ones(2)
    P = np.asarray(pts, float)
    return P.min(0) - margin, P.max(0) + margin


def draw_points(cv: Canvas, uv: np.ndarray, rgb: np.ndarray | None, h: np.ndarray | None = None, band=(0.3, 2.0), n: int = 120_000):
    """The points from above: colour where we have it, darker for higher points so walls stand out."""
    if len(uv) > n:
        k = np.random.default_rng(1).choice(len(uv), n, replace=False)
        uv, rgb, h = uv[k], (rgb[k] if rgb is not None else None), (h[k] if h is not None else None)
    q = ((uv - cv.lo) * cv.ppm).astype(int) + np.array([cv.pad, cv.pad + cv.top])
    ok = (q[:, 0] >= 0) & (q[:, 0] < cv.img.shape[1]) & (q[:, 1] >= 0) & (q[:, 1] < cv.img.shape[0])
    if h is not None:
        ok &= (h > -0.1) & (h < 2.6)
    col = rgb[ok][:, ::-1] if rgb is not None else np.full((ok.sum(), 3), 120, np.uint8)
    if h is not None:
        wall = (h[ok] > band[0]) & (h[ok] < band[1])
        col = np.where(wall[:, None], (col * 0.45).astype(np.uint8), (col * 0.35 + 165).astype(np.uint8))
    cv.img[q[ok, 1], q[ok, 0]] = col


def draw_plan(cv: Canvas, plan: dict, labels: bool = True, fill: bool = True, colour=None):
    over = cv.img.copy()
    if fill:
        for k, r in enumerate(plan["rooms"]):
            cv2.fillPoly(over, [cv.poly(r["polygon"])], ROOM_BGR[k % len(ROOM_BGR)])
        cv.img[:] = cv2.addWeighted(over, 0.35, cv.img, 0.65, 0)
    for r in plan["rooms"]:
        cv2.polylines(cv.img, [cv.poly(r["polygon"])], True, colour or (90, 90, 90), 1, cv2.LINE_AA)
    for w in plan["walls"]:
        a, b = cv.px(w["a"]), cv.px(w["b"])
        thick = max(2, int(w["thicknessM"] * cv.ppm))
        col = colour or KIND_BGR.get(w["kind"], (0, 0, 0))
        if w.get("guess"):
            _dashed(cv.img, a, b, col, max(2, thick // 2))
        else:
            cv2.line(cv.img, a, b, col, thick, cv2.LINE_AA)
    for o in plan["openings"]:
        p = cv.px(o["at"])
        w = next((x for x in plan["walls"] if x["id"] == o["wallId"]), None)
        if w is None:
            continue
        t = np.subtract(w["b"], w["a"]) / max(1e-9, np.hypot(*np.subtract(w["b"], w["a"])))
        half = t * o["widthM"] / 2
        a, b = cv.px(np.array(o["at"]) - half), cv.px(np.array(o["at"]) + half)
        cv2.line(cv.img, a, b, (250, 250, 250), max(3, int(w["thicknessM"] * cv.ppm) + 2))
        cv2.line(cv.img, a, b, (30, 30, 220) if o["kind"] == "door" else (220, 160, 30), 2, cv2.LINE_AA)
        if labels:
            _label(cv.img, o["id"], (p[0] + 4, p[1] - 4), (30, 30, 200) if o["kind"] == "door" else (200, 120, 20), 0.4)
    for f in plan["fixtures"]:
        c = np.array(f["at"])
        s = np.array(f.get("sizeM") or [0.5, 0.5]) / 2
        cv2.rectangle(cv.img, cv.px(c - s), cv.px(c + s), (40, 120, 200) if f["kind"] == "stairs" else (90, 40, 160), 1, cv2.LINE_AA)
        if labels:
            txt = f["kind"].replace("_", " ") + (f" {f['heightM']:.2f}" if f.get("heightM") else "")
            _label(cv.img, txt, cv.px(c - s * np.array([1, -1])), (90, 40, 160), 0.35)
    if labels:
        for r in plan["rooms"]:
            P = np.asarray(r["polygon"], float)
            c = cv.px(P.mean(0))
            _label(cv.img, r["id"].upper(), (c[0] - 12, c[1]), (0, 0, 0), 0.6, 2)
            extra = f"{r['areaM2']:.1f} m2" + (f", ceiling {r['ceilingM']:.2f}" if r.get("ceilingM") else "")
            _label(cv.img, extra, (c[0] - 40, c[1] + 16), (40, 40, 40), 0.38)
        for w in plan["walls"]:
            m = cv.px((np.asarray(w["a"]) + np.asarray(w["b"])) / 2)
            _label(cv.img, w["id"], (m[0] + 3, m[1] + 12), (120, 60, 0), 0.33)


def scale_bar(cv: Canvas, title: str = ""):
    x, y = cv.pad, cv.top - 12
    cv2.line(cv.img, (x, y), (x + int(cv.ppm), y), (0, 0, 0), 2)
    _label(cv.img, "1 m", (x + int(cv.ppm) + 6, y + 4), (0, 0, 0), 0.4)
    if title:
        _label(cv.img, title, (x + int(cv.ppm) + 50, y + 4), (0, 0, 0), 0.45)


def top_down(plan: dict, uv: np.ndarray, rgb: np.ndarray | None, h: np.ndarray | None, title: str = "", ppm: float = 60) -> np.ndarray:
    lo, hi = bounds(plan, uv[:: max(1, len(uv) // 5000)] if len(uv) else None)
    lo = np.maximum(lo, np.percentile(uv, 0.5, 0) - 0.6) if len(uv) else lo
    hi = np.minimum(hi, np.percentile(uv, 99.5, 0) + 0.6) if len(uv) else hi
    pl, ph = bounds(plan)
    lo, hi = np.minimum(lo, pl), np.maximum(hi, ph)
    cv = Canvas(lo, hi, ppm)
    draw_points(cv, uv, rgb, h)
    draw_plan(cv, plan)
    scale_bar(cv, title)
    return cv.img


def wall_in_frame(img: np.ndarray, plan: dict, pose_world: np.ndarray, K: np.ndarray, rotation: float, floor_y: float, ceiling: float | None) -> np.ndarray:
    """The plan's walls drawn into one video frame: each wall's foot and top as lines, with its id.
    pose_world: OpenCV camera-to-world (4x4); K: the frame's lens in its own pixels."""
    out = img.copy()
    c, s = np.cos(rotation), np.sin(rotation)
    top = (ceiling or 2.3) - 0.02
    R, t = pose_world[:3, :3], pose_world[:3, 3]
    H, W = img.shape[:2]

    def world(p, y):
        u, v = p
        return np.array([c * u - s * v, floor_y + y, s * u + c * v])

    def project(P):
        q = (P - t) @ R  # camera coordinates
        if q[2] < 0.15:
            return None
        return np.array([K[0, 0] * q[0] / q[2] + K[0, 2], K[1, 1] * q[1] / q[2] + K[1, 2]]), q[2]

    for w in plan["walls"]:
        a, b = np.asarray(w["a"], float), np.asarray(w["b"], float)
        segs = []
        for y in (0.02, top):
            pts = [world(a + (b - a) * k / 12, y) for k in range(13)]
            segs.append(pts)
        col = (40, 40, 230) if w.get("guess") else (40, 200, 40)
        drawn = False
        for pts in segs:
            pr = [project(P) for P in pts]
            for p0, p1 in zip(pr, pr[1:]):
                if p0 is None or p1 is None:
                    continue
                q0, q1 = p0[0], p1[0]
                if max(abs(q0).max(), abs(q1).max()) > 4 * max(H, W):
                    continue
                cv2.line(out, tuple(int(v) for v in q0), tuple(int(v) for v in q1), col, 2, cv2.LINE_AA)
                drawn = True
        for e in (a, b):
            p0, p1 = project(world(e, 0.02)), project(world(e, top))
            if p0 is not None and p1 is not None and max(abs(p0[0]).max(), abs(p1[0]).max()) < 4 * max(H, W):
                cv2.line(out, tuple(int(v) for v in p0[0]), tuple(int(v) for v in p1[0]), col, 1, cv2.LINE_AA)
        if drawn:
            mid = project(world((a + b) / 2, 1.2))
            if mid is not None and 0 <= mid[0][0] < W and 0 <= mid[0][1] < H:
                _label(out, w["id"], (int(mid[0][0]), int(mid[0][1])), (255, 255, 255), 0.7, 2, bg=col)
    return out


def _label(img, text, org, col, scale=0.45, thick=1, bg=None):
    if bg is not None:
        (w, h), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thick)
        cv2.rectangle(img, (org[0] - 2, org[1] - h - 3), (org[0] + w + 2, org[1] + 3), bg, -1)
    cv2.putText(img, text, org, cv2.FONT_HERSHEY_SIMPLEX, scale, col, thick, cv2.LINE_AA)


def _dashed(img, a, b, col, thick, dash: int = 8):
    a, b = np.array(a, float), np.array(b, float)
    L = np.hypot(*(b - a))
    for k in range(0, int(L), dash * 2):
        p = a + (b - a) * k / max(L, 1)
        q = a + (b - a) * min(L, k + dash) / max(L, 1)
        cv2.line(img, tuple(p.astype(int)), tuple(q.astype(int)), col, thick, cv2.LINE_AA)
