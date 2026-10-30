"""Local runner for development on Apple Silicon (MPS). Not for serving.

    python run_local.py scan  FRAMES_DIR_OR_VIDEO --out OUT [--max-frames 16] [--floor-to-joists 2.10] [--preview]
    python run_local.py serve [--port 8790]                     # same HTTP API as Modal, on localhost
    python run_local.py serve --port 8791 --no-model            # /floorplan and /texture only: no model, no GPU
    python run_local.py post  URL FRAMES_DIR_OR_VIDEO --out OUT  # call any scan3d server, unpack the reply

scan and serve load MapAnything on MPS (or --device cpu). post only needs the frames.
The bearer token comes from SCAN3D_TOKEN.
"""

import argparse
import json
import os
import secrets
import subprocess
import sys
import tempfile
import time
import urllib.request
from email.parser import BytesParser
from email.policy import default
from pathlib import Path

LOCAL_MAX_FRAMES = 48  # about 10 GB on an M3 Pro; 24 measured rooms much worse


def read_frames(src: str) -> list[tuple[str, bytes]]:
    """Frames from a folder of JPEG/PNG, or from a video at 5 fps, long side 1280 (server/pipeline.ts)."""
    path = Path(src)
    if path.is_file():
        tmp = Path(tempfile.mkdtemp(prefix="scan3d-frames-"))
        vf = "fps=5,scale='if(gt(iw,ih),1280,-2)':'if(gt(iw,ih),-2,1280)'"
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(path), "-t", "180", "-vf", vf, "-q:v", "3", "-start_number", "0", str(tmp / "%04d.jpg")], check=True)
        path = tmp
    files = sorted(p for p in path.iterdir() if p.suffix.lower() in (".jpg", ".jpeg", ".png"))
    if not files:
        sys.exit(f"no frames in {src}")
    return [(p.name, p.read_bytes()) for p in files]


def write_outputs(out: Path, scan: dict, ply: bytes, depth: bytes, preview: bool):
    out.mkdir(parents=True, exist_ok=True)
    (out / "scan.json").write_text(json.dumps(scan, indent=2))
    (out / "points.ply").write_bytes(ply)
    (out / "depth.bin").write_bytes(depth)
    if preview:
        import cv2

        from scan3d.preview import render

        cv2.imwrite(str(out / "preview.png"), render(scan, ply))
    room, q = scan["room"], scan["quality"]
    print(json.dumps({
        "out": str(out),
        "frames": f"{len(scan['frames'])} of {scan['framesReceived']}",
        "timings": scan["timings"],
        "scaleSource": scan["scaleSource"],
        "scale": {k: scan["scale"][k] for k in ("factor", "confidence", "expectedErrorPct", "modelMetricScale")},
        "ceilingHeightM": room["ceilingHeightM"],
        "widthM": room["widthM"],
        "depthM": room["depthM"],
        "walls": len(room["walls"]),
        "sides": room["box"]["sides"],
        "points": scan["files"]["points"]["count"],
        "pass": q["pass"],
        "warnings": q["warnings"],
    }, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("scan", "post"):
        p = sub.add_parser(name)
        if name == "post":
            p.add_argument("url", help="server base URL, e.g. http://127.0.0.1:8790 or the Modal URL")
        p.add_argument("frames", help="folder of frames, or a video file")
        p.add_argument("--out", required=True)
        p.add_argument("--max-frames", type=int, default=16 if name == "scan" else 48)
        p.add_argument("--floor-to-joists", type=float, help="tape measurement, floor to underside of joists, metres")
        p.add_argument("--preview", action="store_true", help="also write preview.png (plan + side view)")
        if name == "scan":
            p.add_argument("--device", help="mps (default when available) or cpu")
    p = sub.add_parser("serve")
    p.add_argument("--port", type=int, default=8790)
    p.add_argument("--device")
    p.add_argument("--no-model", action="store_true", help="serve /floorplan and /texture only, without loading MapAnything (no GPU)")
    args = ap.parse_args()

    if args.cmd == "scan":
        from scan3d.pipeline import Scanner

        if args.max_frames > LOCAL_MAX_FRAMES:
            print(f"capping at {LOCAL_MAX_FRAMES} frames for the Mac", file=sys.stderr)
        items = read_frames(args.frames)
        t = time.perf_counter()
        scanner = Scanner.load(args.device)
        print(f"model loaded on {scanner.device} in {time.perf_counter() - t:.1f}s", file=sys.stderr)
        known = {"floorToJoistsM": args.floor_to_joists} if args.floor_to_joists else {}
        r = scanner.scan(items, min(args.max_frames, LOCAL_MAX_FRAMES), known)
        write_outputs(Path(args.out), r.scan, r.points_ply, r.depth_bin, args.preview)

    elif args.cmd == "serve":
        import uvicorn

        from scan3d.api import create_app
        from scan3d.pipeline import Scanner

        token = os.environ.get("SCAN3D_TOKEN") or secrets.token_hex(16)
        if "SCAN3D_TOKEN" not in os.environ:
            print(f"SCAN3D_TOKEN not set; using {token} for this run", file=sys.stderr)
        scanner = None if args.no_model else Scanner.load(args.device)
        app = create_app(lambda: scanner, token, max_frames_cap=LOCAL_MAX_FRAMES)
        uvicorn.run(app, host="127.0.0.1", port=args.port)

    else:
        from scan3d.api import multipart

        token = os.environ.get("SCAN3D_TOKEN") or sys.exit("set SCAN3D_TOKEN")
        options = {"maxFrames": args.max_frames, "known": {"floorToJoistsM": args.floor_to_joists} if args.floor_to_joists else {}}
        parts = [("options", None, "application/json", json.dumps(options).encode())]
        parts += [("frames", name, "image/jpeg", data) for name, data in read_frames(args.frames)]
        body, ctype = multipart(parts)
        req = urllib.request.Request(args.url.rstrip("/") + "/scan", data=body, method="POST", headers={"Content-Type": ctype, "Authorization": f"Bearer {token}"})
        t = time.perf_counter()
        with urllib.request.urlopen(req, timeout=900) as resp:
            reply = resp.read()
            reply_type = resp.headers["content-type"]
        print(f"round trip {time.perf_counter() - t:.1f}s, {len(body) / 1e6:.1f} MB up, {len(reply) / 1e6:.1f} MB down", file=sys.stderr)
        msg = BytesParser(policy=default).parsebytes(f"Content-Type: {reply_type}\r\n\r\n".encode() + reply)
        got = {p.get_param("name", header="content-disposition"): p.get_content() for p in msg.iter_parts()}
        write_outputs(Path(args.out), json.loads(got["scan"]), got["points"], got["depth"], args.preview)


if __name__ == "__main__":
    main()
