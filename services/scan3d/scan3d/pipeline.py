"""One scan: frames in, measured room + point cloud + per-frame depth lookup out."""

import os
import tempfile
import threading
import time
from dataclasses import dataclass

import numpy as np

from . import MODEL_CODE_TAG, MODEL_ID, MODEL_REVISION, ScanError
from .export import depth_bytes, ply_bytes
from .frames import crop_for, load_frames, model_size, select_sharpest
from .room import describe, fit_room

FIT_VOXEL = 0.02  # m, voxel grid for plane fitting and the exported cloud (research note: 2 cm)
MAX_POINTS = 300_000
CONF_PERCENTILE = 20  # drop each view's least confident 20% of pixels (research note)
MAX_MEASUREMENT_RATIO = 1.5  # a tape number this far from the model's estimate is probably a typo


@dataclass
class ScanResult:
    scan: dict
    points_ply: bytes
    depth_bin: bytes


def _voxel_keep(pts: np.ndarray, voxel: float, order: np.ndarray) -> np.ndarray:
    """Indices of one point per voxel: the first one in `order` (highest confidence first)."""
    keys = np.floor(pts[order] / voxel).astype(np.int64)
    keys -= keys.min(0)
    packed = (keys[:, 0] << 42) | (keys[:, 1] << 21) | keys[:, 2]
    _, first = np.unique(packed, return_index=True)
    return order[first]


def view_points(views: list[dict]):
    """World points for every confident pixel, with the exact formula the Node lookup uses."""
    H, W = views[0]["depth"].shape
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float32)
    pts, rgb, fid, conf, masks = [], [], [], [], []
    for i, v in enumerate(views):
        valid = v["mask"] & (v["depth"] > 0)
        if valid.any():
            valid &= v["conf"] >= np.percentile(v["conf"][valid], CONF_PERCENTILE)
        masks.append(valid)
        K, z = v["K"], v["depth"][valid]
        cam = np.stack([(uu[valid] - K[0, 2]) * z / K[0, 0], (vv[valid] - K[1, 2]) * z / K[1, 1], z], 1)
        pts.append(cam @ v["pose"][:3, :3].T + v["pose"][:3, 3])
        rgb.append(v["rgb"][valid])
        fid.append(np.full(len(z), i, np.uint16))
        conf.append(v["conf"][valid])
    return (*(np.concatenate(a) for a in (pts, rgb, fid, conf)), masks)


class Scanner:
    def __init__(self, model, device: str):
        self.model = model
        self.device = device
        self.lock = threading.Lock()  # one GPU, one scan at a time

    @classmethod
    def load(cls, device: str | None = None) -> "Scanner":
        import torch
        from mapanything.models import MapAnything
        from mapanything.utils.device import get_device

        dev = get_device(device)
        model = MapAnything.from_pretrained(MODEL_ID, revision=MODEL_REVISION).to(dev).eval()
        torch.set_grad_enabled(False)
        return cls(model, dev.type)

    def _infer(self, frame_bytes: list[bytes]) -> list[dict]:
        import torch
        from mapanything.utils.image import load_images

        with tempfile.TemporaryDirectory() as tmp:
            paths = []
            for i, data in enumerate(frame_bytes):
                paths.append(os.path.join(tmp, f"{i:04d}.jpg"))
                with open(paths[-1], "wb") as f:
                    f.write(data)
            views = load_images(paths)
        with self.lock, torch.inference_mode():
            preds = self.model.infer(
                views,
                memory_efficient_inference=True,
                use_amp=True,
                amp_dtype="bf16",  # falls back to fp16 on MPS
                apply_mask=True,
                mask_edges=True,
            )
        out = []
        for p in preds:
            out.append({
                "depth": p["depth_z"][0, ..., 0].float().cpu().numpy(),
                "conf": p["conf"][0].float().cpu().numpy(),
                "mask": p["mask"][0, ..., 0].cpu().numpy().astype(bool),
                "K": p["intrinsics"][0].float().cpu().numpy(),
                "pose": p["camera_poses"][0].float().cpu().numpy(),
                "rgb": (p["img_no_norm"][0].float().cpu().numpy().clip(0, 1) * 255).round().astype(np.uint8),
                "metric_scale": float(p["metric_scaling_factor"].flatten()[0]) if "metric_scaling_factor" in p else None,
            })
        return out

    def scan(self, items: list[tuple[str, bytes]], max_frames: int = 48, known: dict | None = None) -> ScanResult:
        t0 = time.perf_counter()
        timings = {}
        known = {k: v for k, v in (known or {}).items() if v is not None}
        tape = known.get("floorToJoistsM")
        if tape is not None and not (1.0 <= float(tape) <= 4.0):
            raise ScanError("floorToJoistsM must be between 1.0 and 4.0 metres")
        if not items:
            raise ScanError("send at least 1 frame (40-60 recommended)")

        frames = load_frames(items)
        picked = select_sharpest(frames, max_frames)
        target = model_size(picked)
        timings["decodeS"] = time.perf_counter() - t0

        t = time.perf_counter()
        views = self._infer([f.data for f in picked])
        timings["inferS"] = time.perf_counter() - t

        t = time.perf_counter()
        n = len(views)
        H, W = views[0]["depth"].shape
        pts, rgb, fid, conf, valid_masks = view_points(views)
        if len(pts) < 1000:
            raise ScanError("the model found almost no usable depth in these frames")
        keep = _voxel_keep(pts, FIT_VOXEL, np.argsort(-conf, kind="stable"))
        poses = np.stack([v["pose"] for v in views])
        fit = fit_room(pts[keep], fid[keep].astype(np.int64), n, poses[:, :3, 3], poses[:, :3, :3])
        timings["fitS"] = time.perf_counter() - t

        # Scale: the model's own metric guess, or one tape measurement of floor to joists.
        warnings = list(fit.warnings)
        model_height = fit.ceiling["height"] if fit.ceiling else None
        s, source = 1.0, "model"
        if tape is not None:
            if model_height is None:
                warnings.append("Couldn't use floorToJoistsM: no ceiling plane was found, so sizes stay model estimates.")
            else:
                ratio = float(tape) / model_height
                if not (1 / MAX_MEASUREMENT_RATIO <= ratio <= MAX_MEASUREMENT_RATIO):
                    warnings.append(f"floorToJoistsM ({tape} m) is {ratio:.2f}x the scan's estimate ({model_height:.2f} m); check the tape number.")
                s, source = ratio, "user_measurement"
        if source == "model":
            # Research note: images-only metric scale is typically 10-25% off indoors.
            scale = {"source": "model", "factor": 1.0, "confidence": "low", "expectedErrorPct": 20}
        else:
            # 3.5% is the paper's depth error once scale is aligned (ScanNet); worse if the ceiling wanders.
            spread = fit.ceiling["spread"]
            pct = 3.5 if spread is not None and spread * s <= 0.05 else 6.0
            scale = {"source": "user_measurement", "factor": round(s, 4), "confidence": "high" if pct <= 3.5 else "medium", "expectedErrorPct": pct}
        scale["modelCeilingHeightM"] = round(model_height, 3) if model_height else None
        scale["modelMetricScale"] = views[0]["metric_scale"]
        scale["known"] = known
        if n == 1:
            warnings.append("Single frame: one view can't confirm walls, the floor or scale.")

        # Everything below is in the room frame, scaled.
        t = time.perf_counter()
        room, quality = describe(fit, s)
        quality["warnings"] = warnings
        R, o = fit.rotation, fit.origin
        cloud = keep
        if len(cloud) > MAX_POINTS:
            cloud = np.random.default_rng(0).choice(cloud, MAX_POINTS, replace=False)
        cloud = cloud[np.argsort(fid[cloud], kind="stable")]  # capture order, for the fly-in reveal
        xyz = (fit.to_room(pts[cloud]) * s).astype(np.float32)
        ply = ply_bytes(xyz, rgb[cloud], fid[cloud])

        depths, frames_json = [], []
        for i, (f, v) in enumerate(zip(picked, views)):
            pose = np.eye(4)
            pose[:3, :3] = R @ v["pose"][:3, :3]
            pose[:3, 3] = s * (R @ (v["pose"][:3, 3] - o))
            depths.append(np.where(valid_masks[i], v["depth"] * s, 0).astype(np.float16))
            frames_json.append({
                "index": i,
                "sourceIndex": f.source_index,
                "name": f.name,
                "width": f.width,
                "height": f.height,
                "sharpness": round(f.sharpness, 1),
                "model": crop_for(f.width, f.height, target),
                "intrinsics": np.round(v["K"], 4).tolist(),
                "pose": np.round(pose, 5).tolist(),
                "validFraction": round(float(valid_masks[i].mean()), 3),
                "depthOffset": i * H * W * 2,
            })
        depth = depth_bytes(depths)
        timings["exportS"] = time.perf_counter() - t
        timings["totalS"] = time.perf_counter() - t0

        scan = {
            "version": 1,
            "units": "m",
            "coordinateFrame": "room: origin on the floor under the room box centre, +Y up, X along the longer side, Z = X cross Y (right-handed, three.js). Camera poses are camera-to-room with OpenCV camera axes (x right, y down, z forward).",
            "model": {"id": MODEL_ID, "revision": MODEL_REVISION, "code": MODEL_CODE_TAG, "device": self.device},
            "scaleSource": source,
            "scale": scale,
            "room": room,
            "quality": quality,
            "framesReceived": len(frames),
            "frames": frames_json,
            "files": {
                "points": {
                    "part": "points",
                    "filename": "points.ply",
                    "format": "binary_little_endian PLY",
                    "count": int(len(cloud)),
                    "properties": ["x:float32", "y:float32", "z:float32", "red:uint8", "green:uint8", "blue:uint8", "frame:uint16"],
                },
                "depth": {
                    "part": "depth",
                    "filename": "depth.bin",
                    "dtype": "float16",
                    "byteOrder": "little",
                    "shape": [n, H, W],
                    "invalid": 0,
                },
            },
            "timings": {k: round(v, 2) for k, v in timings.items()},
        }
        return ScanResult(scan, ply, depth)
