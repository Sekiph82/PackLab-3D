import copy

import numpy as np
import open3d as o3d

_UP_AXIS_ROTATIONS = {
    "z": (0.0, 0.0, 0.0),
    "y": (-np.pi / 2, 0.0, 0.0),
    "x": (0.0, np.pi / 2, 0.0),
}


def remove_floating_artifacts(mesh: o3d.geometry.TriangleMesh) -> o3d.geometry.TriangleMesh:
    """Keeps only the largest connected triangle cluster, dropping disconnected debris."""
    mesh = copy.deepcopy(mesh)
    triangle_clusters, cluster_n_triangles, _ = mesh.cluster_connected_triangles()
    triangle_clusters = np.asarray(triangle_clusters)
    cluster_n_triangles = np.asarray(cluster_n_triangles)
    if len(cluster_n_triangles) <= 1:
        return mesh
    largest_cluster = cluster_n_triangles.argmax()
    triangles_to_remove = triangle_clusters != largest_cluster
    mesh.remove_triangles_by_mask(triangles_to_remove)
    mesh.remove_unreferenced_vertices()
    return mesh


def repair_manifold(mesh: o3d.geometry.TriangleMesh) -> o3d.geometry.TriangleMesh:
    """Degenerate/duplicate/non-manifold cleanup.

    This improves manifoldness but does not guarantee full watertightness for
    arbitrary open holes — true hole-filling needs a dedicated tool (e.g. PyMeshFix),
    not yet integrated. Check the result with mesh.is_watertight().
    """
    mesh = copy.deepcopy(mesh)
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()
    return mesh


def normalize_z_up(
    mesh: o3d.geometry.TriangleMesh, current_up_axis: str = "y"
) -> o3d.geometry.TriangleMesh:
    if current_up_axis not in _UP_AXIS_ROTATIONS:
        raise ValueError(f"Unsupported up axis: {current_up_axis}")
    mesh = copy.deepcopy(mesh)
    rotation = _UP_AXIS_ROTATIONS[current_up_axis]
    if any(rotation):
        R = mesh.get_rotation_matrix_from_xyz(rotation)
        mesh.rotate(R, center=(0, 0, 0))
    return mesh


def cleanup_mesh(mesh: o3d.geometry.TriangleMesh, current_up_axis: str = "y"):
    """Runs the full cleanup pass: floating-artifact removal, manifold repair, Z-up normalization.

    Returns (cleaned_mesh, report) where report has is_watertight/triangle_count/vertex_count.
    """
    mesh = remove_floating_artifacts(mesh)
    mesh = repair_manifold(mesh)
    mesh = normalize_z_up(mesh, current_up_axis=current_up_axis)
    mesh.compute_vertex_normals()
    # Open3D's is_watertight() segfaults natively on a 0-triangle mesh (confirmed
    # via isolated reproduction) rather than raising a catchable exception —
    # must guard before calling it, not just wrap in try/except.
    is_watertight = bool(mesh.is_watertight()) if len(mesh.triangles) > 0 else False
    report = {
        "is_watertight": is_watertight,
        "triangle_count": len(mesh.triangles),
        "vertex_count": len(mesh.vertices),
    }
    return mesh, report
