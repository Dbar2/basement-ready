import numpy as np

from scan3d.export import read_mesh
from scan3d.mesh import fuse, room_mesh


def wall_views(n=6, H=60, W=80, depth=2.0):
    """A flat wall straight ahead at z = depth, seen from a few spots along x."""
    K = np.array([[60.0, 0, W / 2], [0, 60.0, H / 2], [0, 0, 1]], np.float32)
    views = []
    for i in range(n):
        pose = np.eye(4, dtype=np.float32)
        pose[0, 3] = 0.1 * i
        views.append({"depth": np.full((H, W), depth, np.float32), "mask": np.ones((H, W), bool), "K": K, "pose": pose, "rgb": np.full((H, W, 3), 200, np.uint8)})
    return views


def test_wall_has_one_skin():
    verts, faces, colours = fuse(wall_views(), lambda p: p)
    # Only the wall itself: no second surface where the band behind it meets unseen space.
    assert np.abs(verts[:, 2] - 2.0).max() < 0.05
    assert len(faces) > 100
    assert (np.abs(colours.astype(int) - 200) <= 1).all()


def test_mesh_round_trip():
    out = read_mesh(room_mesh(wall_views(), lambda p: p))
    assert out["faces"].max() < len(out["verts"])
    assert np.abs(out["verts"][:, 2] - 2.0).max() < 0.05
