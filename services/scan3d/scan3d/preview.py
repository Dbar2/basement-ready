"""A quick plan and side view of a scan, for checking the fit by eye (walls doubled? floor flat?)."""

import cv2
import numpy as np

from .export import read_ply

PX = 120  # pixels per metre
PAD = 40


def _canvas(lo, hi):
    w, h = ((np.array(hi) - np.array(lo)) * PX).astype(int) + 2 * PAD
    return np.full((h, w, 3), 245, np.uint8)


def render(scan: dict, ply: bytes) -> np.ndarray:
    v = read_ply(ply)
    xyz = np.stack([v["x"], v["y"], v["z"]], 1)
    bgr = np.stack([v["blue"], v["green"], v["red"]], 1)
    room = scan["room"]
    lo = np.percentile(xyz, 1, 0) - 0.3
    hi = np.percentile(xyz, 99, 0) + 0.3

    def to_px(a, b, a0, b1):  # a to the right, b up the image
        return np.c_[(a - a0) * PX + PAD, (b1 - b) * PX + PAD].astype(int)

    # Plan: looking down, X to the right, Z down the image. Points drawn low to high.
    plan = _canvas((lo[0], lo[2]), (hi[0], hi[2]))
    order = np.argsort(xyz[:, 1])
    p = to_px(xyz[order, 0], -xyz[order, 2], lo[0], -lo[2])
    ok = (p[:, 0] >= 0) & (p[:, 0] < plan.shape[1]) & (p[:, 1] >= 0) & (p[:, 1] < plan.shape[0])
    plan[p[ok, 1], p[ok, 0]] = bgr[order][ok]
    b = room["box"]
    corners = to_px(np.array([b["min"][0], b["max"][0]]), -np.array([b["min"][2], b["max"][2]]), lo[0], -lo[2])
    cv2.rectangle(plan, tuple(corners[0]), tuple(corners[1]), (60, 160, 60), 2)
    doubled = {w for d in scan["quality"]["doubledWalls"] for w in d["walls"]}
    for w in room["walls"]:
        (x0, z0), (x1, z1) = w["segment"]
        s = to_px(np.array([x0, x1]), -np.array([z0, z1]), lo[0], -lo[2])
        color = (40, 40, 220) if w["id"] in doubled else (200, 90, 20)
        cv2.line(plan, tuple(s[0]), tuple(s[1]), color, 3)
        cv2.putText(plan, w["id"], tuple(s[0] + 4), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1)
    for f in scan["frames"]:
        c = np.array(f["pose"])[:3, 3]
        cv2.circle(plan, tuple(to_px(c[[0]], -c[[2]], lo[0], -lo[2])[0]), 4, (0, 0, 0), -1)

    # Side: looking along +Z, X to the right, Y up. Floor and ceiling as lines.
    side = _canvas((lo[0], lo[1]), (hi[0], hi[1]))
    p = to_px(xyz[:, 0], xyz[:, 1], lo[0], hi[1])
    ok = (p[:, 0] >= 0) & (p[:, 0] < side.shape[1]) & (p[:, 1] >= 0) & (p[:, 1] < side.shape[0])
    side[p[ok, 1], p[ok, 0]] = bgr[ok]
    for y, color in [(0.0, (60, 160, 60)), (room["ceilingHeightM"], (200, 90, 20))]:
        if y is not None:
            yy = int((hi[1] - y) * PX + PAD)
            cv2.line(side, (0, yy), (side.shape[1], yy), color, 2)

    width = max(plan.shape[1], side.shape[1])
    pad = lambda im: cv2.copyMakeBorder(im, 0, 0, 0, width - im.shape[1], cv2.BORDER_CONSTANT, value=(245, 245, 245))  # noqa: E731
    h = room["ceilingHeightM"]
    label = f"{scan['scaleSource']}  W {room['widthM']} m  D {room['depthM']} m  H {h if h is not None else '?'} m"
    head = np.full((36, width, 3), 255, np.uint8)
    cv2.putText(head, label, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (20, 20, 20), 1)
    return np.vstack([head, pad(plan), pad(side)])
