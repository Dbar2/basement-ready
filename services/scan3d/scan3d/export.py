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


SURFELS_MAGIC = b"BRS1"


def surfel_bytes(xyz: np.ndarray, rgb: np.ndarray, size_m: np.ndarray, frame: np.ndarray) -> bytes:
    """Dense surface points for the photo-like view, as four packed arrays after an 8-byte header
    ("BRS1", uint32 count): positions int16 x3 in millimetres (room frame), colours uint8 x3,
    footprint uint8 in millimetres (the patch of surface one point covers), frame uint16."""
    n = len(xyz)
    pos = np.clip(np.round(xyz * 1000), -32767, 32767).astype("<i2")
    size = np.clip(np.round(size_m * 1000), 1, 255).astype("u1")
    return SURFELS_MAGIC + np.uint32(n).astype("<u4").tobytes() + pos.tobytes() + rgb.astype("u1").tobytes() + size.tobytes() + frame.astype("<u2").tobytes()


def read_surfels(data: bytes) -> dict:
    assert data[:4] == SURFELS_MAGIC
    n = int(np.frombuffer(data, "<u4", 1, 4)[0])
    o = 8
    pos = np.frombuffer(data, "<i2", n * 3, o).reshape(n, 3).astype(np.float32) / 1000
    o += n * 6
    rgb = np.frombuffer(data, "u1", n * 3, o).reshape(n, 3)
    o += n * 3
    size = np.frombuffer(data, "u1", n, o).astype(np.float32) / 1000
    o += n
    frame = np.frombuffer(data, "<u2", n, o)
    return {"xyz": pos, "rgb": rgb, "size": size, "frame": frame}


MESH_MAGIC = b"BRM1"


def mesh_bytes(verts: np.ndarray, faces: np.ndarray, rgb: np.ndarray) -> bytes:
    """A coloured triangle mesh after a 12-byte header ("BRM1", uint32 vertex count, uint32 face count):
    faces uint32 x3, positions int16 x3 in millimetres (room frame), colours uint8 x3."""
    pos = np.clip(np.round(verts * 1000), -32767, 32767).astype("<i2")
    head = MESH_MAGIC + np.array([len(verts), len(faces)], "<u4").tobytes()
    return head + faces.astype("<u4").tobytes() + pos.tobytes() + rgb.astype("u1").tobytes()


def read_mesh(data: bytes) -> dict:
    assert data[:4] == MESH_MAGIC
    nv, nf = (int(x) for x in np.frombuffer(data, "<u4", 2, 4))
    o = 12
    faces = np.frombuffer(data, "<u4", nf * 3, o).reshape(nf, 3)
    o += nf * 12
    verts = np.frombuffer(data, "<i2", nv * 3, o).reshape(nv, 3).astype(np.float32) / 1000
    o += nv * 6
    rgb = np.frombuffer(data, "u1", nv * 3, o).reshape(nv, 3)
    return {"verts": verts, "faces": faces, "rgb": rgb}


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
