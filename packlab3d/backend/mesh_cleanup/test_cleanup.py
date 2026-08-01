import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.mesh_cleanup.cleanup import (
    cleanup_mesh,
    normalize_z_up,
    remove_floating_artifacts,
    repair_manifold,
)


def _box(w, h, d):
    return o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)


def test_remove_floating_artifacts_keeps_largest_cluster():
    main = o3d.geometry.TriangleMesh.create_sphere(radius=5, resolution=20)
    stray = _box(0.1, 0.1, 0.1)
    stray.translate((1000, 1000, 1000))
    combined = main + stray

    cleaned = remove_floating_artifacts(combined)

    assert len(cleaned.triangles) == len(main.triangles)
    max_bound = np.asarray(cleaned.get_axis_aligned_bounding_box().max_bound)
    assert np.all(max_bound < 20)


def test_remove_floating_artifacts_noop_on_single_cluster():
    mesh = _box(10, 10, 10)
    cleaned = remove_floating_artifacts(mesh)
    assert len(cleaned.triangles) == len(mesh.triangles)


def test_repair_manifold_preserves_watertight_box():
    mesh = _box(10, 10, 10)
    repaired = repair_manifold(mesh)
    assert repaired.is_watertight()


def test_normalize_z_up_from_y_moves_tall_axis_to_z():
    mesh = _box(2, 50, 2)  # tall along Y
    rotated = normalize_z_up(mesh, current_up_axis="y")
    extent = np.asarray(rotated.get_axis_aligned_bounding_box().get_extent())
    assert extent[2] == pytest.approx(50, abs=1e-6)
    assert extent[1] == pytest.approx(2, abs=1e-6)


def test_normalize_z_up_from_x_moves_tall_axis_to_z():
    mesh = _box(50, 2, 2)  # tall along X
    rotated = normalize_z_up(mesh, current_up_axis="x")
    extent = np.asarray(rotated.get_axis_aligned_bounding_box().get_extent())
    assert extent[2] == pytest.approx(50, abs=1e-6)
    assert extent[0] == pytest.approx(2, abs=1e-6)


def test_normalize_z_up_noop_when_already_z():
    mesh = _box(2, 2, 50)
    rotated = normalize_z_up(mesh, current_up_axis="z")
    extent = np.asarray(rotated.get_axis_aligned_bounding_box().get_extent())
    np.testing.assert_allclose(extent, [2, 2, 50])


def test_normalize_z_up_rejects_unknown_axis():
    with pytest.raises(ValueError):
        normalize_z_up(_box(1, 1, 1), current_up_axis="w")


def test_cleanup_mesh_full_pipeline():
    main = o3d.geometry.TriangleMesh.create_sphere(radius=5, resolution=20)
    stray = _box(0.1, 0.1, 0.1)
    stray.translate((1000, 1000, 1000))
    combined = main + stray

    cleaned, report = cleanup_mesh(combined, current_up_axis="z")

    assert report["triangle_count"] == len(main.triangles)
    assert report["is_watertight"] is True
    assert report["vertex_count"] == len(cleaned.vertices)
