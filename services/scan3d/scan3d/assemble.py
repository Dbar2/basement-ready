"""One connected basement from rooms measured one at a time.

MapAnything measures a room well on its own, but over a whole walk its geometry drifts. So each
room is measured on its own, and one rough pass over the whole walk says where the rooms sit:
frames close in time are the same camera in both runs, which gives each room's turn, scale and
shift into the whole-walk plan. Rooms are then squared to the basement's main axes and nudged so
neighbours share a wall instead of overlapping or leaving a sliver between them.

All 2D, on the floor plane (x, z), in metres. Pure numpy.
"""

from dataclasses import dataclass

import numpy as np

PAIR_FRAMES = 2  # frames this close in time (at 5 fps) count as the same camera
SQUARE_DEG = 20  # a room turned within this of a right angle is squared to it
PARTITION_M = 0.12  # wall thickness between two rooms
CUT_SHARE = 0.1  # each cut in the walk must explain this share of its spread
CLOSE_GAP_M = 0.9  # a gap between facing walls narrower than this is closed to a partition
MIN_SIDE_OVERLAP_M = 0.4  # ...when the two rooms face each other along at least this much


@dataclass
class Placement:
    theta: float  # radians, room frame -> whole frame, on the floor plane
    scale: float  # whole-walk metres per room metre (only the median across rooms is used)
    shift: np.ndarray  # (x, z) in whole-walk metres
    pairs: int


def _yaw(fwd: np.ndarray) -> np.ndarray:
    return np.arctan2(fwd[:, 1], fwd[:, 0])


def rot(theta: float) -> np.ndarray:
    c, s = np.cos(theta), np.sin(theta)
    return np.array([[c, -s], [s, c]])


def place(room_idx, room_pos, room_fwd, whole_idx, whole_pos, whole_fwd) -> Placement | None:
    """Where a room sits in the whole-walk plan, from its cameras that the whole walk also has.
    *_idx: video frame numbers; *_pos: camera (x, z); *_fwd: camera forward (x, z), not normalised."""
    room_idx, whole_idx = np.asarray(room_idx), np.asarray(whole_idx)
    pairs = [(i, int(np.argmin(np.abs(whole_idx - f)))) for i, f in enumerate(room_idx)]
    pairs = [(i, j) for i, j in pairs if abs(int(whole_idx[j]) - int(room_idx[i])) <= PAIR_FRAMES]
    # Looking at the ceiling or floor says little about the heading.
    level = [(i, j) for i, j in pairs if np.linalg.norm(room_fwd[i]) > 0.5 and np.linalg.norm(whole_fwd[j]) > 0.5]
    if len(level) < 3:
        return None
    i, j = np.array(level).T
    d = _yaw(whole_fwd[j]) - _yaw(room_fwd[i])
    theta = float(np.arctan2(np.sin(d).mean(), np.cos(d).mean()))
    R = rot(theta)
    pr, pw = room_pos[i] @ R.T, whole_pos[j]
    mr, mw = pr.mean(0), pw.mean(0)
    spread = float(((pr - mr) ** 2).sum())
    scale = float(((pw - mw) * (pr - mr)).sum() / spread) if spread > 1e-6 else 1.0
    return Placement(theta, scale, mw - scale * mr, len(level))


def square(theta: float, tol_deg: float = SQUARE_DEG) -> float:
    """Snap a turn to the nearest right angle when it's close: rooms in a house share axes."""
    q = round(theta / (np.pi / 2)) * (np.pi / 2)
    return q if abs(np.degrees(theta - q)) <= tol_deg else theta


@dataclass
class Rect:
    x0: float
    z0: float
    x1: float
    z1: float

    def shift(self, dx: float, dz: float) -> "Rect":
        return Rect(self.x0 + dx, self.z0 + dz, self.x1 + dx, self.z1 + dz)

    @property
    def centre(self) -> np.ndarray:
        return np.array([(self.x0 + self.x1) / 2, (self.z0 + self.z1) / 2])


def placed_rect(width: float, depth: float, theta: float, centre: np.ndarray) -> Rect:
    """A room's box (width along its x, depth along its z, centred on its origin), turned by a
    right angle and centred at `centre`."""
    quarter = int(round(theta / (np.pi / 2))) % 2
    w, d = (depth, width) if quarter else (width, depth)
    return Rect(centre[0] - w / 2, centre[1] - d / 2, centre[0] + w / 2, centre[1] + d / 2)


def settle(rects: list[Rect], passes: int = 3) -> list[tuple[float, float]]:
    """Shifts that stop rooms overlapping and close slivers between facing walls, keeping the first
    room still and moving later rooms, in filming order."""
    out = list(rects)
    moves = [(0.0, 0.0) for _ in rects]
    for _ in range(passes):
        for k in range(1, len(out)):
            for j in range(k):
                a, b = out[j], out[k]
                ox = min(a.x1, b.x1) - max(a.x0, b.x0)  # >0: they share this much along x
                oz = min(a.z1, b.z1) - max(a.z0, b.z0)
                dx = dz = 0.0
                if ox > 0 and oz > 0:  # overlapping: back out along the shallower axis
                    if ox < oz:
                        dx = (ox + PARTITION_M) * (1 if b.centre[0] > a.centre[0] else -1)
                    else:
                        dz = (oz + PARTITION_M) * (1 if b.centre[1] > a.centre[1] else -1)
                elif oz >= MIN_SIDE_OVERLAP_M and -CLOSE_GAP_M < ox <= 0:  # side by side along x
                    dx = (-ox - PARTITION_M) * (-1 if b.centre[0] > a.centre[0] else 1)
                elif ox >= MIN_SIDE_OVERLAP_M and -CLOSE_GAP_M < oz <= 0:  # side by side along z
                    dz = (-oz - PARTITION_M) * (-1 if b.centre[1] > a.centre[1] else 1)
                if dx or dz:
                    out[k] = b.shift(dx, dz)
                    moves[k] = (moves[k][0] + dx, moves[k][1] + dz)
    return moves


def split_walk(pos: np.ndarray, min_len: int = 6, penalty: float | None = None) -> list[tuple[int, int]]:
    """Cut a camera path (n x 2, in filming order) into contiguous stretches that each stay in one
    place, by dynamic programming: least spread within stretches plus a fixed cost per cut. A cut
    happens where the walk moves on to a new area, with or without a door."""
    n = len(pos)
    if n < 2 * min_len:
        return [(0, n)]
    if penalty is None:
        # A tenth of the whole walk's spread per cut: rooms, not steps within a room, whatever the
        # scale of the rough pass. Too many cuts is safe (pieces of one room merge later); too few isn't.
        penalty = CUT_SHARE * float(((pos - pos.mean(0)) ** 2).sum())
    c1 = np.vstack([np.zeros((1, 2)), np.cumsum(pos, 0)])
    c2 = np.concatenate([[0.0], np.cumsum((pos**2).sum(1))])

    def cost(a: int, b: int) -> float:  # sum of squared distances to the mean, for pos[a:b]
        m = b - a
        s = c1[b] - c1[a]
        return float(c2[b] - c2[a] - (s @ s) / m)

    best = np.full(n + 1, np.inf)
    best[0] = 0.0
    back = np.zeros(n + 1, int)
    for b in range(min_len, n + 1):
        for a in range(0, b - min_len + 1):
            if a and a < min_len:
                continue
            v = best[a] + cost(a, b) + (penalty if a else 0.0)
            if v < best[b]:
                best[b], back[b] = v, a
    cuts, b = [], n
    while b > 0:
        cuts.append((int(back[b]), b))
        b = int(back[b])
    return cuts[::-1]


def _inside(r: Rect, pts: np.ndarray, margin: float = 0.0) -> np.ndarray:
    return (pts[:, 0] > r.x0 + margin) & (pts[:, 0] < r.x1 - margin) & (pts[:, 1] > r.z0 + margin) & (pts[:, 1] < r.z1 - margin)


def resolve(rects: list[Rect], cams: list[np.ndarray], same_share: float = 0.5) -> tuple[list[Rect], list[int]]:
    """Two stretches of the walk in one open room are one room: where each room's box holds most of
    the other's camera positions, keep the first. Returns the rooms kept and, for each input, the
    index of the room it became."""
    keep: list[int] = []
    owner = list(range(len(rects)))
    out = list(rects)
    for k in range(len(rects)):
        merged = False
        for j in keep:
            if _inside(out[j], cams[k]).mean() >= same_share and _inside(out[k], cams[j]).mean() >= same_share:
                owner[k] = j
                merged = True
                break
        if not merged:
            keep.append(k)
    return [out[k] for k in keep], [keep.index(owner[k]) for k in range(len(rects))]
