import zipfile
from io import BytesIO

import open3d as o3d
import pytest

from packlab3d.backend.cad_drawings.generate_2d import (
    CadBackend,
    build_zip_package,
    count_files,
    generate_technical_drawing_package,
)
from packlab3d.core.utils.errors import ModelNotAvailableError


def _box(w=10, h=20, d=30):
    return o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)


def test_generate_package_mesh_projection_has_three_views():
    package = generate_technical_drawing_package(_box())
    assert set(package["views"]) == {"front", "side", "top"}
    for view in package["views"].values():
        assert view["svg"].strip().startswith("<svg")
        assert view["dxf"].startswith("0\nSECTION")


def test_generate_package_metadata():
    package = generate_technical_drawing_package(
        _box(10, 20, 30), material="HDPE", wall_thickness_mm=2.5
    )
    assert package["metadata"]["bounding_box_mm"] == [10.0, 20.0, 30.0]
    assert package["metadata"]["volume_ml"] == pytest.approx(6.0, rel=1e-3)  # 10*20*30 mm^3 / 1000
    assert package["metadata"]["material"] == "HDPE"
    assert package["metadata"]["wall_thickness_mm"] == 2.5


def test_generate_package_solid_step_iges_skipped_with_reason():
    package = generate_technical_drawing_package(_box())
    assert package["solid"]["step"] is None
    assert package["solid"]["iges"] is None
    assert "pythonocc-core" in package["solid"]["skipped_reason"]


def test_generate_package_freecad_backend_raises():
    with pytest.raises(ModelNotAvailableError):
        generate_technical_drawing_package(_box(), backend=CadBackend.FREECAD)


def test_generate_package_occ_backend_raises():
    with pytest.raises(ModelNotAvailableError):
        generate_technical_drawing_package(_box(), backend=CadBackend.OCC)


def test_generate_package_unknown_backend_raises():
    with pytest.raises(ValueError):
        generate_technical_drawing_package(_box(), backend="not-a-backend")


def test_build_zip_package_contains_expected_files():
    package = generate_technical_drawing_package(_box())
    zip_bytes = build_zip_package(package)

    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert names == {
            "front.svg", "front.dxf",
            "side.svg", "side.dxf",
            "top.svg", "top.dxf",
            "metadata.json",
            "validation.json",
        }
        assert len(zf.read("front.svg")) > 0
        assert len(zf.read("front.dxf")) > 0


def test_count_files_matches_zip_entry_count():
    package = generate_technical_drawing_package(_box())
    zip_bytes = build_zip_package(package)
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        assert count_files(package) == len(zf.namelist())
