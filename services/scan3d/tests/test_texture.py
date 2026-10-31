import json

import cv2
import numpy as np

from scan3d import texture
from scan3d.texture import Camera, choose, fill, layout, pack, paint, score, wall_shift

W, H = 320, 240
K = np.array([[260.0, 0, W / 2 - 0.5], [0, 260.0, H / 2 - 0.5], [0, 0, 1]])
ROOM = (4.0, 3.0, 2.4)  # x, z, height


def room_surfaces():
    """A 4 × 3 m room, 2.4 m high, in the conventions of src/three/AsBuiltModel.ts."""
    X, Z, Hh = ROOM
    walls = [
        # (id, origin, u, n, length)
        ("wall:s", [0, 0, 0], [1, 0, 0], [0, 0, 1], X),
        ("wall:e", [X, 0, 0], [0, 0, 1], [-1, 0, 0], Z),
        ("wall:n", [X, 0, Z], [-1, 0, 0], [0, 0, -1], X),
        ("wall:w", [0, 0, Z], [0, 0, -1], [1, 0, 0], Z),
    ]
    out = [{"id": i, "kind": "wall", "origin": o, "u": u, "v": [0, 1, 0], "n": n, "size": [L, Hh], "key": i} for i, o, u, n, L in walls]
    out.append({"id": "floor", "kind": "floor", "origin": [0, 0, Z], "u": [1, 0, 0], "v": [0, 0, -1], "n": [0, 1, 0], "size": [X, Z], "key": "f"})
    out.append({"id": "ceiling", "kind": "ceiling", "origin": [0, Hh, 0], "u": [1, 0, 0], "v": [0, 0, 1], "n": [0, -1, 0], "size": [X, Z], "key": "c"})
    return out


def pattern(sid: str, s: np.ndarray, t: np.ndarray) -> np.ndarray:
    """A different smooth picture on every surface, with stripes, so a misplaced texel shows."""
    base = {"wall:s": (60, 120, 200), "wall:e": (200, 90, 70), "wall:n": (80, 180, 90), "wall:w": (190, 170, 60), "floor": (120, 100, 90), "ceiling": (225, 225, 220)}[sid]
    stripe = 0.5 + 0.5 * np.sin(s * 9.0) * np.cos(t * 7.0)
    c = np.asarray(base, float)[None] * (0.55 + 0.45 * stripe[:, None])
    return np.clip(c, 0, 255)


def pose_at(C, look_at):
    """OpenCV camera-to-room: x right, y down, z forward, the room's +Y up."""
    C, f = np.asarray(C, float), np.asarray(look_at, float) - np.asarray(C, float)
    f /= np.linalg.norm(f)
    x = np.cross(f, [0, 1, 0])
    x /= np.linalg.norm(x)
    y = np.cross(f, x)
    P = np.eye(4)
    P[:3, 0], P[:3, 1], P[:3, 2], P[:3, 3] = x, y, f, C
    return P


def render(pose, surfs, boxes=()):
    """Ray-cast the room (and grey boxes) from a camera: the frame it would film, and its z-depth."""
    R, C = pose[:3, :3], pose[:3, 3]
    xs, ys = np.meshgrid(np.arange(W), np.arange(H))
    rc = np.stack([(xs - K[0, 2]) / K[0, 0], (ys - K[1, 2]) / K[1, 1], np.ones_like(xs, float)], -1).reshape(-1, 3)
    d = rc @ R.T
    best = np.full(len(d), np.inf)
    img = np.zeros((len(d), 3))
    for sd in surfs:
        o, u, v, n = (np.asarray(sd[k], float) for k in ("origin", "u", "v", "n"))
        with np.errstate(divide="ignore", invalid="ignore"):
            t = (n @ (o - C)) / (d @ n)
        p = C[None] + t[:, None] * d
        s_, t_ = (p - o) @ u, (p - o) @ v
        hit = (t > 0) & (t < best) & (s_ >= 0) & (t_ >= 0) & (s_ <= sd["size"][0]) & (t_ <= sd["size"][1])
        best[hit] = t[hit]
        img[hit] = pattern(sd["id"], s_[hit], t_[hit])
    for c, size, *colour in boxes:
        lo, hi = np.asarray(c) - np.asarray(size) / 2, np.asarray(c) + np.asarray(size) / 2
        with np.errstate(divide="ignore", invalid="ignore"):
            t1, t2 = (lo[None] - C[None]) / d, (hi[None] - C[None]) / d
        tmin, tmax = np.nanmax(np.minimum(t1, t2), 1), np.nanmin(np.maximum(t1, t2), 1)
        hit = (tmax >= tmin) & (tmin > 0) & (tmin < best)
        best[hit] = tmin[hit]
        img[hit] = colour[0] if colour else (90, 90, 90)
    rgb = img.reshape(H, W, 3).astype(np.uint8)
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR), best.reshape(H, W).astype(np.float32)


def camera(pose, surfs, boxes=(), depth=True, sharp=1.0):
    img, z = render(pose, surfs, boxes)
    cam = Camera(image=img, K=K.copy(), R=pose[:3, :3], C=pose[:3, 3], sharp=sharp)
    if depth:
        cam.depth, cam.Kd = z, K.copy()
    return cam


def grid(sf, step=0.1):
    s, t = np.meshgrid(np.arange(0.05, sf.size[0], step), np.arange(0.05, sf.size[1], step))
    return sf.points(s.ravel(), t.ravel())


def test_choose_prefers_square_on_close_and_sharp():
    surfs = [texture._surf(d) for d in room_surfaces()]
    planes = texture._occluder_planes(surfs)
    north = next(s for s in surfs if s.id == "wall:n")
    P, N = grid(north)
    spots = {
        "square": pose_at([2, 1.4, 1.2], [2, 1.2, 3]),
        "far": pose_at([2, 1.4, 0.1], [2, 1.2, 3]),
        "grazing": pose_at([3.8, 1.4, 2.6], [0.2, 1.2, 3]),
        "blurry": pose_at([2.1, 1.4, 1.2], [2.1, 1.2, 3]),
    }
    cams = {k: Camera(image=np.zeros((H, W, 3), np.uint8), K=K, R=p[:3, :3], C=p[:3, 3], sharp=0.4 if k == "blurry" else 1.0) for k, p in spots.items()}
    q = {k: score(c, north, P, N, planes, [], 100)[0] for k, c in cams.items()}

    # Compared where both see the wall, away from the edges of either frame.
    middle = (np.abs(P[:, 0] - 2) < 0.5) & (np.abs(P[:, 1] - 1.2) < 0.4)

    def better(a, b):
        both = middle & (q[a] > 0) & (q[b] > 0)
        return both.sum() > 20 and (q[a][both] > q[b][both]).all()

    assert better("square", "far")
    assert better("square", "grazing")
    assert better("square", "blurry")
    # Seeing the same part of the wall, the sharp frame goes first and the blurry one adds nothing.
    picked = choose([(0, q["blurry"]), (1, q["square"])])
    assert picked == [1]
    # The far one sees more of the wall: both are kept, each for where it's best.
    assert sorted(choose([(0, q["far"]), (1, q["square"])])) == [0, 1]


def test_hidden_spots_score_nothing():
    surfs = [texture._surf(d) for d in room_surfaces()]
    planes = texture._occluder_planes(surfs)
    north = next(s for s in surfs if s.id == "wall:n")
    P, N = grid(north)
    pose = pose_at([2, 1.2, 0.8], [2, 1.2, 3])
    # A box the model knows about, between the camera and the middle of the wall.
    box = (np.array([2.0, 1.2, 2.0]), [0.6, 0.6, 0.3], 0.0)
    cam = Camera(image=np.zeros((H, W, 3), np.uint8), K=K, R=pose[:3, :3], C=pose[:3, 3])
    q, _ = score(cam, north, P, N, planes, [box], 100)
    behind = (np.abs(P[:, 0] - 2) < 0.15) & (np.abs(P[:, 1] - 1.2) < 0.15)
    assert (q[behind] == 0).all()
    # Outside its shadow (about 1.1 m across on the wall), what the frame frames is seen.
    dx, dy = np.abs(P[:, 0] - 2), np.abs(P[:, 1] - 1.2)
    clear = (dx < 1.1) & (dy < 0.8) & ((dx > 0.65) | (dy > 0.65))
    assert (q[clear] > 0).mean() > 0.9
    # Something only the scan measured (no model box), a metre in front of the wall: also hidden.
    cam2 = Camera(image=np.zeros((H, W, 3), np.uint8), K=K, R=pose[:3, :3], C=pose[:3, 3])
    depth = np.full((H, W), 2.2, np.float32)
    depth[100:140, 140:180] = 1.2
    cam2.depth, cam2.Kd = depth, K
    q2, _ = score(cam2, north, P, N, planes, [], 100)
    x = K[0, 0] * (P[:, 0] - 2) / 2.2 + K[0, 2]
    y = K[1, 1] * -(P[:, 1] - 1.2) / 2.2 + K[1, 2]
    clutter = (x > 142) & (x < 178) & (y > 102) & (y < 138)
    assert clutter.any() and (q2[clutter] == 0).all()


def job_for(poses, boxes=()):
    surfs = room_surfaces()
    cams, images, depths = [], [], []
    for i, pose in enumerate(poses):
        img, z = render(pose, surfs, boxes)
        images.append(img)
        depths.append(z[None])
        cams.append({"image": i, "K": K.tolist(), "pose": pose.tolist(), "width": W, "height": H, "depth": {"map": i, "frame": 0, "K": K.tolist()}})
    return {"surfaces": surfs, "occluders": [], "cameras": cams, "options": {"ppm": 40}}, images, depths


def tile_of(index, files, sid):
    page = index["page"]
    atlas = cv2.imdecode(np.frombuffer(files[f"atlas-{page}.jpg"], np.uint8), cv2.IMREAD_COLOR)
    x, y, w, h = (round(v * page) for v in index["surfaces"][sid]["rect"])
    return cv2.cvtColor(atlas[y:y + h, x:x + w], cv2.COLOR_BGR2RGB).astype(float)


def truth_tile(sd, ppm, w, h):
    s, t = np.meshgrid((np.arange(w) + 0.5) / ppm, sd["size"][1] - (np.arange(h) + 0.5) / ppm)
    return pattern(sd["id"], s.ravel(), t.ravel()).reshape(h, w, 3)


SPOTS = [
    pose_at([1.0, 1.4, 1.0], [3.5, 1.1, 2.8]),
    pose_at([3.0, 1.4, 1.0], [0.5, 1.1, 2.8]),
    pose_at([3.0, 1.4, 2.0], [0.5, 1.0, 0.2]),
    pose_at([1.0, 1.4, 2.0], [3.5, 1.0, 0.2]),
    pose_at([2.0, 1.5, 1.5], [2.0, 0.0, 2.6]),
    pose_at([2.0, 1.5, 1.5], [3.9, 1.0, 1.5]),
    pose_at([2.0, 1.5, 1.5], [0.1, 1.0, 1.5]),
    pose_at([2.0, 1.3, 1.5], [2.0, 2.4, 2.4]),
    # Looking down at the floor, steeply enough to paint it.
    pose_at([1.0, 1.5, 0.9], [1.1, 0.0, 1.4]),
    pose_at([3.0, 1.5, 0.9], [2.9, 0.0, 1.4]),
    pose_at([1.0, 1.5, 2.1], [1.1, 0.0, 1.6]),
    pose_at([3.0, 1.5, 2.1], [2.9, 0.0, 1.6]),
]


def test_paint_puts_every_frame_back_where_it_was_filmed():
    job, images, depths = job_for(SPOTS)
    index, files = paint(job, images, depths)
    assert set(index["surfaces"]) == {s["id"] for s in room_surfaces()}
    assert index["levels"]
    for sd in room_surfaces():
        entry = index["surfaces"][sd["id"]]
        got = tile_of(index, files, sd["id"])
        want = truth_tile(sd, index["ppm"], got.shape[1], got.shape[0])
        assert entry["frames"], sd["id"]
        if sd["id"] == "ceiling":
            # One frame looks up: what it saw squarely enough is painted, the rest filled from it.
            assert entry["coverage"] > 0.15
            continue
        assert entry["coverage"] > (0.9 if sd["kind"] == "wall" else 0.6), sd["id"]
        err = np.abs(got - want).mean()
        assert err < 6, (sd["id"], err)


def test_a_wall_the_plan_put_off_is_painted_where_it_really_is():
    # The plan's north wall is 15 cm in front of the real one (the frames see the real one).
    real = room_surfaces()
    job, images, depths = job_for(SPOTS[:4])
    for sd in job["surfaces"]:
        if sd["id"] == "wall:n":
            sd["origin"] = [sd["origin"][0], 0, sd["origin"][2] - 0.15]
    index, files = paint(job, images, depths)
    entry = index["surfaces"]["wall:n"]
    assert abs(entry.get("shiftM", 0) + 0.15) < 0.03
    sd = next(s for s in real if s["id"] == "wall:n")
    got = tile_of(index, files, "wall:n")
    want = truth_tile(sd, index["ppm"], got.shape[1], got.shape[0])
    assert np.abs(got - want).mean() < 16


def test_wall_shift_needs_a_clear_level():
    rng = np.random.default_rng(1)
    assert abs(wall_shift([rng.normal(-0.12, 0.005, 2000)]) + 0.12) < 0.01
    assert wall_shift([rng.uniform(-0.3, 0.3, 2000)]) == 0.0
    assert wall_shift([np.full(50, -0.1)]) == 0.0


def test_fill_takes_the_colour_around_a_hole():
    img = np.zeros((40, 40, 3), np.uint8)
    img[:] = (10, 200, 30)
    known = np.ones((40, 40), bool)
    known[10:30, 10:30] = False
    img[~known] = 0
    out = fill(img, known)
    assert np.abs(out[20, 20].astype(int) - (10, 200, 30)).max() <= 2


def test_pack_and_layout():
    assert pack([(100, 50), (60, 60)], 128, 2) is not None
    assert pack([(200, 10)], 128, 2) is None
    surfs = [texture._surf(d) for d in room_surfaces()]
    # 58 m² at 1 cm fits the smallest page; at 5 mm it takes the next one up.
    assert layout(surfs, 100, 4096) == (1024, 100)
    assert layout(surfs, 200, 4096) == (2048, 200)
    # Capped at 1024, the density drops until it fits.
    page, ppm = layout(surfs, 200, 1024)
    assert page == 1024 and 100 <= ppm < 200


def test_texture_route(monkeypatch):
    from fastapi.testclient import TestClient

    from scan3d.api import create_app

    job, images, depths = job_for(SPOTS[:3])
    app = create_app(lambda: None, token="t")
    files = [("frames", (f"{i}.jpg", cv2.imencode(".jpg", im)[1].tobytes(), "image/jpeg")) for i, im in enumerate(images)]
    files += [("depth", (f"{i}.bin", d.astype("<f2").tobytes(), "application/octet-stream")) for i, d in enumerate(depths)]
    job["depthShapes"] = [list(d.shape) for d in depths]
    res = TestClient(app).post("/texture", headers={"Authorization": "Bearer t"}, data={"job": json.dumps(job)}, files=files)
    assert res.status_code == 200, res.text
    assert res.headers["content-type"].startswith("multipart/form-data")
    assert b'"surfaces"' in res.content and b"\xff\xd8" in res.content
    assert TestClient(app).post("/texture", data={"job": "{}"}).status_code == 401


def test_only_what_lies_on_the_surface_counts():
    surfs = [texture._surf(d) for d in room_surfaces()]
    planes = texture._occluder_planes(surfs)

    def seen(sid, moved, pose):
        """Spots of `sid` a frame counts when the scan measured that surface `moved` metres along its
        normal from where the plan has it (+: into the room)."""
        real = [dict(d, origin=list(np.asarray(d["origin"]) + moved * np.asarray(d["n"]))) if d["id"] == sid else d for d in room_surfaces()]
        _, depth = render(pose, real)
        depth[~np.isfinite(depth)] = np.inf
        surf = next(x for x in surfs if x.id == sid)
        P, N = grid(surf)
        cam = Camera(image=np.zeros((H, W, 3), np.uint8), K=K, R=pose[:3, :3], C=pose[:3, 3], depth=depth, Kd=K)
        q, _ = score(cam, surf, P, N, planes, [], 100, on=0.0)
        return int((q > 0).sum())

    level = pose_at([2, 1.2, 0.8], [2, 1.2, 3])
    on_wall = seen("wall:n", 0.0, level)
    assert on_wall > 100
    # A shelf 30 cm in front of the wall, or an alcove 30 cm behind it: neither is the wall.
    assert seen("wall:n", 0.3, level) == 0
    assert seen("wall:n", -0.3, level) < 0.1 * on_wall
    # A ceiling loses what hangs below it, not the joist bays above it.
    up = pose_at([2, 1.0, 0.6], [2, 2.4, 2.2])
    on_ceiling = seen("ceiling", 0.0, up)
    assert on_ceiling > 100
    assert seen("ceiling", 0.3, up) < 0.1 * on_ceiling
    assert seen("ceiling", -0.3, up) > 0.8 * on_ceiling


def test_paint_the_frames_disagree_on_is_drawn_plain():
    # A box stands in front of the north wall, in the frames but not in the plan, and without depth to
    # catch it: from each side it lands on a different part of the wall, so the frames disagree there.
    poses = [pose_at([1.0, 1.4, 0.8], [2.5, 1.0, 3.0]), pose_at([3.0, 1.4, 0.8], [1.5, 1.0, 3.0]), pose_at([2.0, 1.5, 0.6], [2.0, 1.0, 3.0])]
    box = [(np.array([2.0, 0.5, 2.4]), [0.6, 1.0, 0.3], (230, 40, 40))]

    def sure(boxes):
        surfs = room_surfaces()
        cams, images = [], []
        for i, pose in enumerate(poses):
            img, _ = render(pose, surfs, boxes)
            images.append(img)
            cams.append({"image": i, "K": K.tolist(), "pose": pose.tolist(), "width": W, "height": H})
        index, _ = paint({"surfaces": surfs, "occluders": [], "cameras": cams, "options": {"ppm": 40}}, images, [])
        return index["surfaces"]["wall:n"]["sure"]

    clean, cluttered = sure([]), sure(box)
    assert clean > 0.9
    assert cluttered < clean - 0.05


def test_a_floor_seen_only_at_a_shallow_angle_stays_plain():
    # Standing, looking across the room: the floor is in view, but too shallow to paint without streaks.
    level = [pose_at([0.5, 1.5, 1.5], [3.9, 1.2, 1.5]), pose_at([3.5, 1.5, 1.5], [0.1, 1.2, 1.5])]
    job, images, depths = job_for(level)
    index, _ = paint(job, images, depths)
    assert index["surfaces"]["floor"]["coverage"] < 0.25
    assert index["surfaces"]["wall:e"]["coverage"] > 0.8
