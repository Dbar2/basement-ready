"""Frame selection, the frame-to-model crop mapping, box lifting and the HTTP contract."""

import json
from email.parser import BytesParser
from email.policy import default

import cv2
import numpy as np
import PIL.Image
import pytest
from fastapi.testclient import TestClient
from mapanything.utils.cropping import crop_resize_if_necessary
from mapanything.utils.image import RESOLUTION_MAPPINGS

from scan3d.api import create_app
from scan3d.export import lift_box
from scan3d.frames import MODEL_SIZES, Frame, crop_for, load_frames, model_size, select_sharpest
from scan3d.pipeline import ScanResult


def jpeg(img: np.ndarray) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


def test_model_sizes_match_mapanything():
    assert MODEL_SIZES == RESOLUTION_MAPPINGS[518]


@pytest.mark.parametrize("size", [(720, 1280), (1280, 720), (1280, 960), (900, 598)])
def test_crop_mapping_matches_mapanything(size):
    w, h = size
    target = model_size([Frame(0, "", b"", w, h, 0)])
    m = crop_for(w, h, target)
    for px, py in [(0.31, 0.27), (0.5, 0.5), (0.8, 0.66)]:
        img = np.zeros((h, w, 3), np.uint8)
        cx, cy = int(px * w), int(py * h)
        img[cy - 4 : cy + 5, cx - 4 : cx + 5] = 255
        out = np.asarray(crop_resize_if_necessary(PIL.Image.fromarray(img), resolution=target)[0])
        assert out.shape[:2] == (target[1], target[0])
        lum = out[..., 0].astype(float)
        vy, ux = np.argwhere(lum > 0.5 * lum.max()).mean(0)  # centre of the dot
        u = (cx + 0.5) / w * m["resizedWidth"] - m["cropLeft"] - 0.5
        v = (cy + 0.5) / h * m["resizedHeight"] - m["cropTop"] - 0.5
        assert abs(ux - u) <= 1.5 and abs(vy - v) <= 1.5


def test_keeps_the_sharpest_frame_per_window():
    rng = np.random.default_rng(0)
    sharp = (rng.random((360, 640, 3)) * 255).astype(np.uint8)
    blurry = cv2.GaussianBlur(sharp, (31, 31), 10)
    items = [(f"{i:04d}.jpg", jpeg(sharp if i % 5 == 3 else blurry)) for i in range(50)]
    picked = select_sharpest(load_frames(items), 10)
    assert [f.source_index for f in picked] == [i for i in range(50) if i % 5 == 3]


def test_lift_box_returns_points_under_the_box():
    H, W = 518, 294
    K = [[300.0, 0, W / 2], [0, 300.0, H / 2], [0, 0, 1]]
    pose = np.eye(4)
    pose[:3, 3] = [0, 1.5, 0]
    scan = {
        "frames": [{"model": crop_for(720, 1280, (W, H)), "intrinsics": K, "pose": pose.tolist(), "depthOffset": 0}],
        "files": {"depth": {"shape": [1, H, W]}},
    }
    depth = np.full((H, W), 2.0, "<f2").tobytes()
    out = lift_box(scan, depth, 0, {"x": 0.4, "y": 0.4, "w": 0.2, "h": 0.2})
    assert out["count"] > 1000
    assert np.allclose(out["median"], [0, 1.5, 2.0], atol=0.02)  # box centred on the image -> straight ahead


class FakeScanner:
    device = "test"

    def __init__(self):
        self.calls = []

    def scan(self, items, max_frames, known):
        self.calls.append((items, max_frames, known))
        return ScanResult({"version": 1, "frames": len(items)}, b"ply\x00\x01", b"\x00" * 8)


def parse(resp):
    msg = BytesParser(policy=default).parsebytes(b"Content-Type: " + resp.headers["content-type"].encode() + b"\r\n\r\n" + resp.content)
    return {p.get_param("name", header="content-disposition"): p.get_content() for p in msg.iter_parts()}


def test_http_contract():
    fake = FakeScanner()
    client = TestClient(create_app(lambda: fake, token="s3cret", max_frames_cap=24))
    frames = [("frames", (f"{i:04d}.jpg", b"jpegbytes", "image/jpeg")) for i in range(3)]
    opts = {"options": json.dumps({"maxFrames": 60, "known": {"floorToJoistsM": 2.1}})}

    assert client.post("/scan", files=frames, data=opts).status_code == 401
    assert client.post("/scan", files=frames, data=opts, headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/health").status_code == 401

    auth = {"Authorization": "Bearer s3cret"}
    assert client.get("/health", headers=auth).json()["device"] == "test"
    r = client.post("/scan", files=frames, data=opts, headers=auth)
    assert r.status_code == 200 and r.headers["content-type"].startswith("multipart/form-data; boundary=")
    parts = parse(r)
    assert json.loads(parts["scan"]) == {"version": 1, "frames": 3}
    assert parts["points"] == b"ply\x00\x01" and parts["depth"] == b"\x00" * 8
    items, max_frames, known = fake.calls[-1]
    assert [n for n, _ in items] == ["0000.jpg", "0001.jpg", "0002.jpg"]
    assert max_frames == 24 and known == {"floorToJoistsM": 2.1}  # capped at the server's limit

    assert client.post("/scan", content=b"x", headers={**auth, "content-type": "text/plain"}).status_code == 415
    # options may also arrive as a file part (a Blob appended to FormData in Node)
    as_file = frames + [("options", ("options.json", b'{"maxFrames": 5}', "application/json"))]
    assert client.post("/scan", files=as_file, headers=auth).status_code == 200
    assert fake.calls[-1][1] == 5
    bad = client.post("/scan", files=frames, data={"options": "{not json"}, headers=auth)
    assert bad.status_code == 400 and "error" in bad.json()
    assert client.post("/scan", json={"frameUrls": ["file:///etc/passwd"]}, headers=auth).status_code == 400
