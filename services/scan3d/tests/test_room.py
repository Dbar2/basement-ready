"""Plane fitting on a synthetic room with known size. No model or weights needed."""

import numpy as np

from scan3d.room import describe, fit_room

W, D, H = 4.2, 3.1, 2.1  # metres; the room spans x in [0, W], z in [0, D], y up from 0 to H


def look_at(eye, target):
    """OpenCV camera-to-world rotation (x right, y down, z forward) for a level-ish camera."""
    z = target - eye
    z /= np.linalg.norm(z)
    x = np.cross(z, [0, 1.0, 0])  # world +Y is up, so camera down (+y) is world -Y
    x /= np.linalg.norm(x)
    y = np.cross(z, x)
    return np.stack([x, y, z], 1)


def make_room(rng, doubled=False, n_cams=24):
    def grid(n, a0, a1, b0, b1):
        return rng.uniform([a0, b0], [a1, b1], (n, 2))

    parts = []
    f = grid(30000, 0, W, 0, D)
    parts.append(np.c_[f[:, 0], np.zeros(len(f)), f[:, 1]])  # floor
    c = grid(25000, 0, W, 0, D)
    parts.append(np.c_[c[:, 0], np.full(len(c), H), c[:, 1]])  # ceiling
    for x in (0.0, W):
        g = grid(12000, 0, D, 0, H)
        parts.append(np.c_[np.full(len(g), x), g[:, 1], g[:, 0]])
    for z in (0.0, D):
        g = grid(15000, 0, W, 0, H)
        parts.append(np.c_[g[:, 0], g[:, 1], np.full(len(g), z)])
    t = grid(3000, 1.5, 2.7, 1.0, 1.8)
    parts.append(np.c_[t[:, 0], np.full(len(t), 0.75), t[:, 1]])  # desk top
    s = grid(4000, 0.5, 1.5, 0, 1.9)
    parts.append(np.c_[s[:, 0], s[:, 1], np.full(len(s), D - 0.3)])  # bookshelf front, 30 cm off a wall
    world = np.concatenate(parts)
    world += rng.normal(0, 0.008, world.shape)

    # Cameras walk a loop at chest height, each looking out at the walls with a little pitch.
    ang = np.linspace(0, 2 * np.pi, n_cams, endpoint=False)
    eyes = np.c_[W / 2 + 0.8 * np.cos(ang), 1.5 + rng.normal(0, 0.05, n_cams), D / 2 + 0.6 * np.sin(ang)]
    targets = np.c_[W / 2 + 3 * np.cos(ang), 1.2 + rng.normal(0, 0.3, n_cams), D / 2 + 3 * np.sin(ang)]
    rots = np.stack([look_at(e, t_) for e, t_ in zip(eyes, targets)])

    # Each point belongs to the camera that faces it most directly.
    dirs = world[:, None, :] - eyes[None]
    dirs /= np.linalg.norm(dirs, axis=2, keepdims=True)
    frames = np.einsum("pcj,cj->pc", dirs, rots[:, :, 2]).argmax(1)

    if doubled:
        # Loop-closure drift: the x = W wall placed a second time, 15 cm inside, by other frames.
        g = grid(12000, 0, D, 0, H)
        copy = np.c_[np.full(len(g), W - 0.15), g[:, 1], g[:, 0]] + rng.normal(0, 0.008, (len(g), 3))
        wall = np.abs(world[:, 0] - W) < 0.05
        frames[wall] = rng.integers(0, 6, wall.sum())
        world = np.concatenate([world, copy])
        frames = np.concatenate([frames, rng.integers(12, 18, len(copy))])

    # MapAnything's world frame is camera 0's frame: re-express everything there.
    R0, c0 = rots[0], eyes[0]
    pts = (world - c0) @ R0
    centers = (eyes - c0) @ R0
    cam_rots = np.einsum("ji,cjk->cik", R0, rots)
    return pts, frames, centers, cam_rots


def fit(doubled=False, seed=1):
    rng = np.random.default_rng(seed)
    pts, frames, centers, rots = make_room(rng, doubled=doubled)
    return fit_room(pts, frames, len(rots), centers, rots)


def test_measures_the_room():
    room, quality = describe(fit(), 1.0)
    assert abs(room["ceilingHeightM"] - H) < 0.02
    assert abs(room["widthM"] - W) < 0.06  # X is the longer side
    assert abs(room["depthM"] - D) < 0.06
    assert room["box"]["sides"] == {"minX": "wall", "maxX": "wall", "minZ": "wall", "maxZ": "wall"}
    assert abs(room["floor"]["normal"][1] - 1) < 1e-3
    assert room["ceiling"]["tiltDeg"] < 1.0
    assert quality["pass"] == {"wallsNotDoubled": True, "flatFloor": True, "ceilingLevelWithin5cm": True}


def test_bookshelf_is_not_a_doubled_wall():
    # The shelf front is found as its own wall-like line, but the same frames saw it and the wall.
    for seed in range(1, 9):
        room, quality = describe(fit(seed=seed), 1.0)
        assert sum(w["axis"] == "z" for w in room["walls"]) >= 3
        assert not quality["wallsDoubled"], seed


def test_flags_a_doubled_wall():
    for seed in range(1, 9):
        room, quality = describe(fit(doubled=True, seed=seed), 1.0)
        assert quality["wallsDoubled"], seed
        assert quality["pass"]["wallsNotDoubled"] is False
        assert abs(quality["doubledWalls"][0]["gapM"] - 0.15) < 0.03


def test_scale_multiplies_every_length():
    f = fit()
    room1, _ = describe(f, 1.0)
    room2, _ = describe(f, 1.1)
    assert abs(room2["ceilingHeightM"] - 1.1 * room1["ceilingHeightM"]) < 0.002
    assert abs(room2["widthM"] - 1.1 * room1["widthM"]) < 0.011
    assert room2["box"]["max"][1] == room2["ceilingHeightM"]


def test_room_frame_puts_floor_at_zero_and_cameras_inside():
    rng = np.random.default_rng(1)
    pts, frames, centers, rots = make_room(rng)
    f = fit_room(pts, frames, len(rots), centers, rots)
    q = f.to_room(centers)
    assert np.allclose(q[:, 1], 1.5, atol=0.2)  # chest height above the floor
    assert np.all(np.abs(q[:, 0]) < W / 2) and np.all(np.abs(q[:, 2]) < D / 2)
    assert np.isclose(np.linalg.det(f.rotation), 1.0)
