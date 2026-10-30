"""The basement's floor plan, read from one connected point cloud: walls, rooms, doors and what's in them.

Points come in one +Y-up world in metres: the phone's tracked world for an app take, or the basement frame
the areas were placed in for a web take. Steps:

1. The floor: the lowest large horizontal plane (RANSAC on 2 cm height layers below the cameras).
2. The main axes, and everything turned onto them (the plan frame: world (x, z) turned by -rotation).
3. Stairs: where the camera rode high on the way down, plus SAM's finds.
4. Wall faces: vertical planes fitted by RANSAC to the points that rise through the wall band, snapped to
   the main axes unless the data insists on an angle, split into runs where the wall stops.
5. Open floor, cut into rooms at narrow necks (doorways): shrink it by half a door, grow each piece back.
6. A grid of cells on every wall face's line. Each cell is a room's, a wall's or outside; a room is the
   cells reachable from its open floor without crossing a wall, so its outline runs on real wall faces
   even where clutter hid the floor next to them.
7. Walls for the model: partitions between two rooms (centreline and thickness from both faces), the
   foundation round the outside, and any full-height wall standing inside a room.
8. Doors where two rooms meet at a neck (and where SAM saw one on a wall), windows from SAM, fixtures
   (stairs, furnace, water heater, panel, rough-in, and beams, ducts and bulkheads from the low ceiling).
9. Each room's ceiling height, so a low room is its own room with its own height.

Typed corrections (merge two rooms, split one, move a wall, a door between two rooms, a room's kind) are
checked against the points and applied only when the points agree. Pure numpy + OpenCV.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import cv2
import numpy as np

from .floorplan import _main_axis
from .room import ransac_plane
from .views import floor_edges

CELL = 0.05  # m
WALL_BAND = (0.6, 1.9)  # m above the floor: walls, not furniture tops or ducts
WALL_RISE = 0.8  # m: a wall rises through the band; a table or bench shows up only near its top
DOOR_HALF = 0.40  # m: half a doorway; open floor narrower than a door splits rooms
MIN_ROOM_M2 = 1.0
SMALL_ROOM_M2 = 2.5  # below this a room must be walled most of the way round (a closet), or it joins a neighbour
CLOSET_M2 = 0.8  # the smallest room kept when it opens only through a door and nobody went in
DOOR_MAX_M = 1.3  # metres of open boundary a doorway has, at most
OPEN_JOIN_M = 1.6  # two rooms that meet along this much unwalled boundary are one open room
FACE_TOL = 0.04  # m: a point within this of a wall plane is on it
SNAP_DEG = 8.0  # a wall within this of the main axes is square to them
MIN_FACE_M = 0.35
PARTITION_MAX = 0.45  # m: two facing room edges closer than this share one wall
NEW_WALL_M = 0.12
FOUNDATION_M = 0.2
STAIR_EYE = 1.85  # m: a camera this far above the floor is on the stairs
EYE_DEFAULT = 1.45


@dataclass
class Floor:
    y: float  # height of the floor at the cameras' centre
    normal: list[float]
    spread: float  # p5-p95 of the floor points' height off the plane
    tilt_deg: float
    inliers: int


@dataclass
class Face:
    """One side of a wall, as seen from a room: the line n.p = c in the plan frame, from a to b along it."""

    n: np.ndarray  # unit normal, pointing into the room that saw it
    c: float
    a: float
    b: float
    count: int
    square: bool  # on the main axes
    top: float = 0.0  # height its points reach
    bottom: float = 0.0
    full: bool = False  # floor to ceiling: a wall, not a shelf
    base: bool = False  # found where the floor stops in the pictures, not from the wall's own points
    moved: float = 0.0  # how far out the floor's edge moved it

    @property
    def t(self) -> np.ndarray:
        return np.array([-self.n[1], self.n[0]])

    def ends(self) -> tuple[np.ndarray, np.ndarray]:
        p0 = self.n * self.c
        return p0 + self.t * self.a, p0 + self.t * self.b


@dataclass
class Grid:
    lo: np.ndarray
    W: int
    H: int

    def ij(self, uv: np.ndarray) -> np.ndarray:
        return np.floor((uv - self.lo) / CELL).astype(int)

    def raster(self, uv: np.ndarray) -> np.ndarray:
        g = np.zeros((self.H, self.W), np.int32)
        ij = self.ij(uv)
        ok = (ij[:, 0] >= 0) & (ij[:, 0] < self.W) & (ij[:, 1] >= 0) & (ij[:, 1] < self.H)
        np.add.at(g, (ij[ok, 1], ij[ok, 0]), 1)
        return g

    def px(self, u: float, axis: int) -> int:
        return int(round((u - self.lo[axis]) / CELL))


def disk(r_m: float) -> np.ndarray:
    r = max(1, int(round(r_m / CELL)))
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))


# ---- 1. The floor ----


def find_floor(points: np.ndarray, cam_y: float | None = None, seed: int = 0) -> Floor | None:
    """The lowest large horizontal plane below the cameras: of the 2 cm height layers holding at least a
    quarter as many points as the strongest and spread over a square metre, the lowest; then RANSAC on
    that layer for the plane itself (a floor can slope to a drain)."""
    y = points[:, 1]
    hi = cam_y - 0.6 if cam_y is not None else float(np.percentile(y, 50))
    lo = cam_y - 2.6 if cam_y is not None else float(np.percentile(y, 0.2)) - 0.1
    sel = points[(y > lo) & (y < hi)]
    if len(sel) < 200:
        return None
    bins = max(1, int((hi - lo) / 0.02))
    hist, edges = np.histogram(sel[:, 1], bins=bins, range=(lo, hi))
    smooth = np.convolve(hist, [1, 2, 1], "same")
    peaks = [k for k in range(len(smooth)) if smooth[k] > 0 and smooth[k] >= smooth[max(0, k - 1)] and smooth[k] >= smooth[min(len(smooth) - 1, k + 1)]]
    if not peaks:
        return None
    best = max(smooth[k] for k in peaks)
    pick = None
    for k in sorted(peaks, key=lambda k: edges[k]):
        if smooth[k] < 0.25 * best:
            continue
        h = (edges[k] + edges[k + 1]) / 2
        layer = sel[np.abs(sel[:, 1] - h) < 0.04]
        cells = np.unique(np.floor(layer[:, [0, 2]] / 0.1).astype(np.int64), axis=0)
        if len(cells) >= 100:  # 1 m² of 10 cm cells
            pick = (h, layer)
            break
    if pick is None:
        k = max(peaks, key=lambda k: smooth[k])
        h = (edges[k] + edges[k + 1]) / 2
        pick = (h, sel[np.abs(sel[:, 1] - h) < 0.04])
    h, layer = pick
    rng = np.random.default_rng(seed)
    found = ransac_plane(layer, rng, axis=np.array([0.0, 1.0, 0.0]), max_angle=np.deg2rad(6), thresh=0.02)
    if found is None:
        return Floor(float(h), [0.0, 1.0, 0.0], 0.04, 0.0, int(len(layer)))
    n, d, inl = found
    if n[1] < 0:
        n, d = -n, -d
    centre = np.median(layer[:, [0, 2]], 0)
    fy = float(-(d + n[0] * centre[0] + n[2] * centre[1]) / n[1])
    off = layer[inl] @ n + d
    spread = float(np.percentile(off, 95) - np.percentile(off, 5)) if inl.sum() > 20 else 0.04
    return Floor(round(fy, 4), np.round(n, 5).tolist(), round(spread, 3), round(float(np.degrees(np.arccos(min(1.0, n[1])))), 2), int(inl.sum()))


def height_above(points: np.ndarray, floor: Floor) -> np.ndarray:
    n = np.asarray(floor.normal)
    return (points - np.array([0.0, floor.y, 0.0])) @ n


def layer_peak(h: np.ndarray, lo: float, hi: float, share: float = 0.2) -> float | None:
    """The lowest large horizontal layer between lo and hi: a ceiling (or the joists' underside, when the
    subfloor between them is the stronger layer only by a little)."""
    sel = h[(h >= lo - 0.3) & (h <= hi)]
    if len(sel) < 60:
        return None
    a = lo - 0.3
    hist, edges = np.histogram(sel, bins=max(1, int((hi - a) / 0.02)), range=(a, hi))
    smooth = np.convolve(hist, [1, 2, 1], "same").astype(float)
    # Walls give every height the same steady count; a ceiling stands out of that.
    back = np.array([np.median(smooth[max(0, k - 12) : k + 13]) for k in range(len(smooth))])
    rise = smooth - back
    first = int(np.searchsorted(edges, lo))
    if first >= len(rise) or rise[first:].max() <= 0:
        return None
    best = rise[first:].max()
    for k in range(first, len(rise)):
        if rise[k] >= max(share * best, 0.5 * back[k]) and smooth[k] >= smooth[max(0, k - 1)] and smooth[k] >= smooth[min(len(smooth) - 1, k + 1)]:
            return float((edges[k] + edges[k + 1]) / 2)
    return None


# ---- 3. Stairs from the camera's walk ----


def stairs_from_walk(cams_uv: np.ndarray, cams_h: np.ndarray) -> dict | None:
    """Where the camera rode high on the way down, the stairs run under it: a 0.9 m strip along the
    camera's line, from where it was highest to where it reached the floor."""
    high = cams_h > STAIR_EYE
    if high.sum() < 4:
        return None
    # The longest run of high cameras (the walk down; a later trip up is usually off the end).
    runs, start = [], None
    for i, flag in enumerate(np.append(high, False)):
        if flag and start is None:
            start = i
        elif not flag and start is not None:
            runs.append((start, i))
            start = None
    s, e = max(runs, key=lambda r: r[1] - r[0])
    e = min(len(cams_uv), e + 3)  # the last steps down, already near eye height
    p, hh = cams_uv[s:e], cams_h[s:e]
    # Standing on the upper floor before going down isn't over the stairs: keep where the camera descends.
    slope = hh < hh.max() - 0.25
    if slope.sum() >= 4:
        p, hh = p[slope], hh[slope]
    if len(p) < 4:
        return None
    c = p.mean(0)
    axis = np.linalg.svd(p - c, full_matrices=False)[2][0]
    along = (p - c) @ axis
    if np.ptp(along) < 0.8 or abs(np.corrcoef(along, hh)[0, 1]) < 0.5:
        return None
    ang = np.arctan2(axis[1], axis[0])
    q = np.round(ang / (np.pi / 2)) * (np.pi / 2)
    if abs(ang - q) < np.deg2rad(15):
        axis = np.array([np.cos(q), np.sin(q)])
        along = (p - c) @ axis
    across = np.array([-axis[1], axis[0]])
    mid = float(np.median((p - c) @ across))
    bottom_end = along[np.argmin(hh)]
    lo_a, hi_a = float(along.min()) - 0.25, float(along.max()) + 0.25
    corners = [c + axis * a + across * (mid + w) for a in (lo_a, hi_a) for w in (-0.45, 0.45)]
    corners = np.array(corners)[[0, 1, 3, 2]]
    bottom = c + axis * (lo_a if abs(bottom_end - lo_a) < abs(bottom_end - hi_a) else hi_a) + across * mid
    return {"polygon": corners, "bottom": bottom, "axis": axis, "source": "walk"}


# ---- 2. The main axes ----


def main_axis(xz: np.ndarray, seed: int = 0, prior: float | None = None) -> float:
    """The walls' dominant direction, modulo 90 degrees: wall lines found by RANSAC without snapping,
    their angles averaged on the 90-degree circle, weighted by points times length. `prior`: where each
    area's own room frame put its walls; the walls are then only looked for within 4 degrees of it."""
    if len(xz) < 200:
        return _main_axis(xz)
    rng = np.random.default_rng(seed)
    pool = xz if len(xz) <= 60_000 else xz[rng.choice(len(xz), 60_000, replace=False)]
    found: list[tuple[float, float]] = []  # (angle modulo 90 degrees, weight)
    for _ in range(25):
        if len(pool) < 200:
            break
        S = pool if len(pool) <= 20_000 else pool[rng.choice(len(pool), 20_000, replace=False)]
        pair = S[rng.integers(0, len(S), (600, 2))]
        t = pair[:, 1] - pair[:, 0]
        L = np.linalg.norm(t, axis=1)
        ok = L > 0.5
        if not ok.any():
            break
        n = np.stack([-t[ok, 1], t[ok, 0]], 1) / L[ok, None]
        c = (n * pair[ok, 0]).sum(1)
        counts = (np.abs(S @ n.T - c) < 0.03).sum(0)
        k = int(counts.argmax())
        on = np.abs(pool @ n[k] - c[k]) < 0.04
        P = pool[on]
        if len(P) < 100:
            break
        # The longest unbroken run along the line: a line through points of several walls isn't a wall.
        tdir = np.array([-n[k][1], n[k][0]])
        al = P @ tdir
        order = np.argsort(al)
        cuts = np.nonzero(np.diff(al[order]) > 0.25)[0]
        runs = np.split(order, cuts + 1)
        P = P[max(runs, key=len)]
        if len(P) < 60:
            pool = pool[~on]
            continue
        ctr = P.mean(0)
        u, sv, vt = np.linalg.svd(P - ctr, full_matrices=False)
        d = vt[0]
        span = float(np.ptp((P - ctr) @ d))
        found.append((float(np.arctan2(d[1], d[0]) % (np.pi / 2)), len(P) * span))
        pool = pool[~on]
    if not found:
        return _main_axis(xz)
    # The most common direction (a few odd walls or a diagonal shelf don't pull it), then the weighted
    # mean of the walls within 3 degrees of it.
    ang = np.array([a for a, _ in found])
    w = np.array([x for _, x in found])
    grid_a = np.deg2rad(np.arange(0, 90, 0.25))
    if prior is not None:
        grid_a = grid_a[np.abs(np.angle(np.exp(4j * (grid_a - prior))) / 4) <= np.deg2rad(4)]
    diff = np.angle(np.exp(4j * (grid_a[:, None] - ang[None, :]))) / 4
    peak = grid_a[int(((np.exp(-0.5 * (diff / np.deg2rad(1.5)) ** 2)) * w).sum(1).argmax())]
    near = np.abs(np.angle(np.exp(4j * (ang - peak))) / 4) <= np.deg2rad(3)
    z = (w[near] * np.exp(4j * ang[near])).sum()
    return float(np.angle(z) / 4)


def area_axis(rotations: list) -> float | None:
    """The walls' direction the areas' own room frames agree on (each frame's x runs along its longest
    wall): their median on the 90-degree circle, in the world's (x, z)."""
    if not rotations:
        return None
    ang = np.array([np.arctan2(R[0][2], R[0][0]) for R in rotations])
    z = np.exp(4j * ang)
    med = min(ang, key=lambda a: np.abs(np.angle(z * np.exp(-4j * a))).sum())
    return float(med % (np.pi / 2))


# ---- 4. Wall faces ----


def find_faces(uv: np.ndarray, free: np.ndarray, grid: Grid, seed: int = 0) -> list[Face]:
    """Sequential RANSAC: the line with most wall points, snapped square when it's within SNAP_DEG of the
    axes, split into runs where its points stop; its points are removed and the next is found."""
    rng = np.random.default_rng(seed)
    pool = uv if len(uv) <= 90_000 else uv[rng.choice(len(uv), 90_000, replace=False)]
    faces: list[Face] = []
    for _ in range(120):
        if len(pool) < 40:
            break
        S = pool if len(pool) <= 25_000 else pool[rng.choice(len(pool), 25_000, replace=False)]
        pair = S[rng.integers(0, len(S), (600, 2))]
        t = pair[:, 1] - pair[:, 0]
        L = np.linalg.norm(t, axis=1)
        ok = L > 0.25
        if not ok.any():
            break
        n = np.stack([-t[ok, 1], t[ok, 0]], 1) / L[ok, None]
        c = (n * pair[ok, 0]).sum(1)
        counts = (np.abs(S @ n.T - c) < 0.03).sum(0)
        k = int(counts.argmax())
        nk, ck = n[k], float(c[k])
        on = np.abs(pool @ nk - ck) < FACE_TOL
        if on.sum() < 40:
            break
        P = pool[on]
        # Refit: square to the axes when close, else the points' own direction.
        ang = np.arctan2(nk[1], nk[0])
        q = np.round(ang / (np.pi / 2)) * (np.pi / 2)
        square = abs(ang - q) < np.deg2rad(SNAP_DEG)
        if square:
            nk = np.round(np.array([np.cos(q), np.sin(q)]))
        else:
            ctr = P.mean(0)
            tt = np.linalg.svd(P - ctr, full_matrices=False)[2][0]
            nk = np.array([-tt[1], tt[0]])
        ck = float(np.median(P @ nk))
        first = on
        on = np.abs(pool @ nk - ck) < FACE_TOL
        if on.sum() < 30:  # the refit line lost its points: drop the first fit's and go on
            pool = pool[~first]
            continue
        P = pool[on]
        tt = np.array([-nk[1], nk[0]])
        along = np.sort(P @ tt)
        gaps = np.nonzero(np.diff(along) > 0.25)[0]
        starts = np.r_[0, gaps + 1]
        ends = np.r_[gaps, len(along) - 1]
        for s, e in zip(starts, ends):
            a, b = float(along[s]), float(along[e])
            if b - a < MIN_FACE_M or e - s + 1 < 30:
                continue
            occ = np.unique(np.floor((along[s : e + 1] - a) / 0.05)).size / max(1.0, (b - a) / 0.05)
            if occ < 0.45:
                continue
            faces.append(Face(nk.copy(), ck, a, b, int(e - s + 1), bool(square)))
        pool = pool[~on]
    # The side each face was seen from: the side with open floor next to it.
    out = []
    for f in faces:
        mids = np.linspace(f.a, f.b, max(3, int((f.b - f.a) / 0.1)))
        base = f.n * f.c + mids[:, None] * f.t
        score = []
        for sgn in (1, -1):
            pts = np.concatenate([base + sgn * d * f.n for d in (0.15, 0.3, 0.45)])
            ij = grid.ij(pts)
            okk = (ij[:, 0] >= 0) & (ij[:, 0] < grid.W) & (ij[:, 1] >= 0) & (ij[:, 1] < grid.H)
            score.append(free[ij[okk, 1], ij[okk, 0]].sum() if okk.any() else 0)
        if score[1] > score[0]:
            f = Face(-f.n, -f.c, -f.b, -f.a, f.count, f.square)
        out.append(f)
    return merge_faces(out)


def merge_faces(faces: list[Face]) -> list[Face]:
    """Pieces of one face (same side, within 5 cm, less than 30 cm apart along it) become one."""
    faces = sorted(faces, key=lambda f: -(f.b - f.a))
    out: list[Face] = []
    for f in faces:
        for g in out:
            if g.n @ f.n > 0.999 and abs(g.c - f.c) < 0.05 and f.a < g.b + 0.3 and f.b > g.a - 0.3:
                w = (g.b - g.a) / max(1e-6, (g.b - g.a) + (f.b - f.a))
                g.c = w * g.c + (1 - w) * f.c
                g.a, g.b = min(g.a, f.a), max(g.b, f.b)
                g.count += f.count
                break
        else:
            out.append(f)
    return out


def face_heights(faces: list[Face], uv: np.ndarray, h: np.ndarray, ceiling: float | None) -> None:
    """How high each face's points reach: a wall runs floor to ceiling (the ceiling over the room it faces,
    so a low room's walls count), a shelf or a furnace stops short of it."""
    cap = (ceiling or 3.0) + 0.1
    for f in faces:
        d = uv @ f.n - f.c
        al = uv @ f.t
        span = (al > f.a) & (al < f.b) & (h < cap)
        on = span & (np.abs(d) < FACE_TOL)
        if on.sum() < 20:
            continue
        f.top = float(np.percentile(h[on], 97))
        f.bottom = float(np.percentile(h[on], 3))
        over = span & (d > 0.1) & (d < 0.8) & (h > 1.2)
        local = float(np.percentile(h[over], 95)) if over.sum() > 30 else (ceiling or 2.3)
        f.full = (f.top >= 1.95 or f.top >= local - 0.3) and f.bottom <= 0.6


def outermost(faces: list[Face], reach: float = 0.9) -> list[Face]:
    """One wall seen as several parallel copies from the same side (the 3D pulls a bare wall towards the
    camera, by more from further away): the copy furthest from the room is the wall, and the nearer copies
    move out onto it and join it. A partition's two faces look opposite ways, so both stay; a wall seen
    through a door, past a wall facing back, isn't a copy."""
    for f in sorted(faces, key=lambda f: -(f.b - f.a)):
        if not f.full or not f.square:
            continue
        best = None
        for g in faces:
            if g is f or not g.full or not g.square or g.n @ f.n < 0.99:
                continue
            behind = f.c - g.c
            ov = min(f.b, g.b) - max(f.a, g.a)
            if not (0.03 < behind <= reach and ov >= 0.3 * min(f.b - f.a, g.b - g.a) and ov >= 0.3):
                continue
            between = any(x.full and x.n @ f.n < -0.99 and g.c - 0.02 < -x.c < f.c + 0.02 and min(f.b, -x.a) - max(f.a, -x.b) > 0.3 for x in faces)
            if not between and (best is None or behind > best[1]):
                best = (g, behind)
        if best is not None:
            f.c = best[0].c
            f.moved += best[1]
    return merge_faces(faces)


def tie_in(faces: list[Face], gap: float = 0.35) -> None:
    """A wall stands on its own only if it's long, seen from both sides, or meets another wall at an end;
    a short floating piece is a far wall the 3D pulled in, or a tall cupboard, and stops counting."""
    full = [f for f in faces if f.full]
    for f in full:
        if f.b - f.a >= 2.5:
            continue
        two_sided = any(g is not f and g.n @ f.n < -0.99 and abs(f.c + g.c) <= 0.3 and min(f.b, -g.a) - max(f.a, -g.b) > 0.3 for g in full)
        ends = f.ends()
        touches = False
        for g in full:
            if g is f:
                continue
            g0, g1 = g.ends()
            for e in ends:
                # distance from this end to g's segment
                d = g1 - g0
                L2 = float(d @ d)
                u = 0.0 if L2 == 0 else float(np.clip((e - g0) @ d / L2, 0, 1))
                if np.hypot(*(g0 + u * d - e)) <= gap:
                    touches = True
                    break
            if touches:
                break
        if not (two_sided or touches):
            f.full = False


def with_floor_edges(faces: list[Face], base: list[Face], reach: float = 0.8) -> list[Face]:
    """A wall face with the floor's edge running parallel behind it, within reach, moves out onto that
    edge: the floor shows the wall's foot is there. Never inwards (a box in front of a wall stops the
    floor short of it). A floor edge with no wall face near it stands for a wall the points missed."""
    used = set()
    for f in faces:
        if not f.full or not f.square:
            continue
        best = None
        for k, g in enumerate(base):
            if not g.square or g.n @ f.n < 0.99:
                continue
            delta = f.c - g.c  # how far behind f (away from the room) g lies
            ov = min(f.b, g.b) - max(f.a, g.a)
            if 0.04 < delta <= reach and ov >= max(0.4, 0.4 * min(f.b - f.a, g.b - g.a)):
                if best is None or ov * g.count > best[1]:
                    best = (k, ov * g.count, delta)
        if best is not None:
            g = base[best[0]]
            f.c, f.moved = g.c, best[2]
            used.add(best[0])
    for k, g in enumerate(base):
        if k in used or g.b - g.a < 0.8 or not g.square:
            continue
        near = any(f.n @ g.n > 0.99 and abs(f.c - g.c) < reach and min(f.b, g.b) - max(f.a, g.a) > 0.2 for f in faces)
        if not near:
            g.base, g.full = True, True
            faces.append(g)
    return merge_faces(faces)


# ---- 6. The cell grid on the wall lines ----


def barrier_of(faces: list[Face], grid: Grid) -> np.ndarray:
    """Where a real wall stands: every floor-to-ceiling face drawn as a line. Furniture rises through the
    wall band too, but it doesn't stop a room."""
    out = np.zeros((grid.H, grid.W), np.uint8)
    for f in faces:
        if not f.full:
            continue
        e0, e1 = f.ends()
        a, b = grid.ij(np.array([e0, e1]))
        cv2.line(out, (int(a[0]), int(a[1])), (int(b[0]), int(b[1])), 1, 1)
    return out


# ---- 6. Rooms on the raster ----


def fill_rooms(regions: np.ndarray, footprint: np.ndarray, blocked: np.ndarray, reach: float = 1.5) -> np.ndarray:
    """Floor inside the footprint that no room's open floor reached (clutter, a corner the camera didn't
    see the floor of) joins the nearest room it can reach without crossing a wall."""
    lab = regions.copy()
    room = (footprint > 0) & (blocked == 0)
    for _ in range(int(reach / CELL)):
        dil = cv2.dilate(lab.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
        add = (lab == 0) & room & (dil > 0)
        if not add.any():
            break
        lab[add] = dil[add]
    return lab


def walls_facing_away(labels: np.ndarray, faces: list[Face], grid: Grid) -> dict[int, float]:
    """For each room, the share of the wall faces along it that look away from it (it's behind them)."""
    front: dict[int, float] = {}
    back: dict[int, float] = {}
    for f in faces:
        if not f.full:
            continue
        ts = np.arange(f.a, f.b, CELL)
        base = f.n * f.c + ts[:, None] * f.t
        for sign, acc in ((1, front), (-1, back)):
            q = grid.ij(base + sign * f.n * 0.15)
            ok = (q[:, 0] >= 0) & (q[:, 0] < grid.W) & (q[:, 1] >= 0) & (q[:, 1] < grid.H)
            for k in labels[q[ok, 1], q[ok, 0]]:
                if k:
                    acc[int(k)] = acc.get(int(k), 0.0) + CELL
    return {k: back.get(k, 0.0) / (back.get(k, 0.0) + front.get(k, 0.0)) for k in set(front) | set(back) if back.get(k, 0.0) + front.get(k, 0.0) >= 0.5}


def split_ghost(labels: np.ndarray, k: int, reach: float = 0.6) -> bool:
    """A ghost strip between two rooms goes half to each, with a 12 cm wall down its middle: the wall is
    somewhere between where the two rooms' cameras saw it."""
    mask = labels == k
    ring = cv2.dilate(mask.astype(np.uint8), disk(reach)) > 0
    nbrs = [int(o) for o in np.unique(labels[ring & ~mask]) if o and o != k]
    if len(nbrs) < 2:
        return False
    dist = np.stack([cv2.distanceTransform((labels != o).astype(np.uint8), cv2.DIST_L2, 5) for o in nbrs])
    owner = np.array(nbrs)[dist.argmin(0)]
    labels[mask] = owner[mask]
    # The wall: strip pixels next to a pixel the other room got.
    edge = np.zeros_like(mask)
    for dy, dx in ((0, 1), (1, 0), (0, -1), (-1, 0)):
        shifted = np.roll(np.roll(owner, dy, 0), dx, 1)
        edge |= mask & (shifted != owner) & np.roll(np.roll(mask, dy, 0), dx, 1)
    labels[cv2.dilate(edge.astype(np.uint8), np.ones((2, 2), np.uint8)) > 0 & mask] = 0
    return True


def contact(labels: np.ndarray, a: int, b: int) -> float:
    """Metres of open boundary where rooms a and b touch directly (no wall between)."""
    A, B = labels == a, labels == b
    n = (A[:, :-1] & B[:, 1:]).sum() + (B[:, :-1] & A[:, 1:]).sum() + (A[:-1, :] & B[1:, :]).sum() + (B[:-1, :] & A[1:, :]).sum()
    return float(n) * CELL


def near(labels: np.ndarray, a: int, b: int, gap: float = 0.4) -> bool:
    """Rooms a and b come within `gap` of each other (a wall between them)."""
    d = cv2.dilate((labels == a).astype(np.uint8), disk(gap))
    return bool((d & (labels == b)).any())


def enclosed(labels: np.ndarray, k: int, blocked: np.ndarray, footprint: np.ndarray) -> float:
    """Share of a room's edge that is wall or outside: a closet is closed in; a nook opens onto its room."""
    m = (labels == k).astype(np.uint8)
    ring = cv2.dilate(m, np.ones((3, 3), np.uint8)) & (1 - m)
    ring2 = cv2.dilate(m, disk(0.15)) & (1 - m)
    closed = ((blocked > 0) | (footprint == 0)) & (ring2 > 0)
    ring_px = ring > 0
    # A ring pixel counts as closed if there's wall or outside within 15 cm of it.
    near_closed = cv2.dilate(closed.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    return float((ring_px & near_closed).sum() / max(1, ring_px.sum()))


def room_outline(mask: np.ndarray, grid: Grid, step: int = 2) -> list[tuple[float, float]]:
    """A room's raster as a square polygon on a 10 cm grid, holes filled, small steps tidied."""
    H, W = mask.shape
    m = cv2.morphologyEx(mask.astype(np.uint8), cv2.MORPH_CLOSE, disk(0.15))
    Hs, Ws = (H + step - 1) // step, (W + step - 1) // step
    pad = np.zeros((Hs * step, Ws * step), np.uint8)
    pad[:H, :W] = m
    coarse = pad.reshape(Hs, step, Ws, step).mean((1, 3)) >= 0.5
    n, comp = cv2.connectedComponents(coarse.astype(np.uint8), connectivity=4)
    if n > 2:
        sizes = [((comp == c).sum(), c) for c in range(1, n)]
        coarse = comp == max(sizes)[1]
    xs = [float(grid.lo[0] + i * step * CELL) for i in range(Ws + 1)]
    zs = [float(grid.lo[1] + j * step * CELL) for j in range(Hs + 1)]
    return simplify(outline(coarse.astype(np.uint8), xs, zs), 0.25)


# ---- Room outlines from cells ----

WALL_SEARCH = 1.0  # m: how far past an outline its real wall face may sit
WALL_SHARE = 0.25  # a line counts as wall where this share of the edge has wall points
OPEN_GAP = 0.4  # m of open space after a wall ends the search outward


def settle(rooms: list[dict], wall: float = NEW_WALL_M) -> None:
    """Two rooms whose facing edges overlap or touch (closer than a wall) move apart to share one wall,
    centred where they met. After each move the outlines are read again."""

    def one_move() -> bool:
        for x in range(len(rooms)):
            for y in range(x + 1, len(rooms)):
                A, B = rooms[x], rooms[y]
                for a0, a1, ta, na, La in _edges(A["polygon"]):
                    for b0, b1, tb, nb, Lb in _edges(B["polygon"]):
                        if na @ nb > -0.99:
                            continue
                        gap = float((b0 - a0) @ na)
                        if not (-0.3 <= gap < wall - 0.02):
                            continue
                        s0, s1 = sorted([float((b0 - a0) @ ta), float((b1 - a0) @ ta)])
                        ov = min(La, s1) - max(0.0, s0)
                        if ov < 0.3 or ov < 0.6 * min(La, Lb):
                            continue
                        mid = gap / 2
                        _move_edge(A, a0, a1, na * (mid - wall / 2))
                        _move_edge(B, b0, b1, na * (mid + wall / 2 - gap))
                        return True
        return False

    for _ in range(20):
        if not one_move():
            break


def _move_edge(room: dict, a, b, move) -> None:
    P = [tuple(p) for p in room["polygon"]]
    out = []
    for p in P:
        if (abs(p[0] - a[0]) < 1e-6 and abs(p[1] - a[1]) < 1e-6) or (abs(p[0] - b[0]) < 1e-6 and abs(p[1] - b[1]) < 1e-6):
            out.append((p[0] + move[0], p[1] + move[1]))
        else:
            out.append(p)
    room["polygon"] = simplify(out)


def snap_out(rooms: list[dict], walls: np.ndarray, grid: Grid) -> None:
    """Each square edge of each outline moves out to the furthest wall line within WALL_SEARCH: the 3D
    pulls a bare wall towards the camera (more from further away) and clutter hides the floor next to it,
    so the nearest wall points are often a copy short of the wall. Never into another room, and never
    across open floor past a wall (whatever's there is something else). Every edge's new line is found
    first; the corners are then where neighbouring lines cross, so the outline stays square."""
    others = np.zeros((grid.H, grid.W), np.int32)
    for k, r in enumerate(rooms, start=1):
        cv2.fillPoly(others, [grid.ij(np.array(r["polygon"])).astype(np.int32)], k)
    reach = int(WALL_SEARCH / CELL)
    for k, r in enumerate(rooms, start=1):
        P = _clean([tuple(map(float, p)) for p in r["polygon"]])
        n = len(P)
        if n < 4 or n % 2:
            continue
        # Each edge as a line: (axis it's constant on, value), and how far it moves.
        lines = []
        for e in range(n):
            a, b = np.array(P[e]), np.array(P[(e + 1) % n])
            axis = 1 if abs(a[1] - b[1]) < 1e-9 else 0 if abs(a[0] - b[0]) < 1e-9 else -1
            lines.append([axis, float(a[axis]) if axis >= 0 else 0.0])
        if any(l[0] < 0 for l in lines) or any(lines[e][0] == lines[(e + 1) % n][0] for e in range(n)):
            continue  # not a clean square outline: leave it
        for e in range(n):
            a, b = np.array(P[e]), np.array(P[(e + 1) % n])
            L = float(np.hypot(*(b - a)))
            if L < 0.3:
                continue
            t = (b - a) / L
            nrm = np.array([t[1], -t[0]])
            if _inside(P, (a + b) / 2 + nrm * 0.03):
                nrm = -nrm
            ts = np.arange(0.1, L - 0.1, CELL)
            base = a + ts[:, None] * t
            last = None
            for step in range(1, reach + 1):
                q = grid.ij(base + nrm * (step * CELL))
                ok = (q[:, 0] >= 0) & (q[:, 0] < grid.W) & (q[:, 1] >= 0) & (q[:, 1] < grid.H)
                if not ok.any():
                    break
                o = others[q[ok, 1], q[ok, 0]]
                if ((o > 0) & (o != k)).mean() > 0.2:
                    break
                if (walls[q[ok, 1], q[ok, 0]] > 0).mean() >= WALL_SHARE:
                    last = step
                    if not r.get("entered", True):
                        break  # seen from its door: its wall is the first one, not a copy behind it
                elif last is not None and (step - last) * CELL >= OPEN_GAP:
                    break
            if last is not None:
                lines[e][1] += float(nrm[lines[e][0]]) * last * CELL
        # Corner k sits where edge k-1's line meets edge k's.
        out = []
        for e in range(n):
            prev, cur = lines[e - 1], lines[e]
            pt = [0.0, 0.0]
            pt[prev[0]], pt[cur[0]] = prev[1], cur[1]
            out.append(tuple(pt))
        r["polygon"] = simplify(out)


def outline(mask: np.ndarray, xs: list[float], zs: list[float]) -> list[tuple[float, float]]:
    """The outer boundary of a set of grid cells, as a polygon on the grid lines, with corners only
    where it turns."""
    nz, nx = mask.shape
    m = np.zeros((nz + 2, nx + 2), np.uint8)
    m[1:-1, 1:-1] = mask
    # Fill holes: anything not reachable from outside is inside.
    outside = m.copy()
    ff = np.zeros((nz + 4, nx + 4), np.uint8)
    cv2.floodFill(outside, ff, (0, 0), 2)
    m[outside == 0] = 1
    # Directed boundary edges, interior on the left: (x, z) grid vertices.
    nxt = {}
    for j in range(nz + 2):
        for i in range(nx + 2):
            if not m[j, i]:
                continue
            if j == 0 or not m[j - 1, i]:
                nxt[(i + 1, j)] = (i, j)  # top edge, heading -x
            if j == nz + 1 or not m[j + 1, i]:
                nxt[(i, j + 1)] = (i + 1, j + 1)  # bottom edge, heading +x
            if i == 0 or not m[j, i - 1]:
                nxt[(i, j)] = (i, j + 1)  # left edge, heading +z
            if i == nx + 1 or not m[j, i + 1]:
                nxt[(i + 1, j + 1)] = (i + 1, j)  # right edge, heading -z
    if not nxt:
        return []
    loops, seen = [], set()
    for start in list(nxt):
        if start in seen:
            continue
        loop, p = [], start
        while p not in seen and p in nxt:
            seen.add(p)
            loop.append(p)
            p = nxt[p]
        if len(loop) >= 4:
            loops.append(loop)
    if not loops:
        return []

    def area(lp):
        return 0.5 * sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(lp, lp[1:] + lp[:1]))

    loop = max(loops, key=lambda lp: abs(area(lp)))
    # Corners only.
    pts = []
    for k in range(len(loop)):
        a, b, c = loop[k - 1], loop[k], loop[(k + 1) % len(loop)]
        if (b[0] - a[0], b[1] - a[1]) != (c[0] - b[0], c[1] - b[1]):
            pts.append(b)
    X = [xs[0]] + list(xs) + [xs[-1]]
    Z = [zs[0]] + list(zs) + [zs[-1]]
    return [(X[i], Z[j]) for i, j in pts]


def poly_area(poly) -> float:
    return 0.5 * abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(poly, poly[1:] + poly[:1])))


def simplify(poly: list[tuple[float, float]], step: float = 0.2) -> list[tuple[float, float]]:
    """Square polygon tidied: steps shorter than `step` between two parallel edges are taken out by moving
    the shorter edge onto the longer one's line; zero-length and straight-through corners go."""
    P = [tuple(map(float, p)) for p in poly]
    for _ in range(200):
        n = len(P)
        if n <= 4:
            break
        changed = False
        for k in range(n):
            a, b = P[k], P[(k + 1) % n]
            L = abs(b[0] - a[0]) + abs(b[1] - a[1])
            if L >= step:
                continue
            prev, nxt2 = P[k - 1], P[(k + 2) % n]
            lp = abs(a[0] - prev[0]) + abs(a[1] - prev[1])
            ln = abs(nxt2[0] - b[0]) + abs(nxt2[1] - b[1])
            horizontal = abs(b[0] - a[0]) < 1e-9  # the short edge runs along z: neighbours run along x
            if lp >= ln:  # move the next edge onto the previous one's line
                if horizontal:
                    P[(k + 1) % n] = (b[0], a[1])
                    P[(k + 2) % n] = (nxt2[0], a[1])
                else:
                    P[(k + 1) % n] = (a[0], b[1])
                    P[(k + 2) % n] = (a[0], nxt2[1])
            else:
                if horizontal:
                    P[k] = (a[0], b[1])
                    P[k - 1] = (prev[0], b[1])
                else:
                    P[k] = (b[0], a[1])
                    P[k - 1] = (b[0], prev[1])
            changed = True
            break
        P = _clean(P)
        if not changed:
            break
    return P


def _clean(P):
    out = []
    for p in P:
        if out and abs(p[0] - out[-1][0]) < 1e-6 and abs(p[1] - out[-1][1]) < 1e-6:
            continue
        out.append(p)
    if len(out) > 1 and abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    changed = True
    while changed and len(out) > 3:
        changed = False
        for k in range(len(out)):
            a, b, c = out[k - 1], out[k], out[(k + 1) % len(out)]
            if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) < 1e-9:
                out.pop(k)
                changed = True
                break
    return out


# ---- The plan ----


@dataclass
class Plan:
    rotation: float
    floor: Floor | None
    ceiling: float | None
    rooms: list[dict]
    walls: list[dict]
    openings: list[dict]
    fixtures: list[dict]
    footprint_m2: float
    edits: list[dict] = field(default_factory=list)
    area_floors: list[dict] = field(default_factory=list)
    debug: dict = field(default_factory=dict)

    def to_json(self) -> dict:
        return {
            "version": 1,
            "frame": "plan: world (x, z) turned by -rotation; metres; floor at height 0",
            "rotation": round(self.rotation, 6),
            "floor": None if self.floor is None else {"y": self.floor.y, "normal": self.floor.normal, "spreadM": self.floor.spread, "tiltDeg": self.floor.tilt_deg},
            "areaFloors": self.area_floors,
            "ceilingM": None if self.ceiling is None else round(self.ceiling, 3),
            "footprintM2": self.footprint_m2,
            "rooms": self.rooms,
            "walls": self.walls,
            "openings": self.openings,
            "fixtures": self.fixtures,
            "edits": self.edits,
        }


def _r(v, n=3):
    return round(float(v), n)


def _pt(p):
    return [_r(p[0]), _r(p[1])]


def _inside(poly, p) -> bool:
    x, z = p
    inside = False
    for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]):
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            inside = not inside
    return inside


def _edges(poly):
    """A polygon's edges with their outward normal (counter-clockwise in (u, v) with v down... either way:
    the normal is checked against the polygon's own inside)."""
    out = []
    for k in range(len(poly)):
        a, b = np.array(poly[k]), np.array(poly[(k + 1) % len(poly)])
        d = b - a
        L = float(np.hypot(*d))
        if L < 1e-6:
            continue
        t = d / L
        n = np.array([t[1], -t[0]])
        mid = (a + b) / 2
        if _inside(poly, mid + n * 0.02):
            n = -n
        out.append((a, b, t, n, L))
    return out


def read_plan(
    points: np.ndarray,
    cams: np.ndarray,
    *,
    area: np.ndarray | None = None,
    hints: dict | None = None,
    edits: list[dict] | None = None,
    views: list[dict] | None = None,
    axis_prior: float | None = None,
    seed: int = 0,
) -> Plan:
    """points: N x 3, cams: M x 3 camera centres along the walk, both in a +Y-up world in metres.
    area: which area each point came from (for each area's own floor). hints: SAM's finds lifted into the
    same world ({"doors": [...], "windows": [...], "stairs": [...], "fixtures": [...], "overhead": [...]},
    each with "low"/"high"/"center" [x, y, z] and an "id"). edits: typed corrections to check and apply.
    views: the frames the 3D kept, with depth (scan3d/views.py), for where the floor meets the walls."""
    hints = hints or {}
    edits = [dict(e) for e in (edits or [])]
    cam_y = float(np.median(cams[:, 1])) if len(cams) else None
    floor = find_floor(points, cam_y, seed)
    if floor is None:
        floor = Floor(float(np.percentile(points[:, 1], 2)), [0.0, 1.0, 0.0], 0.1, 0.0, 0)
    h = height_above(points, floor)
    cams_h = cams[:, 1] - floor.y if len(cams) else np.zeros(0)
    ceiling = layer_peak(h, max(1.5, float(np.median(cams_h[cams_h < STAIR_EYE])) + 0.15 if (cams_h < STAIR_EYE).any() else 1.6), 3.4)

    area_floors = []
    if area is not None:
        for k in np.unique(area):
            sel = points[area == k]
            f = find_floor(sel, cam_y, seed)
            if f is not None:
                area_floors.append({"area": int(k), "y": f.y, "offsetM": _r(f.y - floor.y), "spreadM": f.spread})

    # 2. Axes: the walls' main direction (unsnapped wall lines, weighted by length), everything turned onto it.
    band = (h > WALL_BAND[0]) & (h < WALL_BAND[1])
    phi = main_axis(points[band][:, [0, 2]], seed, axis_prior)
    cs, sn = np.cos(-phi), np.sin(-phi)

    def turn(xz):
        xz = np.asarray(xz, float).reshape(-1, 2)
        return np.stack([cs * xz[:, 0] - sn * xz[:, 1], sn * xz[:, 0] + cs * xz[:, 1]], 1)

    uv = turn(points[:, [0, 2]])
    cuv = turn(cams[:, [0, 2]]) if len(cams) else np.zeros((0, 2))

    # 3. Stairs.
    stairs = stairs_from_walk(cuv, cams_h) if len(cams) else None
    for s in hints.get("stairs", []):
        lo, hi = turn([s["low"][0], s["low"][2]])[0], turn([s["high"][0], s["high"][2]])[0]
        a, b = np.minimum(lo, hi), np.maximum(lo, hi)
        if (b - a).min() < 0.4:
            continue
        poly = np.array([[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]])
        if stairs is None:
            stairs = {"polygon": poly, "bottom": None, "axis": None, "source": "sam", "id": s.get("id")}
        else:
            stairs["id"] = s.get("id")
            stairs["source"] = "walk+sam"
    on_floor = cams_h < STAIR_EYE

    pw, hw = uv[band], h[band]
    allxy = np.concatenate([pw, uv[np.abs(h) < 0.08], cuv[on_floor]]) if len(cuv) else np.concatenate([pw, uv[np.abs(h) < 0.08]])
    lo = np.percentile(allxy, 0.5, axis=0) - 1.0
    hi = np.percentile(allxy, 99.5, axis=0) + 1.0
    W, H = (np.ceil((hi - lo) / CELL)).astype(int) + 1
    grid = Grid(lo, int(W), int(H))

    stair_mask = np.zeros((grid.H, grid.W), np.uint8)
    if stairs is not None:
        cv2.fillPoly(stair_mask, [grid.ij(stairs["polygon"]).astype(np.int32)], 1)

    # Walls: cells whose points rise through most of the band (not on the stairs).
    ij = grid.ij(pw)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < grid.W) & (ij[:, 1] >= 0) & (ij[:, 1] < grid.H)
    counts = np.zeros((grid.H, grid.W), np.int32)
    np.add.at(counts, (ij[ok, 1], ij[ok, 0]), 1)
    top = np.full((grid.H, grid.W), -np.inf)
    bot = np.full((grid.H, grid.W), np.inf)
    np.maximum.at(top, (ij[ok, 1], ij[ok, 0]), hw[ok])
    np.minimum.at(bot, (ij[ok, 1], ij[ok, 0]), hw[ok])
    rise = np.where(np.isfinite(top), top - bot, 0.0)
    rise = cv2.dilate(rise.astype(np.float32), np.ones((3, 3), np.uint8))
    wall_core = ((counts >= 2) & (rise >= WALL_RISE) & (stair_mask == 0)).astype(np.uint8)
    walls = cv2.dilate(wall_core, disk(0.05))

    # Where the floor stops in each picture, on the floor plane: the walls' feet (scan3d/views.py).
    base_uv, base_wall = np.zeros((0, 2)), np.zeros(0, bool)
    if views:
        E, base_wall = floor_edges(views, floor.y, floor.normal)
        if len(E):
            base_uv = turn(E[:, [0, 2]])
    floor_pts = grid.raster(np.concatenate([uv[np.abs(h) < 0.08], base_uv])) > 0
    walked = np.zeros((grid.H, grid.W), np.uint8)
    for p in grid.ij(cuv[on_floor]) if len(cuv) else []:
        if 0 <= p[1] < grid.H and 0 <= p[0] < grid.W:
            walked[p[1], p[0]] = 1
    near_walk = cv2.dilate(walked, disk(0.6)) > 0
    seen = (floor_pts | near_walk).astype(np.uint8)
    footprint = cv2.morphologyEx(seen | walls | stair_mask, cv2.MORPH_CLOSE, disk(0.3))
    filled = footprint.copy()
    cv2.floodFill(filled, np.zeros((grid.H + 2, grid.W + 2), np.uint8), (0, 0), 1)
    footprint = footprint | (1 - filled)
    free = (footprint & (1 - walls)).astype(np.uint8)

    # 4. Wall faces from the points on wall cells.
    on_wall = wall_core[np.clip(ij[:, 1], 0, grid.H - 1), np.clip(ij[:, 0], 0, grid.W - 1)] > 0
    faces = find_faces(pw[ok & on_wall], free, grid, seed)
    face_heights(faces, uv, h, ceiling)
    if len(base_uv) >= 60 and base_wall.sum() >= 60:
        faces = with_floor_edges(faces, find_faces(base_uv[base_wall], free, grid, seed + 1))
    faces = outermost(faces)
    tie_in(faces)

    # 5. Rooms: open floor shrunk by half a door falls apart at the doorways; each piece grows back.
    # The walls RANSAC found cut the open floor too, where the wall's own points were too sparse to.
    free = (free & (1 - cv2.dilate(barrier_of(faces, grid), np.ones((3, 3), np.uint8)))).astype(np.uint8)
    core = cv2.erode(free, disk(DOOR_HALF))
    n, lab = cv2.connectedComponents(core)
    markers = np.zeros((grid.H, grid.W), np.int32)
    k2 = 0
    for k in range(1, n):
        if (lab == k).sum() * CELL * CELL >= 0.3:
            k2 += 1
            markers[lab == k] = k2
    grown = markers.copy()
    for _ in range(int(DOOR_HALF / CELL) + 4):
        dil = cv2.dilate(grown.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
        add = (grown == 0) & (free > 0) & (dil > 0)
        grown[add] = dil[add]
    # Open floor nobody claimed is a room too where the person stood (a cluttered room's floor), and, when
    # the whole-take watch saw a room only from its doorway, floor the camera saw without going in.
    left = ((free > 0) & (grown == 0)).astype(np.uint8)
    n_left, left_lab = cv2.connectedComponents(left)
    for k in range(1, n_left):
        piece = left_lab == k
        a = piece.sum() * CELL * CELL
        if (a >= MIN_ROOM_M2 and (walked[piece] > 0).sum() >= 3) or (hints.get("peek") and a >= CLOSET_M2 and floor_pts[piece].mean() >= 0.3):
            grown[piece] = grown.max() + 1

    # 6. Floor next to the open floor (clutter, a hidden corner) joins the room it's reachable from
    #    without crossing a wall; rooms meeting along a long open boundary are one open room.
    blocked = ((walls > 0) | (cv2.dilate(barrier_of(faces, grid), np.ones((3, 3), np.uint8)) > 0)).astype(np.uint8)
    labels = fill_rooms(grown, footprint, blocked)

    def merge(a: int, b: int):
        labels[labels == b] = a
        grown[grown == b] = a

    # Corrections that change which room is which come first, so the outlines follow them.
    edit_log = []

    def label_at(p) -> int:
        q = grid.ij(turn(p))[0]
        if not (0 <= q[0] < grid.W and 0 <= q[1] < grid.H):
            return 0
        if labels[q[1], q[0]]:
            return int(labels[q[1], q[0]])
        win = labels[max(0, q[1] - 10) : q[1] + 11, max(0, q[0] - 10) : q[0] + 11]
        vals, counts = np.unique(win[win > 0], return_counts=True)
        return int(vals[counts.argmax()]) if len(vals) else 0

    split_asked = False
    for e in edits:
        op = e.get("op")
        if op == "merge":
            a, b = label_at(e["at"][0]), label_at(e["at"][1])
            if not a or not b or a == b:
                edit_log.append({**e, "ok": False, "why": "those points aren't in two rooms"})
                continue
            open_m = contact(labels, a, b)
            if open_m < 1.3:  # a door's width: two rooms that meet only through a door stay two rooms
                why = f"they meet only through a {open_m:.1f} m opening; the rest is wall" if open_m > 0 else "the points show a wall between them" if near(labels, a, b) else "the two rooms don't touch"
                edit_log.append({**e, "ok": False, "why": why})
            else:
                merge(a, b)
                edit_log.append({**e, "ok": True, "why": f"open along {open_m:.1f} m"})
        elif op == "split":
            a = label_at(e["at"])
            axis, value = e.get("axis"), float(e.get("value", 0))
            if not a or axis not in ("u", "v"):
                edit_log.append({**e, "ok": False, "why": "no room there"})
                continue
            k = grid.px(value, 0 if axis == "u" else 1)
            mine = labels == a
            line = mine[:, max(0, k - 1) : k + 2].any(1) if axis == "u" else mine[max(0, k - 1) : k + 2, :].any(0)
            wl = (walls[:, max(0, k - 1) : k + 2].any(1) if axis == "u" else walls[max(0, k - 1) : k + 2, :].any(0)) & line
            share = float(wl.sum() / max(1, line.sum()))
            yy, xx = np.nonzero(mine)
            side = (xx >= k) if axis == "u" else (yy >= k)
            if share < 0.35 or side.all() or not side.any():
                edit_log.append({**e, "ok": False, "why": f"the points show a wall along only {share:.0%} of that line"})
            else:
                labels[yy[side], xx[side]] = int(labels.max()) + 1
                split_asked = True
                edit_log.append({**e, "ok": True, "why": f"wall along {share:.0%} of the cut"})

    # Rooms that meet along a long open boundary are one open room (clutter made the neck).
    for _ in range(10):
        if split_asked:
            break  # they asked for it split; don't undo it
        ids = [int(k) for k in np.unique(labels[labels > 0])]
        best = max(((contact(labels, a, b), a, b) for x, a in enumerate(ids) for b in ids[x + 1 :]), default=None)
        if not best or best[0] < OPEN_JOIN_M:
            break
        merge(best[1], best[2])

    # A ghost strip: one wall seen from its two sides lands twice, apart, with "open floor" between. Its
    # walls look away from it, where a room's look into it.
    facing = walls_facing_away(labels, faces, grid)

    # Slivers (a doorway's own floor, a strip behind clutter) and small pieces: a small piece stays a room
    # (a closet) only when walls close it in most of the way round; otherwise it joins the room it opens onto.
    for _ in range(20):
        changed = False
        for k in [int(k) for k in np.unique(labels[labels > 0])]:
            mask = labels == k
            yy, xx = np.nonzero(mask)
            ext = min(np.ptp(xx) + 1, np.ptp(yy) + 1) * CELL
            area = mask.sum() * CELL * CELL
            long_side = max(np.ptp(xx) + 1, np.ptp(yy) + 1) * CELL
            sliver = ext < 0.6 or (ext < 0.9 and long_side >= 3 * ext) or (ext < 1.2 and facing.get(k, 0.0) >= 0.6)
            if not sliver and area >= SMALL_ROOM_M2:
                continue
            if not sliver and area >= MIN_ROOM_M2 and enclosed(labels, k, blocked, footprint) >= 0.6:
                continue
            ghost = ext < 1.2 and facing.get(k, 0.0) >= 0.6
            if ghost and split_ghost(labels, k):
                changed = True
                break
            touching = sum(contact(labels, k, o) for o in np.unique(labels[labels > 0]) if o != k)
            if not sliver and not ghost and area >= CLOSET_M2 and 0 < touching <= DOOR_MAX_M and not (walked[mask] > 0).any():
                continue  # through a door, and nobody went in: a closet looked into from its doorway
            touch = {o: contact(labels, k, o) for o in np.unique(labels[labels > 0]) if o != k}
            touch = {o: v for o, v in touch.items() if v > 0}
            if touch:
                merge(max(touch, key=touch.get), k)
            else:
                labels[mask] = 0
            changed = True
            break
        if not changed:
            break

    # Outlines: square polygons, each edge pushed out to its wall.
    raw_rooms = []
    for k in [int(k) for k in np.unique(labels[labels > 0])]:
        mask = labels == k
        entered = bool((walked[mask] > 0).any())
        if entered:
            poly = room_outline(mask, grid)
        else:
            # Seen only from its doorway: the floor in view is a wedge from the door. The room is the box
            # round it, squared to the axes; its hidden corners are where the walls seen would meet.
            yy, xx = np.nonzero(mask)
            x0, x1 = grid.lo[0] + xx.min() * CELL, grid.lo[0] + (xx.max() + 1) * CELL
            z0, z1 = grid.lo[1] + yy.min() * CELL, grid.lo[1] + (yy.max() + 1) * CELL
            poly = [(x0, z0), (x1, z0), (x1, z1), (x0, z1)]
        if len(poly) < 3 or poly_area(poly) < (MIN_ROOM_M2 if entered else CLOSET_M2):
            continue
        raw_rooms.append({"label": k, "polygon": poly, "entered": entered})
    for _ in range(2):  # a second pass lets a notch, emptied by its neighbours' moves, close
        snap_out(raw_rooms, walls, grid)
    settle(raw_rooms)

    # Wall moves: an edge of a room's outline moved to a new line, if a wall face is there.
    for e in edits:
        if e.get("op") != "move_wall":
            continue
        a = label_at(e["at"])
        r = next((x for x in raw_rooms if x["label"] == a), None)
        if r is None:
            edit_log.append({**e, "ok": False, "why": "no room there"})
            continue
        axis, frm, to = e.get("axis"), float(e.get("from", 0)), float(e.get("to", 0))
        k = 0 if axis == "u" else 1
        hits = [f for f in faces if f.square and abs(f.n[k]) > 0.5 and abs(f.c * f.n[k] - to) < 0.08 and f.full]
        if not hits:
            edit_log.append({**e, "ok": False, "why": "no wall in the points on that line"})
            continue
        r["polygon"] = simplify([(to, p[1]) if k == 0 and abs(p[0] - frm) < 0.05 else (p[0], to) if k == 1 and abs(p[1] - frm) < 0.05 else p for p in r["polygon"]])
        edit_log.append({**e, "ok": True, "why": f"a full-height wall face is on that line ({sum(f.b - f.a for f in hits):.1f} m of it)"})

    # 9. Each room's ceiling, from the points over its open floor (not next to its walls).
    rooms = []
    room_mask = np.zeros((grid.H, grid.W), np.int32)
    for idx, r in enumerate(sorted(raw_rooms, key=lambda r: -poly_area(r["polygon"])), start=1):
        m = np.zeros((grid.H, grid.W), np.uint8)
        cv2.fillPoly(m, [grid.ij(np.array(r["polygon"])).astype(np.int32)], 1)
        room_mask[(m > 0) & (room_mask == 0)] = idx
        inner = cv2.erode(m, disk(0.25)) > 0
        pij = grid.ij(uv)
        okp = (pij[:, 0] >= 0) & (pij[:, 0] < grid.W) & (pij[:, 1] >= 0) & (pij[:, 1] < grid.H)
        inside_pts = np.zeros(len(uv), bool)
        inside_pts[okp] = inner[pij[okp, 1], pij[okp, 0]]
        floor_h = cams_h[on_floor] if len(cams_h) else np.array([EYE_DEFAULT])
        ceil = layer_peak(h[inside_pts], max(1.4, float(np.median(floor_h)) - 0.1 if len(floor_h) else 1.5), 3.4, share=0.2)
        cam_in = sum(1 for p in cuv[on_floor] if _inside(r["polygon"], p)) if len(cuv) else 0
        rooms.append({
            "id": f"r{idx}",
            "label": r["label"],
            "polygon": [_pt(p) for p in r["polygon"]],
            "areaM2": _r(poly_area(r["polygon"]), 2),
            "ceilingM": None if ceil is None else _r(ceil, 2),
            "cameras": int(cam_in),
            # Whether the camera walked on its open floor; its squared outline may reach into the doorway
            # the camera looked in from.
            "entered": bool(r.get("entered", True)),
        })
    ceil_vals = [r["ceilingM"] for r in rooms if r["ceilingM"]]
    main_ceiling = max(ceil_vals, key=lambda c: sum(r["areaM2"] for r in rooms if r["ceilingM"] == c)) if ceil_vals else ceiling
    for r in rooms:
        r["low"] = bool(r["ceilingM"] is not None and main_ceiling is not None and r["ceilingM"] < min(1.95, main_ceiling - 0.2))

    # 7. Walls for the model, from the room outlines.
    walls_out, wall_id = [], [0]

    def add_wall(a, b, thick, kind, rooms_, seen):
        wall_id[0] += 1
        w = {"id": f"w{wall_id[0]}", "a": _pt(a), "b": _pt(b), "thicknessM": _r(thick, 3), "kind": kind, "rooms": rooms_, "seenShare": _r(seen, 2)}
        if seen < 0.35:
            w["guess"] = True
        walls_out.append(w)
        return w

    def walled_share(a, b, n):
        """How much of the line a-b has wall points on its outside (within 15 cm)."""
        L = float(np.hypot(*(b - a)))
        ts = np.linspace(0.05, max(0.05, L - 0.05), max(2, int(L / 0.05)))
        hit = 0
        for t in ts:
            p = a + (b - a) * (t / L)
            q = [p + n * d for d in (0.0, 0.05, 0.1, 0.15)]
            ijq = grid.ij(np.array(q))
            okq = (ijq[:, 0] >= 0) & (ijq[:, 0] < grid.W) & (ijq[:, 1] >= 0) & (ijq[:, 1] < grid.H)
            hit += bool(okq.any() and walls[ijq[okq, 1], ijq[okq, 0]].any())
        return hit / len(ts)

    room_edges = {r["id"]: _edges([tuple(p) for p in r["polygon"]]) for r in rooms}
    used = {rid: [[] for _ in es] for rid, es in room_edges.items()}  # covered intervals along each edge
    # Partitions: facing edges of two rooms within PARTITION_MAX.
    ids = [r["id"] for r in rooms]
    for x, ra in enumerate(ids):
        for rb in ids[x + 1 :]:
            for ka, (a0, a1, ta, na, La) in enumerate(room_edges[ra]):
                for kb, (b0, b1, tb, nb, Lb) in enumerate(room_edges[rb]):
                    if na @ nb > -0.99:
                        continue
                    gap = float((b0 - a0) @ na)
                    if gap < -0.05 or gap > PARTITION_MAX:
                        continue
                    s0, s1 = sorted([float((b0 - a0) @ ta), float((b1 - a0) @ ta)])
                    lo_t, hi_t = max(0.0, s0), min(La, s1)
                    if hi_t - lo_t < 0.3:
                        continue
                    thick = gap if gap >= 0.08 else NEW_WALL_M
                    mid_off = gap / 2 if gap >= 0.08 else gap / 2
                    p0 = a0 + ta * lo_t + na * mid_off
                    p1 = a0 + ta * hi_t + na * mid_off
                    seen = max(walled_share(a0 + ta * lo_t, a0 + ta * hi_t, na), walled_share(b0 + tb * 0, b1, nb) if gap >= 0.08 else 0)
                    add_wall(p0, p1, thick, "existing", [ra, rb], seen)
                    used[ra][ka].append((lo_t, hi_t))
                    tb0, tb1 = sorted([float((a0 + ta * lo_t - b0) @ tb), float((a0 + ta * hi_t - b0) @ tb)])
                    used[rb][kb].append((max(0.0, tb0), min(Lb, tb1)))
    # The rest of each outline: foundation where the outside is beyond it, else an interior wall whose
    # far side wasn't filmed.
    outside = (footprint == 0)
    for r in rooms:
        for k, (a, b, t, n, L) in enumerate(room_edges[r["id"]]):
            cover = sorted(used[r["id"]][k])
            spans, at = [], 0.0
            for s0, s1 in cover:
                if s0 - at > 0.25:
                    spans.append((at, s0))
                at = max(at, s1)
            if L - at > 0.25:
                spans.append((at, L))
            for s0, s1 in spans:
                p0, p1 = a + t * s0, a + t * s1
                mid = (p0 + p1) / 2
                probe = grid.ij(np.array([mid + n * d for d in (0.35, 0.6, 0.9)]))
                okp = (probe[:, 0] >= 0) & (probe[:, 0] < grid.W) & (probe[:, 1] >= 0) & (probe[:, 1] < grid.H)
                beyond_out = (not okp.all()) or outside[probe[okp, 1], probe[okp, 0]].mean() >= 0.6
                thick = FOUNDATION_M if beyond_out else NEW_WALL_M
                add_wall(p0 + n * thick / 2, p1 + n * thick / 2, thick, "foundation" if beyond_out else "existing", [r["id"]], walled_share(p0, p1, n))
    walls_out[:] = _join_walls(walls_out)
    # Full-height walls standing inside a room (a stair wall, a stub): faces nowhere near an outline.
    full_faces = [f for f in faces if f.full and f.square]
    for f in faces:
        if not f.full or not f.square or f.b - f.a < 0.8:
            continue
        # Seen from both sides: a face looking the other way 5-30 cm behind it, alongside it.
        back = [g for g in full_faces if g.n @ f.n < -0.99 and 0.05 <= -(f.c + g.c) <= 0.3 and min(f.b, -g.a) - max(f.a, -g.b) >= 0.5]
        if not back:
            continue
        e0, e1 = f.ends()
        mid = (e0 + e1) / 2
        near = False
        for es in room_edges.values():
            for a, b, t, n, L in es:
                if abs(t @ f.t) > 0.9 and abs((mid - a) @ n) < 0.3 and -0.3 < (mid - a) @ t < L + 0.3:
                    near = True
        if near or not any(_inside(r["polygon"], mid) for r in rooms):
            continue
        inside_of = [r["id"] for r in rooms if _inside(r["polygon"], mid)]
        add_wall(e0 - f.n * NEW_WALL_M / 2, e1 - f.n * NEW_WALL_M / 2, NEW_WALL_M, "existing", inside_of, 1.0)

    # 8. Doors where two rooms meet at a neck.
    openings = []
    lab_of = {r["label"]: r["id"] for r in rooms}
    meets = {}
    for dj, di in ((0, 1), (1, 0)):
        A = labels[: grid.H - dj, : grid.W - di]
        B = labels[dj:, di:]
        m = (A > 0) & (B > 0) & (A != B)
        for y, x in zip(*np.nonzero(m)):
            ra, rb = lab_of.get(int(A[y, x])), lab_of.get(int(B[y, x]))
            if not ra or not rb or ra == rb:
                continue
            meets.setdefault(tuple(sorted((ra, rb))), []).append((x + di * 0.5, y + dj * 0.5))
    for (ra, rb), px in meets.items():
        P = np.array(px)
        img = np.zeros((grid.H, grid.W), np.uint8)
        img[np.clip(P[:, 1].astype(int), 0, grid.H - 1), np.clip(P[:, 0].astype(int), 0, grid.W - 1)] = 1
        nc, comp = cv2.connectedComponents(cv2.dilate(img, np.ones((3, 3), np.uint8)))
        for c in range(1, nc):
            ys, xs_ = np.nonzero((comp == c) & (img > 0))
            if len(ys) < 3:
                continue
            centre = grid.lo + (np.array([xs_.mean(), ys.mean()]) + 0.5) * CELL
            w = _door_on(walls_out, ra, rb, centre)
            if w is None:
                continue
            openings.append(_door(w, centre, walls, grid, "geometry"))
    # Where the walk went from one room into the next, it went through a door.
    if len(cuv):
        last, last_p = None, None
        for p_ in cuv[on_floor]:
            here = next((r["id"] for r in rooms if _inside(r["polygon"], p_)), None)
            if here is None:
                continue
            if last is not None and here != last:
                mid = (last_p + p_) / 2
                w = _door_on(walls_out, last, here, mid)
                if w is not None and not any(o["wallId"] == w["id"] and np.hypot(*(np.array(o["at"]) - _closest_on(w, mid))) < 0.8 for o in openings):
                    openings.append(_door(w, mid, walls, grid, "walk"))
            last, last_p = here, p_

    # Doors SAM saw: confirm one already found, or add it on the wall it's on.
    for d in hints.get("doors", []):
        c = turn([d["center"][0], d["center"][2]])[0]
        near = min(openings, key=lambda o: np.hypot(*(np.array(o["at"]) - c)), default=None)
        if near is not None and np.hypot(*(np.array(near["at"]) - c)) < 0.7:
            near.setdefault("detectionId", d.get("id"))
            near["source"] = "geometry+sam"
            continue
        w = min(walls_out, key=lambda w: _dist_to_wall(w, c), default=None)
        if w is None or _dist_to_wall(w, c) > 0.5:
            continue
        lo_, hi_ = turn([d["low"][0], d["low"][2]])[0], turn([d["high"][0], d["high"][2]])[0]
        t = _wall_t(w)
        # Narrower than any door: SAM boxed only part of it (or saw it edge-on). The usual interior door's
        # width, marked a guess, rather than the narrowest a door can be.
        measured = abs((hi_ - lo_) @ t)
        width = float(np.clip(measured, 0.6, 1.2)) if measured >= 0.6 else 0.76
        o = _door(w, c, walls, grid, "sam", width)
        if measured < 0.6:
            o["guess"] = True
        o["detectionId"] = d.get("id")
        if d.get("high") and d.get("low"):
            o["heightM"] = _r(np.clip(d["high"][1] - floor.y, 1.7, 2.4), 2)
        openings.append(o)
    # Door corrections: "this door connects A and B" / "no door here".
    for e in edits:
        if e.get("op") == "door":
            ra, rb = lab_of.get(label_at(e["at"][0])), lab_of.get(label_at(e["at"][1]))
            if not ra or not rb or ra == rb:
                edit_log.append({**e, "ok": False, "why": "those points aren't in two rooms"})
                continue
            if any(set(o.get("rooms", [])) == {ra, rb} for o in openings):
                edit_log.append({**e, "ok": True, "why": "already there"})
                continue
            between = [w for w in walls_out if set(w["rooms"]) == {ra, rb}]
            gap = None
            for w in between:
                gap = _gap_on(w, walls, grid)
                if gap:
                    openings.append(_door(w, gap[0], walls, grid, "edit", gap[1]))
                    break
            edit_log.append({**e, "ok": bool(gap), "why": f"a {gap[1]:.2f} m gap in the wall between them" if gap else "no gap in the wall points between those rooms"})
        elif e.get("op") == "no_door":
            c = turn(e["at"])[0]
            near = min(openings, key=lambda o: np.hypot(*(np.array(o["at"]) - c)), default=None)
            if near is None or np.hypot(*(np.array(near["at"]) - c)) > 0.8:
                edit_log.append({**e, "ok": False, "why": "no door there"})
                continue
            w = next(w for w in walls_out if w["id"] == near["wallId"])
            share = _wall_points_across(w, near, walls, grid)
            if share >= 0.6 and "sam" not in near["source"]:
                openings.remove(near)
                edit_log.append({**e, "ok": True, "why": f"wall points across {share:.0%} of it"})
            else:
                edit_log.append({**e, "ok": False, "why": "the points show an opening there" if share < 0.6 else "SAM saw a door there"})
    # Windows SAM saw, on the nearest wall.
    for d in hints.get("windows", []):
        c = turn([d["center"][0], d["center"][2]])[0]
        w = min(walls_out, key=lambda w: _dist_to_wall(w, c), default=None)
        if w is None or _dist_to_wall(w, c) > 0.6:
            continue
        lo_, hi_ = turn([d["low"][0], d["low"][2]])[0], turn([d["high"][0], d["high"][2]])[0]
        t = _wall_t(w)
        width = float(np.clip(abs((hi_ - lo_) @ t), 0.3, 2.0))
        sill = float(d["low"][1] - floor.y)
        height = float(d["high"][1] - d["low"][1])
        off = float((c - np.array(w["a"])) @ t)
        if any(o["wallId"] == w["id"] and o["kind"] == "window" and abs(o["offsetM"] - off) < 0.6 for o in openings):
            continue
        openings.append({"kind": "window", "wallId": w["id"], "offsetM": _r(off), "widthM": _r(width, 2), "heightM": _r(np.clip(height, 0.2, 1.6), 2), "sillM": _r(max(0.0, sill), 2), "at": _pt(c), "detectionId": d.get("id"), "source": "sam", "rooms": w["rooms"]})
    for k, o in enumerate(openings, start=1):
        o["id"] = f"{'d' if o['kind'] == 'door' else 'win'}{k}"

    # Rooms nobody went into: seen from the room their door opens onto. Their own walls (not the one
    # shared with that room) are guesses: the plan screen asks about them.
    for r in rooms:
        if r["entered"]:
            continue
        via = [x for o in openings if o["kind"] == "door" and r["id"] in o.get("rooms", []) for x in o["rooms"] if x != r["id"]]
        shared = [x for w in walls_out if r["id"] in w["rooms"] for x in w["rooms"] if x != r["id"]]
        r["seenFrom"] = (via or shared or [None])[0]
        for w in walls_out:
            if set(w["rooms"]) <= {r["id"]}:
                w["guess"] = True
                w["seenFromDoor"] = True

    # Fixtures: stairs, SAM's mechanicals, and what hangs low under the ceiling.
    fixtures = []
    if stairs is not None:
        # The walk down starts over the upper floor: the stairs end at the basement's outline.
        P = np.asarray(stairs["polygon"])
        a, b = P.min(0), P.max(0)
        if rooms:
            R = np.array([p for r in rooms for p in r["polygon"]], float)
            a, b = np.maximum(a, R.min(0)), np.minimum(b, R.max(0))
        fx = {"id": "stairs1", "kind": "stairs", "at": _pt((a + b) / 2), "sizeM": _pt(b - a), "source": stairs["source"]}
        if stairs.get("bottom") is not None:
            fx["bottom"] = _pt(stairs["bottom"])
        if stairs.get("id"):
            fx["detectionId"] = stairs["id"]
        fixtures.append(fx)
    for d in hints.get("fixtures", []):
        c = turn([d["center"][0], d["center"][2]])[0]
        kind = d.get("kind", "furnace")
        if any(f["kind"] == kind and np.hypot(*(np.array(f["at"]) - c)) < 1.0 for f in fixtures):
            continue
        fixtures.append({"id": f"{kind}{len(fixtures) + 1}", "kind": kind, "at": _pt(c), "detectionId": d.get("id"), "source": "sam"})
    fixtures += overheads(uv, h, rooms, grid, main_ceiling, hints, turn)
    # Kinds the plan can tell: the stairs' room, a furnace room, a closet.
    for r in rooms:
        inside = [f["kind"] for f in fixtures if _inside(r["polygon"], f["at"])]
        r["kind"] = "mechanical" if r["areaM2"] < 12 and ({"furnace", "water_heater"} & set(inside)) else "closet" if r["areaM2"] < SMALL_ROOM_M2 else "other"
    for e in edits:
        if e.get("op") != "kind":
            continue
        rid = lab_of.get(label_at(e["at"]))
        r = next((x for x in rooms if x["id"] == rid), None)
        if r is None:
            edit_log.append({**e, "ok": False, "why": "no room there"})
            continue
        kind = e.get("kind")
        if kind == "closet" and r["areaM2"] > 5:
            edit_log.append({**e, "ok": False, "why": f"{r['areaM2']} m² is too big for a closet"})
            continue
        if kind == "stairs" and not any(f["kind"] == "stairs" and _inside(r["polygon"], f["at"]) for f in fixtures):
            edit_log.append({**e, "ok": False, "why": "no stairs in that room"})
            continue
        r["kind"] = kind
        if e.get("name"):
            r["name"] = str(e["name"])[:40]
        edit_log.append({**e, "ok": True, "why": "label only"})
    for r in rooms:
        r.pop("label", None)

    fp_m2 = round(float(sum(r["areaM2"] for r in rooms)), 2)
    plan = Plan(phi, floor, main_ceiling, rooms, walls_out, openings, fixtures, fp_m2, edit_log, area_floors)
    plan.debug = {"grid": grid, "walls": walls, "free": free, "footprint": footprint, "regions": grown, "faces": faces, "labels": labels, "turn": turn, "uv": uv, "h": h, "cams_uv": cuv, "cams_h": cams_h, "stairs": stairs}
    return plan


def _wall_t(w) -> np.ndarray:
    a, b = np.array(w["a"]), np.array(w["b"])
    d = b - a
    return d / max(1e-9, np.hypot(*d))


def _dist_to_wall(w, p) -> float:
    a, b = np.array(w["a"]), np.array(w["b"])
    t = _wall_t(w)
    L = float(np.hypot(*(b - a)))
    s = float(np.clip((p - a) @ t, 0, L))
    return float(np.hypot(*(a + t * s - p)))


def _closest_on(w, p) -> np.ndarray:
    a, b = np.array(w["a"]), np.array(w["b"])
    t = _wall_t(w)
    return a + t * float(np.clip((p - a) @ t, 0, np.hypot(*(b - a))))


def _door_on(walls_out, ra, rb, centre):
    between = [w for w in walls_out if set(w["rooms"]) == {ra, rb}]
    if not between:
        return None
    w = min(between, key=lambda w: _dist_to_wall(w, centre))
    return w if _dist_to_wall(w, centre) < 0.8 else None


def _gap_on(w, walls, grid: Grid):
    """The widest run along a wall's line with no wall points: (centre, width), if it's door-sized."""
    a, b = np.array(w["a"]), np.array(w["b"])
    t = _wall_t(w)
    L = float(np.hypot(*(b - a)))
    ts = np.arange(0.0, L, CELL)
    ij = grid.ij(a + ts[:, None] * t)
    okk = (ij[:, 0] >= 0) & (ij[:, 0] < grid.W) & (ij[:, 1] >= 0) & (ij[:, 1] < grid.H)
    hit = np.ones(len(ts), bool)
    hit[okk] = walls[ij[okk, 1], ij[okk, 0]] > 0
    best, run = None, 0
    for k, x in enumerate(np.append(hit, True)):
        if not x:
            run += 1
            continue
        if run * CELL >= 0.6 and (best is None or run > best[1]):
            best = (k - run, run)
        run = 0
    if best is None:
        return None
    s, n = best
    return a + t * (ts[s] + n * CELL / 2), float(min(1.5, n * CELL))


def _door(w, centre, walls, grid: Grid, source: str, width: float | None = None):
    """A door on wall w at the point nearest `centre`, as wide as the gap in the wall points there."""
    a = np.array(w["a"])
    t = _wall_t(w)
    L = float(np.hypot(*(np.array(w["b"]) - a)))
    off = float(np.clip((centre - a) @ t, 0, L))
    if width is None:
        lo_, hi_ = off, off
        for sgn in (-1, 1):
            s = off
            while 0 <= s <= L:
                q = grid.ij((a + t * s)[None])[0]
                if 0 <= q[0] < grid.W and 0 <= q[1] < grid.H and walls[q[1], q[0]]:
                    break
                s += sgn * CELL
            if sgn < 0:
                lo_ = s
            else:
                hi_ = s
        width = float(np.clip(hi_ - lo_, 0.6, 1.2))
        off = (lo_ + hi_) / 2 if hi_ - lo_ <= 1.3 else off
    off = float(np.clip(off, width / 2, max(width / 2, L - width / 2)))
    return {"kind": "door", "wallId": w["id"], "offsetM": _r(off), "widthM": _r(width, 2), "heightM": 2.03, "at": _pt(a + t * off), "source": source, "rooms": list(w["rooms"])}


def _wall_points_across(w, o, walls, grid: Grid) -> float:
    a = np.array(w["a"])
    t = _wall_t(w)
    ts = np.arange(o["offsetM"] - o["widthM"] / 2, o["offsetM"] + o["widthM"] / 2, CELL)
    ij = grid.ij(a + ts[:, None] * t)
    okk = (ij[:, 0] >= 0) & (ij[:, 0] < grid.W) & (ij[:, 1] >= 0) & (ij[:, 1] < grid.H)
    return float((walls[ij[okk, 1], ij[okk, 0]] > 0).mean()) if okk.any() else 0.0


def _join_walls(ws: list[dict]) -> list[dict]:
    """Collinear pieces of one wall (same kind and thickness, touching) become one."""
    out: list[dict] = []
    for w in sorted(ws, key=lambda w: (w["kind"], -np.hypot(*(np.array(w["b"]) - np.array(w["a"]))))):
        a, b = np.array(w["a"]), np.array(w["b"])
        t = _wall_t(w)
        for g in out:
            if g["kind"] != w["kind"] or abs(g["thicknessM"] - w["thicknessM"]) > 0.03:
                continue
            ga, gb = np.array(g["a"]), np.array(g["b"])
            gt = _wall_t(g)
            if abs(gt @ t) < 0.999:
                continue
            n = np.array([-gt[1], gt[0]])
            if abs((a - ga) @ n) > 0.03 or abs((b - ga) @ n) > 0.03:
                continue
            s = sorted([0.0, float((gb - ga) @ gt), float((a - ga) @ gt), float((b - ga) @ gt)])
            ga_t, gb_t = 0.0, float((gb - ga) @ gt)
            wa_t, wb_t = sorted([float((a - ga) @ gt), float((b - ga) @ gt)])
            if wa_t > gb_t + 0.15 or wb_t < ga_t - 0.15:
                continue
            g["a"], g["b"] = _pt(ga + gt * s[0]), _pt(ga + gt * s[-1])
            g["rooms"] = sorted(set(g["rooms"]) | set(w["rooms"]))
            g["seenShare"] = max(g["seenShare"], w["seenShare"])
            if g["seenShare"] >= 0.35:
                g.pop("guess", None)
            break
        else:
            out.append(dict(w))
    for k, w in enumerate(out, start=1):
        w["id"] = f"w{k}"
    return out


def _seg_point_dist(p, a, b) -> float:
    d = b - a
    L2 = float(d @ d)
    t = 0.0 if L2 == 0 else float(np.clip((p - a) @ d / L2, 0, 1))
    return float(np.hypot(*(a + t * d - p)))


def overheads(uv, h, rooms, grid: Grid, ceiling, hints, turn) -> list[dict]:
    """Beams, ducts and bulkheads: strips where the lowest thing overhead sits well under the room's
    ceiling. Their underside is the headroom under them."""
    if ceiling is None:
        return []
    sel = (h > 1.45) & (h < ceiling + 0.1)
    if sel.sum() < 100:
        return []
    ij = grid.ij(uv[sel])
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < grid.W) & (ij[:, 1] >= 0) & (ij[:, 1] < grid.H)
    low = np.full((grid.H, grid.W), np.inf, np.float32)
    cnt = np.zeros((grid.H, grid.W), np.int32)
    hs = h[sel][ok]
    np.add.at(cnt, (ij[ok, 1], ij[ok, 0]), 1)
    # The 20th-percentile height per cell, approximated by the minimum over points once sparse noise is dropped.
    np.minimum.at(low, (ij[ok, 1], ij[ok, 0]), hs)
    low[cnt < 3] = np.inf
    out = []
    for r in rooms:
        rc = r["ceilingM"] or ceiling
        m = np.zeros((grid.H, grid.W), np.uint8)
        cv2.fillPoly(m, [grid.ij(np.array(r["polygon"])).astype(np.int32)], 1)
        m = cv2.erode(m, disk(0.15))
        under = ((low < rc - 0.15) & (low > 1.5) & (m > 0)).astype(np.uint8)
        under = cv2.morphologyEx(under, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab = cv2.connectedComponents(under)
        for k in range(1, n):
            ys, xs = np.nonzero(lab == k)
            if len(ys) * CELL * CELL < 0.4:
                continue
            rect = cv2.minAreaRect(np.stack([xs, ys], 1).astype(np.float32))
            (cx, cy), (w, l), ang = rect
            w, l = sorted((w * CELL, l * CELL))
            if l < 1.2 or l / max(w, 0.05) < 2.5:
                continue
            under_h = float(np.percentile(low[lab == k], 30))
            centre = grid.lo + (np.array([cx, cy]) + 0.5) * CELL
            # Boxed in along a wall (wider than a beam, its long side at the room's edge): a bulkhead.
            edge = min(_seg_point_dist(centre, a, b) for a, b, *_ in _edges(r["polygon"]))
            kind = "beam" if w <= 0.3 else "bulkhead" if (w > 0.7 or edge <= w / 2 + 0.25) else "duct"
            along_u = abs(np.cos(np.deg2rad(ang))) > 0.7
            size = [l, w] if (along_u == (rect[1][0] >= rect[1][1])) else [w, l]
            out.append({"id": f"{kind}{len(out) + 1}", "kind": kind, "at": _pt(centre), "sizeM": _pt(size), "heightM": _r(under_h, 2), "source": "geometry", "room": r["id"]})
    # SAM's labels for what hangs low, where they sit on one.
    for d in hints.get("overhead", []):
        if "center" not in d:
            continue
        c = turn([d["center"][0], d["center"][2]])[0]
        near = min(out, key=lambda f: np.hypot(*(np.array(f["at"]) - c)), default=None)
        if near is not None and np.hypot(*(np.array(near["at"]) - c)) < 1.5:
            near["kind"] = d.get("kind", near["kind"])
            near["detectionId"] = d.get("id")
            near["source"] = "geometry+sam"
    return out
