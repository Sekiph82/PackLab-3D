import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.wall_thickness.apply import apply_wall_thickness


def _box(size=100):
    return o3d.geometry.TriangleMesh.create_box(size, size, size)


def test_apply_wall_thickness_preserves_outer_bbox():
    mesh = _box(100)
    result = apply_wall_thickness(mesh, thickness_mm=5)
    np.testing.assert_allclose(result.bounding_box_mm, [100, 100, 100])
    np.testing.assert_allclose(
        np.asarray(result.outer.get_axis_aligned_bounding_box().get_extent()), [100, 100, 100]
    )


def test_apply_wall_thickness_shrinks_inner_shell():
    mesh = _box(100)
    result = apply_wall_thickness(mesh, thickness_mm=5)
    inner_extent = np.asarray(result.inner.get_axis_aligned_bounding_box().get_extent())
    assert np.all(inner_extent < 100)
    assert np.all(inner_extent > 0)


def test_apply_wall_thickness_volumes_and_watertightness():
    mesh = _box(100)
    result = apply_wall_thickness(mesh, thickness_mm=5)

    assert result.outer_volume_ml == pytest.approx(1000.0, rel=1e-3)
    assert result.inner_volume_ml < result.outer_volume_ml
    assert result.material_volume_ml == pytest.approx(
        result.outer_volume_ml - result.inner_volume_ml, rel=1e-6
    )
    assert result.material_volume_ml > 0

    assert result.is_watertight is True
    assert result.outer_watertight is True
    assert result.inner_watertight is True
    assert result.combined_shell_watertight is True
    assert result.self_intersecting is False
    assert result.confidence in {"MEDIUM", "HIGH"}
    assert result.estimated_internal_capacity_ml == pytest.approx(result.inner_volume_ml)


def test_apply_wall_thickness_combined_mesh_has_both_shells():
    mesh = _box(100)
    result = apply_wall_thickness(mesh, thickness_mm=5)
    assert len(result.combined.triangles) == len(result.outer.triangles) + len(
        result.inner.triangles
    )


def test_apply_wall_thickness_rejects_non_positive_thickness():
    mesh = _box(100)
    with pytest.raises(ValueError):
        apply_wall_thickness(mesh, thickness_mm=0)
    with pytest.raises(ValueError):
        apply_wall_thickness(mesh, thickness_mm=-1)


def test_apply_wall_thickness_rejects_thickness_too_large():
    mesh = _box(100)
    with pytest.raises(ValueError):
        apply_wall_thickness(mesh, thickness_mm=60)  # >= half of smallest extent (50)
