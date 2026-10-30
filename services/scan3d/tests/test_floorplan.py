"""The whole-basement floor plan from a connected, true-to-size point cloud (scan3d/floorplan.py)."""

import numpy as np

from scan3d.floorplan import floor_plan


def wall(x0, z0, x1, z1, gaps=()):
    """Points on a vertical wall from the floor to 2.3 m, every 3 cm along and 5 cm up, minus door gaps."""
    n = int(np.hypot(x1 - x0, z1 - z0) / 0.03) + 1
    t = np.linspace(0, 1, n)
    xs, zs = x0 + t * (x1 - x0), z0 + t * (z1 - z0)
    keep = np.ones(n, bool)
    for a, b in gaps:
        along = xs if x0 != x1 else zs
        keep &= ~((along > a) & (along < b))
    ys = np.arange(0.05, 2.3, 0.05)
    return np.array([[x, y, z] for x, z in zip(xs[keep], zs[keep]) for y in ys])


def test_two_rooms_through_a_door():
    # Room A 0..5 x 0..4, a 12 cm partition at x = 5 with a door from z = 1.0 to 1.9, room B 5.12..8.
    rng = np.random.default_rng(0)
    pts = np.concatenate([
        wall(0, 0, 8, 0), wall(0, 4, 8, 4), wall(0, 0, 0, 4), wall(8, 0, 8, 4),
        wall(5, 0, 5, 4, gaps=[(1.0, 1.9)]), wall(5.12, 0, 5.12, 4, gaps=[(1.0, 1.9)]),
        np.column_stack([rng.uniform(0, 8, 40000), np.zeros(40000), rng.uniform(0, 4, 40000)]),  # the floor
    ])
    cams = np.array([[x, 1.45, z] for x, z in [(1.5, 1.5), (2.5, 2.5), (3.5, 1.8), (6.2, 1.5), (6.8, 2.6), (7.0, 1.2)]])
    fp = floor_plan(pts, cams)
    assert abs(fp.floor_y) < 0.03
    sizes = sorted((round(r.box[2] - r.box[0], 1), round(r.box[3] - r.box[1], 1)) for r in fp.rooms)
    assert len(fp.rooms) == 2, sizes
    (bw, bd), (aw, ad) = sizes  # the smaller room first
    assert abs(aw - 5.0) <= 0.25 and abs(ad - 4.0) <= 0.25
    assert abs(bw - 2.88) <= 0.25 and abs(bd - 4.0) <= 0.25
    assert all(r.cameras == 3 for r in fp.rooms)
