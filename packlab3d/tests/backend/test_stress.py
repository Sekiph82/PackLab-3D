import time

import numpy as np
import open3d as o3d
import pytest

from packlab3d.backend.cad_drawings.generate_2d import generate_technical_drawing_package
from packlab3d.backend.label_engine.generate_label import generate_label_package
from packlab3d.backend.label_engine.render import LabelContent, LabelSpec
from packlab3d.backend.label_engine.shapes import LabelShape
from packlab3d.backend.label_engine.styles import LabelStyle
from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh
from packlab3d.backend.label_mapping.uv import UVMode
from packlab3d.backend.mesh_cleanup.cleanup import cleanup_mesh
from packlab3d.backend.mesh_scaling.scaling import TargetDimensions, scale_mesh_to_dimensions
from packlab3d.backend.wall_thickness.apply import apply_wall_thickness

TIME_BUDGET_S = 15.0


def _large_sphere(resolution=60):
    # resolution=60 -> tens of thousands of triangles; big enough to be a
    # meaningful stress case without making the suite slow.
    return o3d.geometry.TriangleMesh.create_sphere(radius=100.0, resolution=resolution)


def test_scale_mesh_large_mesh_completes_within_budget():
    mesh = _large_sphere()
    target = TargetDimensions(width_mm=500, height_mm=500, depth_mm=500)
    start = time.perf_counter()
    scaled, factors, size = scale_mesh_to_dimensions(mesh, target)
    elapsed = time.perf_counter() - start
    assert elapsed < TIME_BUDGET_S
    np.testing.assert_allclose(size, [500, 500, 500], atol=0.5)


def test_cleanup_large_mesh_completes_and_stays_watertight():
    mesh = _large_sphere()
    start = time.perf_counter()
    cleaned, report = cleanup_mesh(mesh, current_up_axis="z")
    elapsed = time.perf_counter() - start
    assert elapsed < TIME_BUDGET_S
    assert report["is_watertight"] is True
    assert report["triangle_count"] == len(mesh.triangles)


def test_wall_thickness_large_mesh_completes_within_budget():
    mesh = _large_sphere()
    start = time.perf_counter()
    result = apply_wall_thickness(mesh, thickness_mm=5.0)
    elapsed = time.perf_counter() - start
    assert elapsed < TIME_BUDGET_S
    assert result.is_watertight is True
    assert result.self_intersecting is False


def test_cad_drawing_large_mesh_completes_within_budget():
    mesh = _large_sphere()
    start = time.perf_counter()
    package = generate_technical_drawing_package(mesh)
    elapsed = time.perf_counter() - start
    assert elapsed < TIME_BUDGET_S
    assert set(package["views"]) == {"front", "side", "top"}


@pytest.mark.parametrize("mode", list(UVMode))
def test_label_mapping_large_mesh_completes_within_budget(mode):
    mesh = _large_sphere()
    from PIL import Image

    texture = Image.new("RGBA", (256, 256), (0, 87, 255, 255))
    start = time.perf_counter()
    result = apply_label_to_mesh(mesh, mode, texture)
    elapsed = time.perf_counter() - start
    assert elapsed < TIME_BUDGET_S
    assert result.validation["uv_in_range"] is True
    assert result.validation["missing_uv_count"] == 0
    # fully unwelded: 3 unique vertices per original triangle
    assert len(result.vertices) == len(mesh.triangles) * 3


def test_label_with_very_long_text_content_does_not_crash():
    long_text = "Ingredient " * 200  # ~2200 chars
    many_blocks = [f"Note {i}: {'x' * 50}" for i in range(20)]
    spec = LabelSpec(
        style=LabelStyle.MINIMAL_MODERN,
        shape=LabelShape.RECTANGLE,
        content=LabelContent(
            brand_name="A" * 100,
            product_name="B" * 100,
            ingredients=long_text,
            warnings=long_text,
            custom_text_blocks=many_blocks,
        ),
    )
    package = generate_label_package(spec)
    assert package["png"].startswith(b"\x89PNG\r\n\x1a\n")
    assert package["svg"].strip().startswith("<svg")
    # documented v1 limitation: no dynamic font scaling, content may overflow
    # the canvas bounds — the important thing under stress is "doesn't crash".


def test_label_with_high_resolution_does_not_crash():
    spec = LabelSpec(
        style=LabelStyle.BOLD_COLORFUL,
        shape=LabelShape.OVAL,
        width_mm=200,
        height_mm=150,
        dpi=600,
        content=LabelContent(brand_name="Big Label", barcode_data="9999999999999"),
    )
    package = generate_label_package(spec)
    assert len(package["png"]) > 0
