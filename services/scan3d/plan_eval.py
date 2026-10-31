"""Score a floor plan against the truth, in one command, from cached takes (scripts/eval/plan-takes.ts).

    .venv/bin/python plan_eval.py                     # every cached take, the new plan and the old boxes
    .venv/bin/python plan_eval.py --take b2 --method new

For the rendered basements (b1–b7) the truth is the generator's own plan (scripts/eval/generate.py
BASEMENTS): room rectangles, doors, stairs, overheads. Scores:

- wall error: every true wall face sampled every 5 cm; the distance to the nearest predicted room edge
  running the same way (capped at 1 m). Median, 90th percentile, and the share within 10 cm.
- rooms: how many, matched to the true rooms by overlap; area error per matched room; the footprint's
  overlap with the true one (IoU).
- adjacency: which rooms share a wall, against the truth.
- doors: a true door counts as found when a predicted door joins the same two rooms within 0.8 m of it.
- ceilings and overheads, where the plan has them.

For a real take there's no plan to compare with, only what the homeowner says (a sketch in
scripts/eval/sketches/<take>.json): room count, which room has what, which rooms a door joins, and
their tape numbers when they give them.

Writes tmp/eval/plan/results.json and an overlay per take and method in tmp/eval/plan/overlays/:
predicted on the true plan (left) and predicted on the points from above (right).
"""

from __future__ import annotations

import argparse
import ast
import json
import math
import sys
import time
from pathlib import Path

import cv2
import numpy as np

from scan3d import plandraw
from scan3d.export import lift_box, read_ply
from scan3d.floorplan import floor_plan
from scan3d.layout import area_axis, find_floor, read_plan

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / "tmp" / "eval" / "plan"
SKETCHES = ROOT / "scripts" / "eval" / "sketches"
# Sketches of other people's homes stay out of the repo, beside the cached takes (tmp/ is gitignored).
PRIVATE_SKETCHES = ROOT / "tmp" / "eval" / "sketches"
# media/ is git-ignored: in a worktree it lives with the main checkout.
MEDIA = next((m for m in (ROOT / "media", ROOT.parents[2] / "media") if (m / "eval").exists()), ROOT / "media")


# ---- Loading a cached take ----


def _rot_y(turn: int):
    t = turn * math.pi / 2
    c, s = round(math.cos(t)), round(math.sin(t))
    return np.array([[c, 0, -s], [0, 1, 0], [s, 0, c]], float)


def load_take(name: str, depth: bool = True) -> dict:
    """Every area's points, cameras and frames in one +Y-up world: the phone's (tracked) or the basement
    frame the areas were placed in (a web take)."""
    d = PLAN / name
    b = json.loads((d / "bundle.json").read_text())
    pts, rgb, area, views, cams = [], [], [], [], []
    for k, a in enumerate(b["areas"]):
        ad = d / a["dir"]
        scan = json.loads((ad / "scan.json").read_text())
        v = read_ply((ad / "points.ply").read_bytes())
        room = np.stack([v["x"], v["y"], v["z"]], 1).astype(float)
        f = float((scan.get("scale") or {}).get("factor") or 1.0)
        if scan["world"]["frame"] == "arkit" and b["kind"] == "tracked":
            R, o = np.asarray(scan["world"]["rotation"], float), np.asarray(scan["world"]["origin"], float)
            M, t, s = R.T, o, 1.0 / f  # world = M (s p) + t
        else:
            pl = a.get("placement") or {"turn": 0, "x": 0, "z": 0}
            M, t, s = _rot_y(pl["turn"]), np.array([pl["x"], pl.get("y", 0.0), pl["z"]]), 1.0
        pts.append((s * room) @ M.T + t)
        rgb.append(np.stack([v["red"], v["green"], v["blue"]], 1))
        area.append(np.full(len(room), k, np.int32))
        # A take copied from the app's own 3D files has no depth (the API serves points, not depth): no
        # floor edges and no self-check for it, only the points.
        dep = (ad / "depth.bin").read_bytes() if depth and (ad / "depth.bin").exists() else None
        shape = scan["files"]["depth"]["shape"]
        for i, fr in enumerate(scan["frames"]):
            P = np.asarray(fr["pose"], float)
            pose = np.eye(4)
            pose[:3, :3] = M @ P[:3, :3]
            pose[:3, 3] = M @ (s * P[:3, 3]) + t
            view = {"area": k, "frame": scan["sentFrames"][fr["sourceIndex"]], "pose": pose, "K": np.asarray(fr["intrinsics"], float), "model": fr["model"]}
            if dep is not None:
                H, W = shape[1], shape[2]
                view["depth"] = np.frombuffer(dep, "<f2", count=H * W, offset=fr["depthOffset"]).reshape(H, W).astype(np.float32) * s
            views.append(view)
        a["scan"] = scan
        a["depth"] = dep
        a["M"], a["t"], a["s"] = M, t, s
    if b.get("cams"):
        cams = np.array([c for c in b["cams"] if c], float)
    else:
        cams = np.array([v["pose"][:3, 3] for v in views])
    return {"bundle": b, "points": np.concatenate(pts), "rgb": np.concatenate(rgb), "area": np.concatenate(area), "views": views, "cams": cams, "areas": b["areas"]}


def lift_finds(take: dict) -> dict:
    """SAM's finds in the take's world: each one's points under its boxes in the area that saw it most
    (the same as server/plan.ts locate), as hints for the plan."""
    hints = {"doors": [], "windows": [], "stairs": [], "fixtures": [], "overhead": []}
    for det in take["bundle"].get("detections") or []:
        byframe = {t[0]: t for t in det["track"]}
        best = None
        for a in take["areas"]:
            scan = a["scan"]
            if a["depth"] is None:  # a find is lifted by its depth: a take without depth gets no hints
                continue
            mids, lows, highs = [], [], []
            for i, fr in enumerate(scan["frames"]):
                tr = byframe.get(scan["sentFrames"][fr["sourceIndex"]])
                if not tr:
                    continue
                got = lift_box(scan, a["depth"], i, {"x": tr[1], "y": tr[2], "w": tr[3], "h": tr[4]})
                if got:
                    mids.append(got["median"])
                    lows.append(got["p05"])
                    highs.append(got["p95"])
            if mids and (best is None or len(mids) > best[0]):
                to = lambda p: a["M"] @ (a["s"] * np.asarray(p)) + a["t"]  # noqa: E731
                best = (len(mids), to(np.median(mids, 0)), to(np.median(lows, 0)), to(np.median(highs, 0)))
        if best is None:
            continue
        lo_, hi_ = np.minimum(best[2], best[3]), np.maximum(best[2], best[3])
        h = {"id": det["id"], "center": best[1].tolist(), "low": lo_.tolist(), "high": hi_.tolist(), "views": best[0]}
        kind, label = det["kind"], det["label"]
        if kind == "exit":
            hints["doors"].append(h)
        elif kind == "window":
            hints["windows"].append(h)
        elif kind == "stairs":
            hints["stairs"].append(h)
        elif kind == "mechanical":
            fk = "panel" if "panel" in label.lower() else "water_heater" if "water heater" in label.lower() else "plumbing" if ("rough" in label.lower() or "drain" in label.lower()) else "furnace"
            hints["fixtures"].append({**h, "kind": fk})
        elif kind in ("duct", "beam"):
            hints["overhead"].append({**h, "kind": "bulkhead" if "bulkhead" in label.lower() else kind})
    return hints


# ---- Truth from the generator ----


def _basements() -> list[dict]:
    src = (ROOT / "scripts" / "eval" / "generate.py").read_text()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "BASEMENTS")
    return eval(compile(ast.Expression(node.value), "generate.py", "eval"), {"dict": dict, "__builtins__": {}})


def _w(x, y):
    """Generator plan (x east, y north) -> the phone's world (x, z): z = -y (generate.py write_capture)."""
    return (float(x), float(-y))


def truth_for(take: str) -> dict | None:
    cfg = next((c for c in _basements() if take.startswith(c["id"])), None)
    if cfg is None:
        return None
    p = MEDIA / "eval" / cfg["id"] / "truth.json"
    tj = json.loads(p.read_text()) if p.exists() else {"rooms": []}
    rooms = []
    for k, r in enumerate(cfg["rooms"]):
        x0, y0, x1, y1 = r["rect"]
        info = tj["rooms"][k] if k < len(tj.get("rooms", [])) else {}
        rooms.append({"name": r["name"], "polygon": [_w(x0, y0), _w(x1, y0), _w(x1, y1), _w(x0, y1)], "ceilingM": info.get("ceilingHeightM"), "rect": (x0, y0, x1, y1), "entered": not r.get("peek")})

    def room_at(x, y):
        for k, r in enumerate(cfg["rooms"]):
            x0, y0, x1, y1 = r["rect"]
            if x0 - 0.01 <= x <= x1 + 0.01 and y0 - 0.01 <= y <= y1 + 0.01:
                return k
        return -1

    doors = []
    dirs = {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}
    for d in cfg.get("doors", []):
        x0, y0, x1, y1 = cfg["rooms"][d["room"]]["rect"]
        o = {"N": (x0 + d["at"], y1), "S": (x0 + d["at"], y0), "E": (x1, y0 + d["at"]), "W": (x0, y0 + d["at"])}[d["wall"]]
        nx, ny = dirs[d["wall"]]
        other = room_at(o[0] + nx * 0.2, o[1] + ny * 0.2)
        doors.append({"at": _w(*o), "rooms": sorted([d["room"], other]), "widthM": d["width"]})
    # Stairs (generate.py stair_layout).
    st = cfg["stairs"]
    width = st.get("width", 0.92)
    n = math.ceil((cfg["subfloor"] + 0.02) / 0.20)
    top = st["bottom"] + st["up"] * (n - 1) * 0.254
    a0, a1 = sorted((st["bottom"], top))
    c0, c1 = sorted((st["line"], st["line"] + st["side"] * width))
    sx0, sy0, sx1, sy1 = (a0, c0, a1, c1) if st["axis"] == "x" else (c0, a0, c1, a1)
    stairs = {"polygon": [_w(sx0, sy0), _w(sx1, sy0), _w(sx1, sy1), _w(sx0, sy1)]}
    # What hangs low: positions from the plan, undersides from truth.json.
    over = []
    for r in tj.get("rooms", []):
        for ob in r.get("obstructions", []):
            over.append({"kind": ob["kind"], "heightM": ob["bottomM"], "room": r["index"]})
    shapes = [("duct", d["rect"]) for d in cfg.get("ducts", [])] + [("bulkhead", d["rect"]) for d in cfg.get("bulkheads", [])]
    for b in cfg.get("beams", []):
        lo_, hi_ = b["span"]
        shapes.append(("beam", (lo_, b["at"] - 0.1, hi_, b["at"] + 0.1) if b["axis"] == "x" else (b["at"] - 0.1, lo_, b["at"] + 0.1, hi_)))
    overheads = []
    for kind, (x0, y0, x1, y1) in shapes:
        h = next((o["heightM"] for o in over if o["kind"] == kind), None)
        overheads.append({"kind": kind, "polygon": [_w(x0, y0), _w(x1, y0), _w(x1, y1), _w(x0, y1)], "heightM": h})
    return {"kind": "plan", "rooms": rooms, "doors": doors, "stairs": stairs, "overheads": overheads}


# ---- Scoring ----


def to_world(plan: dict) -> dict:
    """The plan's polygons and points turned back from the plan frame into the take's world."""
    c, s = math.cos(plan["rotation"]), math.sin(plan["rotation"])
    T = lambda p: (c * p[0] - s * p[1], s * p[0] + c * p[1])  # noqa: E731
    out = json.loads(json.dumps(plan))
    for r in out["rooms"]:
        r["polygon"] = [T(p) for p in r["polygon"]]
    for w in out["walls"]:
        w["a"], w["b"] = T(w["a"]), T(w["b"])
    for o in out["openings"]:
        o["at"] = T(o["at"])
    for f in out["fixtures"]:
        f["at"] = T(f["at"])
        if f.get("sizeM") and abs(s) > 0.7:
            f["sizeM"] = f["sizeM"][::-1]
    return out


def _edges(poly):
    P = [np.asarray(p, float) for p in poly]
    return [(P[k], P[(k + 1) % len(P)]) for k in range(len(P))]


def _seg_dist(p, a, b):
    d = b - a
    L2 = float(d @ d)
    t = 0.0 if L2 == 0 else float(np.clip((p - a) @ d / L2, 0, 1))
    return float(np.hypot(*(a + t * d - p)))


def wall_error(true_rooms, pred_rooms) -> dict:
    pred = [e for r in pred_rooms for e in _edges(r["polygon"])]
    errs = []
    for r in true_rooms:
        for a, b in _edges(r["polygon"]):
            d = b - a
            L = float(np.hypot(*d))
            t = d / L
            cands = [(pa, pb) for pa, pb in pred if np.hypot(*(pb - pa)) > 0 and abs(((pb - pa) / np.hypot(*(pb - pa))) @ t) > 0.94]
            for k in np.arange(0.025, L, 0.05):
                p = a + t * k
                errs.append(min([_seg_dist(p, pa, pb) for pa, pb in cands] + [1.0]))
    e = np.array(errs) if errs else np.array([1.0])
    back = []
    tr = [e2 for r in true_rooms for e2 in _edges(r["polygon"])]
    for pa, pb in pred:
        d = pb - pa
        L = float(np.hypot(*d))
        if L < 1e-6:
            continue
        t = d / L
        cands = [(a, b) for a, b in tr if abs(((b - a) / np.hypot(*(b - a))) @ t) > 0.94]
        for k in np.arange(0.025, L, 0.05):
            back.append(min([_seg_dist(pa + t * k, a, b) for a, b in cands] + [1.0]))
    bk = np.array(back) if back else np.array([1.0])
    return {"medianCm": round(float(np.median(e)) * 100, 1), "p90Cm": round(float(np.percentile(e, 90)) * 100, 1), "within10": round(float((e <= 0.10).mean()), 3), "within25": round(float((e <= 0.25).mean()), 3), "extraMedianCm": round(float(np.median(bk)) * 100, 1), "extraWithin25": round(float((bk <= 0.25).mean()), 3)}


def _raster(polys, lo, hi, ppm=50):
    W, H = (np.ceil((hi - lo) * ppm)).astype(int) + 1
    out = []
    for poly in polys:
        m = np.zeros((H, W), np.uint8)
        cv2.fillPoly(m, [np.round((np.asarray(poly) - lo) * ppm).astype(np.int32)], 1)
        out.append(m > 0)
    return out


def match_rooms(true_rooms, pred_rooms):
    allp = np.array([p for r in true_rooms + pred_rooms for p in r["polygon"]], float)
    lo, hi = allp.min(0) - 0.5, allp.max(0) + 0.5
    T = _raster([r["polygon"] for r in true_rooms], lo, hi)
    P = _raster([r["polygon"] for r in pred_rooms], lo, hi)
    iou = np.zeros((len(T), len(P)))
    for i, t in enumerate(T):
        for j, p in enumerate(P):
            inter = (t & p).sum()
            iou[i, j] = inter / max(1, (t | p).sum())
    pairs, used_t, used_p = [], set(), set()
    for i, j in sorted(((i, j) for i in range(len(T)) for j in range(len(P))), key=lambda ij: -iou[ij]):
        if iou[i, j] < 0.25 or i in used_t or j in used_p:
            continue
        pairs.append((i, j, float(iou[i, j])))
        used_t.add(i)
        used_p.add(j)
    ut = np.any(T, 0) if T else None
    up = np.any(P, 0) if P else np.zeros_like(ut)
    fiou = float((ut & up).sum() / max(1, (ut | up).sum())) if ut is not None else 0.0
    return pairs, fiou


def _poly_area(poly):
    P = np.asarray(poly, float)
    return 0.5 * abs(float((P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1]).sum()))


def adjacency(rooms, tol=0.45):
    """Pairs of rooms with facing edges closer than tol over 0.5 m or more."""
    out = set()
    for i in range(len(rooms)):
        for j in range(i + 1, len(rooms)):
            for a0, a1 in _edges(rooms[i]["polygon"]):
                for b0, b1 in _edges(rooms[j]["polygon"]):
                    ta = (a1 - a0) / max(1e-9, np.hypot(*(a1 - a0)))
                    tb = (b1 - b0) / max(1e-9, np.hypot(*(b1 - b0)))
                    if abs(ta @ tb) < 0.98:
                        continue
                    n = np.array([-ta[1], ta[0]])
                    if abs((b0 - a0) @ n) > tol:
                        continue
                    s = sorted([float((b0 - a0) @ ta), float((b1 - a0) @ ta)])
                    if min(np.hypot(*(a1 - a0)), s[1]) - max(0.0, s[0]) >= 0.5:
                        out.add((i, j))
    return out


def score_plan(world: dict, truth: dict) -> dict:
    pr, tr = world["rooms"], truth["rooms"]
    pairs, fiou = match_rooms(tr, pr)
    t2p = {i: j for i, j, _ in pairs}
    p2t = {j: i for i, j, _ in pairs}
    areas = []
    for i, j, iou in pairs:
        ta, pa = _poly_area(tr[i]["polygon"]), _poly_area(pr[j]["polygon"])
        areas.append({"room": tr[i]["name"], "trueM2": round(ta, 2), "planM2": round(pa, 2), "errPct": round(100 * (pa - ta) / ta, 1), "iou": round(iou, 3),
                      "ceilingTrue": tr[i].get("ceilingM"), "ceilingPlan": pr[j].get("ceilingM")})
    ta_ = adjacency(tr)
    pa_ = {tuple(sorted((p2t[a], p2t[b]))) for a, b in adjacency(pr) if a in p2t and b in p2t}
    adj = {"true": len(ta_), "found": len(ta_ & pa_), "extra": len(pa_ - ta_)}
    # Doors: same two rooms, within 0.8 m.
    found = 0
    used = set()
    pred_doors = []
    ids = {r["id"]: k for k, r in enumerate(pr)}
    for o in world["openings"]:
        if o["kind"] != "door":
            continue
        rooms_ = sorted(p2t.get(ids.get(x, -9), -2) for x in o.get("rooms", []))
        if len(rooms_) == 1:
            rooms_ = sorted(rooms_ + [-1])
        pred_doors.append((np.asarray(o["at"], float), rooms_))
    for d in truth["doors"]:
        for k, (p, rr) in enumerate(pred_doors):
            if k in used:
                continue
            if rr == d["rooms"] and np.hypot(*(p - np.asarray(d["at"]))) < 0.8:
                found += 1
                used.add(k)
                break
    doors = {"true": len(truth["doors"]), "found": found, "extra": len(pred_doors) - len(used)}
    # Stairs: centre distance.
    st = next((f for f in world["fixtures"] if f["kind"] == "stairs"), None)
    stairs = None
    if truth.get("stairs") and st:
        tc = np.mean(np.asarray(truth["stairs"]["polygon"]), 0)
        stairs = {"centreErrM": round(float(np.hypot(*(np.asarray(st["at"]) - tc))), 2)}
    # Overheads: a true one counts as found when a predicted one of any kind lies on it.
    ov_found, ov_h = 0, []
    preds = [f for f in world["fixtures"] if f["kind"] in ("beam", "duct", "bulkhead")]
    for t in truth.get("overheads", []):
        P = np.asarray(t["polygon"], float)
        lo_, hi_ = P.min(0) - 0.3, P.max(0) + 0.3
        hit = [f for f in preds if lo_[0] <= f["at"][0] <= hi_[0] and lo_[1] <= f["at"][1] <= hi_[1]]
        if hit:
            ov_found += 1
            if t["heightM"] and hit[0].get("heightM"):
                ov_h.append(abs(hit[0]["heightM"] - t["heightM"]))
    # Rooms the camera only looked into from a doorway: found, drawn as seen from the door, and how big.
    peek = []
    for i, r in enumerate(tr):
        if r.get("entered", True):
            continue
        j = t2p.get(i)
        got = pr[j] if j is not None else None
        peek.append({"room": r["name"], "found": got is not None, "markedFromDoor": bool(got and got.get("entered") is False),
                     "errPct": round(100 * (_poly_area(got["polygon"]) - _poly_area(r["polygon"])) / _poly_area(r["polygon"]), 1) if got else None})
    return {
        "rooms": {"true": len(tr), "plan": len(pr), "matched": len(pairs), "footprintIoU": round(fiou, 3), "perRoom": areas},
        "doorwayRooms": peek,
        "walls": wall_error(tr, pr),
        "adjacency": adj,
        "doors": doors,
        "stairs": stairs,
        "overheads": {"true": len(truth.get("overheads", [])), "found": ov_found, "plan": len(preds), "heightErrCm": round(100 * float(np.median(ov_h)), 1) if ov_h else None},
        "guessWalls": sum(1 for w in world["walls"] if w.get("guess")),
        "walls_n": len(world["walls"]),
        "selfCheck": self_check_score(world, truth),
    }


def self_check_score(world: dict, truth: dict) -> dict | None:
    """Does the self-check doubt the right walls? Each wall's error is how far its faces sit from the
    nearest true wall face running the same way; compared for the walls it trusts and the ones it doubts."""
    if not any("check" in w for w in world["walls"]):
        return None
    tr = [e for r in truth["rooms"] for e in _edges(r["polygon"])]
    sure, doubt = [], []
    for w in world["walls"]:
        a, b = np.asarray(w["a"], float), np.asarray(w["b"], float)
        L = float(np.hypot(*(b - a)))
        if L < 0.3:
            continue
        t = (b - a) / L
        n = np.array([-t[1], t[0]])
        cands = [(x, y) for x, y in tr if abs(((y - x) / np.hypot(*(y - x))) @ t) > 0.94]
        best = 1.0
        for side in (1, -1):  # the face nearer a true wall (a foundation's outside face isn't one)
            errs = [min([_seg_dist(a + t * k + n * side * w["thicknessM"] / 2, x, y) for x, y in cands] + [1.0]) for k in np.arange(0.1, L, 0.2)]
            best = min(best, float(np.median(errs)) if errs else 1.0)
        (doubt if w.get("guess") else sure).append(best)
    med = lambda xs: round(100 * float(np.median(xs)), 1) if xs else None  # noqa: E731
    return {"sure": len(sure), "sureErrCm": med(sure), "doubtful": len(doubt), "doubtfulErrCm": med(doubt)}


# ---- A real take: the homeowner's sketch ----


def score_sketch(world: dict, sketch: dict) -> dict:
    """Topology against what the homeowner drew: rooms by what's in them, and which rooms a door joins."""
    rooms = world["rooms"]
    if not rooms:
        return {"rooms": {"sketch": len(sketch["rooms"]), "plan": 0}}

    def has(r, kinds):
        return [f["kind"] for f in world["fixtures"] if f["kind"] in kinds and _inside(r["polygon"], f["at"])]

    roles: dict[str, str] = {}
    main = max(rooms, key=lambda r: r["areaM2"])
    roles[main["id"]] = "main"
    util = [r for r in rooms if r["id"] != main["id"] and has(r, {"furnace", "water_heater", "panel"})]
    if util:
        roles[max(util, key=lambda r: len(has(r, {"furnace", "water_heater", "panel"})))["id"]] = "utility"
    low = [r for r in rooms if r["id"] not in roles and r.get("low")]
    if low:
        roles[low[0]["id"]] = "low room"
    small = [r for r in rooms if r["id"] not in roles and r["areaM2"] < 4]
    if small:
        roles[min(small, key=lambda r: r["areaM2"])["id"]] = "closet"
    for r in rooms:
        if r["id"] not in roles and r.get("kind") == "bathroom" and "bathroom" not in roles.values():
            roles[r["id"]] = "bathroom"
    stairs_room = [r for r in rooms if r["id"] not in roles and has(r, {"stairs"})]
    if stairs_room:
        roles[stairs_room[0]["id"]] = "stairs"
    got = {}
    for o in world["openings"]:
        if o["kind"] != "door":
            continue
        pair = tuple(sorted(roles.get(x, x) for x in o.get("rooms", [])))
        got[pair] = got.get(pair, 0) + 1
    want = {}
    for d in sketch["doors"]:
        pair = tuple(sorted(d["rooms"]))
        want[pair] = want.get(pair, 0) + 1
    hits = sum(min(n, got.get(p, 0)) for p, n in want.items())
    out = {
        "rooms": {"sketch": len(sketch["rooms"]), "plan": len(rooms), "named": sorted(set(roles.values())), "missing": sorted(set(r["role"] for r in sketch["rooms"]) - set(roles.values()))},
        "doors": {"sketch": sum(want.values()), "found": hits, "plan": sum(got.values()), "pairs": {"/".join(k): v for k, v in got.items()}},
        "fixtures": {k: sum(1 for f in world["fixtures"] if f["kind"] == k) for k in ("stairs", "furnace", "water_heater", "panel", "plumbing", "beam", "duct", "bulkhead")},
        "lowRooms": [r["id"] for r in rooms if r.get("low")],
        "roles": roles,
    }
    tape = sketch.get("tape") or []
    if tape:
        errs = []
        for t in tape:
            r = next((x for x in rooms if roles.get(x["id"]) == t["room"]), None)
            if r is None:
                continue
            P = np.asarray(r["polygon"], float)
            ext = np.ptp(P, 0)
            got_m = float(max(ext)) if t.get("side") == "long" else float(min(ext))
            errs.append({"room": t["room"], "side": t.get("side"), "tapeM": t["m"], "planM": round(got_m, 2), "errCm": round(100 * (got_m - t["m"]), 1)})
        out["tape"] = errs
    return out


def _inside(poly, p) -> bool:
    x, z = p
    inside = False
    P = list(poly)
    for (x0, z0), (x1, z1) in zip(P, P[1:] + P[:1]):
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0):
            inside = not inside
    return inside


# ---- The old plan (boxes), for before/after ----


def boxes_plan(points, cams) -> dict:
    fp = floor_plan(points, cams)
    rooms = [{"id": f"r{k + 1}", "polygon": [(r.box[0], r.box[1]), (r.box[2], r.box[1]), (r.box[2], r.box[3]), (r.box[0], r.box[3])], "areaM2": round((r.box[2] - r.box[0]) * (r.box[3] - r.box[1]), 2), "ceilingM": None if fp.ceiling_y is None else round(fp.ceiling_y - fp.floor_y, 2)} for k, r in enumerate(fp.rooms)]
    walls = []
    for r in rooms:
        P = r["polygon"]
        for k in range(4):
            walls.append({"id": f"w{len(walls) + 1}", "a": P[k], "b": P[(k + 1) % 4], "thicknessM": 0.12, "kind": "existing", "rooms": [r["id"]]})
    return {"rotation": fp.rotation, "rooms": rooms, "walls": walls, "openings": [], "fixtures": [], "floor": {"y": fp.floor_y}}


# ---- Overlays ----


def overlay(path: Path, plan: dict, world: dict, truth: dict | None, take: dict, title: str):
    """Left: the plan (red) on the truth (green), in the take's world. Right: the plan over the points."""
    c, s = math.cos(-plan["rotation"]), math.sin(-plan["rotation"])
    pts = take["points"]
    uv = np.stack([c * pts[:, 0] - s * pts[:, 2], s * pts[:, 0] + c * pts[:, 2]], 1)
    fy = (plan.get("floor") or {}).get("y", 0.0)
    right = plandraw.top_down(plan, uv, take["rgb"], pts[:, 1] - fy, title)
    if truth and truth.get("kind") == "plan":
        allp = np.array([p for r in truth["rooms"] + world["rooms"] for p in r["polygon"]], float)
        cv = plandraw.Canvas(allp.min(0) - 0.8, allp.max(0) + 0.8, 60)
        for r in truth["rooms"]:
            cv2.fillPoly(cv.img, [cv.poly(r["polygon"])], (200, 235, 200))
            cv2.polylines(cv.img, [cv.poly(r["polygon"])], True, (40, 150, 40), 3, cv2.LINE_AA)
        cv2.polylines(cv.img, [cv.poly(truth["stairs"]["polygon"])], True, (40, 150, 40), 1, cv2.LINE_AA)
        for d in truth["doors"]:
            cv2.circle(cv.img, cv.px(d["at"]), 7, (40, 150, 40), 2, cv2.LINE_AA)
        plandraw.draw_plan(cv, world, labels=True, fill=False, colour=(40, 40, 220))
        plandraw.scale_bar(cv, "plan (red) on the truth (green), the phone's world")
        left = cv.img
    else:
        left = None
    img = right if left is None else _side_by_side(left, right)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def _side_by_side(a, b):
    h = max(a.shape[0], b.shape[0])
    pad = lambda x: np.vstack([x, np.full((h - x.shape[0], x.shape[1], 3), 250, np.uint8)])  # noqa: E731
    return np.hstack([pad(a), np.full((h, 6, 3), 200, np.uint8), pad(b)])


# ---- Main ----


def run(name: str, method: str, use_hints: bool = True, edits=None, peek: int = 0) -> dict:
    t0 = time.perf_counter()
    take = load_take(name, depth=True)
    hints = lift_finds(take) if use_hints else {}
    if peek:
        hints["peek"] = peek  # what the whole-take watch says: rooms only seen from a doorway
    if method == "old":
        plan = boxes_plan(take["points"], take["cams"])
    else:
        prior = area_axis([a["scan"]["world"]["rotation"] for a in take["areas"]]) if take["bundle"]["kind"] == "tracked" else None
        p = read_plan(take["points"], take["cams"], area=take["area"], hints=hints, edits=edits, views=take["views"], axis_prior=prior)
        plan = p.to_json()
        if method == "new+check":
            from scan3d.selfcheck import check_walls

            check_walls(plan, take["views"])
    world = to_world(plan)
    truth = truth_for(name)
    # The homeowner's sketch: the one named for this take, or for the start of its name (david-* -> david).
    sketches = [*PRIVATE_SKETCHES.glob("*.json"), *SKETCHES.glob("*.json")]
    sk = next((p for p in sorted(sketches, key=lambda p: -len(p.stem)) if name.startswith(p.stem)), SKETCHES / "none.json")
    if truth is not None:
        score = score_plan(world, truth)
    elif sk.exists():
        score = score_sketch(plan, json.loads(sk.read_text()))
    else:
        score = {}
    score["seconds"] = round(time.perf_counter() - t0, 1)
    overlay(PLAN / "overlays" / f"{name}-{method}.png", plan, world, truth, take, f"{name}: {method}")
    (PLAN / "plans").mkdir(parents=True, exist_ok=True)
    (PLAN / "plans" / f"{name}-{method}.json").write_text(json.dumps(plan, default=float))
    return score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--take", default="", help="comma-separated prefixes of cached takes (tmp/eval/plan/*)")
    ap.add_argument("--method", default="old,new", help="old (boxes), new, new+check")
    ap.add_argument("--no-hints", action="store_true")
    ap.add_argument("--label", default="", help="a name for this run in results.json")
    ap.add_argument("--peek", type=int, default=0, help="tell the plan, as the whole-take watch would, that this many rooms were only seen from a doorway")
    a = ap.parse_args()
    names = sorted(p.name for p in PLAN.iterdir() if (p / "bundle.json").exists())
    if a.take:
        names = [n for n in names if any(n.startswith(t) for t in a.take.split(","))]
    results_path = PLAN / "results.json"
    results = json.loads(results_path.read_text()) if results_path.exists() else {}
    for n in names:
        for m in a.method.split(","):
            s = run(n, m, not a.no_hints, peek=a.peek)
            key = f"{n}:{m}" + (f":{a.label}" if a.label else "")
            results[key] = s
            print(f"\n== {key}")
            print(json.dumps(s, indent=1, default=float)[:3000])
    results_path.write_text(json.dumps(results, indent=1, default=float))


if __name__ == "__main__":
    sys.exit(main())
