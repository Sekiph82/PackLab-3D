import copy
from dataclasses import dataclass
from typing import Optional

import numpy as np
import open3d as o3d

# Axis convention: X=width, Y=depth, Z=height (Z-up). Units: millimeters.


@dataclass
class TargetDimensions:
    width_mm: Optional[float] = None
    height_mm: Optional[float] = None
    depth_mm: Optional[float] = None
    diameter_mm: Optional[float] = None
    volume_ml: Optional[float] = None


def get_bounding_size(mesh: o3d.geometry.TriangleMesh) -> np.ndarray:
    return np.asarray(mesh.get_axis_aligned_bounding_box().get_extent())


def _target_size_vector(current_size: np.ndarray, target: TargetDimensions) -> np.ndarray:
    x = target.width_mm
    y = target.depth_mm
    z = target.height_mm
    if target.diameter_mm is not None:
        x = target.diameter_mm if x is None else x
        y = target.diameter_mm if y is None else y
    if x is None and y is None and z is None:
        raise ValueError(
            "At least one target dimension (width, height, depth, or diameter) is required."
        )
    return np.array(
        [
            x if x is not None else current_size[0],
            y if y is not None else current_size[1],
            z if z is not None else current_size[2],
        ],
        dtype=float,
    )


def compute_scale_factors(
    current_size: np.ndarray, target: TargetDimensions, uniform: bool = False
) -> np.ndarray:
    current_size = np.asarray(current_size, dtype=float)
    if np.any(~np.isfinite(current_size)) or np.any(current_size <= 0):
        # NaN/Inf must be checked explicitly: `NaN <= 0` is False, so a NaN extent
        # (e.g. from a mesh with non-finite vertex coordinates) would otherwise
        # silently pass this guard and produce NaN/Inf scale factors downstream.
        raise ValueError("Mesh has zero, negative, or non-finite extent on at least one axis.")

    target_vec = _target_size_vector(current_size, target)
    if np.any(~np.isfinite(target_vec)):
        raise ValueError("Target dimensions must be finite numbers.")
    factors = target_vec / current_size

    if uniform:
        constrained = np.array(
            [
                target.width_mm is not None or target.diameter_mm is not None,
                target.depth_mm is not None or target.diameter_mm is not None,
                target.height_mm is not None,
            ]
        )
        uniform_factor = factors[constrained].mean() if constrained.any() else 1.0
        factors = np.full(3, uniform_factor)

    return factors


def scale_mesh_to_dimensions(
    mesh: o3d.geometry.TriangleMesh, target: TargetDimensions, uniform: bool = False
):
    """Scale mesh to real-world target dimensions (mm) and align its min corner to the origin.

    Returns (scaled_mesh, scale_factors_xyz, resulting_size_xyz).
    """
    mesh = copy.deepcopy(mesh)
    current_size = get_bounding_size(mesh)
    scale_factors = compute_scale_factors(current_size, target, uniform=uniform)

    min_bound = np.asarray(mesh.get_axis_aligned_bounding_box().min_bound)
    mesh.translate(-min_bound)

    vertices = np.asarray(mesh.vertices) * scale_factors
    mesh.vertices = o3d.utility.Vector3dVector(vertices)
    mesh.compute_vertex_normals()

    resulting_size = get_bounding_size(mesh)
    return mesh, scale_factors, resulting_size


def estimated_volume_ml(mesh: o3d.geometry.TriangleMesh) -> Optional[float]:
    """Returns computed mesh volume in mL, or None if the mesh isn't watertight.

    Used for post-scale validation against a user-supplied target volume_ml, not as
    a scaling input — solving for a missing dimension from volume alone requires a
    shape-specific formula (cylinder, box, ...) not specified in tasks.md.
    """
    if len(mesh.triangles) == 0:
        # Open3D's get_volume() segfaults natively on a 0-triangle mesh
        # (confirmed via isolated reproduction), not a catchable RuntimeError.
        return None
    try:
        return mesh.get_volume() / 1000.0
    except RuntimeError:
        return None
