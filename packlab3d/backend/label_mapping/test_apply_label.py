import numpy as np
import open3d as o3d
import pytest
from PIL import Image

from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh, count_inverted_triangles
from packlab3d.backend.label_mapping.uv import UVMode


def _box():
    return o3d.geometry.TriangleMesh.create_box(width=10, height=10, depth=10)


def _texture():
    return Image.new("RGBA", (64, 64), (0, 87, 255, 255))


def test_count_inverted_triangles_zero_for_clean_outward_box():
    mesh = _box()
    assert count_inverted_triangles(mesh) == 0


def test_apply_label_to_mesh_box():
    result = apply_label_to_mesh(_box(), UVMode.BOX, _texture())
    assert result.uv_mode == UVMode.BOX
    assert result.vertices.shape[1] == 3
    assert result.uvs.shape == (result.vertices.shape[0], 2)
    assert result.faces.shape[1] == 3
    assert len(result.vertices) == len(result.faces) * 3  # unwelded


def test_apply_label_to_mesh_validation_report():
    result = apply_label_to_mesh(_box(), UVMode.BOX, _texture())
    v = result.validation
    assert v["uv_in_range"] is True
    assert v["missing_uv_count"] == 0
    assert v["inverted_triangle_count"] == 0
    assert v["vertex_count"] == len(result.vertices)
    assert v["triangle_count"] == len(result.faces)


def test_apply_label_to_mesh_uvs_within_0_1():
    result = apply_label_to_mesh(_box(), UVMode.BOTTLE_BLEND, _texture())
    assert result.uvs.min() >= 0.0
    assert result.uvs.max() <= 1.0


@pytest.mark.parametrize("mode", list(UVMode))
def test_apply_label_to_mesh_all_uv_modes(mode):
    result = apply_label_to_mesh(_box(), mode, _texture())
    assert result.validation["uv_in_range"] is True
    assert result.validation["missing_uv_count"] == 0
