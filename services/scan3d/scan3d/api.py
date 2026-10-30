"""The HTTP contract, shared by the Modal app and the local dev server. See README.md."""

import hmac
import json

import numpy as np
import os
import secrets
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Callable
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from . import MODEL_ID, MODEL_REVISION, ScanError
from .export import read_ply
from .floorplan import floor_plan
from .mesh import MAX_FACES
from .pipeline import Scanner
from .texture import decode as decode_image
from .texture import paint

MAX_FRAMES_IN = 900  # 3 minutes at 5 fps, the cap in server/pipeline.ts
MAX_FRAME_BYTES = 10 * 1024 * 1024
DEFAULT_FRAMES = 48


def multipart(parts: list[tuple[str, str | None, str, bytes]]) -> tuple[bytes, str]:
    """(name, filename or None for a text field, content type, body) parts -> multipart/form-data body
    and its content type."""
    boundary = "scan3d-" + secrets.token_hex(12)
    out = bytearray()
    for name, filename, ctype, body in parts:
        fname = f'; filename="{filename}"' if filename else ""
        out += (
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"{fname}\r\n'
            f"Content-Type: {ctype}\r\n\r\n"
        ).encode()
        out += body + b"\r\n"
    out += f"--{boundary}--\r\n".encode()
    return bytes(out), f"multipart/form-data; boundary={boundary}"


def _fetch(url: str) -> tuple[str, bytes]:
    if urlparse(url).scheme not in ("http", "https"):
        raise ScanError(f"frame URL must be http(s): {url[:80]}")
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            data = r.read(MAX_FRAME_BYTES + 1)
    except OSError as e:
        raise ScanError(f"couldn't fetch frame {url[:80]}: {e}") from e
    if len(data) > MAX_FRAME_BYTES:
        raise ScanError(f"frame too large: {url[:80]}")
    return os.path.basename(urlparse(url).path) or url, data


def _cameras(raw, n: int):
    """Checked known cameras: a list with one {intrinsics 3x3, pose 4x4} or null per frame, or None."""
    if raw is None:
        return None
    if not isinstance(raw, list) or len(raw) != n:
        raise ScanError("cameras must be a list with one entry per frame (null where unknown)")
    out = []
    for c in raw:
        if c is None:
            out.append(None)
            continue
        try:
            k, pose = np.asarray(c["intrinsics"], float), np.asarray(c["pose"], float)
        except (KeyError, TypeError, ValueError) as e:
            raise ScanError("each camera needs intrinsics (3x3) and pose (4x4)") from e
        if k.shape != (3, 3) or pose.shape != (4, 4) or not (np.isfinite(k).all() and np.isfinite(pose).all()):
            raise ScanError("each camera needs intrinsics (3x3) and pose (4x4)")
        out.append({"intrinsics": k, "pose": pose})
    return out


def create_app(get_scanner: Callable[[], Scanner | None], token: str, max_frames_cap: int = 64) -> FastAPI:
    if not token:
        raise ValueError("a bearer token is required (SCAN3D_TOKEN)")
    app = FastAPI(title="Basement Ready scan3d", docs_url=None, redoc_url=None, openapi_url=None)

    def authorized(request: Request) -> bool:
        header = request.headers.get("authorization", "")
        return header.startswith("Bearer ") and hmac.compare_digest(header[7:].encode(), token.encode())

    def error(status: int, message: str) -> JSONResponse:
        return JSONResponse({"error": message}, status_code=status)

    @app.get("/health")
    def health(request: Request):
        # Also the warm-up call: on Modal, hitting it boots a GPU container and loads the model.
        if not authorized(request):
            return error(401, "missing or wrong bearer token")
        scanner = get_scanner()
        return {"ok": True, "model": MODEL_ID, "revision": MODEL_REVISION, "device": scanner.device if scanner else "cpu", "maxFrames": max_frames_cap}

    @app.post("/scan")
    async def scan(request: Request):
        if not authorized(request):
            return error(401, "missing or wrong bearer token")
        ctype = request.headers.get("content-type", "")
        try:
            if ctype.startswith("multipart/form-data"):
                form = await request.form(max_files=MAX_FRAMES_IN + 1, max_fields=10)
                raw = form.get("options") or "{}"
                options = json.loads(raw if isinstance(raw, str) else await raw.read())  # text field or Blob
                # Known cameras from the phone's tracking, one per frame part (see docs/capture-contract.md).
                raw_cams = form.get("cameras")
                if raw_cams is not None:
                    options["cameras"] = json.loads(raw_cams if isinstance(raw_cams, str) else await raw_cams.read())
                uploads = form.getlist("frames")
                if len(uploads) > MAX_FRAMES_IN:
                    return error(413, f"at most {MAX_FRAMES_IN} frames per scan")
                items = []
                for u in uploads:
                    if isinstance(u, str):
                        raise ScanError("'frames' must be file parts")
                    items.append((u.filename or f"{len(items):04d}.jpg", await u.read()))
            elif ctype.startswith("application/json"):
                options = await request.json()
                urls = options.get("frameUrls") or []
                if len(urls) > MAX_FRAMES_IN:
                    return error(413, f"at most {MAX_FRAMES_IN} frames per scan")
                with ThreadPoolExecutor(max_workers=16) as pool:
                    items = await run_in_threadpool(lambda: list(pool.map(_fetch, urls)))
            else:
                return error(415, "send multipart/form-data (frames + options) or application/json (frameUrls)")
            if not isinstance(options, dict):
                raise ScanError("options must be a JSON object")
            try:
                max_frames = max(2, min(int(options.get("maxFrames") or DEFAULT_FRAMES), max_frames_cap))
            except (TypeError, ValueError) as e:
                raise ScanError("maxFrames must be a number") from e
            known = options.get("known") or {}
            if not isinstance(known, dict):
                raise ScanError("known must be an object, e.g. {\"floorToJoistsM\": 2.1}")
            # Live previews while filming ask for a small cloud and no depth.
            try:
                max_points = int(options.get("maxPoints") or 300_000)
            except (TypeError, ValueError) as e:
                raise ScanError("maxPoints must be a number") from e
            skip_depth = bool(options.get("skipDepth"))
            try:
                max_faces = max(20_000, min(int(options.get("maxFaces") or MAX_FACES), MAX_FACES))
            except (TypeError, ValueError) as e:
                raise ScanError("maxFaces must be a number") from e
            cameras = _cameras(options.get("cameras"), len(items))
            scanner = get_scanner()
            if scanner is None:
                return error(503, "this endpoint only paints (POST /texture)")
            result = await run_in_threadpool(scanner.scan, items, max_frames, known, max_points, skip_depth, cameras, max_faces)
        except (ScanError, json.JSONDecodeError) as e:
            return error(400, str(e))

        body, media = multipart([
            ("scan", "scan.json", "application/json", json.dumps(result.scan).encode()),
            ("points", "points.ply", "application/octet-stream", result.points_ply),
            ("depth", "depth.bin", "application/octet-stream", result.depth_bin),
            *([("surfels", "surfels.bin", "application/octet-stream", result.surfels)] if result.surfels else []),
            *([("mesh", "mesh.bin", "application/octet-stream", result.mesh)] if result.mesh else []),
        ])
        return Response(body, media_type=media)

    @app.post("/floorplan")
    async def floorplan(request: Request):
        """The whole basement's floor plan from areas already scanned with known cameras: multipart
        `areas` (JSON list of {world: {rotation, origin}, factor}), one `points` PLY per area in the same
        order (each in its room frame), and `cameras` (JSON list of camera centres in the world)."""
        if not authorized(request):
            return error(401, "missing or wrong bearer token")
        try:
            form = await request.form(max_files=64, max_fields=10)
            areas = json.loads(form.get("areas") or "[]")
            cams = np.asarray(json.loads(form.get("cameras") or "[]"), float).reshape(-1, 3)
            plys = form.getlist("points")
            if not areas or len(plys) != len(areas) or len(cams) < 3:
                raise ScanError("send areas, one points PLY per area, and at least 3 cameras")
            pts = []
            for a, ply in zip(areas, plys):
                v = read_ply(await ply.read())
                room = np.stack([v["x"], v["y"], v["z"]], 1).astype(float) / float(a.get("factor") or 1.0)
                R, o = np.asarray(a["world"]["rotation"], float), np.asarray(a["world"]["origin"], float)
                pts.append(room @ R + o)
            fp = await run_in_threadpool(floor_plan, np.concatenate(pts), cams)
        except (ScanError, json.JSONDecodeError, KeyError, ValueError) as e:
            return error(400, str(e))
        return JSONResponse({
            "rotation": fp.rotation,
            "floorY": fp.floor_y,
            "ceilingY": fp.ceiling_y,
            "footprintM2": fp.footprint_m2,
            "rooms": [{"box": r.box, "outline": r.outline, "areaM2": r.area_m2, "cameras": r.cameras, "sides": r.walls} for r in fp.rooms],
        })

    @app.post("/texture")
    async def texture(request: Request):
        """Paint the as-built model with the frames (scan3d/texture.py): multipart `job` (JSON: surfaces,
        occluders, cameras, options, depthShapes), `frames` (images, in the order the cameras' `image`
        index them) and `depth` (raw float16, one per depthShapes entry). Replies multipart: `index`
        (the atlas index) and one JPEG part per atlas size."""
        if not authorized(request):
            return error(401, "missing or wrong bearer token")
        try:
            form = await request.form(max_files=MAX_FRAMES_IN + 64, max_fields=10)
            raw = form.get("job")
            if raw is None:
                raise ScanError("send a job")
            job = json.loads(raw if isinstance(raw, str) else await raw.read())
            if not isinstance(job, dict) or not job.get("surfaces") or not job.get("cameras"):
                raise ScanError("the job needs surfaces and cameras")
            images = [decode_image(await f.read()) for f in form.getlist("frames") if not isinstance(f, str)]
            shapes = job.get("depthShapes") or []
            depths = []
            for f, shape in zip([f for f in form.getlist("depth") if not isinstance(f, str)], shapes):
                depths.append(np.frombuffer(await f.read(), "<f2").reshape(shape))
            if any(not (0 <= c.get("image", -1) < len(images)) for c in job["cameras"]):
                raise ScanError("every camera's image must be one of the frames sent")
            index, files = await run_in_threadpool(paint, job, images, depths)
        except (ScanError, json.JSONDecodeError, KeyError, ValueError) as e:
            return error(400, str(e))
        body, media = multipart([
            ("index", "index.json", "application/json", json.dumps(index).encode()),
            *[(name, name, "image/jpeg", data) for name, data in files.items()],
        ])
        return Response(body, media_type=media)

    return app
