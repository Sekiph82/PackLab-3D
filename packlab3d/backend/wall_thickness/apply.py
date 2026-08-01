import copy
from dataclasses import dataclass
from typing import Optional

import numpy as np
import open3d as o3d

from packlab3d.backend.mesh_scaling.scaling import get_bounding_size


@dataclass
class ThicknessResult:
    outer: o3d.geometry.TriangleMesh
    inner: o3d.geometry.TriangleMesh
    combined: o3d.geometry.TriangleMesh
    thickness_mm: float
    bounding_box_mm: np.ndarray
    outer_volume_ml: Optional[float]
    inner_volume_ml: Optional[float]
    material_volume_ml: Optional[float]
    is_watertight: bool
    self_intersecting: bool


def _safe_volume_ml(mesh: o3d.geometry.TriangleMesh) -> Optional[float]:
    if len(mesh.triangles) == 0:
        # Open3D's get_volume() segfaults natively on a 0-triangle mesh
        # (confirmed via isolated reproduction), not a catchable RuntimeError.
        return None
    try:
        return abs(mesh.get_volume()) / 1000.0
    except RuntimeError:
        return None


def apply_wall_thickness(
    mesh: o3d.geometry.TriangleMesh, thickness_mm: float
) -> ThicknessResult:
    """Thickens a closed mesh uniformly by offsetting an inner shell inward along
    vertex normals by `thickness_mm`.

    The input mesh becomes the outer wall; a second, inward-offset, winding-flipped
    copy becomes the inner cavity wall. Together they represent a hollow shell of
    the given wall thickness — `outer_volume - inner_volume` is the material volume.

    This is an approximation: exact only for locally planar/near-planar regions.
    Highly concave geometry or thickness close to the mesh's local feature size can
    make the inner shell self-intersect — checked via `is_self_intersecting()` and
    reported in the result rather than silently producing broken geometry.
    """
    if not np.isfinite(thickness_mm) or thickness_mm <= 0:
        # NaN/Inf must be checked explicitly: `NaN <= 0` and `NaN >= x` are both
        # False, so a non-finite thickness would otherwise silently bypass this
        # guard (and the extent check below) and produce a NaN-vertexed mesh.
        raise ValueError("thickness_mm must be a positive, finite number.")

    outer = copy.deepcopy(mesh)
    outer.compute_vertex_normals()

    extent = get_bounding_size(outer)
    if thickness_mm >= extent.min() / 2:
        raise ValueError(
            f"thickness_mm ({thickness_mm}) is too large relative to the mesh's "
            f"smallest extent ({extent.min():.3f} mm); it would collapse the cavity."
        )

    vertex_normals = np.asarray(outer.vertex_normals)
    vertices = np.asarray(outer.vertices)
    inner_vertices = vertices - vertex_normals * thickness_mm

    inner = copy.deepcopy(outer)
    inner.vertices = o3d.utility.Vector3dVector(inner_vertices)
    triangles = np.asarray(inner.triangles)
    inner.triangles = o3d.utility.Vector3iVector(triangles[:, [0, 2, 1]])
    inner.compute_vertex_normals()

    # Defense in depth: the extent check above already rejects an empty input
    # mesh before this point, but is_self_intersecting()/is_watertight() both
    # segfault natively (not a catchable exception) on a 0-triangle mesh, so
    # guard them directly too rather than relying solely on that earlier check.
    self_intersecting = bool(inner.is_self_intersecting()) if len(inner.triangles) > 0 else False
    combined = outer + inner

    outer_vol = _safe_volume_ml(outer)
    inner_vol = _safe_volume_ml(inner)
    material_vol = (
        outer_vol - inner_vol if outer_vol is not None and inner_vol is not None else None
    )

    return ThicknessResult(
        outer=outer,
        inner=inner,
        combined=combined,
        thickness_mm=thickness_mm,
        bounding_box_mm=extent,
        outer_volume_ml=outer_vol,
        inner_volume_ml=inner_vol,
        material_volume_ml=material_vol,
        is_watertight=(
            bool(outer.is_watertight() and inner.is_watertight())
            if len(outer.triangles) > 0 and len(inner.triangles) > 0
            else False
        ),
        self_intersecting=self_intersecting,
    )
