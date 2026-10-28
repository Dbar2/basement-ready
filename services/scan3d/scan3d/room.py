"""Room geometry from a point cloud: gravity, floor, ceiling, walls and the room box.

Pure numpy, so Modal and the Mac give the same answer. Input points are in MapAnything's
world frame (view 0's camera, OpenCV axes) in model metres. `fit_room` returns the
transform into the room frame plus everything measured there, still in model units;
`describe` applies the scale factor and turns it into the JSON the Node worker reads.

Room frame: origin on the floor under the centre of the room box, +Y up, X along the
longer side of the room, Z = X cross Y (right-handed, same as three.js).
"""

from dataclasses import dataclass, field

import numpy as np

PLANE_THRESH = 0.03  # m. RANSAC inlier distance; the research note suggests 0.02-0.03.
AXIS_TOL = np.deg2rad(12)  # how far a wall may sit off the main room axes and still count as square
MIN_WALL_LEN = 0.4  # m
SAME_FRAMES = 0.35
FLAT_FLOOR = 0.04  # m, p5-p95 spread of floor height across the room
LEVEL_CEILING = 0.05  # m, the research note's "ceiling within 5 cm"  # below this frame overlap, two parallel surfaces were seen by different frames


def fit_plane(pts: np.ndarray) -> tuple[np.ndarray, float]:
    """Least-squares plane n.x + d = 0 through pts."""
    c = pts.mean(0)
    n = np.linalg.svd(pts - c, full_matrices=False)[2][-1]
    return n, -float(n @ c)


def ransac_plane(pts, rng, axis=None, max_angle=None, thresh=PLANE_THRESH, iters=800):
    """Best plane by inlier count, optionally with its normal within max_angle of axis."""
    search = pts if len(pts) <= 40_000 else pts[rng.choice(len(pts), 40_000, replace=False)]
    best_n, best_d, best_count = None, 0.0, 0
    for _ in range(0, iters, 100):
        tri = search[rng.integers(0, len(search), (100, 3))]
        n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
        length = np.linalg.norm(n, axis=1)
        ok = length > 1e-9
        n, p0 = n[ok] / length[ok, None], tri[ok, 0]
        if axis is not None:
            ok = np.abs(n @ axis) >= np.cos(max_angle)
            n, p0 = n[ok], p0[ok]
        if not len(n):
            continue
        d = -(n * p0).sum(1)
        counts = (np.abs(search @ n.T + d) < thresh).sum(0)
        k = int(counts.argmax())
        if counts[k] > best_count:
            best_n, best_d, best_count = n[k], float(d[k]), int(counts[k])
    if best_n is None:
        return None
    inl = np.abs(pts @ best_n + best_d) < thresh
    if inl.sum() < 3:
        return None
    n, d = fit_plane(pts[inl])
    if axis is not None and abs(n @ axis) < np.cos(max_angle):
        n, d = best_n, best_d
    return n, d, np.abs(pts @ n + d) < thresh


def ransac_line(pts2, rng, thresh=PLANE_THRESH, iters=600):
    """Best 2D line m.p + d = 0 by inlier count."""
    search = pts2 if len(pts2) <= 30_000 else pts2[rng.choice(len(pts2), 30_000, replace=False)]
    best_m, best_d, best_count = None, 0.0, 0
    for _ in range(0, iters, 100):
        pair = search[rng.integers(0, len(search), (100, 2))]
        t = pair[:, 1] - pair[:, 0]
        length = np.linalg.norm(t, axis=1)
        ok = length > 1e-6
        m = np.stack([-t[ok, 1], t[ok, 0]], 1) / length[ok, None]
        d = -(m * pair[ok, 0]).sum(1)
        counts = (np.abs(search @ m.T + d) < thresh).sum(0)
        k = int(counts.argmax())
        if counts[k] > best_count:
            best_m, best_d, best_count = m[k], float(d[k]), int(counts[k])
    if best_m is None:
        return None
    inl = np.abs(pts2 @ best_m + best_d) < thresh
    c = pts2[inl].mean(0)
    t = np.linalg.svd(pts2[inl] - c, full_matrices=False)[2][0]
    m = np.array([-t[1], t[0]])
    d = -float(m @ c)
    return m, d, np.abs(pts2 @ m + d) < thresh


def horizontal_planes(pts, up, rng, max_angle, min_inliers, max_planes=8):
    """Peel off planes facing up/down, biggest first. Normals are flipped to point along up."""
    left, out = np.arange(len(pts)), []
    for _ in range(max_planes):
        if len(left) < min_inliers:
            break
        r = ransac_plane(pts[left], rng, axis=up, max_angle=max_angle)
        if r is None or r[2].sum() < min_inliers:
            break
        n, d, inl = r
        if n @ up < 0:
            n, d = -n, -d
        out.append({"n": n, "d": d, "idx": left[inl]})
        left = left[~inl]
    return out


def frame_overlap(frames_a: np.ndarray, frames_b: np.ndarray, n_frames: int) -> float:
    """How much two point sets were seen by the same frames: 1 = same frames, 0 = disjoint."""
    ha = np.bincount(frames_a, minlength=n_frames) / max(len(frames_a), 1)
    hb = np.bincount(frames_b, minlength=n_frames) / max(len(frames_b), 1)
    return float(np.minimum(ha, hb).sum())


@dataclass
class RoomFit:
    rotation: np.ndarray  # world -> room, rows are the room X, Y (up), Z axes in world coordinates
    origin: np.ndarray  # room origin in world coordinates
    floor: dict | None
    ceiling: dict | None
    ceiling_candidates: list
    walls: list
    box: dict
    quality: dict
    warnings: list = field(default_factory=list)

    def to_room(self, pts: np.ndarray) -> np.ndarray:
        return (pts - self.origin) @ self.rotation.T


def _pick(cands, key, share=0.25):
    """Start from the best-supported plane; move to a parallel one with at least `share` of its
    support if that one has a larger key (a lower floor under a big table, a higher ceiling)."""
    if not cands:
        return None
    big = max(cands, key=lambda c: len(c["idx"]))
    near = [c for c in cands if c["n"] @ big["n"] >= np.cos(np.deg2rad(10)) and len(c["idx"]) >= share * len(big["idx"])]
    return max(near, key=key)


def height_spread(xz: np.ndarray, h: np.ndarray, cell: float = 0.5, min_pts: int = 20):
    """How much a surface's height wanders across the room: p5-p95 of the median height of each
    50 cm cell. Robust to clutter in a cell, but shows a warped or drifting floor or ceiling."""
    if len(h) < min_pts * 3:
        return None, 0
    keys = np.floor(xz / cell).astype(np.int64)
    keys -= keys.min(0)
    packed = keys[:, 0] * (int(keys[:, 1].max()) + 1) + keys[:, 1]
    order = np.argsort(packed, kind="stable")
    cells = np.split(h[order], np.flatnonzero(np.diff(packed[order])) + 1)
    meds = np.array([np.median(c) for c in cells if len(c) >= min_pts])
    if len(meds) < 3:
        return None, len(meds)
    return float(np.percentile(meds, 95) - np.percentile(meds, 5)), len(meds)


def _contiguous(along: np.ndarray, gap: float = 0.3) -> np.ndarray:
    """Mask of the run with the most points, where consecutive points are at most `gap` apart."""
    order = np.argsort(along)
    breaks = np.flatnonzero(np.diff(along[order]) > gap) + 1
    runs = np.split(order, breaks)
    best = max(runs, key=len)
    mask = np.zeros(len(along), bool)
    mask[best] = True
    return mask


def fit_room(pts, frame_ids, n_frames, cam_centers, cam_rots, seed=0) -> RoomFit:
    rng = np.random.default_rng(seed)
    warnings = []
    min_inl = max(300, int(0.02 * len(pts)))

    # 1. Up: people hold phones roughly upright, so start from the cameras' average -Y.
    up = -cam_rots[:, :, 1].mean(0)
    up /= np.linalg.norm(up)

    # 2. Floor: the lowest big horizontal plane with the cameras above it. A loose first pass
    #    finds it even with a tilted phone; its normal becomes the true up, then a tight pass.
    def cam_height(p):
        return float(np.median(cam_centers @ p["n"] + p["d"]))

    floor = None
    for max_angle in (np.deg2rad(35), np.deg2rad(10)):
        planes = horizontal_planes(pts, up, rng, max_angle, min_inl)
        found = _pick([p for p in planes if cam_height(p) > 0.3], key=cam_height)
        if found is not None:
            floor = found
            up = floor["n"]
    if floor is None:
        warnings.append("No floor plane found; heights are measured from the lowest points.")
        d_floor = -float(np.percentile(pts @ up, 2))
    else:
        d_floor = floor["d"]
    h = pts @ up + d_floor  # height above the floor

    # 3. Ceiling: the highest big plane facing down with the cameras below it. In an unfinished
    #    basement that is often the subfloor between joists, so every candidate is returned.
    above = []
    for p in planes:
        if cam_height(p) < -0.15 and p["n"] @ up >= np.cos(np.deg2rad(10)):
            above.append({**p, "height": float(np.median(h[p["idx"]]))})
    ceiling = _pick(above, key=lambda p: p["height"])
    if ceiling is None:
        warnings.append("No ceiling plane found; film floor-to-ceiling at each wall.")
    top = ceiling["height"] if ceiling else float(np.percentile(h, 98))

    # 4. Walls: vertical lines in a floor plan of the points between desk height and ducts.
    f0 = cam_rots[0][:, 2] if abs(cam_rots[0][:, 2] @ up) < 0.95 else cam_rots[0][:, 0]
    e1 = f0 - (f0 @ up) * up
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(up, e1)
    band = np.flatnonzero((h > 0.4 * top) & (h < 0.85 * top))
    plan = np.stack([pts[band] @ e1, pts[band] @ e2], 1)
    lines, left = [], np.arange(len(band))
    min_line = max(150, int(0.03 * len(band)))
    for _ in range(10):
        if len(left) < min_line:
            break
        r = ransac_line(plan[left], rng)
        if r is None or r[2].sum() < min_line:
            break
        m, d, inl = r
        idx = left[inl]
        # A wall is one continuous run of points; clutter that happens to line up is not.
        run = _contiguous(plan[idx] @ np.array([-m[1], m[0]]))
        along = plan[idx[run]] @ np.array([-m[1], m[0]])
        length = np.percentile(along, 98) - np.percentile(along, 2)
        if run.sum() >= min_line and length >= MIN_WALL_LEN:
            lines.append({"m": m, "idx": idx[run]})
            left = np.setdiff1d(left, idx[run], assume_unique=True)
        else:
            left = left[~inl]

    # 5. Square the room up: dominant wall direction modulo 90 degrees, weighted by support.
    if lines:
        theta = np.array([np.arctan2(ln["m"][1], ln["m"][0]) for ln in lines])
        w = np.array([len(ln["idx"]) for ln in lines], float)
        phi = 0.25 * np.arctan2((w * np.sin(4 * theta)).sum(), (w * np.cos(4 * theta)).sum())
    else:
        phi = 0.0
        warnings.append("No walls found; room size comes from the spread of points.")
    a = np.cos(phi) * e1 + np.sin(phi) * e2
    b = np.cross(up, a)

    # 6. Room bounds per side: the outermost wall on that side of the cameras. A side with no wall
    #    (the camera never saw one) reaches the spread of points or the cameras, whichever is
    #    farther: whoever filmed was standing in the room.
    inside = (h > -0.1) & (h < top + 0.1)

    def bounds(axis_vec):
        coord, cams = pts[band] @ axis_vec, cam_centers @ axis_vec
        centre = float(np.median(cams))
        pos = []
        for ln in lines:
            m3 = ln["m"][0] * e1 + ln["m"][1] * e2
            if abs(m3 @ axis_vec) >= np.cos(AXIS_TOL):
                pos.append(float(np.median(coord[ln["idx"]])))
        lo = [p for p in pos if p < centre]
        hi = [p for p in pos if p > centre]
        spread = pts[inside] @ axis_vec if inside.any() else cams
        return (
            (min(lo), "wall") if lo else (min(float(np.percentile(spread, 2)), float(cams.min()) - 0.3), "extent"),
            (max(hi), "wall") if hi else (max(float(np.percentile(spread, 98)), float(cams.max()) + 0.3), "extent"),
        )

    (u_lo, u_hi), (v_lo, v_hi) = bounds(a), bounds(b)
    if u_hi[0] - u_lo[0] >= v_hi[0] - v_lo[0]:
        x_axis, x_lo, x_hi = a, u_lo, u_hi
        z_lo, z_hi = (-v_hi[0], v_hi[1]), (-v_lo[0], v_lo[1])  # z = a x up = -b
        z_axis = -b
    else:
        x_axis, x_lo, x_hi = b, v_lo, v_hi
        z_lo, z_hi = u_lo, u_hi  # z = b x up = a
        z_axis = a
    xc, zc = (x_lo[0] + x_hi[0]) / 2, (z_lo[0] + z_hi[0]) / 2
    origin = xc * x_axis + zc * z_axis - d_floor * up
    rotation = np.stack([x_axis, up, z_axis])
    q_all = (pts - origin) @ rotation.T
    width, depth = x_hi[0] - x_lo[0], z_hi[0] - z_lo[0]
    box = {
        "min": [-width / 2, 0.0, -depth / 2],
        "max": [width / 2, top, depth / 2],
        "sides": {"minX": x_lo[1], "maxX": x_hi[1], "minZ": z_lo[1], "maxZ": z_hi[1]},
        "heightFrom": "ceiling" if ceiling else "points",
    }

    # 7. Walls in the room frame, each refit as a 2D line with its normal facing the room centre.
    walls = []
    for ln in lines:
        q = q_all[band[ln["idx"]]][:, [0, 2]]
        c = q.mean(0)
        t = np.linalg.svd(q - c, full_matrices=False)[2][0]
        m = np.array([-t[1], t[0]])
        if m @ -c < 0:
            m = -m
        s = (q - c) @ t
        lo, hi = np.percentile(s, 2), np.percentile(s, 98)
        axis = "x" if abs(m[0]) >= np.cos(AXIS_TOL) else "z" if abs(m[1]) >= np.cos(AXIS_TOL) else "other"
        walls.append({
            "axis": axis,  # "x": wall plane is x = const (its normal runs along X)
            "normal": [float(m[0]), 0.0, float(m[1])],
            "offset": -float(m @ c),
            "segment": [(c + lo * t).tolist(), (c + hi * t).tolist()],
            "length": float(hi - lo),
            "rms": float(np.sqrt(np.mean(((q - c) @ m) ** 2))),
            "inliers": len(ln["idx"]),
            "_frames": frame_ids[band[ln["idx"]]],
            "_pos": float(c[0] if axis == "x" else c[1]),
            "_along": q[:, 1] if axis == "x" else q[:, 0],
            "_span": sorted(float(v[1 if axis == "x" else 0]) for v in ((c + lo * t), (c + hi * t))),
        })
    walls.sort(key=lambda w_: -w_["inliers"])

    # 8. Quality checks for the pass bar: walls not doubled, one flat floor, level ceiling.
    doubled = []
    if n_frames > 1:
        for i, wa in enumerate(walls):
            for j in range(i + 1, len(walls)):
                wb = walls[j]
                if wa["axis"] != wb["axis"] or wa["axis"] == "other":
                    continue
                gap = abs(wa["_pos"] - wb["_pos"])
                lo, hi = max(wa["_span"][0], wb["_span"][0]), min(wa["_span"][1], wb["_span"][1])
                if 0.05 <= gap <= 0.6 and hi - lo >= 0.5:
                    # Compare only the stretch both cover: a shelf in front of a wall is seen by the
                    # same frames as the wall behind it; a wall placed twice is not.
                    ina = (wa["_along"] >= lo) & (wa["_along"] <= hi)
                    inb = (wb["_along"] >= lo) & (wb["_along"] <= hi)
                    shared = frame_overlap(wa["_frames"][ina], wb["_frames"][inb], n_frames)
                    if shared < SAME_FRAMES:
                        doubled.append({"walls": [i, j], "gap": gap, "sharedFrames": shared})

    split = None
    floor_q = {}
    if floor is not None:
        near = np.abs(h) < 0.1
        spread, cells = height_spread(q_all[near][:, [0, 2]], h[near])
        floor_q = {
            "rms": float(np.sqrt(np.mean(h[floor["idx"]] ** 2))),
            "spread": spread,
            "cells": cells,
            "inliers": len(floor["idx"]),
            "normal": (rotation @ floor["n"]).tolist(),
        }
        if n_frames > 1:
            for p in planes:
                if p is floor or cam_height(p) <= 0.3 or p["n"] @ up < np.cos(np.deg2rad(5)):
                    continue
                gap = float(np.median(h[p["idx"]]))
                if 0.04 <= abs(gap) <= 0.3 and len(p["idx"]) >= 0.25 * len(floor["idx"]):
                    shared = frame_overlap(frame_ids[floor["idx"]], frame_ids[p["idx"]], n_frames)
                    if shared < SAME_FRAMES:
                        split = {"gap": gap, "inliers": len(p["idx"]), "sharedFrames": shared}

    ceil_q = None
    if ceiling is not None:
        n_c = rotation @ ceiling["n"]
        d_c = ceiling["d"] + ceiling["n"] @ origin  # same plane, room coordinates
        corners = [(x, z) for x in (box["min"][0], box["max"][0]) for z in (box["min"][2], box["max"][2])]
        heights = [-(d_c + n_c[0] * x + n_c[2] * z) / n_c[1] for x, z in corners]
        dh = h[ceiling["idx"]] - ceiling["height"]
        near = np.abs(h - ceiling["height"]) < 0.1
        spread, cells = height_spread(q_all[near][:, [0, 2]], h[near])
        ceil_q = {
            "height": ceiling["height"],
            "rangeAtCorners": float(max(heights) - min(heights)),
            "tiltDeg": float(np.degrees(np.arccos(min(1.0, abs(n_c[1]))))),
            "rms": float(np.sqrt(np.mean(dh**2))),
            "spread": spread,
            "cells": cells,
            "inliers": len(ceiling["idx"]),
            "normal": n_c.tolist(),
        }

    sides = box["sides"].values()
    if lines and sum(s == "wall" for s in sides) < 4:
        warnings.append(f"Only {sum(s == 'wall' for s in sides)} of 4 walls bound the room; the rest come from the spread of points.")
    if doubled:
        warnings.append("Some walls look doubled (the same wall placed twice). Re-film with a slower, closed loop.")
    if split:
        warnings.append("The floor looks split into two levels. Re-film with a slower, closed loop.")

    return RoomFit(
        rotation=rotation,
        origin=origin,
        floor=floor_q or None,
        ceiling=ceil_q,
        ceiling_candidates=sorted(
            ({"height": p["height"], "inliers": len(p["idx"])} for p in above), key=lambda c: -c["height"]
        ),
        walls=walls,
        box=box,
        quality={"doubled": doubled, "split": split},
        warnings=warnings,
    )


def describe(fit: RoomFit, s: float) -> tuple[dict, dict]:
    """Room and quality JSON with every length multiplied by the scale factor s."""
    r = lambda v, k=3: round(float(v) * s, k)  # noqa: E731
    box = fit.box
    walls = [
        {
            "id": f"wall-{i + 1}",
            "axis": w["axis"],
            "normal": [round(v, 4) for v in w["normal"]],
            "offset": r(w["offset"]),
            "segment": [[r(p[0]), r(p[1])] for p in w["segment"]],
            "lengthM": r(w["length"], 2),
            "rmsM": r(w["rms"], 4),
            "inliers": w["inliers"],
        }
        for i, w in enumerate(fit.walls)
    ]
    ceiling = None
    if fit.ceiling:
        c = fit.ceiling
        ceiling = {
            "heightM": r(c["height"]),
            "normal": [round(v, 4) for v in c["normal"]],
            "tiltDeg": round(c["tiltDeg"], 2),
            "heightRangeAtCornersM": r(c["rangeAtCorners"]),
            "rmsM": r(c["rms"], 4),
            "heightSpreadM": None if c["spread"] is None else r(c["spread"]),
            "cellsMeasured": c["cells"],
            "inliers": c["inliers"],
            "note": "Highest large down-facing plane. In an unfinished basement this may be the subfloor between joists, not their underside.",
        }
    floor = None
    if fit.floor:
        f = fit.floor
        floor = {
            "heightM": 0.0,
            "normal": [round(v, 4) for v in f["normal"]],
            "rmsM": r(f["rms"], 4),
            "heightSpreadM": None if f["spread"] is None else r(f["spread"]),
            "cellsMeasured": f["cells"],
            "inliers": f["inliers"],
        }
    room = {
        "floor": floor,
        "ceiling": ceiling,
        "ceilingCandidates": [{"heightM": r(c["height"]), "inliers": c["inliers"]} for c in fit.ceiling_candidates],
        "ceilingHeightM": ceiling["heightM"] if ceiling else None,
        "widthM": r(box["max"][0] - box["min"][0], 2),
        "depthM": r(box["max"][2] - box["min"][2], 2),
        "box": {
            "min": [r(v) for v in box["min"]],
            "max": [r(v) for v in box["max"]],
            "sides": box["sides"],
            "heightFrom": box["heightFrom"],
        },
        "walls": walls,
    }
    q = fit.quality
    # Pass bar (research note): one flat floor; ceiling height within 5 cm across the room.
    f_spread = fit.floor["spread"] if fit.floor else None
    c_spread = fit.ceiling["spread"] if fit.ceiling else None
    flat = None if f_spread is None else bool(f_spread * s <= FLAT_FLOOR and not q["split"])
    level = None if c_spread is None else bool(c_spread * s <= LEVEL_CEILING)
    quality = {
        "wallsDoubled": bool(q["doubled"]),
        "doubledWalls": [
            {"walls": [walls[i]["id"] for i in d["walls"]], "gapM": r(d["gap"]), "sharedFrames": round(d["sharedFrames"], 2)}
            for d in q["doubled"]
        ],
        "floorSplit": None if not q["split"] else {
            "gapM": r(q["split"]["gap"]),
            "inliers": q["split"]["inliers"],
            "sharedFrames": round(q["split"]["sharedFrames"], 2),
        },
        "pass": {
            "wallsNotDoubled": not q["doubled"] if len(fit.walls) >= 2 else None,
            "flatFloor": flat,
            "ceilingLevelWithin5cm": level,
        },
        "warnings": list(fit.warnings),
    }
    return room, quality
