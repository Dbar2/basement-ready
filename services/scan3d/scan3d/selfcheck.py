"""The plan checks itself: every wall it draws is put into every frame the 3D kept and compared with what
that frame's depth saw there.

A wall face sampled from knee to head height, in each frame that faces it:
- agrees where the depth lands on it (within 8 cm plus 10% of the distance: depth is rougher far away),
- contradicts where the depth runs on past it (the camera saw through where the wall should be),
- says nothing where something nearer hides it.

A wall's confidence is its agreeing samples against agreeing plus contradicting ones. Doors and windows
aren't sampled (the camera sees through them). A wall few frames looked at, or one the frames see
through, is a guess: the plan screen asks about it.
"""

from __future__ import annotations

import numpy as np

MIN_SEEN = 12  # samples, agreeing or contradicting, before a wall counts as checked
SURE = 0.55


def wall_samples(plan: dict, step: float = 0.2):
    """Points on both faces of every wall, in the take's world, with each face's normal and its wall."""
    rot = plan["rotation"]
    c, s = np.cos(rot), np.sin(rot)
    fy = (plan.get("floor") or {}).get("y", 0.0)
    ceiling = plan.get("ceilingM") or 2.3
    pts, nrm, owner = [], [], []
    for k, w in enumerate(plan["walls"]):
        a, b = np.asarray(w["a"], float), np.asarray(w["b"], float)
        L = float(np.hypot(*(b - a)))
        if L < 0.2:
            continue
        t = (b - a) / L
        n = np.array([-t[1], t[0]])
        holes = [(o["offsetM"] - o["widthM"] / 2 - 0.05, o["offsetM"] + o["widthM"] / 2 + 0.05) for o in plan["openings"] if o.get("wallId") == w["id"]]
        top = min(2.0, ceiling - 0.15)
        for along in np.arange(0.1, L - 0.05, step):
            if any(lo <= along <= hi for lo, hi in holes):
                continue
            for side in (1, -1):
                p = a + t * along + n * side * w["thicknessM"] / 2
                for h in np.arange(0.35, top, 0.3):
                    pts.append((c * p[0] - s * p[1], fy + h, s * p[0] + c * p[1]))
                    m = n * side
                    nrm.append((c * m[0] - s * m[1], 0.0, s * m[0] + c * m[1]))
                    owner.append(k)
    return np.asarray(pts, float).reshape(-1, 3), np.asarray(nrm, float).reshape(-1, 3), np.asarray(owner, int)


def check_walls(plan: dict, views: list[dict]) -> dict:
    """Adds `check` {confidence, agree, contradict, frames} to every wall, marks the doubtful ones `guess`,
    and returns a summary."""
    P, N, owner = wall_samples(plan)
    nw = len(plan["walls"])
    agree = np.zeros(nw)
    contra = np.zeros(nw)
    frames = np.zeros(nw, int)
    for v in views:
        D = v.get("depth")
        if D is None or not len(P):
            continue
        H, W = D.shape
        R, C, K = v["pose"][:3, :3], v["pose"][:3, 3], v["K"]
        q = (P - C) @ R  # camera coordinates (x right, y down, z forward)
        z = q[:, 2]
        facing = ((C - P) * N).sum(1) > 0
        ok = (z > 0.3) & facing
        u = np.full(len(P), -1, int)
        vv = np.full(len(P), -1, int)
        u[ok] = np.round(K[0, 0] * q[ok, 0] / z[ok] + K[0, 2]).astype(int)
        vv[ok] = np.round(K[1, 1] * q[ok, 1] / z[ok] + K[1, 2]).astype(int)
        ok &= (u >= 0) & (u < W) & (vv >= 0) & (vv < H)
        if not ok.any():
            continue
        dm = np.zeros(len(P))
        dm[ok] = D[vv[ok], u[ok]]
        ok &= dm > 0
        tol = 0.08 + 0.10 * z
        a = ok & (np.abs(dm - z) < tol)
        x = ok & (dm > z + tol)
        np.add.at(agree, owner[a], 1)
        np.add.at(contra, owner[x], 1)
        seen = np.zeros(nw, bool)
        seen[owner[a | x]] = True
        frames += seen
    doubtful = 0
    for k, w in enumerate(plan["walls"]):
        n_seen = agree[k] + contra[k]
        conf = float((agree[k] + 1) / (n_seen + 2))
        w["check"] = {"confidence": round(conf, 2), "agree": int(agree[k]), "contradict": int(contra[k]), "frames": int(frames[k])}
        if n_seen < MIN_SEEN or conf < SURE:
            w["guess"] = True
            doubtful += 1
        else:
            w.pop("guess", None)
    return {"walls": nw, "doubtful": doubtful}
