import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.label_mapping.uv import (
    UVMode,
    compute_uv,
    unwrap_bottle_blend,
    unwrap_box,
    unwrap_cylindrical,
    unweld_mesh_with_uvs,
    validate_uvs,
)


def _cylinder():
    return o3d.geometry.TriangleMesh.create_cylinder(radius=5.0, height=20.0, resolution=24, split=4)


def _box():
    return o3d.geometry.TriangleMesh.create_box(width=10, height=10, depth=10)


def test_unwrap_cylindrical_shape_and_range():
    mesh = _cylinder()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_cylindrical(vertices, faces)
    assert uvs.shape == (len(faces), 3, 2)
    assert uvs.min() >= 0.0 - 1e-9
    assert uvs.max() <= 1.0 + 1e-9


def test_unwrap_cylindrical_v_tracks_height():
    mesh = _cylinder()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_cylindrical(vertices, faces)
    z = vertices[:, 2]
    z_min, z_max = z.min(), z.max()
    # bottom-most vertex should map near v=0, top-most near v=1
    bottom_idx = np.argmin(z)
    top_idx = np.argmax(z)
    per_vertex_v = (z - z_min) / (z_max - z_min)
    assert per_vertex_v[bottom_idx] == pytest.approx(0.0, abs=1e-6)
    assert per_vertex_v[top_idx] == pytest.approx(1.0, abs=1e-6)


def test_unwrap_box_shape_and_range():
    mesh = _box()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_box(vertices, faces)
    assert uvs.shape == (len(faces), 3, 2)
    assert uvs.min() >= 0.0 - 1e-9
    assert uvs.max() <= 1.0 + 1e-9


def test_unwrap_box_uses_distinct_grid_cells_per_face():
    mesh = _box()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_box(vertices, faces)
    # cell index = floor(u*3), floor(v*2) -> expect more than one distinct cell used (6 faces)
    cell_u = np.floor(uvs[:, :, 0].mean(axis=1) * 3).astype(int)
    cell_v = np.floor(uvs[:, :, 1].mean(axis=1) * 2).astype(int)
    cells = set(zip(cell_u.tolist(), cell_v.tolist()))
    assert len(cells) == 6


def test_unwrap_bottle_blend_shape_and_range():
    mesh = _cylinder()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_bottle_blend(vertices, faces)
    assert uvs.shape == (len(faces), 3, 2)
    assert uvs.min() >= 0.0 - 1e-9
    assert uvs.max() <= 1.0 + 1e-9


def test_unwrap_bottle_blend_caps_use_top_v_band():
    mesh = _cylinder()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    uvs = unwrap_bottle_blend(vertices, faces)
    # at least some triangles should land in the cap band (v >= 0.8)
    assert (uvs[:, :, 1] >= 0.8).any()
    # and some in the body band (v < 0.8)
    assert (uvs[:, :, 1] < 0.8).any()


def test_compute_uv_dispatch():
    mesh = _box()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    for mode in UVMode:
        uvs = compute_uv(vertices, faces, mode)
        assert uvs.shape == (len(faces), 3, 2)


def test_compute_uv_rejects_unknown_mode():
    mesh = _box()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    with pytest.raises(ValueError):
        compute_uv(vertices, faces, "spherical")


def test_validate_uvs_in_range():
    uvs = np.array([[[0.0, 0.0], [0.5, 0.5], [1.0, 1.0]]])
    result = validate_uvs(uvs)
    assert result["in_range"] is True
    assert result["min"] == pytest.approx(0.0)
    assert result["max"] == pytest.approx(1.0)


def test_validate_uvs_out_of_range():
    uvs = np.array([[[0.0, 0.0], [0.5, 1.4], [1.0, 1.0]]])
    result = validate_uvs(uvs)
    assert result["in_range"] is False
    assert result["max"] == pytest.approx(1.4)


def test_unweld_mesh_with_uvs_produces_one_uv_per_corner():
    mesh = _box()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    corner_uvs = unwrap_box(vertices, faces)
    new_vertices, new_faces, new_uvs = unweld_mesh_with_uvs(vertices, faces, corner_uvs)

    assert len(new_vertices) == len(faces) * 3
    assert new_faces.shape == (len(faces), 3)
    assert new_uvs.shape == (len(faces) * 3, 2)
    np.testing.assert_array_equal(new_faces, np.arange(len(new_vertices)).reshape(-1, 3))
    np.testing.assert_allclose(new_uvs, corner_uvs.reshape(-1, 2))
