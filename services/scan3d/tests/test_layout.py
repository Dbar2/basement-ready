"""The basement's real plan (scan3d/layout.py), its self-check (scan3d/selfcheck.py) and /floorplan."""

import json

import numpy as np
from fastapi.testclient import TestClient

from scan3d.api import create_app
from scan3d.export import ply_bytes
from scan3d.layout import find_floor, read_plan
from scan3d.selfcheck import check_walls
from scan3d.views import floor_edges


def wall(x0, z0, x1, z1, gaps=(), top=2.3):
    """Points on a vertical wall from the floor to `top`, every 3 cm along and 5 cm up, minus door gaps."""
    n = int(np.hypot(x1 - x0, z1 - z0) / 0.03) + 1
    t = np.linspace(0, 1, n)
    xs, zs = x0 + t * (x1 - x0), z0 + t * (z1 - z0)
    keep = np.ones(n, bool)
    for a, b in gaps:
        along = xs if x0 != x1 else zs
        keep &= ~((along > a) & (along < b))
    ys = np.arange(0.05, top, 0.05)
    return np.array([[x, y, z] for x, z in zip(xs[keep], zs[keep]) for y in ys])


def flat(x0, x1, z0, z1, y, n, rng):
    return np.column_stack([rng.uniform(x0, x1, n), np.full(n, y), rng.uniform(z0, z1, n)])


def two_rooms(low_b=False):
    """Room A 0..5 x 0..4 and room B 5.12..8 x 0..4, a 12 cm partition at x = 5 with a door at z 1.0-1.9.
    The camera walks round A, through the door and round B."""
    rng = np.random.default_rng(0)
    top_b = 1.75 if low_b else 2.3
    pts = np.concatenate([
        wall(0, 0, 5, 0), wall(0, 4, 5, 4), wall(0, 0, 0, 4),
        wall(5.12, 0, 8, 0, top=top_b), wall(5.12, 4, 8, 4, top=top_b), wall(8, 0, 8, 4, top=top_b),
        wall(5, 0, 5, 4, gaps=[(1.0, 1.9)]), wall(5.12, 0, 5.12, 4, gaps=[(1.0, 1.9)], top=top_b),
        # Above the door: the wall carries on from 2.05 m up.
        np.array([[x, y, z] for x in (5.0, 5.12) for z in np.arange(1.0, 1.9, 0.03) for y in np.arange(2.05, 2.3, 0.05)]),
        flat(0, 8, 0, 4, 0.0, 60000, rng),  # the floor
        flat(0, 5, 0, 4, 2.3, 20000, rng),  # A's ceiling
        flat(5.12, 8, 0, 4, top_b, 12000, rng),  # B's ceiling
    ])
    walk = [(1.5, 1.5), (2.5, 2.5), (3.5, 1.8), (4.3, 1.5), (4.8, 1.45), (5.3, 1.45), (5.8, 1.45), (6.2, 1.5), (6.8, 2.6), (7.0, 1.2)]
    cams = []
    for (x0, z0), (x1, z1) in zip(walk, walk[1:]):
        for t in np.linspace(0, 1, 6, endpoint=False):
            cams.append([x0 + t * (x1 - x0), 1.45, z0 + t * (z1 - z0)])
    return pts, np.array(cams)


def test_floor_is_the_lowest_large_plane():
    rng = np.random.default_rng(1)
    pts = np.concatenate([flat(0, 6, 0, 4, 0.0, 30000, rng), flat(1, 4, 1, 3, 0.75, 40000, rng), wall(0, 0, 6, 0)])
    f = find_floor(pts, cam_y=1.45)
    assert abs(f.y) < 0.02 and f.tilt_deg < 1


def test_two_rooms_walls_and_a_door():
    pts, cams = two_rooms()
    plan = read_plan(pts, cams).to_json()
    assert abs(plan["floor"]["y"]) < 0.03
    rooms = sorted(plan["rooms"], key=lambda r: -r["areaM2"])
    assert len(rooms) == 2, [r["areaM2"] for r in rooms]
    a, b = rooms
    assert abs(a["areaM2"] - 20.0) < 1.5 and abs(b["areaM2"] - 11.5) < 1.2
    # Polygons, in the plan frame (the axes are the walls': rotation ~0 here).
    assert abs(plan["rotation"]) < 0.02
    pa, pb = np.array(a["polygon"]), np.array(b["polygon"])
    assert abs(pa[:, 0].max() - 5.0) < 0.15 and abs(pb[:, 0].min() - 5.12) < 0.15
    # One wall between them, about a partition thick, with the door in it.
    between = [w for w in plan["walls"] if set(w["rooms"]) == {a["id"], b["id"]}]
    assert between and all(0.05 <= w["thicknessM"] <= 0.3 for w in between)
    doors = [o for o in plan["openings"] if o["kind"] == "door"]
    assert len(doors) == 1 and set(doors[0]["rooms"]) == {a["id"], b["id"]}
    assert abs(doors[0]["at"][1] - 1.45) < 0.3 and 0.6 <= doors[0]["widthM"] <= 1.2
    # The outside is foundation.
    assert any(w["kind"] == "foundation" for w in plan["walls"])


def test_a_low_room_keeps_its_own_ceiling():
    pts, cams = two_rooms(low_b=True)
    plan = read_plan(pts, cams).to_json()
    low = [r for r in plan["rooms"] if r["low"]]
    assert len(low) == 1 and abs(low[0]["ceilingM"] - 1.75) < 0.06
    assert all(abs(r["ceilingM"] - 2.3) < 0.06 for r in plan["rooms"] if not r["low"])


def test_corrections_are_checked_against_the_points():
    pts, cams = two_rooms()
    edits = [
        {"op": "merge", "at": [[2.0, 2.0], [6.5, 2.0]]},  # a wall stands between them: refused
        {"op": "split", "at": [2.0, 2.0], "axis": "u", "value": 2.5},  # no wall there: refused
        {"op": "kind", "at": [6.5, 2.0], "kind": "closet"},  # 11.5 m² is no closet: refused
        {"op": "kind", "at": [6.5, 2.0], "kind": "mechanical", "name": "Furnace room"},
    ]
    plan = read_plan(pts, cams, edits=edits).to_json()
    ok = [e["ok"] for e in plan["edits"]]
    assert ok == [False, False, False, True], plan["edits"]
    assert len(plan["rooms"]) == 2
    assert any(r.get("name") == "Furnace room" for r in plan["rooms"])


def box_views(room=(0.0, 5.0, 0.0, 4.0), ceiling=2.3, pull=1.0):
    """Depth maps of an empty box room seen from its middle, looking at each wall. `pull` < 1 puts the
    walls (not the floor) nearer than they are, the way the 3D does on a bare wall."""
    x0, x1, z0, z1 = room
    H, W, f = 120, 90, 80.0
    K = np.array([[f, 0, W / 2], [0, f, H / 2], [0, 0, 1]])
    views = []
    C = np.array([(x0 + x1) / 2, 1.45, (z0 + z1) / 2])
    for yaw in (0, np.pi / 2, np.pi, 3 * np.pi / 2):
        fwd = np.array([np.sin(yaw), 0, np.cos(yaw)])
        fwd = fwd * np.cos(0.35) + np.array([0, -np.sin(0.35), 0])  # looking a little down
        right = np.cross([0, -1, 0], fwd)  # OpenCV camera: x right, y down, z forward
        right /= np.linalg.norm(right)
        down = np.cross(fwd, right)
        R = np.stack([right, down, fwd], 1)
        vv, uu = np.mgrid[0:H, 0:W]
        rays = np.stack([(uu - K[0, 2]) / f, (vv - K[1, 2]) / f, np.ones_like(uu, float)], -1) @ R.T
        ts = []
        for axis, val in ((0, x0), (0, x1), (2, z0), (2, z1), (1, 0.0), (1, ceiling)):
            with np.errstate(divide="ignore", invalid="ignore"):
                t = (val - C[axis]) / rays[..., axis]
            t[(t <= 0) | ~np.isfinite(t)] = np.inf
            ts.append(t)
        ts = np.stack(ts)
        hit = ts.argmin(0)  # the surface the pixel really sees
        t = ts.min(0)
        t = np.where(hit < 4, t * pull, t)  # walls come back short; floor and ceiling don't
        pose = np.eye(4)
        pose[:3, :3], pose[:3, 3] = R, C
        views.append({"pose": pose, "K": K, "depth": np.where(np.isfinite(t), t, 0).astype(np.float32)})
    return views


def test_floor_edges_find_the_wall_foot_when_the_wall_is_pulled_in():
    views = box_views(pull=0.8)
    E, wall_like = floor_edges(views, 0.0)
    assert len(E) > 50 and wall_like.mean() > 0.8
    d = np.minimum.reduce([np.abs(E[:, 0] - 0), np.abs(E[:, 0] - 5), np.abs(E[:, 2] - 0), np.abs(E[:, 2] - 4)])
    assert np.median(d) < 0.06


def test_self_check_trusts_real_walls_and_doubts_a_made_up_one():
    views = box_views()
    plan = {
        "rotation": 0.0,
        "floor": {"y": 0.0},
        "ceilingM": 2.3,
        "openings": [],
        "walls": [
            {"id": "w1", "a": [-0.1, 0.0], "b": [5.1, 0.0], "thicknessM": 0.2, "kind": "foundation", "rooms": ["r1"]},
            {"id": "w2", "a": [5.1, 0.0], "b": [5.1, 4.0], "thicknessM": 0.2, "kind": "foundation", "rooms": ["r1"]},
            {"id": "w3", "a": [3.5, 0.5], "b": [3.5, 3.5], "thicknessM": 0.12, "kind": "existing", "rooms": ["r1"]},
        ],
    }
    # w1, w2 drawn on the walls' outside faces; their inside faces are 10 cm in, where the walls are.
    plan["walls"][0]["a"], plan["walls"][0]["b"] = [-0.1, -0.1], [5.1, -0.1]
    plan["walls"][1]["a"], plan["walls"][1]["b"] = [5.1, -0.1], [5.1, 4.1]
    out = check_walls(plan, views)
    w1, w2, w3 = plan["walls"]
    assert w1["check"]["confidence"] > 0.8 and not w1.get("guess")
    assert w2["check"]["confidence"] > 0.8 and not w2.get("guess")
    assert w3["check"]["confidence"] < 0.3 and w3.get("guess")  # the camera sees through where it would be
    assert out["doubtful"] == 1


def test_floorplan_endpoint_returns_the_plan():
    pts, cams = two_rooms()
    client = TestClient(create_app(lambda: None, token="s3cret"))
    auth = {"Authorization": "Bearer s3cret"}
    area = {"world": {"rotation": np.eye(3).tolist(), "origin": [0, 0, 0]}, "factor": 1}
    files = [("points", ("a.ply", ply_bytes(pts.astype(np.float32), np.full((len(pts), 3), 128, np.uint8), np.zeros(len(pts), np.uint16)), "application/octet-stream"))]
    data = {"areas": json.dumps([area]), "cameras": json.dumps(cams.tolist()), "render": "1"}
    assert client.post("/floorplan", files=files, data=data).status_code == 401
    r = client.post("/floorplan", files=files, data=data, headers=auth)
    assert r.status_code == 200, r.text
    out = r.json()
    assert len(out["rooms"]) == 2 and all(len(x["box"]) == 4 for x in out["rooms"])
    assert len(out["plan"]["rooms"]) == 2 and out["plan"]["walls"] and out["renders"]["topDown"]
    bad = client.post("/floorplan", files=files, data={**data, "edits": "{}"}, headers=auth)
    assert bad.status_code == 400


def test_a_closet_looked_into_from_its_door_is_still_a_room():
    # Room A as before; B is a 1.5 x 1.6 m closet behind a 0.8 m door, filmed only from A's side of it.
    rng = np.random.default_rng(3)
    pts = np.concatenate([
        wall(0, 0, 5, 0), wall(0, 4, 5, 4), wall(0, 0, 0, 4),
        wall(5, 0, 5, 4, gaps=[(1.0, 1.8)]), wall(5.12, 0.6, 5.12, 1.8 + 0.4, gaps=[(1.0, 1.8)]),
        wall(5.12, 0.6, 6.62, 0.6), wall(5.12, 2.2, 6.62, 2.2), wall(6.62, 0.6, 6.62, 2.2),
        np.array([[x, y, z] for x in (5.0, 5.12) for z in np.arange(1.0, 1.8, 0.03) for y in np.arange(2.05, 2.3, 0.05)]),
        flat(0, 5, 0, 4, 0.0, 50000, rng),
        # Through the door only part of the closet's floor is seen: a wedge from the door.
        np.array([[5.12 + d, 0.0, 1.4 + (rng.uniform(-1, 1)) * (0.4 + 0.25 * d)] for d in rng.uniform(0, 1.5, 6000)]),
        flat(0, 5, 0, 4, 2.3, 15000, rng),
    ])
    walk = [(1.5, 1.5), (2.5, 2.5), (3.5, 1.8), (4.3, 1.4)]
    cams = np.array([[x0 + t * (x1 - x0), 1.45, z0 + t * (z1 - z0)] for (x0, z0), (x1, z1) in zip(walk, walk[1:]) for t in np.linspace(0, 1, 6, endpoint=False)])
    plan = read_plan(pts, cams, hints={"peek": 1}).to_json()
    rooms = sorted(plan["rooms"], key=lambda r: -r["areaM2"])
    assert len(rooms) == 2, [(r["areaM2"], r["entered"]) for r in rooms]
    a, closet = rooms
    assert a["entered"] and not closet["entered"] and closet["seenFrom"] == a["id"]
    # Its hidden corners are filled in: the whole closet, not the wedge the camera saw.
    assert abs(closet["areaM2"] - 2.4) < 0.4, closet["areaM2"]
    own = [w for w in plan["walls"] if set(w["rooms"]) == {closet["id"]}]
    assert own and all(w.get("guess") and w.get("seenFromDoor") for w in own)
    assert any(o["kind"] == "door" and set(o["rooms"]) == {a["id"], closet["id"]} for o in plan["openings"])
