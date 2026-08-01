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


def _component_sizes(mesh: o3d.geometry.TriangleMesh) -> list[int]:
    if len(mesh.triangles) == 0:
        return []
    _clusters, cluster_n_triangles, _areas = mesh.cluster_connected_triangles()
    return [int(value) for value in np.asarray(cluster_n_triangles).tolist()]


def _safe_bbox(mesh: o3d.geometry.TriangleMesh) -> list[float]:
    if len(mesh.vertices) == 0:
        return [0.0, 0.0, 0.0]
    return [float(value) for value in mesh.get_axis_aligned_bounding_box().get_extent()]


def _safe_volume_ml(mesh: o3d.geometry.TriangleMesh):
    if len(mesh.triangles) == 0:
        return None
    try:
        if not mesh.is_watertight():
            return None
        return abs(float(mesh.get_volume())) / 1000.0
    except RuntimeError:
        return None


def _safe_non_manifold_edges(mesh: o3d.geometry.TriangleMesh) -> int:
    if len(mesh.triangles) == 0:
        return 0
    try:
        return int(len(mesh.get_non_manifold_edges(allow_boundary_edges=False)))
    except Exception:
        return 0


def _safe_non_manifold_vertices(mesh: o3d.geometry.TriangleMesh) -> int:
    if len(mesh.triangles) == 0:
        return 0
    try:
        return int(len(mesh.get_non_manifold_vertices()))
    except Exception:
        return 0


def _mesh_stats(mesh: o3d.geometry.TriangleMesh) -> dict:
    component_sizes = _component_sizes(mesh)
    watertight = bool(mesh.is_watertight()) if len(mesh.triangles) > 0 else False
    return {
        "vertices": int(len(mesh.vertices)),
        "triangles": int(len(mesh.triangles)),
        "components": int(len(component_sizes)),
        "componentTriangleCounts": component_sizes,
        "watertight": watertight,
        "nonManifoldEdges": _safe_non_manifold_edges(mesh),
        "nonManifoldVertices": _safe_non_manifold_vertices(mesh),
        "boundingBoxMm": _safe_bbox(mesh),
        "volumeMl": _safe_volume_ml(mesh),
    }


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
    before = _mesh_stats(mesh)
    warnings = []

    working = copy.deepcopy(mesh)
    triangle_clusters, cluster_n_triangles, _ = working.cluster_connected_triangles() if len(working.triangles) else ([], [], [])
    cluster_n_triangles = np.asarray(cluster_n_triangles)
    removed_components = 0
    removed_triangles_from_components = 0
    if len(cluster_n_triangles) > 1:
        largest_cluster = int(cluster_n_triangles.argmax())
        triangle_clusters = np.asarray(triangle_clusters)
        triangles_to_remove = triangle_clusters != largest_cluster
        removed_components = int(len(cluster_n_triangles) - 1)
        removed_triangles_from_components = int(np.sum(triangles_to_remove))
        working.remove_triangles_by_mask(triangles_to_remove)
        working.remove_unreferenced_vertices()

    counts_after_components = {
        "vertices": int(len(working.vertices)),
        "triangles": int(len(working.triangles)),
    }

    working.remove_degenerate_triangles()
    working.remove_duplicated_triangles()
    working.remove_duplicated_vertices()
    working.remove_non_manifold_edges()
    working.remove_unreferenced_vertices()

    removed_vertices = max(0, counts_after_components["vertices"] - int(len(working.vertices)))
    removed_triangles = max(0, counts_after_components["triangles"] - int(len(working.triangles)))

    working = normalize_z_up(working, current_up_axis=current_up_axis)
    if len(working.triangles) > 0:
        try:
            working.orient_triangles()
        except RuntimeError:
            warnings.append("Open3D could not orient all triangle normals.")
        working.compute_vertex_normals()

    mesh = working
    # Open3D's is_watertight() segfaults natively on a 0-triangle mesh (confirmed
    # via isolated reproduction) rather than raising a catchable exception —
    # must guard before calling it, not just wrap in try/except.
    after = _mesh_stats(mesh)
    is_watertight = after["watertight"]
    if not is_watertight:
        warnings.append("Mesh remains non-watertight; no guaranteed hole filling is available in the current cleanup path.")
    if after["nonManifoldEdges"] or after["nonManifoldVertices"]:
        warnings.append("Non-manifold geometry remains after Open3D repair operations.")
    status = "cleaned" if is_watertight and not warnings else "partially-repaired"
    report = {
        "is_watertight": is_watertight,
        "triangle_count": len(mesh.triangles),
        "vertex_count": len(mesh.vertices),
        "status": status,
        "before": before,
        "operations": {
            "removedComponents": removed_components,
            "removedVertices": removed_vertices,
            "removedTriangles": removed_triangles + removed_triangles_from_components,
            "removedFloatingArtifactTriangles": removed_triangles_from_components,
            "filledHoles": 0,
            "normalOrientationAttempted": bool(len(mesh.triangles) > 0),
        },
        "after": after,
        "warnings": warnings,
    }
    return mesh, report
