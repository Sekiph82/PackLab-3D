import enum

import numpy as np


class UVMode(str, enum.Enum):
    CYLINDRICAL = "cylindrical"
    BOX = "box"
    BOTTLE_BLEND = "bottle_blend"


def _face_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    v0, v1, v2 = vertices[faces[:, 0]], vertices[faces[:, 1]], vertices[faces[:, 2]]
    normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.where(norms == 0, 1, norms)


def unwrap_cylindrical(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Cylindrical projection around the Z axis (Stage 3/4's Z-up convention).

    u = angle around Z (0-1), v = height along Z (0-1). KNOWN LIMITATION: the
    single seam where angle wraps from ~360deg back to 0deg is not specially
    handled — the row of triangles straddling it will show a compressed/pinched
    texture strip. This is the standard, well-known artifact of naive cylindrical
    UV unwrapping; avoiding it requires extending U past 1.0 at the seam, which
    conflicts with the "normalize UVs to 0-1" requirement, so it's accepted and
    documented here rather than hidden.
    """
    center_xy = vertices[:, :2].mean(axis=0)
    z_min, z_max = vertices[:, 2].min(), vertices[:, 2].max()
    z_range = max(z_max - z_min, 1e-9)

    angles = np.arctan2(vertices[:, 1] - center_xy[1], vertices[:, 0] - center_xy[0])
    u = (angles + np.pi) / (2 * np.pi)
    v = (vertices[:, 2] - z_min) / z_range

    per_vertex_uv = np.stack([u, v], axis=1)
    return per_vertex_uv[faces]  # (F, 3, 2)


def unwrap_box(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Box projection: each triangle assigned to whichever of its face normal's
    dominant axis (+-X/+-Y/+-Z), then packed into a 3x2 UV atlas grid (one cell
    per cube face) so the 6 faces don't overlap in texture space.
    """
    normals = _face_normals(vertices, faces)
    dominant_axis = np.argmax(np.abs(normals), axis=1)
    sign = np.sign(normals[np.arange(len(normals)), dominant_axis]).astype(int)

    cell_map = {
        (0, 1): (0, 0), (0, -1): (1, 0),
        (1, 1): (2, 0), (1, -1): (0, 1),
        (2, 1): (1, 1), (2, -1): (2, 1),
    }

    bbox_min = vertices.min(axis=0)
    bbox_max = vertices.max(axis=0)
    bbox_size = np.maximum(bbox_max - bbox_min, 1e-9)

    corner_uvs = np.zeros((len(faces), 3, 2))
    for i in range(len(faces)):
        axis = int(dominant_axis[i])
        s = int(sign[i]) if sign[i] != 0 else 1
        col, row = cell_map[(axis, s)]
        other_axes = [a for a in range(3) if a != axis]
        for k in range(3):
            vtx = vertices[faces[i, k]]
            local_u = (vtx[other_axes[0]] - bbox_min[other_axes[0]]) / bbox_size[other_axes[0]]
            local_v = (vtx[other_axes[1]] - bbox_min[other_axes[1]]) / bbox_size[other_axes[1]]
            corner_uvs[i, k] = [(col + local_u) / 3.0, (row + local_v) / 2.0]
    return corner_uvs


def unwrap_bottle_blend(vertices: np.ndarray, faces: np.ndarray, cap_normal_threshold: float = 0.7) -> np.ndarray:
    """Cylindrical body (bottom 80% of V) blended with planar top/bottom caps
    (top 20% of V, split left/right in U) — faces are routed to one or the
    other based on how vertical their normal is.
    """
    normals = _face_normals(vertices, faces)
    is_cap = np.abs(normals[:, 2]) > cap_normal_threshold
    is_top_cap = is_cap & (normals[:, 2] > 0)

    center_xy = vertices[:, :2].mean(axis=0)
    z_min, z_max = vertices[:, 2].min(), vertices[:, 2].max()
    z_range = max(z_max - z_min, 1e-9)
    bbox_min = vertices.min(axis=0)
    bbox_max = vertices.max(axis=0)
    x_range = max(bbox_max[0] - bbox_min[0], 1e-9)
    y_range = max(bbox_max[1] - bbox_min[1], 1e-9)
    body_v_range = 0.8

    corner_uvs = np.zeros((len(faces), 3, 2))
    for i in range(len(faces)):
        cap = bool(is_cap[i])
        top_cap = bool(is_top_cap[i])
        for k in range(3):
            vtx = vertices[faces[i, k]]
            if not cap:
                angle = np.arctan2(vtx[1] - center_xy[1], vtx[0] - center_xy[0])
                u = (angle + np.pi) / (2 * np.pi)
                v = ((vtx[2] - z_min) / z_range) * body_v_range
            else:
                local_u = (vtx[0] - bbox_min[0]) / x_range
                local_v = (vtx[1] - bbox_min[1]) / y_range
                u = 0.5 + local_u * 0.5 if top_cap else local_u * 0.5
                v = body_v_range + local_v * (1 - body_v_range)
            corner_uvs[i, k] = [u, v]
    return corner_uvs


def compute_uv(vertices: np.ndarray, faces: np.ndarray, mode) -> np.ndarray:
    mode = UVMode(mode)
    if len(faces) == 0:
        # vertices.min(axis=0)/max(axis=0) raise on a zero-size array — every
        # unwrap function hits this the same way, so guard once here.
        return np.zeros((0, 3, 2))
    if mode == UVMode.CYLINDRICAL:
        return unwrap_cylindrical(vertices, faces)
    if mode == UVMode.BOX:
        return unwrap_box(vertices, faces)
    if mode == UVMode.BOTTLE_BLEND:
        return unwrap_bottle_blend(vertices, faces)
    raise ValueError(f"Unknown UV mode: {mode}")


def validate_uvs(corner_uvs: np.ndarray, tolerance: float = 1e-6) -> dict:
    if corner_uvs.size == 0:
        # .min()/.max() raise on a zero-size array — an empty UV set is
        # trivially "in range" (there's nothing out of range).
        return {"in_range": True, "min": None, "max": None}
    uv_min = float(corner_uvs.min())
    uv_max = float(corner_uvs.max())
    return {
        "in_range": bool(uv_min >= -tolerance and uv_max <= 1.0 + tolerance),
        "min": uv_min,
        "max": uv_max,
    }


def unweld_mesh_with_uvs(vertices: np.ndarray, faces: np.ndarray, corner_uvs: np.ndarray):
    """Duplicates every vertex per triangle-corner so each gets exactly one UV.

    This is the standard fix for hard UV seams (box-face boundaries, the
    cylindrical wrap seam): a shared vertex generally needs a different UV per
    adjacent face, which a per-vertex UV array can't represent. Trade-off: the
    output mesh is fully flat-shaded (3x the vertex count, no shared vertices),
    which is an acceptable v1 limitation for a label-mapping preview mesh.
    """
    new_vertices = vertices[faces.reshape(-1)]
    new_uvs = corner_uvs.reshape(-1, 2)
    new_faces = np.arange(len(new_vertices)).reshape(-1, 3)
    return new_vertices, new_faces, new_uvs
