"""A whole basement's floor plan from one connected, true-to-size point cloud.

With the phone's tracking, every part of the walk lands in one gravity-aligned world (+Y up, metres),
so the plan is read from all of it at once instead of a box per stretch of video:

1. The floor height and the basement's main axes (walls are mostly at right angles).
2. A 5 cm grid looking down: wall cells (points at wall height), floor cells (points on the floor, plus
   where the person walked).
3. Open floor = the footprint minus the walls. Shrinking it by half a doorway cuts rooms apart at their
   doors; each piece grows back over the open floor to give one room.
4. Each room: its cells, an outline polygon, a box, and its area.

Pure numpy + OpenCV, so Modal and the Mac give the same answer.
"""

from dataclasses import dataclass

import cv2
import numpy as np

CELL = 0.05  # m
WALL_BAND = (0.6, 1.9)  # m above the floor: walls, not furniture tops or ducts
DOOR_HALF = 0.40  # m: half a doorway; open floor narrower than a door splits rooms
MIN_ROOM_M2 = 1.2
WALL_SEARCH = 1.0  # m: how far past a room's open floor its real wall face may sit (clutter, doubled walls)
WALL_RISE = 0.8  # m: a wall rises through the band; a table or bench shows up only near its top
OPEN_GAP = 8  # cells (40 cm) of open space after a wall end the search outward
WALL_SHARE = 0.25  # a grid line counts as wall where this share of the room's side is wall


@dataclass
class PlanRoom:
    cells: int
    area_m2: float
    box: tuple[float, float, float, float]  # x0, z0, x1, z1 in the plan frame
    outline: list[tuple[float, float]]  # polygon in the plan frame
    cameras: int  # how many camera positions stood in it
    walls: dict  # minX / maxX / minZ / maxZ: "wall" where a wall line bounds that side, else "extent"


@dataclass
class FloorPlan:
    rotation: float  # radians: world (x, z) turned by -rotation gives the plan frame
    floor_y: float
    ceiling_y: float | None
    rooms: list[PlanRoom]
    footprint_m2: float


def _height_peak(y: np.ndarray, lo: float, hi: float, bin_m: float = 0.02) -> float | None:
    sel = y[(y >= lo) & (y <= hi)]
    if len(sel) < 50:
        return None
    hist, edges = np.histogram(sel, bins=max(1, int((hi - lo) / bin_m)), range=(lo, hi))
    k = int(hist.argmax())
    return float((edges[k] + edges[k + 1]) / 2)


def _main_axis(xz: np.ndarray) -> float:
    """The walls' dominant direction, modulo 90 degrees, from line segments in a quick plan image."""
    if len(xz) < 100:
        return 0.0
    lo = xz.min(0)
    shape = tuple((np.ceil((xz.max(0) - lo) / CELL) + 3).astype(int)[::-1])
    img = np.zeros(shape, np.uint8)
    ij = ((xz - lo) / CELL).astype(int) + 1
    img[ij[:, 1], ij[:, 0]] = 255
    lines = cv2.HoughLinesP(img, 1, np.pi / 360, threshold=40, minLineLength=int(0.8 / CELL), maxLineGap=int(0.2 / CELL))
    if lines is None:
        return 0.0
    seg = lines[:, 0, :].astype(float)
    ang = np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])
    w = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
    return float(0.25 * np.arctan2((w * np.sin(4 * ang)).sum(), (w * np.cos(4 * ang)).sum()))


def _snap_out(box: list[int], walls: np.ndarray, rooms: np.ndarray, me: int) -> tuple[list[int], list[bool]]:
    """Push each side of a room's box (grid cells: x0, z0, x1, z1, inclusive) out to the outermost wall
    line within WALL_SEARCH: the open floor stops at clutter and the near copy of a doubled wall, but
    the room runs to the wall's face. Never into another room's floor."""
    H, W = walls.shape
    x0, z0, x1, z1 = box
    reach = int(WALL_SEARCH / CELL)
    out = [x0, z0, x1, z1]
    found = [False] * 4
    for side in range(4):
        last = None
        for d in range(1, reach + 1):
            if side == 0:
                col = x0 - d
                if col < 0:
                    break
                line_w, line_r = walls[z0 : z1 + 1, col], rooms[z0 : z1 + 1, col]
            elif side == 2:
                col = x1 + d
                if col >= W:
                    break
                line_w, line_r = walls[z0 : z1 + 1, col], rooms[z0 : z1 + 1, col]
            elif side == 1:
                row = z0 - d
                if row < 0:
                    break
                line_w, line_r = walls[row, x0 : x1 + 1], rooms[row, x0 : x1 + 1]
            else:
                row = z1 + d
                if row >= H:
                    break
                line_w, line_r = walls[row, x0 : x1 + 1], rooms[row, x0 : x1 + 1]
            if ((line_r > 0) & (line_r != me)).mean() > 0.2:
                break  # the next room's floor: the wall between ends here
            if line_w.mean() >= WALL_SHARE:
                last = d
            elif last is not None and d - last >= OPEN_GAP:
                break  # open space past the wall: whatever's beyond belongs to something else
        if last is not None:
            out[side] = out[side] - last if side in (0, 1) else out[side] + last
            found[side] = True
    return out, found


def _split_overlaps(rooms: list["PlanRoom"]) -> None:
    """Two rooms' boxes must not overlap: where they do, the smaller room gives way along the shallower
    direction (it stops at the bigger room's wall). A stair strip along a room's wall doesn't eat the room."""
    order = sorted(range(len(rooms)), key=lambda k: -rooms[k].area_m2)
    for bi, i in enumerate(order):
        for j in order[bi + 1 :]:
            a, b = rooms[i].box, list(rooms[j].box)  # a is the bigger room
            ox = min(a[2], b[2]) - max(a[0], b[0])
            oz = min(a[3], b[3]) - max(a[1], b[1])
            if ox <= 0 or oz <= 0:
                continue
            if ox < oz:
                if (b[0] + b[2]) > (a[0] + a[2]):
                    b[0] = a[2]
                else:
                    b[2] = a[0]
            else:
                if (b[1] + b[3]) > (a[1] + a[3]):
                    b[1] = a[3]
                else:
                    b[3] = a[1]
            if b[2] - b[0] > 0.3 and b[3] - b[1] > 0.3:
                rooms[j].box = tuple(b)


def floor_plan(points: np.ndarray, cameras: np.ndarray) -> FloorPlan:
    """points: N x 3 and cameras: M x 3 (camera centres), in a +Y-up world in metres."""
    # 1. Floor: the strongest horizontal layer well below the cameras; ceiling: the strongest above.
    cam_y = float(np.median(cameras[:, 1]))
    floor_y = _height_peak(points[:, 1], cam_y - 2.2, cam_y - 0.6)
    if floor_y is None:
        floor_y = float(np.percentile(points[:, 1], 2))
    ceiling_y = _height_peak(points[:, 1], cam_y + 0.15, floor_y + 3.2)
    h = points[:, 1] - floor_y

    # 2. Main axes from the wall band, then everything turned onto them.
    band = (h > WALL_BAND[0]) & (h < WALL_BAND[1])
    phi = _main_axis(points[band][:, [0, 2]])
    c, s = np.cos(-phi), np.sin(-phi)
    turn = lambda xz: np.stack([c * xz[:, 0] - s * xz[:, 1], s * xz[:, 0] + c * xz[:, 1]], 1)  # noqa: E731
    pw = turn(points[band][:, [0, 2]])
    hw = h[band]
    pf = turn(points[np.abs(h) < 0.08][:, [0, 2]])
    pc = turn(cameras[:, [0, 2]])

    allxy = np.concatenate([pw, pf, pc])
    lo = np.percentile(allxy, 0.5, axis=0) - 1.0
    hi = np.percentile(allxy, 99.5, axis=0) + 1.0
    W, H = (np.ceil((hi - lo) / CELL)).astype(int) + 1

    def raster(xy: np.ndarray) -> np.ndarray:
        g = np.zeros((H, W), np.int32)
        ij = np.floor((xy - lo) / CELL).astype(int)
        ok = (ij[:, 0] >= 0) & (ij[:, 0] < W) & (ij[:, 1] >= 0) & (ij[:, 1] < H)
        np.add.at(g, (ij[ok, 1], ij[ok, 0]), 1)
        return g

    def disk(r_m: float) -> np.ndarray:
        r = max(1, int(round(r_m / CELL)))
        return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r + 1, 2 * r + 1))

    # 3. Walls: cells whose points rise through most of the wall band (furniture tops and benches don't),
    #    a little thickened; floor: points on the floor and where the person walked.
    wall_counts = raster(pw)
    ij = np.floor((pw - lo) / CELL).astype(int)
    ok = (ij[:, 0] >= 0) & (ij[:, 0] < W) & (ij[:, 1] >= 0) & (ij[:, 1] < H)
    top = np.full((H, W), -np.inf)
    bottom = np.full((H, W), np.inf)
    np.maximum.at(top, (ij[ok, 1], ij[ok, 0]), hw[ok])
    np.minimum.at(bottom, (ij[ok, 1], ij[ok, 0]), hw[ok])
    rise = np.where(np.isfinite(top), top - bottom, 0.0)
    # Neighbouring cells of one wall share its rise: judge it over a small window.
    rise = cv2.dilate(rise.astype(np.float32), np.ones((3, 3), np.uint8))
    walls = ((wall_counts >= 2) & (rise >= WALL_RISE)).astype(np.uint8)
    walls = cv2.dilate(walls, disk(0.05))
    seen = ((raster(pf) > 0) | (cv2.dilate((raster(pc) > 0).astype(np.uint8), disk(0.6)) > 0)).astype(np.uint8)
    footprint = cv2.morphologyEx(seen | walls, cv2.MORPH_CLOSE, disk(0.3))
    # Fill holes (furniture hides floor in the middle of a room).
    filled = footprint.copy()
    mask = np.zeros((H + 2, W + 2), np.uint8)
    cv2.floodFill(filled, mask, (0, 0), 1)
    footprint = footprint | (1 - filled)
    free = (footprint & (1 - walls)).astype(np.uint8)

    # 4. Rooms: open floor shrunk by half a doorway falls apart at the doors; each core grows back.
    core = cv2.erode(free, disk(DOOR_HALF))
    n, labels = cv2.connectedComponents(core)
    keep = [k for k in range(1, n) if (labels == k).sum() * CELL * CELL >= 0.3]
    markers = np.zeros((H, W), np.int32)
    for i, k in enumerate(keep, start=1):
        markers[labels == k] = i
    # Grow over open floor only, nearest core first (a few dilation rounds, capped at the doorway size).
    grown = markers.copy()
    for _ in range(int(DOOR_HALF / CELL) + 4):
        dil = cv2.dilate(grown.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.int32)
        add = (grown == 0) & (free > 0) & (dil > 0)
        grown[add] = dil[add]
    cam_ij = np.floor((pc - lo) / CELL).astype(int)
    # A cluttered room's open floor can be too broken up to leave a core; where the person stood in open
    # floor that no room claimed, that floor is a room too.
    stood = np.zeros((H, W), np.uint8)
    for cx, cy in cam_ij:
        if 0 <= cy < H and 0 <= cx < W:
            stood[cy, cx] = 1
    left = ((free > 0) & (grown == 0)).astype(np.uint8)
    n_left, left_labels = cv2.connectedComponents(left)
    for k in range(1, n_left):
        piece = left_labels == k
        if piece.sum() * CELL * CELL >= MIN_ROOM_M2 and stood[piece].sum() >= 3:
            grown[piece] = grown.max() + 1
    rooms = []
    for i in range(1, int(grown.max()) + 1):
        cells = grown == i
        count = int(cells.sum())
        if count * CELL * CELL < MIN_ROOM_M2:
            continue
        ys, xs = np.nonzero(cells)
        gx0, gx1 = int(np.percentile(xs, 1)), int(np.percentile(xs, 99))
        gz0, gz1 = int(np.percentile(ys, 1)), int(np.percentile(ys, 99))
        (gx0, gz0, gx1, gz1), found = _snap_out([gx0, gz0, gx1, gz1], walls, grown, i)
        x0, x1 = lo[0] + gx0 * CELL, lo[0] + (gx1 + 1) * CELL
        z0, z1 = lo[1] + gz0 * CELL, lo[1] + (gz1 + 1) * CELL
        contours, _ = cv2.findContours(cells.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        big = max(contours, key=cv2.contourArea)
        poly = cv2.approxPolyDP(big, 0.12 / CELL, True)[:, 0, :]
        outline = [(float(lo[0] + (px + 0.5) * CELL), float(lo[1] + (py + 0.5) * CELL)) for px, py in poly]
        inside = sum(1 for cx, cy in cam_ij if 0 <= cy < H and 0 <= cx < W and cells[cy, cx])
        sides = {k: "wall" if f else "extent" for k, f in zip(("minX", "minZ", "maxX", "maxZ"), found)}
        rooms.append(PlanRoom(count, round(count * CELL * CELL, 2), (float(x0), float(z0), float(x1), float(z1)), outline, inside, sides))
    _split_overlaps(rooms)
    fp = FloorPlan(phi, floor_y, ceiling_y, rooms, round(float(free.sum()) * CELL * CELL, 2))
    fp.debug = {"walls": walls, "free": free, "rooms": grown, "lo": lo}  # type: ignore[attr-defined]
    return fp
