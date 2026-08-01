import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.mesh_scaling.scaling import (
    TargetDimensions,
    compute_scale_factors,
    estimated_volume_ml,
    get_bounding_size,
    scale_mesh_to_dimensions,
)


def _box(w, h, d):
    return o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)


def test_get_bounding_size():
    mesh = _box(10, 20, 30)
    np.testing.assert_allclose(get_bounding_size(mesh), [10, 20, 30])


def test_compute_scale_factors_per_axis():
    current = np.array([10.0, 20.0, 30.0])
    target = TargetDimensions(width_mm=50, depth_mm=40, height_mm=90)
    factors = compute_scale_factors(current, target)
    np.testing.assert_allclose(factors, [5.0, 2.0, 3.0])


def test_compute_scale_factors_diameter_applies_to_x_and_y():
    current = np.array([10.0, 10.0, 30.0])
    target = TargetDimensions(diameter_mm=25, height_mm=60)
    factors = compute_scale_factors(current, target)
    np.testing.assert_allclose(factors, [2.5, 2.5, 2.0])


def test_compute_scale_factors_uniform():
    current = np.array([10.0, 20.0, 30.0])
    target = TargetDimensions(height_mm=60)
    factors = compute_scale_factors(current, target, uniform=True)
    np.testing.assert_allclose(factors, [2.0, 2.0, 2.0])


def test_compute_scale_factors_requires_at_least_one_dimension():
    with pytest.raises(ValueError):
        compute_scale_factors(np.array([1.0, 1.0, 1.0]), TargetDimensions())


def test_scale_mesh_to_dimensions_accuracy():
    mesh = _box(10, 20, 30)
    target = TargetDimensions(width_mm=100, depth_mm=100, height_mm=100)
    scaled, factors, resulting_size = scale_mesh_to_dimensions(mesh, target)
    np.testing.assert_allclose(resulting_size, [100, 100, 100], atol=1e-6)
    np.testing.assert_allclose(factors, [10.0, 5.0, 10.0 / 3.0])


def test_scale_mesh_to_dimensions_aligns_min_corner_to_origin():
    mesh = _box(10, 20, 30)
    mesh.translate((5, 5, 5))
    target = TargetDimensions(width_mm=20, depth_mm=40, height_mm=60)
    scaled, _, _ = scale_mesh_to_dimensions(mesh, target)
    min_bound = np.asarray(scaled.get_axis_aligned_bounding_box().min_bound)
    np.testing.assert_allclose(min_bound, [0, 0, 0], atol=1e-6)


def test_estimated_volume_ml_watertight_box():
    mesh = _box(10, 10, 10)
    assert estimated_volume_ml(mesh) == pytest.approx(1.0, rel=1e-6)
