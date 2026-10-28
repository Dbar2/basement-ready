"""Binary outputs, plus the reference pixel-to-3D lift the Node worker mirrors."""

import numpy as np


def ply_bytes(xyz: np.ndarray, rgb: np.ndarray, frame: np.ndarray) -> bytes:
    """Binary PLY that three.js PLYLoader and Blender open as-is."""
    v = np.empty(len(xyz), dtype=[("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("red", "u1"), ("green", "u1"), ("blue", "u1"), ("frame", "<u2")])
    v["x"], v["y"], v["z"] = xyz[:, 0], xyz[:, 1], xyz[:, 2]
    v["red"], v["green"], v["blue"] = rgb[:, 0], rgb[:, 1], rgb[:, 2]
    v["frame"] = frame
    header = (
        "ply\nformat binary_little_endian 1.0\ncomment basement-ready scan3d, metres, room frame (+Y up)\n"
        f"element vertex {len(v)}\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\n"
        "property ushort frame\nend_header\n"
    )
    return header.encode() + v.tobytes()


def read_ply(data: bytes) -> np.ndarray:
    end = data.index(b"end_header\n") + len(b"end_header\n")
    dt = [("x", "<f4"), ("y", "<f4"), ("z", "<f4"), ("red", "u1"), ("green", "u1"), ("blue", "u1"), ("frame", "<u2")]
    return np.frombuffer(data[end:], dtype=dt)


def depth_bytes(depths: list[np.ndarray]) -> bytes:
    return np.stack(depths).astype("<f2").tobytes()


def lift_box(scan: dict, depth_bin: bytes, frame: int, box: dict, erode_px: int = 2) -> dict | None:
    """3D points under a SAM box on one frame, and their robust extent.

    box is {x, y, w, h} as 0..1 of the original frame, the shape server/pipeline.ts uses.
    Returns None when no pixel under the box has depth.
    """
    f = scan["frames"][frame]
    n, H, W = scan["files"]["depth"]["shape"]
    depth = np.frombuffer(depth_bin, "<f2", count=H * W, offset=f["depthOffset"]).reshape(H, W).astype(np.float32)
    m = f["model"]
    # Original frame (0..1) -> model pixel grid, then shrink by a couple of pixels to skip edges.
    u0 = int(np.ceil(box["x"] * m["resizedWidth"] - m["cropLeft"])) + erode_px
    v0 = int(np.ceil(box["y"] * m["resizedHeight"] - m["cropTop"])) + erode_px
    u1 = int(np.floor((box["x"] + box["w"]) * m["resizedWidth"] - m["cropLeft"])) - erode_px
    v1 = int(np.floor((box["y"] + box["h"]) * m["resizedHeight"] - m["cropTop"])) - erode_px
    u0, v0, u1, v1 = max(u0, 0), max(v0, 0), min(u1, W - 1), min(v1, H - 1)
    if u1 < u0 or v1 < v0:
        return None
    vv, uu = np.mgrid[v0 : v1 + 1, u0 : u1 + 1]
    z = depth[v0 : v1 + 1, u0 : u1 + 1]
    ok = z > 0
    if not ok.any():
        return None
    K, pose = np.array(f["intrinsics"]), np.array(f["pose"])
    z, uu, vv = z[ok], uu[ok], vv[ok]
    cam = np.stack([(uu - K[0, 2]) * z / K[0, 0], (vv - K[1, 2]) * z / K[1, 1], z], 1)
    pts = cam @ pose[:3, :3].T + pose[:3, 3]
    return {
        "count": int(len(pts)),
        "median": np.median(pts, 0).round(3).tolist(),
        "p05": np.percentile(pts, 5, 0).round(3).tolist(),
        "p95": np.percentile(pts, 95, 0).round(3).tolist(),
    }
