"""A solid, connected surface of the room from MapAnything's depth maps, for the walkable 3D.

Points drawn as discs read as circles up close. This fuses every depth map into one truncated signed
distance volume (TSDF: each pixel votes, along its ray, for where the surface is), takes the surface
with marching cubes, colours each vertex from the frames, and thins the triangles for the web.
Scatter-based fusion along each ray (a few samples around the measured depth), so it's fast in numpy.
Written as a BRM1 file (export.mesh_bytes), which the server merges across areas and the viewer draws.
"""

import numpy as np

from .export import mesh_bytes

VOXEL = 0.04  # m
TRUNC = 3  # voxels either side of the measured depth
MAX_FACES = 300_000  # after thinning: about 5 MB
MIN_VOTES = 3  # samples a voxel needs before it counts as seen
MIN_VIEWS = 2  # frames that must see a voxel: a smear in one frame doesn't make a surface
EDGE_JUMP = 0.03  # a pixel whose neighbour's depth jumps by this share sits on an edge, where depth smears
BATCH = 8_000_000  # samples summed into the volume at a time, to keep memory flat


def _edges(z: np.ndarray) -> np.ndarray:
    """Pixels beside a jump in depth. At an object's edge the depth runs from the near surface to the far
    one, which fuses into thin fins sticking out of the walls."""
    edge = np.zeros(z.shape, bool)
    for axis in (0, 1):
        a, b = (z[1:], z[:-1]) if axis == 0 else (z[:, 1:], z[:, :-1])
        jump = np.abs(a - b) > EDGE_JUMP * np.minimum(a, b)
        if axis == 0:
            edge[1:] |= jump
            edge[:-1] |= jump
        else:
            edge[:, 1:] |= jump
            edge[:, :-1] |= jump
    return edge


def _rays(v: dict, stride: int = 1):
    """Each valid pixel's ray direction in the world (unit depth), the camera centre, depth and colour."""
    z = v["depth"][::stride, ::stride]
    m = v["mask"][::stride, ::stride] & (z > 0) & ~_edges(z)
    vv, uu = np.nonzero(m)
    K = v["K"]
    cam = np.stack([(uu * stride - K[0, 2]) / K[0, 0], (vv * stride - K[1, 2]) / K[1, 1], np.ones(len(uu))], 1).astype(np.float32)
    return cam @ v["pose"][:3, :3].T, v["pose"][:3, 3], z[m], v["rgb"][::stride, ::stride][m]


def fuse(views: list[dict], to_room, s: float = 1.0, voxel: float = VOXEL) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    """TSDF fusion. Returns (vertices, faces, colours) in the room frame, scaled, or None if empty.
    views: MapAnything outputs with depth, mask, K, pose (camera-to-world), rgb."""
    from skimage.measure import marching_cubes

    # The volume's extent from a light sample of the surface.
    surface = []
    for v in views:
        d, t, z, _ = _rays(v, 4)
        if len(z):
            surface.append(d * z[:, None] + t)
    if not surface:
        return None
    pts = to_room(np.concatenate(surface)) * s
    lo = np.percentile(pts, 0.2, axis=0) - (TRUNC + 2) * voxel
    hi = np.percentile(pts, 99.8, axis=0) + (TRUNC + 2) * voxel
    dims = np.ceil((hi - lo) / voxel).astype(int) + 1
    size = int(np.prod(dims))
    weight = np.zeros(size, np.float32)
    tsdf = np.zeros(size, np.float32)
    col = np.zeros((size, 3), np.float32)
    views_seen = np.zeros(size, np.uint8)

    def add(flat, sdf, rgb):
        flat, sdf, rgb = np.concatenate(flat), np.concatenate(sdf), np.concatenate(rgb)
        weight[:] += np.bincount(flat, minlength=size)
        tsdf[:] += np.bincount(flat, weights=sdf, minlength=size)
        for c in range(3):
            col[:, c] += np.bincount(flat, weights=rgb[:, c], minlength=size)

    offsets = np.arange(-TRUNC, TRUNC + 1, dtype=np.float32) * voxel
    flat, sdf, rgb, pending = [], [], [], 0
    for v in views:
        d, t, z, c = _rays(v)
        if not len(z):
            continue
        c = c.astype(np.float32)
        first = len(flat)
        # Samples along each ray around the measured depth; signed distance positive in front of it.
        for off in offsets:
            ijk = np.floor((to_room(d * (z + off)[:, None] + t) * s - lo) / voxel).astype(np.int64)
            ok = np.all((ijk >= 0) & (ijk < dims), axis=1)
            flat.append(np.ravel_multi_index(tuple(ijk[ok].T), dims))
            sdf.append(np.full(int(ok.sum()), -off / (TRUNC * voxel), np.float32))
            rgb.append(c[ok])
            pending += int(ok.sum())
        # Fancy-index += counts each voxel once per frame, however many of its samples land there.
        views_seen[np.concatenate(flat[first:])] += 1
        if pending > BATCH:
            add(flat, sdf, rgb)
            flat, sdf, rgb, pending = [], [], [], 0
    if flat:
        add(flat, sdf, rgb)
    seen = weight > 0
    tsdf[seen] /= weight[seen]
    col[seen] /= weight[seen, None]
    # A surface needs a few votes: lone samples make floaters.
    seen = (weight >= MIN_VOTES) & (views_seen >= MIN_VIEWS)
    tsdf[~seen] = 1.0
    volume = tsdf.reshape(dims)
    if volume.min() >= 0 or volume.max() <= 0:
        return None
    verts, faces, _, _ = marching_cubes(volume, level=0.0, allow_degenerate=False)
    # Unseen space was filled in as empty, which puts a false skin where the band behind a wall meets it.
    # A real crossing has both of its voxels seen.
    seen = seen.reshape(dims)
    a = np.clip(np.floor(verts).astype(int), 0, dims - 1)
    b = np.clip(np.ceil(verts).astype(int), 0, dims - 1)
    real = seen[a[:, 0], a[:, 1], a[:, 2]] & seen[b[:, 0], b[:, 1], b[:, 2]]
    faces = faces[real[faces].all(1)]
    if not len(faces):
        return None
    # Colour: the voxel each vertex sits in.
    vi = np.clip(np.round(verts).astype(int), 0, dims - 1)
    colours = col.reshape(*dims, 3)[vi[:, 0], vi[:, 1], vi[:, 2]].clip(0, 255).astype(np.uint8)
    verts = verts * voxel + lo
    return _compact(verts.astype(np.float32), faces.astype(np.int64), colours)


def _compact(verts, faces, colours):
    """Drop vertices no face uses."""
    used = np.unique(faces)
    remap = np.full(len(verts), -1, np.int64)
    remap[used] = np.arange(len(used))
    return verts[used], remap[faces], colours[used]


def thin(verts: np.ndarray, faces: np.ndarray, colours: np.ndarray, max_faces: int = MAX_FACES):
    """Fewer triangles for the web, keeping the shape (quadric decimation), colours carried over."""
    if len(faces) <= max_faces:
        return verts, faces, colours
    import fast_simplification
    from scipy.spatial import cKDTree

    v2, f2 = fast_simplification.simplify(verts, faces.astype(np.int32), target_reduction=1 - max_faces / len(faces))
    _, near = cKDTree(verts).query(v2)
    return v2.astype(np.float32), f2.astype(np.int64), colours[near]


def drop_specks(verts: np.ndarray, faces: np.ndarray, colours: np.ndarray):
    """Keep the bigger connected pieces: specks of noise float on their own."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    n = len(verts)
    edges = np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]])
    graph = coo_matrix((np.ones(len(edges), np.int8), (edges[:, 0], edges[:, 1])), shape=(n, n))
    _, label = connected_components(graph, directed=False)
    face_label = label[faces[:, 0]]
    counts = np.bincount(face_label)
    keep = counts[face_label] >= max(200, 0.002 * len(faces))
    return _compact(verts, faces[keep], colours)


def room_mesh(views: list[dict], to_room, s: float = 1.0, max_faces: int = MAX_FACES) -> bytes:
    fused = fuse(views, to_room, s)
    if fused is None:
        return b""
    return mesh_bytes(*drop_specks(*thin(*fused, max_faces=max_faces)))
