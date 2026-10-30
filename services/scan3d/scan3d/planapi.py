"""What the /floorplan endpoint does, apart from HTTP: every area's points (and depth) into one world,
the plan read from it (scan3d/layout.py), checked against the depth (scan3d/selfcheck.py), and, when
asked, the pictures Spark reads (scan3d/plandraw.py).

An area arrives as {world: {rotation, origin}, factor} (measured with the phone's cameras: world =
rotationᵀ·(room / factor) + origin) or {placement: {turn, x, y, z}} (a web take's area placed in the
basement frame by quarter turns about +Y, then shifted). With depth it also carries `frames` (each
{pose: 4x4 camera-to-room, intrinsics: 3x3 for the depth pixels}) and `depthShape` [H, W]; the depth part
is float16 [frames, H, W], as many frames as `frames`, in the area's room units.
"""

from __future__ import annotations

import base64
import math

import cv2
import numpy as np

from .export import read_ply
from .layout import area_axis, read_plan
from .plandraw import top_down, wall_in_frame
from .selfcheck import check_walls


def area_transform(a: dict) -> tuple[np.ndarray, np.ndarray, float]:
    """(M, t, s) with world = M·(s·room) + t."""
    if a.get("world"):
        R, o = np.asarray(a["world"]["rotation"], float), np.asarray(a["world"]["origin"], float)
        return R.T, o, 1.0 / float(a.get("factor") or 1.0)
    p = a.get("placement") or {}
    turn = int(p.get("turn", 0)) % 4
    c, s = round(math.cos(turn * math.pi / 2)), round(math.sin(turn * math.pi / 2))
    M = np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]], float)
    return M, np.array([float(p.get("x", 0)), float(p.get("y", 0)), float(p.get("z", 0))]), 1.0


def fuse(areas: list[dict], plys: list[bytes], depths: list[bytes | None] | None = None):
    """Every area's points, colours and frames in one world."""
    pts, rgb, area, views = [], [], [], []
    for k, (a, ply) in enumerate(zip(areas, plys)):
        M, t, s = area_transform(a)
        v = read_ply(ply)
        room = np.stack([v["x"], v["y"], v["z"]], 1).astype(float)
        pts.append((s * room) @ M.T + t)
        rgb.append(np.stack([v["red"], v["green"], v["blue"]], 1))
        area.append(np.full(len(room), k, np.int32))
        buf = depths[k] if depths and k < len(depths) else None
        if buf and a.get("frames") and a.get("depthShape"):
            H, W = (int(x) for x in a["depthShape"])
            for i, fr in enumerate(a["frames"]):
                if (i + 1) * H * W * 2 > len(buf):
                    break
                P = np.asarray(fr["pose"], float)
                pose = np.eye(4)
                pose[:3, :3] = M @ P[:3, :3]
                pose[:3, 3] = M @ (s * P[:3, 3]) + t
                d = np.frombuffer(buf, "<f2", count=H * W, offset=i * H * W * 2).reshape(H, W).astype(np.float32) * s
                views.append({"area": k, "pose": pose, "K": np.asarray(fr["intrinsics"], float), "depth": d})
    return np.concatenate(pts), np.concatenate(rgb), np.concatenate(area), views


def box_rooms(plan: dict) -> list[dict]:
    """The plan's rooms the way the box-per-room code reads them (server/basement.ts fromFloorPlan): each
    room's bounds, and per side whether a wall the camera saw runs along it."""
    out = []
    for r in plan["rooms"]:
        P = np.asarray(r["polygon"], float)
        x0, z0 = P.min(0)
        x1, z1 = P.max(0)
        sides = {}
        for side, axis, val in (("minX", 0, x0), ("maxX", 0, x1), ("minZ", 1, z0), ("maxZ", 1, z1)):
            seen = False
            for w in plan["walls"]:
                a, b = np.asarray(w["a"]), np.asarray(w["b"])
                if abs(a[axis] - b[axis]) < 0.05 and abs((a[axis] + b[axis]) / 2 - val) <= w["thicknessM"] / 2 + 0.15 and r["id"] in w["rooms"] and not w.get("guess"):
                    seen = True
            sides[side] = "wall" if seen else "extent"
        out.append({"id": r["id"], "box": [float(x0), float(z0), float(x1), float(z1)], "outline": r["polygon"], "areaM2": r["areaM2"], "cameras": r["cameras"], "sides": sides})
    return out


def _png(img: np.ndarray, ext: str = ".png") -> str:
    ok, buf = cv2.imencode(ext, img, [cv2.IMWRITE_JPEG_QUALITY, 82] if ext == ".jpg" else [])
    return base64.b64encode(buf.tobytes()).decode() if ok else ""


def respond(areas, plys, depths, cams, hints=None, edits=None, keyframes=None, key_cams=None, render=False) -> dict:
    points, rgb, area, views = fuse(areas, plys, depths)
    prior = area_axis([a["world"]["rotation"] for a in areas if a.get("world")])
    p = read_plan(points, cams, area=area, hints=hints, edits=edits, views=views or None, axis_prior=prior)
    plan = p.to_json()
    checked = check_walls(plan, views) if views else None
    floor_y = plan["floor"]["y"] if plan["floor"] else 0.0
    out = {
        "rotation": plan["rotation"],
        "floorY": floor_y,
        "ceilingY": None if plan["ceilingM"] is None else floor_y + plan["ceilingM"],
        "footprintM2": plan["footprintM2"],
        "rooms": box_rooms(plan),
        "plan": plan,
        "checked": checked,
    }
    if render:
        d = p.debug
        renders = {"topDown": _png(top_down(plan, d["uv"], rgb, d["h"], "From above: the points, and the plan drawn on them"))}
        frames = []
        for jpg, cam in zip(keyframes or [], key_cams or []):
            img = cv2.imdecode(np.frombuffer(jpg, np.uint8), cv2.IMREAD_COLOR)
            if img is None:
                continue
            drawn = wall_in_frame(img, plan, np.asarray(cam["pose"], float), np.asarray(cam["intrinsics"], float), plan["rotation"], floor_y, plan["ceilingM"])
            frames.append(_png(drawn, ".jpg"))
        renders["frames"] = frames
        out["renders"] = renders
    return out
