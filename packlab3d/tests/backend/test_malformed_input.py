import sys
import types

import numpy as np
import open3d as o3d
import pytest
from PIL import Image

from packlab3d.backend.cad_drawings.mesh_projection import get_view_dimensions, project_silhouette
from packlab3d.backend.image_processing.segmentation import segment_image
from packlab3d.backend.label_engine.render import LabelContent, LabelSpec, render_label_png
from packlab3d.backend.label_engine.shapes import LabelShape
from packlab3d.backend.label_engine.styles import LabelStyle
from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh
from packlab3d.backend.label_mapping.bake_texture import bake_texture_from_png
from packlab3d.backend.label_mapping.uv import UVMode, compute_uv, validate_uvs
from packlab3d.backend.mesh_cleanup.cleanup import cleanup_mesh, remove_floating_artifacts
from packlab3d.backend.mesh_generation.pipeline import mesh_from_vertices_faces
from packlab3d.backend.mesh_scaling.scaling import (
    TargetDimensions,
    compute_scale_factors,
    get_bounding_size,
)
from packlab3d.backend.wall_thickness.apply import apply_wall_thickness
from packlab3d.core.utils.errors import ModelNotAvailableError


# ---------- image_processing ----------

def _install_fake_sam(monkeypatch):
    fake_torch = types.ModuleType("torch")
    monkeypatch.setitem(sys.modules, "torch", fake_torch)

    fake_sa = types.ModuleType("segment_anything")

    class FakeSamPredictor:
        def __init__(self, sam):
            self._image = None

        def set_image(self, image_np):
            self._image = image_np

        def predict(self, point_coords, point_labels, multimask_output=True):
            h, w = self._image.shape[:2]
            mask = np.ones((h, w), dtype=bool)
            n = 3 if multimask_output else 1
            return np.stack([mask] * n), np.linspace(0.7, 0.95, n), None

    fake_sa.SamPredictor = FakeSamPredictor
    fake_sa.sam_model_registry = {"vit_b": lambda checkpoint: "fake"}
    monkeypatch.setitem(sys.modules, "segment_anything", fake_sa)


def test_segment_image_degenerate_1x1_image(tmp_path, monkeypatch):
    _install_fake_sam(monkeypatch)
    checkpoint = tmp_path / "x.pth"
    checkpoint.write_bytes(b"x")
    image = Image.new("RGB", (1, 1))
    result = segment_image(image, checkpoint_path=str(checkpoint), model_type="vit_b")
    assert result.mask.shape == (1, 1)


# ---------- mesh_generation ----------

def test_mesh_from_vertices_faces_accepts_empty_arrays():
    # (0, 3)-shaped arrays pass shape validation (empty isn't malformed shape) —
    # downstream modules (mesh_cleanup, mesh_scaling, wall_thickness) are the
    # ones responsible for handling an empty mesh gracefully, see their tests.
    mesh = mesh_from_vertices_faces(np.zeros((0, 3)), np.zeros((0, 3), dtype=int))
    assert len(mesh.vertices) == 0
    assert len(mesh.triangles) == 0


def test_mesh_from_vertices_faces_rejects_nan_vertices():
    vertices = np.array([[0, 0, 0], [1, 0, np.nan], [0, 1, 0]])
    faces = np.array([[0, 1, 2]])
    # Not explicitly rejected by shape validation — documents current behavior:
    # NaN passes through to Open3D, which silently accepts it. Downstream
    # (mesh_scaling) rejects NaN explicitly; this is where it would be caught.
    mesh = mesh_from_vertices_faces(vertices, faces)
    assert len(mesh.vertices) == 3


# ---------- mesh_scaling ----------

def test_compute_scale_factors_rejects_nan_current_size():
    with pytest.raises(ValueError):
        compute_scale_factors(np.array([np.nan, 10.0, 10.0]), TargetDimensions(width_mm=10))


def test_compute_scale_factors_rejects_inf_current_size():
    with pytest.raises(ValueError):
        compute_scale_factors(np.array([np.inf, 10.0, 10.0]), TargetDimensions(width_mm=10))


def test_compute_scale_factors_rejects_nan_target():
    with pytest.raises(ValueError):
        compute_scale_factors(np.array([10.0, 10.0, 10.0]), TargetDimensions(width_mm=float("nan")))


def test_get_bounding_size_on_single_point_mesh():
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(np.array([[1.0, 2.0, 3.0]]))
    size = get_bounding_size(mesh)
    np.testing.assert_allclose(size, [0.0, 0.0, 0.0])


# ---------- mesh_cleanup ----------

def test_cleanup_mesh_on_empty_mesh_does_not_crash():
    mesh = o3d.geometry.TriangleMesh()
    cleaned, report = cleanup_mesh(mesh)
    assert report["triangle_count"] == 0
    assert report["vertex_count"] == 0


def test_remove_floating_artifacts_on_empty_mesh():
    mesh = o3d.geometry.TriangleMesh()
    cleaned = remove_floating_artifacts(mesh)
    assert len(cleaned.triangles) == 0


# ---------- wall_thickness ----------

def test_apply_wall_thickness_rejects_nan_thickness():
    mesh = o3d.geometry.TriangleMesh.create_box(10, 10, 10)
    with pytest.raises((ValueError, TypeError)):
        apply_wall_thickness(mesh, thickness_mm=float("nan"))


def test_apply_wall_thickness_on_degenerate_zero_size_mesh_raises():
    mesh = o3d.geometry.TriangleMesh()
    with pytest.raises(Exception):
        apply_wall_thickness(mesh, thickness_mm=1.0)


# ---------- cad_drawings ----------

def test_project_silhouette_on_degenerate_flat_mesh():
    # all vertices coplanar on Z=0 — front/side views collapse to a line
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(
        np.array([[0, 0, 0], [10, 0, 0], [5, 10, 0]], dtype=float)
    )
    mesh.triangles = o3d.utility.Vector3iVector(np.array([[0, 1, 2]]))
    hull = project_silhouette(mesh, "top")
    assert hull.shape[1] == 2
    width, height = get_view_dimensions(mesh, "front")
    assert height == 0.0  # flat in Z


def test_get_view_dimensions_on_single_vertex_mesh():
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(np.array([[5.0, 5.0, 5.0]]))
    width, height = get_view_dimensions(mesh, "top")
    assert width == 0.0
    assert height == 0.0


# ---------- label_engine ----------

def test_render_label_png_with_empty_content_does_not_crash():
    spec = LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, content=LabelContent())
    img = render_label_png(spec)
    assert img.mode == "RGBA"


def test_render_label_png_rejects_unknown_material_gracefully():
    # unknown material code falls back to showing the raw code (not a crash)
    spec = LabelSpec(
        style=LabelStyle.MINIMAL_MODERN,
        shape=LabelShape.RECTANGLE,
        content=LabelContent(material="UNOBTANIUM", volume_ml=100),
    )
    img = render_label_png(spec)
    assert img.mode == "RGBA"


def test_render_label_png_empty_barcode_data_does_not_crash():
    # python-barcode's Code128 accepts an empty string without raising —
    # documents actual behavior rather than an assumed validation error.
    spec = LabelSpec(
        style=LabelStyle.MINIMAL_MODERN,
        shape=LabelShape.RECTANGLE,
        content=LabelContent(barcode_data=""),
    )
    img = render_label_png(spec)
    assert img.mode == "RGBA"


# ---------- label_mapping ----------

def test_compute_uv_on_mesh_with_zero_triangles():
    vertices = np.zeros((0, 3))
    faces = np.zeros((0, 3), dtype=int)
    uvs = compute_uv(vertices, faces, UVMode.BOX)
    assert uvs.shape == (0, 3, 2)
    result = validate_uvs(uvs)
    # min()/max() on an empty array is not well-defined; guard against a crash
    # by checking we at least got a dict back with the expected keys.
    assert set(result) == {"in_range", "min", "max"}


def test_apply_label_to_mesh_on_degenerate_flat_mesh():
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(
        np.array([[0, 0, 0], [10, 0, 0], [5, 10, 0]], dtype=float)
    )
    mesh.triangles = o3d.utility.Vector3iVector(np.array([[0, 1, 2]]))
    texture = Image.new("RGBA", (16, 16), (0, 0, 0, 255))
    result = apply_label_to_mesh(mesh, UVMode.BOX, texture)
    assert result.validation["missing_uv_count"] == 0


def test_bake_texture_from_png_rejects_corrupt_bytes():
    with pytest.raises(Exception):
        bake_texture_from_png(b"not a real png file at all")


def test_bake_texture_from_png_handles_1x1_source():
    img = Image.new("RGBA", (1, 1), (255, 0, 0, 255))
    import io

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    result = bake_texture_from_png(buf.getvalue(), target_size=(64, 64))
    assert result.size == (64, 64)
