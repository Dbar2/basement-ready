"""The Python side of the basement assembly (the server's server/assemble.ts mirrors it)."""

import numpy as np

from scan3d.assemble import Rect, place, placed_rect, settle, split_walk, square


def around(cx, cz, n, r=0.8):
    i = np.arange(n)
    return np.stack([cx + r * np.cos(i * 2.4), cz + r * np.sin(i * 1.7)], 1)


def test_split_walk_cuts_where_the_walk_moves_on():
    walk = np.vstack([around(0, 0, 20), around(5, 0, 20), around(5, 5, 15, 0.6)])
    assert split_walk(walk) == [(0, 20), (20, 40), (40, 55)]


def test_split_walk_leaves_one_room_whole():
    assert split_walk(around(0, 0, 50, 1.2)) == [(0, 50)]


def test_place_recovers_turn_scale_and_shift():
    theta, scale, shift = 0.4, 0.8, np.array([3.0, -2.0])
    idx = np.arange(12) * 3
    pos = around(0, 0, 12, 1.5)
    fwd = np.stack([np.cos(np.arange(12)), np.sin(np.arange(12))], 1)
    R = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
    p = place(idx, pos, fwd, idx, scale * pos @ R.T + shift, fwd @ R.T)
    assert np.isclose(p.theta, theta) and np.isclose(p.scale, scale) and np.allclose(p.shift, shift)


def test_square_and_boxes():
    assert np.isclose(square(np.pi / 2 + 0.1), np.pi / 2)
    assert square(0.6) == 0.6
    r = placed_rect(6, 4, np.pi / 2, np.zeros(2))
    assert (r.x0, r.z0, r.x1, r.z1) == (-2, -3, 2, 3)


def test_settle_backs_out_overlaps_and_closes_slivers():
    moves = settle([Rect(0, 0, 6, 4), Rect(5.5, 0, 8.5, 4), Rect(0, 8, 3, 10)])
    assert moves[0] == (0.0, 0.0)
    assert np.isclose(moves[1][0], 0.5 + 0.12)
    assert moves[2] == (0.0, 0.0)


def test_surfels_round_trip():
    from scan3d.export import read_surfels, surfel_bytes

    xyz = np.array([[1.234, 0.5, -2.0], [-3.0, 2.4, 0.001]], np.float32)
    rgb = np.array([[10, 20, 30], [200, 100, 0]], np.uint8)
    out = read_surfels(surfel_bytes(xyz, rgb, np.array([0.006, 0.3]), np.array([3, 70], np.uint16)))
    assert np.allclose(out["xyz"], xyz, atol=0.0006)
    assert (out["rgb"] == rgb).all()
    assert np.allclose(out["size"], [0.006, 0.255])  # footprints cap at 255 mm
    assert out["frame"].tolist() == [3, 70]
