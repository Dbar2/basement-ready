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


def main():
    ap = argparse.ArgumentParser()
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
    if rows:
        print(f"median |w| {np.median([abs(r['wErr']) for r in rows]) * 100:.1f}%  |d| {np.median([abs(r['dErr']) for r in rows]) * 100:.1f}%  "
              f"|ceil| {np.median([abs(r['cErr']) for r in rows if r['cErr'] is not None]) * 100:.1f} cm")
    if a.json:
        Path(a.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
