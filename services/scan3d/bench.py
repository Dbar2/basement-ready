"""Measure the room fit against the synthetic basements (scripts/eval), fast.

MapAnything runs once per room and frame choice; its views are cached in tmp/eval/cache, so
changes to room.py are scored in seconds. Run from services/scan3d with its venv:

    .venv/bin/python bench.py                       # every rendered basement, every room
    .venv/bin/python bench.py --only b1 --frames 32 --skip-stairs
"""

import argparse
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from scan3d.frames import load_frames, select_sharpest
from scan3d.pipeline import FIT_VOXEL, _voxel_keep, view_points
from scan3d.room import describe, fit_room

ROOT = Path(__file__).resolve().parents[2]
EVAL = ROOT / "media" / "eval"
OUT = ROOT / "tmp" / "eval"
FPS = 5
SEND = 120  # server/scan3d.ts SEND_FRAMES


def frames_for(bid: str) -> Path:
    d = OUT / "frames" / bid / "frames"
    if not (d / "0000.jpg").exists():
        d.mkdir(parents=True, exist_ok=True)
        vf = f"fps={FPS},scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(EVAL / bid / "walkthrough.mp4"), "-t", "120", "-vf", vf, "-q:v", "2",
                        "-start_number", "0", str(d / "%04d.jpg")], check=True)
    return d


def sent(d: Path, lo: int, hi: int) -> list[Path]:
    """The frames the API sends for frames [lo, hi): every step-th, at most SEND."""
    files = sorted(d.glob("*.jpg"))[lo:hi]
    step = max(1, -(-len(files) // SEND))
    return files[::step]


_scanner = None


def views_for(files: list[Path], max_frames: int):
    key = hashlib.sha1(("|".join(str(f) for f in files) + f"#{max_frames}").encode()).hexdigest()[:16]
    cache = OUT / "cache" / f"{key}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        return list(z["views"]), list(z["names"])
    global _scanner
    if _scanner is None:
        from scan3d.pipeline import Scanner

        _scanner = Scanner.load()
    frames = load_frames([(f.name, f.read_bytes()) for f in files])
    picked = select_sharpest(frames, max_frames)
    picked_names = [f.name for f in picked]
    t = time.perf_counter()
    views = _scanner._infer([f.data for f in picked])
    print(f"    inferred {len(picked)} views in {time.perf_counter() - t:.0f}s", file=sys.stderr)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, views=np.array(views, dtype=object), names=np.array(picked_names))
    return views, picked_names


def measure(views):
    n = len(views)
    pts, rgb, fid, conf, _ = view_points(views)
    keep = _voxel_keep(pts, FIT_VOXEL, np.argsort(-conf, kind="stable"))
    poses = np.stack([v["pose"] for v in views])
    fit = fit_room(pts[keep], fid[keep].astype(np.int64), n, poses[:, :3, 3], poses[:, :3, :3])
    room, quality = describe(fit, 1.0)
    cams = fit.to_room(poses[:, :3, 3])
    return room, quality, fit, cams


def plot(path: Path, views, fit, room, cams, title: str):
    """Plan view of the wall band, coloured by when it was filmed (blue early, red late), to see drift."""
    import cv2

    pts, _, fid, _, _ = view_points(views)
    q = fit.to_room(pts)
    top = room["ceilingHeightM"] or 2.3
    band = (q[:, 1] > 0.4 * top) & (q[:, 1] < 0.85 * top)
    q, fid = q[band], fid[band]
    px, pad = 80, 30
    lo, hi = np.percentile(q, 0.5, 0) - 0.3, np.percentile(q, 99.5, 0) + 0.3
    W, H = int((hi[0] - lo[0]) * px) + 2 * pad, int((hi[2] - lo[2]) * px) + 2 * pad
    img = np.full((H + 30, W, 3), 250, np.uint8)
    to = lambda x, z: (int((x - lo[0]) * px) + pad, int((z - lo[2]) * px) + pad + 30)  # noqa: E731
    t = fid / max(1, len(views) - 1)
    col = np.stack([255 * (1 - t), 60 + 0 * t, 255 * t], 1).astype(np.uint8)
    for (x, _, z), c in zip(q[:: max(1, len(q) // 60000)], col[:: max(1, len(q) // 60000)]):
        p = to(x, z)
        if 0 <= p[0] < W and 30 <= p[1] < H + 30:
            img[p[1], p[0]] = c
    b = room["box"]
    cv2.rectangle(img, to(b["min"][0], b["min"][2]), to(b["max"][0], b["max"][2]), (40, 150, 40), 2)
    for w in room["walls"]:
        (x0, z0), (x1, z1) = w["segment"]
        cv2.line(img, to(x0, z0), to(x1, z1), (20, 20, 20), 1)
    for i, c in enumerate(cams):
        cv2.circle(img, to(c[0], c[2]), 3, (0, 0, 0), -1)
        cv2.putText(img, str(i), (to(c[0], c[2])[0] + 3, to(c[0], c[2])[1]), cv2.FONT_HERSHEY_SIMPLEX, 0.3, (0, 0, 0), 1)
    cv2.putText(img, title, (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 0), 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def truth_rooms(bid: str) -> list[tuple[float, float, float, float]]:
    """Each room's interior rectangle (x0, y0, x1, y1), read from the generator's plans."""
    import ast

    src = (ROOT / "scripts" / "eval" / "generate.py").read_text()
    node = next(n for n in ast.parse(src).body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", None) == "BASEMENTS")
    plans = eval(compile(ast.Expression(node.value), "generate.py", "eval"), {"dict": dict, "__builtins__": {}})
    return [tuple(r["rect"]) for r in next(b for b in plans if b["id"] == bid)["rooms"]]


def whole(bid: str, truth: dict, frames: int, do_plot: bool):
    """One MapAnything run over the whole take, scored against the whole basement."""
    d = frames_for(bid)
    views, _ = views_for(sent(d, 0, len(list(d.glob("*.jpg")))), frames)
    room, q, fit, cams = measure(views)
    rects = truth_rooms(bid)
    xs, ys = [v for r in rects for v in (r[0], r[2])], [v for r in rects for v in (r[1], r[3])]
    tw, td = sorted([max(xs) - min(xs), max(ys) - min(ys)], reverse=True)
    w, dd = room["widthM"], room["depthM"]
    print(f"{bid[:2]} whole ({len(views)} frames, {len(rects)} rooms)  box {w:.2f} x {dd:.2f} vs {tw:.2f} x {td:.2f} "
          f"({(w - tw) / tw * 100:+.0f}% / {(dd - td) / td * 100:+.0f}%)  walls {len(room['walls'])}  doubled {len(q['doubledWalls'])}  "
          f"pass {''.join('y' if v else 'n' if v is False else '-' for v in q['pass'].values())}  ceil {room['ceilingHeightM']}")
    if do_plot:
        plot(OUT / "plots" / f"{bid[:2]}-whole-{frames}.png", views, fit, room, cams, f"{bid} whole, {len(views)} frames: {w:.2f} x {dd:.2f} (true {tw:.2f} x {td:.2f})")
    return views, room, fit, cams


def _cams2d(views, fit):
    """Each view's camera position and forward direction on the room's floor plane (x, z)."""
    poses = np.stack([v["pose"] for v in views])
    pos = fit.to_room(poses[:, :3, 3])[:, [0, 2]]
    fwd = (poses[:, :3, 2] @ fit.rotation.T)[:, [0, 2]]
    return pos, fwd


def score_plan(rects, truth_rects):
    """Best match of our room rectangles to the true ones over the 8 turns/mirrors of the plan:
    union area IoU and the mean distance between room centres."""
    best = None
    for k in range(8):
        def tf(x, z):
            for _ in range(k % 4):
                x, z = -z, x
            return (x, -z) if k >= 4 else (x, z)
        ours = []
        for r in rects:
            (ax, az), (bx, bz) = tf(r.x0, r.z0), tf(r.x1, r.z1)
            ours.append((min(ax, bx), min(az, bz), max(ax, bx), max(az, bz)))
        oc = np.array([((a + c) / 2, (b + d) / 2) for a, b, c, d in ours])
        tc = np.array([((a + c) / 2, (b + d) / 2) for a, b, c, d in truth_rects])
        off = (tc - oc).mean(0)
        ours = [(a + off[0], b + off[1], c + off[0], d + off[1]) for a, b, c, d in ours]
        lo = np.minimum(np.min([r[:2] for r in ours + list(truth_rects)], 0), 0) - 1
        hi = np.max([r[2:] for r in ours + list(truth_rects)], 0) + 1
        g = 0.05
        shape = tuple(np.ceil((hi - lo) / g).astype(int))
        def raster(rs):
            m = np.zeros(shape, bool)
            for a, b, c, d in rs:
                m[int((a - lo[0]) / g) : int((c - lo[0]) / g), int((b - lo[1]) / g) : int((d - lo[1]) / g)] = True
            return m
        A, B = raster(ours), raster(truth_rects)
        iou = (A & B).sum() / max(1, (A | B).sum())
        err = float(np.linalg.norm(oc + off - tc, axis=1).mean())
        if best is None or iou > best[0]:
            best = (iou, err)
    return best


def composite(bid: str, truth: dict | None, frames: int, whole_frames: int, by: str, do_plot: bool, d: Path | None = None):
    """Rooms measured on their own and placed by one rough pass over the whole walk. `by`: "truth"
    uses the true room starts; "walk" cuts the walk where the camera moved on to a new area."""
    from scan3d.assemble import place, placed_rect, resolve, rot, settle, split_walk, square

    d = d or frames_for(bid)
    total = len(list(d.glob("*.jpg")))
    wv, wn = views_for(sent(d, 0, total), whole_frames)
    _, _, wfit, _ = measure(wv)
    wpos, wfwd = _cams2d(wv, wfit)
    widx = [int(n[:4]) for n in wn]
    if by == "truth":
        spans = [(round(r["startS"] * FPS), min(total, round(r["endS"] * FPS))) for r in truth["rooms"]]
    else:
        cuts = split_walk(wpos)
        edges = [0] + [widx[a] for a, _ in cuts[1:]] + [total]
        spans = list(zip(edges[:-1], edges[1:]))
    parts = []
    for lo, hi in spans:
        rv, rn = views_for(sent(d, lo, hi), frames)
        room, _, fit, _ = measure(rv)
        pos, fwd = _cams2d(rv, fit)
        parts.append((room, pos, place([int(n[:4]) for n in rn], pos, fwd, widx, wpos, wfwd)))
    S = float(np.median([pl.scale for _, _, pl in parts if pl]))
    rects, cams = [], []
    for room, pos, pl in parts:
        th = square(pl.theta) if pl else 0.0
        centre = pl.shift / S if pl else np.zeros(2)
        rects.append(placed_rect(room["widthM"], room["depthM"], th, centre))
        cams.append(pos @ rot(th).T + centre)
    kept, owner = resolve(rects, cams)
    moves = settle(kept)
    final = [rc.shift(*m) for rc, m in zip(kept, moves)]
    sizes = " ".join(f"{r.x1 - r.x0:.2f}x{r.z1 - r.z0:.2f}" for r in final)
    head = f"{bid[:2]} composite by {by}: {len(spans)} stretches {[(round(a / FPS), round(b / FPS)) for a, b in spans]} -> {len(final)} rooms [{sizes}]"
    if truth is None:
        print(head)
    else:
        truth_rects = truth_rooms(bid)
        iou, err = score_plan(final, truth_rects) if len(final) == len(truth_rects) else (score_plan_union(final, truth_rects), float("nan"))
        true_sizes = " ".join(f"{abs(c - a):.2f}x{abs(dd - b):.2f}" for a, b, c, dd in truth_rects)
        print(f"{head} vs true [{true_sizes}]  IoU {iou:.2f} centre err {err:.2f} m")
    if do_plot:
        plot_plan(OUT / "plots" / f"{bid[:2]}-composite-{by}.png", final, truth_rooms(bid) if truth else None, cams=[c for c in cams], title=head)
    return final


def plot_plan(path: Path, rects, truth_rects, cams, title: str):
    import cv2

    pts = np.concatenate([[[r.x0, r.z0], [r.x1, r.z1]] for r in rects] + list(cams))
    lo, hi = pts.min(0) - 0.6, pts.max(0) + 0.6
    px, pad = 60, 20
    W, H = int((hi[0] - lo[0]) * px) + 2 * pad, int((hi[1] - lo[1]) * px) + 2 * pad + 28
    img = np.full((H, W, 3), 250, np.uint8)
    to = lambda x, z: (int((x - lo[0]) * px) + pad, int((z - lo[1]) * px) + pad + 28)  # noqa: E731
    colours = [(200, 90, 20), (40, 150, 40), (40, 40, 220), (150, 40, 150), (20, 140, 200)]
    for i, (r, c) in enumerate(zip(rects, cams)):
        col = colours[i % len(colours)]
        cv2.rectangle(img, to(r.x0, r.z0), to(r.x1, r.z1), col, 2)
        for p in c:
            cv2.circle(img, to(*p), 2, col, -1)
    cv2.putText(img, title[:110], (6, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 0, 0), 1)
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), img)


def score_plan_union(rects, truth_rects):
    """Union IoU only, for when the room counts differ: best over the 8 turns/mirrors, aligned by
    the union's bounding-box centre."""
    best = 0.0
    for k in range(8):
        def tf(x, z):
            for _ in range(k % 4):
                x, z = -z, x
            return (x, -z) if k >= 4 else (x, z)
        ours = []
        for r in rects:
            (ax, az), (bx, bz) = tf(r.x0, r.z0), tf(r.x1, r.z1)
            ours.append((min(ax, bx), min(az, bz), max(ax, bx), max(az, bz)))
        oc = (np.min([o[:2] for o in ours], 0) + np.max([o[2:] for o in ours], 0)) / 2
        tc = (np.min([t[:2] for t in truth_rects], 0) + np.max([t[2:] for t in truth_rects], 0)) / 2
        off = tc - oc
        ours = [(a + off[0], b + off[1], c + off[0], d + off[1]) for a, b, c, d in ours]
        lo = np.min([r[:2] for r in ours + list(truth_rects)], 0) - 1
        hi = np.max([r[2:] for r in ours + list(truth_rects)], 0) + 1
        g = 0.05
        shape = tuple(np.ceil((hi - lo) / g).astype(int))
        def raster(rs):
            m = np.zeros(shape, bool)
            for a, b, c, d in rs:
                m[int((a - lo[0]) / g) : int((c - lo[0]) / g), int((b - lo[1]) / g) : int((d - lo[1]) / g)] = True
            return m
        A, B = raster(ours), raster(truth_rects)
        best = max(best, (A & B).sum() / max(1, (A | B).sum()))
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--composite", choices=["truth", "walk"], help="rooms on their own, placed by a whole-walk pass; rooms from the truth or cut from the walk")
    ap.add_argument("--whole-frames", type=int, default=64)
    ap.add_argument("--real", help="a real take's frames folder (no truth): composite only")
    ap.add_argument("--whole", action="store_true", help="one run over the whole take instead of one per room")
    ap.add_argument("--plot", action="store_true", help="write a plan view per room to tmp/eval/plots")
    ap.add_argument("--only", default="")
    ap.add_argument("--frames", type=int, default=48)
    ap.add_argument("--skip-stairs", action="store_true", help="room 1 starts where the stairs end")
    ap.add_argument("--json", help="also write rows here")
    a = ap.parse_args()
    rows = []
    for tp in sorted(EVAL.glob("*/truth.json")):
        bid = tp.parent.name
        if a.only and not any(bid.startswith(o) for o in a.only.split(",")):
            continue
        if not (tp.parent / "walkthrough.mp4").exists():
            continue
        truth = json.loads(tp.read_text())
        if a.whole:
            whole(bid, truth, a.frames, a.plot)
            continue
        if a.composite and a.real:
            break
        if a.composite:
            composite(bid, truth, a.frames, a.whole_frames, a.composite, a.plot)
            continue
        d = frames_for(bid)
        total = len(list(d.glob("*.jpg")))
        for r in truth["rooms"]:
            lo = round((truth["stairsEndS"] if a.skip_stairs and r["index"] == 0 else r["startS"]) * FPS)
            hi = min(total, round(r["endS"] * FPS))
            views, _ = views_for(sent(d, lo, hi), a.frames)
            room, q, fit, cams = measure(views)
            tw, td = sorted([r["widthM"], r["depthM"]], reverse=True)
            w, dd, c = room["widthM"], room["depthM"], room["ceilingHeightM"]
            row = {
                "room": f"{bid[:2]}/{r['index'] + 1} {r['name']}",
                "w": f"{w:.2f}/{tw} ({(w - tw) / tw * 100:+.0f}%)",
                "d": f"{dd:.2f}/{td} ({(dd - td) / td * 100:+.0f}%)",
                "ceil": f"{c if c is None else round(c, 2)}/{r['ceilingHeightM']}",
                "cands": [round(x["heightM"], 2) for x in room["ceilingCandidates"]][:5],
                "camH": round(float(np.median(cams[:, 1])), 2),
                "pass": "".join("y" if v else "n" if v is False else "-" for v in q["pass"].values()),
                "wErr": (w - tw) / tw, "dErr": (dd - td) / td, "cErr": None if c is None else c - r["ceilingHeightM"],
                "eye": truth["camera"]["eyeM"],
            }
            rows.append(row)
            if a.plot:
                plot(OUT / "plots" / f"{bid[:2]}-{r['index'] + 1}.png", views, fit, room, cams, f"{row['room']}  w {row['w']}  d {row['d']}  ceil {row['ceil']}")
            print(f"{row['room']:<26} w {row['w']:<18} d {row['d']:<18} ceil {row['ceil']:<12} camH {row['camH']} pass {row['pass']} cands {row['cands']}")
    if a.real:
        composite("real", None, a.frames, a.whole_frames, a.composite or "walk", a.plot, Path(a.real))
    if rows:
        print(f"median |w| {np.median([abs(r['wErr']) for r in rows]) * 100:.1f}%  |d| {np.median([abs(r['dErr']) for r in rows]) * 100:.1f}%  "
              f"|ceil| {np.median([abs(r['cErr']) for r in rows if r['cErr'] is not None]) * 100:.1f} cm")
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
