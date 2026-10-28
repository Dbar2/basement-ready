"""Frame intake: decode, score sharpness, keep the sharpest frame in each slice of the walk."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from math import floor

import cv2
import numpy as np

from . import ScanError

# MapAnything resizes every view to one fixed size per aspect ratio (518 px long side).
# Mirrors mapanything.utils.image.RESOLUTION_MAPPINGS[518] so the crop math below is exact.
MODEL_SIZES = {
    1.000: (518, 518),
    1.321: (518, 392),
    1.542: (518, 336),
    1.762: (518, 294),
    2.056: (518, 252),
    3.083: (518, 168),
    0.757: (392, 518),
    0.649: (336, 518),
    0.567: (294, 518),
    0.486: (252, 518),
}


@dataclass
class Frame:
    source_index: int  # position in the request, so the caller can map back to its own frame ids
    name: str
    data: bytes
    width: int
    height: int
    sharpness: float


def _decode(index: int, name: str, data: bytes) -> Frame:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ScanError(f"frame {index} ({name}) is not a readable image")
    h, w = img.shape[:2]
    # Variance of the Laplacian at a fixed working size, so scores compare across frames.
    k = 640 / max(w, h)
    gray = cv2.cvtColor(cv2.resize(img, (round(w * k), round(h * k)), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    sharp = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return Frame(index, name, data, w, h, sharp)


def load_frames(items: list[tuple[str, bytes]]) -> list[Frame]:
    with ThreadPoolExecutor(max_workers=8) as pool:
        return list(pool.map(lambda a: _decode(a[0], *a[1]), enumerate(items)))


def select_sharpest(frames: list[Frame], max_frames: int) -> list[Frame]:
    """Split the capture into max_frames equal windows and keep the sharpest frame of each."""
    if len(frames) <= max_frames:
        return frames
    edges = np.linspace(0, len(frames), max_frames + 1)
    return [max(frames[floor(a) : floor(b)], key=lambda f: f.sharpness) for a, b in zip(edges[:-1], edges[1:])]


def model_size(frames: list[Frame]) -> tuple[int, int]:
    """The (width, height) MapAnything will use: closest fixed size to the average aspect ratio."""
    aspect = sum(f.width / f.height for f in frames) / len(frames)
    return MODEL_SIZES[min(MODEL_SIZES, key=lambda r: abs(r - aspect))]


def crop_for(width: int, height: int, target: tuple[int, int]) -> dict:
    """How a frame maps onto the model grid: scale to cover, then centre-crop.

    Same arithmetic as mapanything.utils.cropping.crop_resize_if_necessary. A point at (x, y),
    as 0..1 of the original frame, lands on model pixel (x * resizedWidth - cropLeft,
    y * resizedHeight - cropTop).
    """
    tw, th = target
    s = max(tw / width, th / height) + 1e-8
    rw, rh = floor(width * s), floor(height * s)
    return {
        "width": tw,
        "height": th,
        "resizedWidth": rw,
        "resizedHeight": rh,
        "cropLeft": (rw - tw) // 2,
        "cropTop": (rh - th) // 2,
    }
