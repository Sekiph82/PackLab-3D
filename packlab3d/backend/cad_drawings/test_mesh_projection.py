import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.cad_drawings.mesh_projection import (
    get_view_dimensions,
    project_silhouette,
    render_view_dxf,
    render_view_svg,
)


def _box(w, h, d):
    return o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)


def test_project_silhouette_top_matches_xy_extent():
    mesh = _box(10, 20, 30)  # X=10 width, Y=20 depth, Z=30 height
    hull = project_silhouette(mesh, "top")  # XY
    np.testing.assert_allclose(hull[:, 0].max() - hull[:, 0].min(), 10)
    np.testing.assert_allclose(hull[:, 1].max() - hull[:, 1].min(), 20)


def test_project_silhouette_front_matches_xz_extent():
    mesh = _box(10, 20, 30)
    hull = project_silhouette(mesh, "front")  # XZ
    np.testing.assert_allclose(hull[:, 0].max() - hull[:, 0].min(), 10)
    np.testing.assert_allclose(hull[:, 1].max() - hull[:, 1].min(), 30)


def test_project_silhouette_side_matches_yz_extent():
    mesh = _box(10, 20, 30)
    hull = project_silhouette(mesh, "side")  # YZ
    np.testing.assert_allclose(hull[:, 0].max() - hull[:, 0].min(), 20)
    np.testing.assert_allclose(hull[:, 1].max() - hull[:, 1].min(), 30)


def test_project_silhouette_rejects_unknown_view():
    with pytest.raises(ValueError):
        project_silhouette(_box(1, 1, 1), "back")


def test_get_view_dimensions_matches_projection():
    mesh = _box(10, 20, 30)
    assert get_view_dimensions(mesh, "top") == (10.0, 20.0)
    assert get_view_dimensions(mesh, "front") == (10.0, 30.0)
    assert get_view_dimensions(mesh, "side") == (20.0, 30.0)


def test_get_view_dimensions_rejects_unknown_view():
    with pytest.raises(ValueError):
        get_view_dimensions(_box(1, 1, 1), "back")


def test_render_view_svg_contains_dimensions_and_label():
    mesh = _box(10, 20, 30)
    hull = project_silhouette(mesh, "front")
    svg = render_view_svg(hull, 10.0, 30.0, "Front View")
    assert "<svg" in svg
    assert "Front View" in svg
    assert "10.0 mm" in svg
    assert "30.0 mm" in svg
    assert "#0057FF" in svg  # brand blue for dimension lines


def test_render_view_dxf_is_structurally_valid():
    mesh = _box(10, 20, 30)
    hull = project_silhouette(mesh, "front")
    dxf = render_view_dxf(hull, 10.0, 30.0, "Front View")
    assert dxf.startswith("0\nSECTION")
    assert dxf.rstrip().endswith("EOF")
    assert "ENTITIES" in dxf
    assert "POLYLINE" in dxf
    assert "SEQEND" in dxf
    assert "10.0 mm" in dxf
    assert "30.0 mm" in dxf
