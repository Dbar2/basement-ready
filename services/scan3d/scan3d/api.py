"""The HTTP contract, shared by the Modal app and the local dev server. See README.md."""

import hmac
import json
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
from .pipeline import Scanner

MAX_FRAMES_IN = 600  # 2 minutes at 5 fps, the cap in server/pipeline.ts
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
            result = await run_in_threadpool(get_scanner().scan, items, max_frames, known, max_points, skip_depth)
        except (ScanError, json.JSONDecodeError) as e:
            return error(400, str(e))

        body, media = multipart([
            ("scan", "scan.json", "application/json", json.dumps(result.scan).encode()),
            ("points", "points.ply", "application/octet-stream", result.points_ply),
            ("depth", "depth.bin", "application/octet-stream", result.depth_bin),
        ])
        return Response(body, media_type=media)

    return app
