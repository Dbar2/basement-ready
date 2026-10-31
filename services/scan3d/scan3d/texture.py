"""Paint the as-built model with the real video.

The surfaces come from the plan (src/three/AsBuiltModel.ts): flat rectangles, each with its own (s, t)
texture coordinates in metres, plus the stairs, which unfold riser by riser. For every surface:

1. Score every camera on a coarse grid of the surface: how square it looks at it, how close it is,
   how sharp the frame is, how far from the frame's edge, and whether that spot is really in view:
   not behind another part of the model, and not behind anything the scan measured in front of it
   (furniture, boxes, a shelf). Keep the few frames that see it best between them.
2. A wall the plan put a little off the real one is painted where the depth says the real wall is,
   so the frames agree with each other instead of smearing.
3. Warp each kept frame onto the surface (one homography for a flat surface), blend them by score,
   with every frame's exposure matched to the others, and fill what no frame saw from its neighbours.
4. Pack every surface into one square atlas (one draw for the whole shell), written as JPEGs at a few
   sizes so phones load a small one first.

CPU only: numpy and OpenCV. Run it after a scan, and again when the plan changes.
"""

from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass, field

import cv2
import numpy as np

PPM = 100  # texels per metre at the largest size: 1 cm
MAX_PAGE = 4096
MIN_PAGE = 1024
COARSE_M = 0.04  # the scoring grid
MASK_PPM = 25  # the model's own outlines, for working out what hides what
KEEP = 8  # frames per surface at most
BLEND_POWER = 5.0  # how strongly the best frame wins where several see a spot (fewer ghosts)
# How sure a texel's paint is, 0..1: from its best frame's quality (far, grazing, blurry or at a frame's
# edge is poor) and from whether the frames blended there agree (clutter and misplaced paint look
# different from each side). Unsure paint fades into a soft plain version of the surface.
SURE_Q = (0.2, 0.45)  # best frame quality: unsure below the first, sure above the second
SURE_SPREAD = (10.0, 26.0)  # colour spread between the frames, 0-255: sure below, unsure above
SURE_SMOOTH_M = 0.1  # sure and unsure meet softly, not in blotches
PLAIN_BLUR_M = 0.3  # the plain version keeps the surface's light and shade at this scale
# How much of the plain version is the surface's own flat colour, against its blurred light and shade.
# A floor is the most cluttered and the most seen at eye level: nearly flat.
PLAIN_FLAT = {"floor": 0.85}
PLAIN_FLAT_DEFAULT = 0.7
# A floor is painted only from frames looking down at it steeply (cos of the angle to its normal):
# seen from standing height at a shallow angle, it streaks.
MIN_COS = {"floor": 0.45}
# One frame's pixel may cover at most this many texels along the surface's most foreshortened
# direction: past it, the paint is that pixel stretched into a streak.
MAX_STRETCH = 3.0
# A floor is painted only where it looks like floor: close to its own main colour (in Lab: lightness
# counts half). Bins, bags and shoes on it aren't, and their depth is too close to the floor's to tell.
FLOOR_LIKE = (18.0, 34.0)  # colour distance: floor below the first, not floor above the second
# A floor where more than this share of what was seen isn't floor-coloured is a cluttered floor: drawn
# plain all over in its own colour, rather than as islands of paint among cut-out clutter.
CLUTTERED_FLOOR = 0.25
SHARP_POWER = 2.0  # motion blur reads as streaks: blurrier frames count for much less
SHARP_NEIGHBOURS = 3  # frames either side, in filming order, a frame's sharpness is judged against
# How far a wall's paint may move to where the depth says the wall is: back a fair way (the plan put
# the wall a little into the room), forward only a little (in front of a wall is usually a shelf).
MAX_SHIFT_M = 0.35
MAX_SHIFT_FORWARD_M = 0.10
FILL_FAR_M = 0.12  # unseen spots further than this from anything seen take the surface's own colour
JPEG_QUALITY = 86


@dataclass
class Camera:
    image: np.ndarray  # BGR uint8
    K: np.ndarray
    R: np.ndarray  # camera to plan
    C: np.ndarray
    sharp: float = 1.0
    depth: np.ndarray | None = None  # z-depth in plan metres, inf where unknown, min-filtered
    Kd: np.ndarray | None = None
    buf: tuple[np.ndarray, int, np.ndarray] | None = None  # model depth, its step, its intrinsics

    @property
    def size(self) -> tuple[int, int]:
        return self.image.shape[1], self.image.shape[0]


@dataclass
class Surf:
    id: str
    kind: str
    origin: np.ndarray
    u: np.ndarray
    v: np.ndarray
    n: np.ndarray
    size: tuple[float, float]
    key: str
    outline: list | None = None
    holes: list = field(default_factory=list)
    steps: dict | None = None
    mask: np.ndarray | None = None  # MASK_PPM grid of what's solid

    def points(self, s: np.ndarray, t: np.ndarray, shift: float = 0.0) -> tuple[np.ndarray, np.ndarray]:
        """Plan points and normals at texture coordinates (s, t), each (N, 3)."""
        if self.kind == "stairs" and self.steps:
            rise, tread, count = self.steps["rise"], self.steps["tread"], self.steps["count"]
            k = np.clip(np.floor(t / (rise + tread)), 0, count - 1)
            r = t - k * (rise + tread)
            riser = r < rise
            run = np.where(riser, k * tread, k * tread + (r - rise))
            up = np.where(riser, k * rise + r, (k + 1) * rise)
            p = self.origin[None] + s[:, None] * self.u[None] + run[:, None] * self.v[None] + up[:, None] * np.array([0, 1.0, 0])[None]
            nrm = np.where(riser[:, None], -self.v[None], np.array([0, 1.0, 0])[None])
            return p, nrm
        p = (self.origin + shift * self.n)[None] + s[:, None] * self.u[None] + t[:, None] * self.v[None]
        return p, np.broadcast_to(self.n, p.shape)

    def solid(self, s: np.ndarray, t: np.ndarray) -> np.ndarray:
        """Is (s, t) part of the surface (inside its outline, not in an opening)?"""
        m = self.mask
        i, j = np.floor(s * MASK_PPM).astype(int), np.floor(t * MASK_PPM).astype(int)
        ok = (i >= 0) & (j >= 0) & (i < m.shape[1]) & (j < m.shape[0])
        out = np.zeros(len(s), bool)
        out[ok] = m[j[ok], i[ok]] > 0
        return out


def _surf(d: dict) -> Surf:
    s = Surf(
        id=d["id"], kind=d["kind"], key=d.get("key", ""),
        origin=np.asarray(d["origin"], float), u=np.asarray(d["u"], float), v=np.asarray(d["v"], float), n=np.asarray(d["n"], float),
        size=(float(d["size"][0]), float(d["size"][1])), outline=d.get("outline"), holes=d.get("holes") or [], steps=d.get("steps"),
    )
    w, h = max(1, math.ceil(s.size[0] * MASK_PPM)), max(1, math.ceil(s.size[1] * MASK_PPM))
    mask = np.zeros((h, w), np.uint8)
    if s.outline and s.kind != "stairs":
        cv2.fillPoly(mask, [np.round(np.asarray(s.outline) * MASK_PPM).astype(np.int32)], 1)
    else:
        mask[:] = 1
    for hole in s.holes:
        cv2.fillPoly(mask, [np.round(np.asarray(hole) * MASK_PPM).astype(np.int32)], 0)
    s.mask = mask
    return s


# ---- What hides what: a depth image of the model from each camera ----

def _occluder_planes(surfs: list[Surf]):
    """Each surface as a plane the rays can hit: the stairs as their slope."""
    out = []
    for s in surfs:
        if s.kind == "stairs" and s.steps:
            run_len, height = s.steps["count"] * s.steps["tread"], s.steps["count"] * s.steps["rise"]
            w = s.v * run_len + np.array([0, height, 0])
            length = float(np.linalg.norm(w))
            w = w / length
            n = np.cross(s.u, w)
            out.append((s, s.origin, s.u, w, n, (s.size[0], length), None))
        else:
            out.append((s, s.origin, s.u, s.v, s.n, s.size, s.mask))
    return out


def model_depth(cam: Camera, planes, boxes, step: int):
    """The model's z-depth from this camera on a grid every `step` pixels, and the scaled intrinsics."""
    W, H = cam.size
    w, h = max(1, W // step), max(1, H // step)
    xs = (np.arange(w) + 0.5) * step - 0.5
    ys = (np.arange(h) + 0.5) * step - 0.5
    X, Y = np.meshgrid(xs, ys)
    fx, fy, cx, cy = cam.K[0, 0], cam.K[1, 1], cam.K[0, 2], cam.K[1, 2]
    rc = np.stack([(X - cx) / fx, (Y - cy) / fy, np.ones_like(X)], -1).reshape(-1, 3)
    d = rc @ cam.R.T  # world directions; z-depth along each is its ray parameter
    best = np.full(len(d), np.inf)
    for s, o, a, b, n, size, mask in planes:
        num = float(n @ (o - cam.C))
        den = d @ n
        with np.errstate(divide="ignore", invalid="ignore"):
            t = num / den
        # Only a surface's room side hides what's behind it. A camera on its far side (above a ceiling
        # the plan put too low, outside a wall drawn too far in) sees straight through it.
        cand = np.flatnonzero((t > 0.03) & (t < best) & np.isfinite(t) & (den < 0))
        if not len(cand):
            continue
        p = cam.C[None] + t[cand, None] * d[cand]
        q = p - o[None]
        ss, tt = q @ a, q @ b
        inside = (ss >= 0) & (tt >= 0) & (ss <= size[0]) & (tt <= size[1])
        if mask is not None:
            inside &= s.solid(ss, tt)
        hit = cand[inside]
        best[hit] = t[hit]
    for c, sz, rot in boxes:
        cs, sn = math.cos(rot), math.sin(rot)
        Ry = np.array([[cs, 0, sn], [0, 1, 0], [-sn, 0, cs]])  # local to world (three.js rotation.y)
        o = Ry.T @ (cam.C - c)
        dl = d @ Ry  # (Ry.T @ d.T).T
        half = np.asarray(sz) / 2
        with np.errstate(divide="ignore", invalid="ignore"):
            t1 = (-half[None] - o[None]) / dl
            t2 = (half[None] - o[None]) / dl
        tmin = np.nanmax(np.minimum(t1, t2), axis=1)
        tmax = np.nanmin(np.maximum(t1, t2), axis=1)
        hit = (tmax >= np.maximum(tmin, 0.03)) & (tmin < best)
        best[hit] = np.maximum(tmin[hit], 0.03)
    best = best.reshape(h, w)
    # Near an edge, the nearer thing wins: a spot just beside a door jamb counts as hidden.
    return cv2.erode(best.astype(np.float32), np.ones((3, 3), np.uint8))


def _sample(img: np.ndarray, x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """Nearest pixel of a single-channel image; inf outside it."""
    h, w = img.shape
    i, j = np.round(x).astype(int), np.round(y).astype(int)
    ok = (i >= 0) & (j >= 0) & (i < w) & (j < h)
    out = np.full(len(x), np.inf, np.float32)
    out[ok] = img[j[ok], i[ok]]
    return out


# ---- Scoring cameras on a surface ----

def score(cam: Camera, surf: Surf, P: np.ndarray, N: np.ndarray, planes, boxes, ppm: float, shift_tol: float = 0.0, on: float | None = None):
    """Quality of this camera for each point (0 = not seen), and each point's z-depth from it.
    With depth: anything the scan measured in front of the surface hides it. `on`: stricter, a spot
    counts only where the scan measured the surface itself there (within a few cm along its normal),
    so boxes, shelves, people and feet stay off it; a ceiling only loses what hangs below it."""
    q = np.zeros(len(P))
    rel = P - cam.C[None]
    pc = rel @ cam.R  # camera frame
    z = pc[:, 2]
    front = z > 0.15
    if not front.any():
        return q, z
    W, H = cam.size
    fx, fy, cx, cy = cam.K[0, 0], cam.K[1, 1], cam.K[0, 2], cam.K[1, 2]
    with np.errstate(divide="ignore", invalid="ignore"):
        x = fx * pc[:, 0] / z + cx
        y = fy * pc[:, 1] / z + cy
    dist = np.linalg.norm(rel, axis=1)
    cos = -(rel * N).sum(1) / np.maximum(dist, 1e-6)
    with np.errstate(invalid="ignore"):
        edge = np.nan_to_num(np.minimum.reduce([x, W - 1 - x, y, H - 1 - y]) / (0.06 * max(W, H)), nan=-1.0)
    # Pixels per texel along the surface's most foreshortened direction.
    stretch_ok = fx / np.maximum(z, 0.1) * np.maximum(cos, 0) / ppm >= 1 / MAX_STRETCH
    ok = front & (cos > MIN_COS.get(surf.kind, 0.1)) & (edge > 0) & stretch_ok
    if not ok.any():
        return q, z
    if cam.buf is None:
        step = max(2, round(math.sqrt(W * H / 45000)))
        cam.buf = (model_depth(cam, planes, boxes, step), step, None)
    buf, step, _ = cam.buf
    zb = _sample(buf, (x + 0.5) / step - 0.5, (y + 0.5) / step - 0.5)
    ok &= z <= zb + 0.03 + 0.012 * z + shift_tol
    if cam.depth is not None and cam.Kd is not None:
        fxd, fyd, cxd, cyd = cam.Kd[0, 0], cam.Kd[1, 1], cam.Kd[0, 2], cam.Kd[1, 2]
        with np.errstate(divide="ignore", invalid="ignore"):
            zm = _sample(cam.depth, fxd * pc[:, 0] / z + cxd, fyd * pc[:, 1] / z + cyd)
        if on is None:
            # Something real in front of the surface here: a box, a shelf, the furnace.
            ok &= ~(zm < z - np.maximum(0.12, 0.05 * z))
        else:
            # How far the measured point is off the surface, along its normal (+: towards the camera).
            with np.errstate(invalid="ignore"):
                off = (zm / z - 1) * (rel * N).sum(1)
            # A floor's tighter: what lies on it (bags, clothes, shoes) isn't the floor.
            tol = 0.04 + 0.01 * z if surf.kind == "floor" else 0.06 + 0.015 * z
            bad = (off - on > tol) if surf.kind == "ceiling" else (np.abs(off - on) > tol)
            ok &= ~(np.isfinite(zm) & bad)
    # Pixels per metre of surface, against what the texture holds: closer and squarer is sharper.
    res = fx / np.maximum(z, 0.1) * np.sqrt(np.maximum(cos, 0)) / ppm
    q[ok] = (cos[ok] ** 0.5) * (res[ok] / (res[ok] + 1.0)) * np.minimum(1.0, edge[ok]) * cam.sharp**SHARP_POWER
    return q, z


def choose(scores: list[tuple[int, np.ndarray]], keep: int = KEEP) -> list[int]:
    """The frames that see the surface best between them: each next one adds the most where the ones
    already kept see it worst."""
    if not scores:
        return []
    best = np.zeros_like(scores[0][1])
    chosen: list[int] = []
    first = None
    left = dict(scores)
    for _ in range(keep):
        gains = {i: float(np.maximum(q - best * 0.85, 0).sum()) for i, q in left.items()}
        if not gains:
            break
        i = max(gains, key=gains.get)
        if gains[i] <= 0 or (first is not None and gains[i] < 0.03 * first):
            break
        first = first if first is not None else gains[i]
        chosen.append(i)
        best = np.maximum(best, left.pop(i))
    return chosen


def wall_shift(samples: list[np.ndarray]) -> float:
    """How far behind (−) or in front of (+) the plan's wall the measured wall is: the strongest level
    within MAX_SHIFT_M, or 0 without a clear one."""
    if not samples:
        return 0.0
    d = np.concatenate(samples)
    d = d[(d > -MAX_SHIFT_M) & (d < MAX_SHIFT_FORWARD_M)]
    if len(d) < 150:
        return 0.0
    hist, edges = np.histogram(d, bins=np.arange(-MAX_SHIFT_M, MAX_SHIFT_FORWARD_M + 1e-9, 0.02))
    k = int(hist.argmax())
    centre = (edges[k] + edges[k + 1]) / 2
    near = d[np.abs(d - centre) < 0.03]
    if len(near) < max(100, 0.2 * len(d)):
        return 0.0
    m = float(np.median(near))
    return m if abs(m) >= 0.02 else 0.0


# ---- Warping and blending ----

def warp(cam: Camera, surf: Surf, w: int, h: int, ppm: float, shift: float) -> np.ndarray:
    """The frame as seen square-on from the surface: texel (col, row), row 0 at the top."""
    if surf.kind == "stairs":
        cols, rows = np.meshgrid((np.arange(w) + 0.5) / ppm, surf.size[1] - (np.arange(h) + 0.5) / ppm)
        P, _ = surf.points(cols.ravel(), rows.ravel())
        pc = (P - cam.C[None]) @ cam.R
        z = np.maximum(pc[:, 2], 1e-3)
        mx = (cam.K[0, 0] * pc[:, 0] / z + cam.K[0, 2]).reshape(h, w).astype(np.float32)
        my = (cam.K[1, 1] * pc[:, 1] / z + cam.K[1, 2]).reshape(h, w).astype(np.float32)
        return cv2.remap(cam.image, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    o = surf.origin + shift * surf.n
    A = np.stack([surf.u / ppm, -surf.v / ppm, o + surf.u * (0.5 / ppm) + surf.v * (surf.size[1] - 0.5 / ppm)], 1)
    A[:, 2] -= cam.C
    Hm = cam.K @ cam.R.T @ A
    return cv2.warpPerspective(cam.image, Hm, (w, h), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)


def fill(img: np.ndarray, known: np.ndarray, field: bool = False):
    """Fill what no frame saw from its neighbours (push-pull: average down a pyramid, fill back up).
    `field`: also return the smooth fill everywhere, to fade the seen parts into it."""
    if known.all() or not known.any():
        out = img if known.all() else np.full_like(img, 128)
        return (out, out.astype(np.float32)) if field else out
    levels = [(img.astype(np.float32) * known[..., None], known.astype(np.float32))]
    while min(levels[-1][1].shape) > 1 and levels[-1][1].min() <= 0:
        c, m = levels[-1]
        h, w = m.shape
        c2 = cv2.resize(c, ((w + 1) // 2, (h + 1) // 2), interpolation=cv2.INTER_AREA)
        m2 = cv2.resize(m, ((w + 1) // 2, (h + 1) // 2), interpolation=cv2.INTER_AREA)
        levels.append((c2, m2))
    c, m = levels[-1]
    up = c / np.maximum(m[..., None], 1e-6)
    coarse = up
    for c, m in reversed(levels[:-1]):
        h, w = m.shape
        coarse = cv2.resize(up, (w, h), interpolation=cv2.INTER_LINEAR)
        mean = c / np.maximum(m[..., None], 1e-6)
        a = np.clip(m, 0, 1)[..., None]
        up = mean * a + coarse * (1 - a)
    out = img.astype(np.float32).copy()
    out[~known] = up[~known]
    out = np.clip(out, 0, 255).astype(np.uint8)
    return (out, np.where(known[..., None], coarse, up)) if field else out


# ---- The atlas ----

def pack(sizes: list[tuple[int, int]], page: int, pad: int) -> list[tuple[int, int]] | None:
    """Shelf-pack rectangles (tallest first) into a square page; None when they don't fit."""
    order = sorted(range(len(sizes)), key=lambda i: (-sizes[i][1], -sizes[i][0]))
    at: list[tuple[int, int] | None] = [None] * len(sizes)
    x = y = shelf = 0
    for i in order:
        w, h = sizes[i][0] + 2 * pad, sizes[i][1] + 2 * pad
        if w > page:
            return None
        if x + w > page:
            x, y, shelf = 0, y + shelf, 0
        if y + h > page:
            return None
        at[i] = (x + pad, y + pad)
        x += w
        shelf = max(shelf, h)
    return at  # type: ignore[return-value]


def layout(surfs: list[Surf], ppm: float, max_page: int):
    """The page size and texels per metre: the smallest page that holds everything at `ppm`, or the
    largest page at whatever density fits."""
    def sizes(k):
        return [(max(4, math.ceil(s.size[0] * k)), max(4, math.ceil(s.size[1] * k))) for s in surfs]

    page = MIN_PAGE
    while page <= max_page:
        pad = max(2, page // 512)
        if pack(sizes(ppm), page, pad) is not None:
            return page, ppm
        page *= 2
    page = max_page
    pad = max(2, page // 512)
    lo, hi = 5.0, ppm
    for _ in range(18):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if pack(sizes(mid), page, pad) is not None else (lo, mid)
    return page, lo


# ---- The whole job ----

def _camera(c: dict, images: list[np.ndarray], depths: list[np.ndarray]) -> Camera | None:
    img = images[c["image"]]
    if img is None:
        return None
    pose = np.asarray(c["pose"], float)
    K = np.asarray(c["K"], float).copy()
    # Intrinsics are for the image size the caller had; scale them if the image came in another size.
    if c.get("width") and c.get("height") and (img.shape[1], img.shape[0]) != (c["width"], c["height"]):
        sx, sy = img.shape[1] / c["width"], img.shape[0] / c["height"]
        K[0, 0], K[0, 2] = K[0, 0] * sx, (K[0, 2] + 0.5) * sx - 0.5
        K[1, 1], K[1, 2] = K[1, 1] * sy, (K[1, 2] + 0.5) * sy - 0.5
    cam = Camera(image=img, K=K, R=pose[:3, :3], C=pose[:3, 3])
    dd = c.get("depth")
    if dd is not None and dd.get("map") is not None and dd["map"] < len(depths):
        dm = depths[dd["map"]][dd["frame"]].astype(np.float32) * float(dd.get("scale", 1.0))
        dm[~(dm > 0)] = np.inf
        cam.depth = cv2.erode(dm, np.ones((3, 3), np.uint8))
        cam.Kd = np.asarray(dd["K"], float)
    return cam


def paint(job: dict, images: list[np.ndarray], depths: list[np.ndarray] | None = None, log=lambda s: None) -> tuple[dict, dict[str, bytes]]:
    """Paint every surface of `job` from the frames. Returns the atlas index and its JPEG files."""
    t0 = time.perf_counter()
    opts = job.get("options") or {}
    ppm_target = float(opts.get("ppm", PPM))
    max_page = int(opts.get("maxPage", MAX_PAGE))
    surfs = [_surf(d) for d in job["surfaces"]]
    boxes = [(np.asarray(b["center"], float), b["size"], float(b.get("rotY", 0))) for b in job.get("occluders", [])]
    planes = _occluder_planes(surfs)
    pairs = [(c, _camera(c, images, depths or [])) for c in job["cameras"]]
    pairs = [(c, cam) for c, cam in pairs if cam is not None]
    cams: list[Camera] = [cam for _, cam in pairs]
    if not surfs or not cams:
        raise ValueError("nothing to paint: send surfaces and at least one camera")
    # Motion blur: a frame blurrier than the ones filmed just before and after it (which see much the
    # same thing) counts for less. Against the whole take instead, a frame of a plain floor would read
    # as blurry beside one of a busy shelf.
    sharp = []
    for c, cam in pairs:
        s = c.get("sharpness")
        if s is None:
            g = cv2.cvtColor(cv2.resize(cam.image, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
            s = float(cv2.Laplacian(g, cv2.CV_32F).var())
        sharp.append(max(1e-3, float(s)))
    for i, cam in enumerate(cams):
        near = float(np.median(sharp[max(0, i - SHARP_NEIGHBOURS) : i + SHARP_NEIGHBOURS + 1]))
        cam.sharp = float(np.clip(sharp[i] / near, 0.3, 1.3))

    page, ppm = layout(surfs, ppm_target, max_page)
    log(f"atlas {page}px at {ppm:.0f} texels/m for {len(surfs)} surfaces, {len(cams)} frames")

    # Pass 1: score, choose, warp. Kept in memory for the exposure pass.
    plans = []
    for s in surfs:
        w, h = max(4, math.ceil(s.size[0] * ppm)), max(4, math.ceil(s.size[1] * ppm))
        g = max(1, round(ppm * COARSE_M))
        gw, gh = math.ceil(w / g), math.ceil(h / g)
        cs, rs = np.meshgrid((np.arange(gw) + 0.5) * g / ppm, s.size[1] - (np.arange(gh) + 0.5) * g / ppm)
        S, T = cs.ravel(), rs.ravel()
        inside = s.solid(S, T) if s.kind != "stairs" else np.ones(len(S), bool)
        P, N = s.points(S, T)

        def scores_at(pts, shift=0.0, on=None):
            out = []
            for i, cam in enumerate(cams):
                if s.kind != "stairs" and float(s.n @ (cam.C - s.origin - shift * s.n)) <= 0.05:
                    continue  # behind it
                q, _ = score(cam, s, pts, N, planes, boxes, ppm, shift_tol=abs(shift), on=on)
                q[~inside] = 0
                if q.max() > 0:
                    out.append((i, q))
            return out

        scored = scores_at(P)
        chosen = choose(scored)
        shift = 0.0
        if s.kind == "wall" and chosen:
            samples = []
            for i in chosen:
                cam = cams[i]
                if cam.depth is None:
                    continue
                q = dict(scored)[i]
                rel = P - cam.C[None]
                pc = rel @ cam.R
                z = pc[:, 2]
                seen = (q > 0) & (z > 0.15)
                with np.errstate(divide="ignore", invalid="ignore"):
                    zm = _sample(cam.depth, cam.Kd[0, 0] * pc[:, 0] / z + cam.Kd[0, 2], cam.Kd[1, 1] * pc[:, 1] / z + cam.Kd[1, 2])
                seen &= np.isfinite(zm)
                samples.append(((zm[seen] / z[seen]) - 1) * (rel[seen] @ s.n))
            shift = wall_shift(samples)
        # Score again, strictly, on the surface where it really is: only what the scan measured on it.
        if s.kind in ("wall", "floor", "ceiling") and any(cams[i].depth is not None for i, _ in scored):
            strict = scores_at(s.points(S, T, shift)[0] if shift else P, shift, 0.0)
            if strict:
                scored = strict
                chosen = choose(scored)
        qs = dict(scored)
        warps = [warp(cams[i], s, w, h, ppm, shift) for i in chosen]
        weights = [cv2.resize(qs[i].reshape(gh, gw).astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR) ** BLEND_POWER for i in chosen]
        qbest = np.max([qs[i] for i in chosen], axis=0).reshape(gh, gw) if chosen else np.zeros((gh, gw))
        sm = cv2.resize(inside.reshape(gh, gw).astype(np.float32), (w, h), interpolation=cv2.INTER_NEAREST) > 0
        plans.append({"s": s, "w": w, "h": h, "chosen": chosen, "warps": warps, "weights": weights, "solid": sm, "shift": shift, "qbest": cv2.resize(qbest.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)})

    def blend(p, gains, spread=False):
        acc = np.zeros((p["h"], p["w"], 3), np.float32)
        wsum = np.zeros((p["h"], p["w"]), np.float32)
        if spread:
            n = np.zeros((p["h"], p["w"]), np.float32)
            s1, s2 = np.zeros((p["h"], p["w"], 3), np.float32), np.zeros((p["h"], p["w"], 3), np.float32)
            soft = max(1.0, 0.025 * ppm)  # a couple of centimetres off between frames isn't disagreement
        for i, img, wt in zip(p["chosen"], p["warps"], p["weights"]):
            c = img.astype(np.float32) * gains[i][None, None]
            acc += c * wt[..., None]
            wsum += wt
            if spread:
                cs = cv2.GaussianBlur(c, (0, 0), sigmaX=soft)
                sees = (wt > 1e-6).astype(np.float32)
                n += sees
                s1 += cs * sees[..., None]
                s2 += cs * cs * sees[..., None]
        mix = acc / np.maximum(wsum[..., None], 1e-12)
        if not spread:
            return mix, wsum
        # How much the frames that see a spot disagree on its colour: every one of them, not only the
        # one that wins the blend there.
        m = s1 / np.maximum(n, 1)[..., None]
        std = np.sqrt(np.maximum(s2 / np.maximum(n, 1)[..., None] - m * m, 0).mean(axis=2))
        return mix, wsum, np.where(n >= 2, std, 0)

    # Pass 2: match every frame's exposure to the blend it's part of, then blend again.
    gains = {i: np.ones(3, np.float32) for i in range(len(cams))}
    logs: dict[int, list[np.ndarray]] = {}
    rng = np.random.default_rng(0)
    for p in plans:
        if len(p["chosen"]) < 2:
            continue
        mix, wsum = blend(p, gains)
        for i, img, wt in zip(p["chosen"], p["warps"], p["weights"]):
            share = wt / np.maximum(wsum, 1e-12)
            sel = np.flatnonzero(((share > 0.2) & (share < 0.95)).ravel())
            if len(sel) < 50:
                continue
            sel = rng.choice(sel, min(len(sel), 3000), replace=False)
            a = mix.reshape(-1, 3)[sel]
            b = img.reshape(-1, 3)[sel].astype(np.float32)
            good = (a.min(1) > 12) & (b.min(1) > 12) & (a.max(1) < 245) & (b.max(1) < 245)
            if good.sum() > 30:
                logs.setdefault(i, []).append(np.log(a[good]) - np.log(b[good]))
    for i, ls in logs.items():
        gains[i] = np.exp(np.clip(np.median(np.concatenate(ls), axis=0), math.log(0.67), math.log(1.5))).astype(np.float32)

    sizes = [(p["w"], p["h"]) for p in plans]
    pad = max(2, page // 512)
    places = pack(sizes, page, pad)
    # Each surface's blend, and each kind's own colour across the basement (its walls, its floors, its
    # ceilings): what a surface hardly anyone filmed takes, so it matches the rest instead of guessing.
    group = {"wall": "wall", "pane": "wall", "floor": "floor", "ceiling": "ceiling", "stairs": "stairs", "side": "stairs"}
    samples: dict[str, list[np.ndarray]] = {}
    for p in plans:
        if not p["chosen"]:
            continue
        p["mix"], wsum, p["spread"] = blend(p, gains, spread=True)
        p["known"] = wsum > 1e-9
        seen = p["known"] & p["solid"]
        p["coverage"] = float(seen.sum() / max(1, p["solid"].sum()))
        if seen.any():
            samples.setdefault(group[p["s"].kind], []).append(p["mix"][seen][:: max(1, int(seen.sum()) // 20000)])
    everything = np.concatenate([x for v in samples.values() for x in v]) if samples else np.full((1, 3), 128.0)
    tones = {k: np.median(np.concatenate(v), axis=0) for k, v in samples.items()}
    tone_of = lambda kind: tones.get(group[kind], np.median(everything, axis=0))  # noqa: E731

    atlas = np.full((page, page, 3), 128, np.uint8)
    index = {}
    for p, (x, y) in zip(plans, places):
        tone = tone_of(p["s"].kind)
        if p["chosen"]:
            mix, known, solid = p["mix"], p["known"], p["solid"]
            mix8 = np.clip(mix, 0, 255).astype(np.uint8)
            _, smooth = fill(mix8, known, field=True)
            # What was seen fades into the fill over a few centimetres, instead of stopping at a hard edge.
            g = max(1.0, ppm * COARSE_M)
            soft = cv2.GaussianBlur(known.astype(np.float32), (0, 0), sigmaX=0.75 * g)
            alpha = (np.clip(soft * 1.6 - 0.3, 0, 1) * known)[..., None]
            # The surface's own colour (on a surface barely seen, mostly its kind's). Far from anything
            # seen, the fill settles on it rather than smearing whatever was nearest (in a full
            # basement, that's usually stuff).
            seen = known & solid
            own = tone
            if seen.any():
                c = min(1.0, p["coverage"] / 0.35)
                own = np.median(mix[seen][:: max(1, int(seen.sum()) // 20000)], axis=0) * c + tone * (1 - c)
            if seen.any() and not seen.all():
                far = cv2.distanceTransform((~known).astype(np.uint8), cv2.DIST_L2, 5) / ppm
                w = np.clip((far - FILL_FAR_M) / (2 * FILL_FAR_M), 0, 1)[..., None]
                smooth = smooth * (1 - w) + own[None, None] * w
            # Where the paint is unsure (only poor frames saw it, or the frames disagree), a soft plain
            # version of the surface instead of a smear: its light and shade, not its detail.
            lo, hi = SURE_Q
            sure_q = np.clip((p["qbest"] - lo) / (hi - lo), 0, 1)
            lo, hi = SURE_SPREAD
            sure_c = np.clip((hi - p["spread"]) / (hi - lo), 0, 1)
            sure_raw = sure_q * sure_c
            flat = PLAIN_FLAT.get(p["s"].kind, PLAIN_FLAT_DEFAULT)
            shade = cv2.GaussianBlur(smooth.astype(np.float32), (0, 0), sigmaX=max(1.0, PLAIN_BLUR_M * ppm))
            if p["s"].kind == "floor" and seen.sum() > 200:
                lab = cv2.cvtColor(np.clip(mix, 0, 255).astype(np.uint8), cv2.COLOR_BGR2LAB).astype(np.float32)
                main = np.median(lab[seen][:: max(1, int(seen.sum()) // 20000)], axis=0)
                d = np.sqrt((((lab - main[None, None]) * np.array([0.5, 1, 1], np.float32)[None, None]) ** 2).sum(axis=2))
                lo, hi = FLOOR_LIKE
                floor_like = np.clip((hi - d) / (hi - lo), 0, 1)
                sure_raw = sure_raw * floor_like
                like = seen & (floor_like > 0.5)
                if like.sum() > 100:
                    # Its own colour from the parts that look like floor, and its light and shade from them too.
                    own = np.median(mix[like][:: max(1, int(like.sum()) // 20000)], axis=0)
                    _, lit = fill(np.clip(mix, 0, 255).astype(np.uint8), like, field=True)
                    lum = cv2.GaussianBlur(lit.astype(np.float32) @ np.array([0.114, 0.587, 0.299], np.float32), (0, 0), sigmaX=max(1.0, 0.5 * ppm))
                    shade = own[None, None] * np.clip(0.85 + 0.15 * lum / max(1.0, float(np.median(lum))), 0.75, 1.15)[..., None]
                    flat = 0.0
                if float(floor_like[seen].mean()) < 1 - CLUTTERED_FLOOR:
                    sure_raw = np.zeros_like(sure_raw)
                    p["plain"] = True
            sure = cv2.GaussianBlur(sure_raw.astype(np.float32), (0, 0), sigmaX=max(1.0, SURE_SMOOTH_M * ppm))
            sure = np.clip(sure * 1.25 - 0.1, 0, 1)[..., None]
            plain = shade * (1 - flat) + own[None, None] * flat
            # Seen and sure: the photo. Everything else, seen or not: the same plain version.
            a = alpha * sure
            tile = np.clip(mix * a + plain * (1 - a), 0, 255).astype(np.uint8)
            p["sure"] = float((sure[..., 0] * seen).sum() / max(1, seen.sum()))
            coverage = p["coverage"]
        else:
            tile = np.empty((p["h"], p["w"], 3), np.uint8)
            tile[:] = np.clip(tone, 0, 255).astype(np.uint8)
            coverage = 0.0
        padded = cv2.copyMakeBorder(tile, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
        atlas[y - pad:y + p["h"] + pad, x - pad:x + p["w"] + pad] = padded
        s = p["s"]
        index[s.id] = {
            "key": s.key,
            "rect": [x / page, y / page, p["w"] / page, p["h"] / page],
            "coverage": round(coverage, 3),
            # Of what was seen, the share painted with confidence (the rest is drawn plain).
            **({"sure": round(p["sure"], 3)} if "sure" in p else {}),
            # A cluttered floor, drawn plain in its own colour.
            **({"plain": True} if p.get("plain") else {}),
            "frames": [int(i) for i in p["chosen"]],
            **({"shiftM": round(p["shift"], 3)} if p["shift"] else {}),
        }

    files: dict[str, bytes] = {}
    levels: dict[str, str] = {}
    size = page
    img = atlas
    while size >= MIN_PAGE // 2:
        name = f"atlas-{size}.jpg"
        ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY, cv2.IMWRITE_JPEG_PROGRESSIVE, 1])
        if ok:
            files[name] = buf.tobytes()
            levels[str(size)] = name
        size //= 2
        img = cv2.resize(img, (size, size), interpolation=cv2.INTER_AREA)
    out = {
        "version": 1,
        "page": page,
        "ppm": round(ppm, 2),
        "levels": levels,
        "surfaces": index,
        "frames": len(cams),
        # Each kind's colour, for drawing what isn't painted.
        "tones": {k: "#%02x%02x%02x" % tuple(int(round(c)) for c in v[::-1]) for k, v in tones.items()},
        "seconds": round(time.perf_counter() - t0, 2),
    }
    log(f"painted in {out['seconds']} s")
    return out, files


def decode(data: bytes) -> np.ndarray | None:
    return cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)


def main():
    """Offline: python -m scan3d.texture JOB.json OUT_DIR. The job's `images` are file paths (one per
    camera's `image` index) and `depthFiles` raw float16 files with their [frames, H, W] shape."""
    import argparse
    import pathlib
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument("job")
    ap.add_argument("out")
    args = ap.parse_args()
    job = json.loads(pathlib.Path(args.job).read_text())
    images = [cv2.imread(p, cv2.IMREAD_COLOR) for p in job["images"]]
    depths = [np.fromfile(d["path"], "<f2").reshape(d["shape"]) for d in job.get("depthFiles", [])]
    index, files = paint(job, images, depths, log=lambda s: print(s, file=sys.stderr))
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for name, data in files.items():
        (out / name).write_bytes(data)
    (out / "index.json").write_text(json.dumps(index))
    print(json.dumps({k: v for k, v in index.items() if k != "surfaces"}))


if __name__ == "__main__":
    main()
