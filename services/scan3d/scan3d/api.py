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
from .planapi import respond
from .mesh import MAX_FACES
from .pipeline import Scanner

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


def create_app(get_scanner: Callable[[], Scanner], token: str, max_frames_cap: int = 64) -> FastAPI:
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
        return {"ok": True, "model": MODEL_ID, "revision": MODEL_REVISION, "device": scanner.device, "maxFrames": max_frames_cap}

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
            result = await run_in_threadpool(get_scanner().scan, items, max_frames, known, max_points, skip_depth, cameras, max_faces)
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
        """The whole basement's floor plan from areas already scanned (scan3d/planapi.py): multipart `areas`
        (JSON list, one per area: {world: {rotation, origin}, factor} or {placement}, plus `frames` and
        `depthShape` when its depth is sent), one `points` PLY per area in the same order (each in its room
        frame), optionally one `depth` part per area (float16), `cameras` (JSON list of camera centres in
        the world), `hints` (SAM's finds in the world), `edits` (typed corrections to check), and with
        `render`: `keyframes` JPEGs and `keyframeCams` (JSON {pose, intrinsics} per keyframe) for the
        pictures Spark reads."""
        if not authorized(request):
            return error(401, "missing or wrong bearer token")
        try:
            form = await request.form(max_files=128, max_fields=20)
            areas = json.loads(form.get("areas") or "[]")
            cams = np.asarray(json.loads(form.get("cameras") or "[]"), float).reshape(-1, 3)
            plys = [await f.read() for f in form.getlist("points")]
            depths = [await f.read() for f in form.getlist("depth")]
            hints = json.loads(form.get("hints") or "{}")
            edits = json.loads(form.get("edits") or "[]")
            render = str(form.get("render") or "") in ("1", "true")
            keyframes = [await f.read() for f in form.getlist("keyframes")]
            key_cams = json.loads(form.get("keyframeCams") or "[]")
            if not areas or len(plys) != len(areas) or len(cams) < 3:
                raise ScanError("send areas, one points PLY per area, and at least 3 cameras")
            if not isinstance(hints, dict) or not isinstance(edits, list):
                raise ScanError("hints must be an object and edits a list")
            out = await run_in_threadpool(respond, areas, plys, depths or None, cams, hints, edits, keyframes, key_cams, render)
        except (ScanError, json.JSONDecodeError, KeyError, ValueError, TypeError) as e:
            return error(400, str(e))
        return JSONResponse(out)

    return app
