import io

import numpy as np
import open3d as o3d
import pytest
from PIL import Image

from packlab3d.backend.label_mapping.service import (
    LabelMappingValidationError,
    apply_label_mapping_pipeline,
    clamp_texture_resolution,
    validate_mesh_for_label_mapping,
)
from packlab3d.backend.label_mapping.uv import UVMode


def _png_bytes(size=(32, 32)):
    buf = io.BytesIO()
    Image.new("RGBA", size, (0, 120, 255, 255)).save(buf, format="PNG")
    return buf.getvalue()


def _box():
    return o3d.geometry.TriangleMesh.create_box(width=10, height=20, depth=30)


def _cylinder():
    return o3d.geometry.TriangleMesh.create_cylinder(radius=8, height=30, resolution=24, split=2)


def test_validate_mesh_for_label_mapping_reports_counts_and_bounds():
    report = validate_mesh_for_label_mapping(_box())
    assert report["valid"] is True
    assert report["vertexCount"] == 8
    assert report["triangleCount"] == 12
    assert report["boundingBox"]["extent"] == [10.0, 20.0, 30.0]


def test_validate_mesh_for_label_mapping_rejects_degenerate_mesh():
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(np.zeros((3, 3)))
    mesh.triangles = o3d.utility.Vector3iVector(np.array([[0, 1, 2]]))

    with pytest.raises(LabelMappingValidationError) as exc:
        validate_mesh_for_label_mapping(mesh)

    assert exc.value.report["valid"] is False
    assert "Mesh has no usable surface area." in exc.value.errors


def test_clamp_texture_resolution_bounds_untrusted_input():
    assert clamp_texture_resolution(1024)[0] == 1024
    assert clamp_texture_resolution(0)[0] == 1024
    value, warnings = clamp_texture_resolution(99999)
    assert value == 4096
    assert warnings


@pytest.mark.parametrize(
    ("mesh_factory", "mode"),
    [
        (_cylinder, UVMode.CYLINDRICAL),
        (_box, UVMode.BOX),
        (_cylinder, UVMode.BOTTLE_BLEND),
    ],
)
def test_apply_label_mapping_pipeline_returns_valid_textured_glb(mesh_factory, mode):
    result = apply_label_mapping_pipeline(
        mesh_factory(),
        {"png": _png_bytes()},
        mode,
        texture_resolution=256,
    )

    assert result["glb"][:4] == b"glTF"
    assert result["glbValidation"]["valid"] is True
    assert result["glbValidation"]["textureCount"] >= 1
    assert result["glbValidation"]["hasUV"] is True
    assert result["textureResolution"] == 256
    assert result["timings"][0]["stage"] == "Request received"
    assert any(stage["stage"] == "UV generation completed" for stage in result["timings"])
    assert any(stage["stage"] == "GLB export completed" for stage in result["timings"])
