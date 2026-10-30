"""The frames the 3D kept, as cameras in the plan's world with their depth.

Two things are read from them:

- Where the floor stops in each picture. The 3D puts the floor in the right place but, on a bare wall,
  can pull the wall towards the camera. The pixel where the floor ends, cast along its ray onto the floor
  plane, lands on the wall's foot wherever the depth says it is: the camera's own position fixes it.
- Whether a wall the plan draws is where the depth says (the plan's self-check, scan3d/selfcheck.py).

A view: {"pose": 4x4 OpenCV camera-to-world, "K": 3x3 for the depth map's pixels, "depth": H x W metres
(z along the camera's axis, 0 where unknown)}.
"""

from __future__ import annotations

import numpy as np


def rays(view: dict, step: int = 2):
    """Camera centre, and world-space ray directions (z = 1 in the camera) for every step-th pixel."""
    D = view["depth"]
    H, W = D.shape
    K, P = view["K"], view["pose"]
    vv, uu = np.mgrid[0:H:step, 0:W:step]
    cam = np.stack([(uu - K[0, 2]) / K[0, 0], (vv - K[1, 2]) / K[1, 1], np.ones_like(uu, float)], -1)
    return P[:3, 3], cam @ P[:3, :3].T, D[::step, ::step]


def floor_edges(views: list[dict], floor_y: float, normal=(0.0, 1.0, 0.0), step: int = 2, reach: float = 7.0):
    """Where the floor ends in each picture, on the floor: (N x 3 world points, wall-like flags).
    Wall-like: what stands on that edge rises a metre or more (a wall, not a box)."""
    n = np.asarray(normal, float)
    F0 = np.array([0.0, floor_y, 0.0])
    out, wall = [], []
    for v in views:
        if v.get("depth") is None:
            continue
        C, R, Z = rays(v, step)
        P = C + R * Z[..., None]
        h = (P - F0) @ n
        ok = Z > 0
        down = (R @ n) < -0.05
        on_floor = ok & down & (np.abs(h) < 0.06)
        above = ok & (h > 0.12)
        Hs, Ws = Z.shape
        hc = float((C - F0) @ n)
        for u in range(Ws):
            col = on_floor[:, u]
            rows = np.nonzero(col)[0]
            if len(rows) < 4:
                continue
            # The floor run that reaches furthest up the picture from the bottom-most floor pixel.
            v_top = rows[-1]
            for r in rows[::-1]:
                if r >= v_top - 3:  # small holes in the floor run are noise
                    v_top = r
                else:
                    break
            if rows[-1] - v_top < 3 or v_top < 6:
                continue
            seg = above[v_top - 6 : v_top, u]
            if seg.mean() < 0.6:
                continue
            ray = (R[v_top, u] + R[v_top - 1, u]) / 2  # between the last floor pixel and the first wall one
            t = -hc / float(ray @ n)
            if not (0 < t):
                continue
            E = C + ray * t
            if np.hypot(E[0] - C[0], E[2] - C[2]) > reach:
                continue
            up = h[max(0, v_top - 80) : v_top, u][above[max(0, v_top - 80) : v_top, u]]
            out.append(E)
            wall.append(bool(len(up) >= 6 and (up.max() - up.min() >= 0.9 or up.max() >= 1.3)))
    if not out:
        return np.zeros((0, 3)), np.zeros(0, bool)
    return np.asarray(out), np.asarray(wall)
