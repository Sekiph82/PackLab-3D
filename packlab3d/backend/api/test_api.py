import io
import os
import tempfile
import time
import zipfile
from urllib.parse import unquote

import open3d as o3d
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from packlab3d.backend.api.main import app
from packlab3d.backend.i18n import get_message

client = TestClient(app)

STUB_ENDPOINTS = [
    "/export",
]


def _png_bytes(size=(32, 32)):
    buf = io.BytesIO()
    Image.new("RGB", size, color=(255, 0, 0)).save(buf, format="PNG")
    buf.seek(0)
    return buf.read()


def _mesh_to_obj_bytes(mesh) -> bytes:
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".obj")
    tmp.close()
    o3d.io.write_triangle_mesh(tmp.name, mesh)
    with open(tmp.name, "rb") as f:
        data = f.read()
    os.unlink(tmp.name)
    return data


def _box_obj_bytes(w, h, d):
    return _mesh_to_obj_bytes(o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d))


def test_health():
    response = client.get("/")
    assert response.status_code == 200


def test_set_language_valid():
    for lang in ("en", "tr", "sw"):
        response = client.post("/set-language", json={"language": lang})
        assert response.status_code == 200
        assert response.json()["message"] == get_message("api.languageSet", lang)


def test_set_language_invalid():
    response = client.post("/set-language", json={"language": "fr"})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.unsupportedLanguage", "en")


def test_stub_endpoints_return_501_localized():
    for endpoint in STUB_ENDPOINTS:
        for lang in ("en", "tr", "sw"):
            response = client.post(endpoint, json={"language": lang})
            assert response.status_code == 501
            assert response.json()["detail"] == get_message("errors.notImplemented", lang)


def test_process_image_stub_returns_501():
    files = {"file": ("test.jpg", b"fake-image-bytes", "image/jpeg")}
    response = client.post("/process-image", files=files, data={"language": "en"})
    assert response.status_code == 501
    assert response.json()["detail"] == get_message("errors.notImplemented", "en")


def test_generate_mesh_endpoint_is_retired():
    for lang in ("en", "tr", "sw"):
        files = {"file": ("photo.png", _png_bytes(), "image/png")}
        response = client.post("/generate-mesh", files=files, data={"language": lang})
        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "LEGACY_GENERATE_MESH_RETIRED"


def test_generate_mesh_unknown_backend_is_also_retired():
    files = {"file": ("photo.png", _png_bytes(), "image/png")}
    response = client.post("/generate-mesh", files=files, data={"backend": "not-a-backend"})
    assert response.status_code == 410


def test_generate_mesh_invalid_image_is_not_parsed_by_retired_route():
    files = {"file": ("photo.png", b"not-a-real-image", "image/png")}
    response = client.post("/generate-mesh", files=files, data={"language": "en"})
    assert response.status_code == 410


def test_scale_mesh_success_returns_scaled_obj():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    data = {"width_mm": "100", "height_mm": "100", "depth_mm": "100"}
    response = client.post("/scale-mesh", files=files, data=data)
    assert response.status_code == 200
    assert unquote(response.headers["X-Api-Message"]) == get_message("api.meshScaled", "en")
    factors = [float(v) for v in response.headers["X-Scale-Factors"].split(",")]
    assert factors[0] == pytest.approx(10.0, rel=1e-3)
    assert factors[1] == pytest.approx(5.0, rel=1e-3)
    assert b"v " in response.content


def test_scale_mesh_missing_dimensions_returns_400():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    response = client.post("/scale-mesh", files=files, data={})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.missingTargetDimension", "en")


def test_scale_mesh_invalid_file_returns_400():
    files = {"file": ("garbage.obj", b"not a real mesh file", "application/octet-stream")}
    response = client.post("/scale-mesh", files=files, data={"width_mm": "10"})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMesh", "en")


def test_cleanup_mesh_success():
    main = o3d.geometry.TriangleMesh.create_sphere(radius=5, resolution=20)
    stray = o3d.geometry.TriangleMesh.create_box(width=0.1, height=0.1, depth=0.1)
    stray.translate((1000, 1000, 1000))
    combined = main + stray

    files = {"file": ("combined.obj", _mesh_to_obj_bytes(combined), "application/octet-stream")}
    response = client.post("/cleanup-mesh", files=files, data={"up_axis": "z", "language": "tr"})

    assert response.status_code == 200
    assert unquote(response.headers["X-Api-Message"]) == get_message("api.meshCleaned", "tr")
    assert response.headers["X-Is-Watertight"] == "true"
    assert response.headers["X-Triangle-Count"] == str(len(main.triangles))


def test_capabilities_returns_structured_results():
    response = client.get("/capabilities?refresh=true")
    assert response.status_code == 200
    data = response.json()
    assert data["open3d"]["available"] is True
    assert data["open3d"]["status"] in {"available", "import-error"}
    assert "loadTimeMs" in data["open3d"]
    assert data["native_reconstruction"]["available"] is True
    assert data["sam"]["status"] in {"available", "not-configured"}


def test_apply_wall_thickness_default_material_and_thickness():
    files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness", files=files, data={"packaging_type": "jerrycan"}
    )
    assert response.status_code == 200
    assert unquote(response.headers["X-Api-Message"]) == get_message("api.wallThicknessApplied", "en")
    assert response.headers["X-Material"] == "HDPE"
    assert float(response.headers["X-Thickness-Mm"]) == pytest.approx(2.75, rel=1e-3)  # midpoint 2.0-3.5
    assert response.headers["X-Is-Watertight"] == "true"
    assert response.headers["X-Self-Intersecting"] == "false"
    assert float(response.headers["X-Material-Volume-Ml"]) > 0


def test_apply_wall_thickness_material_override():
    files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness",
        files=files,
        data={"packaging_type": "bottle", "material": "HDPE", "thickness_mm": "1.0"},
    )
    assert response.status_code == 200
    assert response.headers["X-Material"] == "HDPE"
    assert response.headers["X-Thickness-Mm"] == "1.000"


def test_apply_wall_thickness_invalid_packaging_type():
    files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness", files=files, data={"packaging_type": "drum", "language": "sw"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidPackagingType", "sw")


def test_apply_wall_thickness_invalid_material_override():
    files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness",
        files=files,
        data={"packaging_type": "bottle", "material": "ABS"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMaterial", "en")


def test_apply_wall_thickness_out_of_range_thickness_rejected():
    files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness",
        files=files,
        data={"packaging_type": "sachet", "thickness_mm": "5.0"},  # sachet range is 0.1-0.2
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidDimensions", "en")


def test_generate_2d_success_returns_zip():
    for lang in ("en", "tr", "sw"):
        files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
        response = client.post(
            "/generate-2d",
            files=files,
            data={"material": "HDPE", "wall_thickness_mm": "2.5", "language": lang},
        )
        assert response.status_code == 200
        assert unquote(response.headers["X-Api-Message"]) == get_message("api.drawingGenerated", lang)
        assert response.headers["X-View-Count"] == "3"
        assert response.headers["X-File-Count"] == "8"  # 3 views x (svg+dxf) + metadata.json + validation.json
        assert response.headers["X-Bounding-Box-Mm"] == "10.000,20.000,30.000"

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            names = set(zf.namelist())
            assert names == {
                "front.svg", "front.dxf",
                "side.svg", "side.dxf",
                "top.svg", "top.dxf",
                "metadata.json",
                "validation.json",
            }
            import json

            metadata = json.loads(zf.read("metadata.json"))
            assert metadata["material"] == "HDPE"
            assert metadata["wall_thickness_mm"] == 2.5


def test_generate_2d_invalid_mesh_returns_400():
    files = {"file": ("garbage.obj", b"not a real mesh", "application/octet-stream")}
    response = client.post("/generate-2d", files=files, data={})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMesh", "en")


def test_generate_2d_unknown_backend_returns_400():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    response = client.post("/generate-2d", files=files, data={"backend": "not-a-backend"})
    assert response.status_code == 400


def test_generate_2d_freecad_backend_returns_503():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    response = client.post("/generate-2d", files=files, data={"backend": "freecad", "language": "tr"})
    assert response.status_code == 503
    assert response.json()["detail"] == get_message("errors.modelUnavailable", "tr")


def test_generate_label_success_returns_zip():
    for lang in ("en", "tr", "sw"):
        data = {
            "style": "eco_green",
            "shape": "oval",
            "width_mm": "80",
            "height_mm": "50",
            "language": lang,
            "brand_name": "Acme",
            "product_name": "Sparkling Water",
            "volume_ml": "500",
            "material": "PET",
            "symbols": "recycle,ce",
            "barcode_data": "1234567890",
        }
        response = client.post("/generate-label", data=data)
        assert response.status_code == 200
        assert unquote(response.headers["X-Api-Message"]) == get_message("api.labelGenerated", lang)
        assert response.headers["X-Label-Style"] == "eco_green"
        assert response.headers["X-Label-Shape"] == "oval"
        assert response.headers["X-File-Count"] == "3"

        with zipfile.ZipFile(io.BytesIO(response.content)) as zf:
            assert set(zf.namelist()) == {"label.png", "label.svg", "metadata.json"}


def test_generate_label_with_logo_upload():
    logo_buf = io.BytesIO()
    Image.new("RGBA", (64, 64), (0, 87, 255, 255)).save(logo_buf, format="PNG")
    logo_buf.seek(0)

    files = {"logo": ("logo.png", logo_buf.read(), "image/png")}
    data = {"style": "minimal_modern", "shape": "rectangle"}
    response = client.post("/generate-label", data=data, files=files)
    assert response.status_code == 200


def test_generate_label_invalid_style_returns_400():
    response = client.post("/generate-label", data={"style": "neon_wave", "shape": "rectangle"})
    assert response.status_code == 400


def test_generate_label_invalid_shape_returns_400():
    response = client.post("/generate-label", data={"style": "minimal_modern", "shape": "hexagon"})
    assert response.status_code == 400


def test_generate_label_invalid_material_returns_400():
    response = client.post(
        "/generate-label",
        data={"style": "minimal_modern", "shape": "rectangle", "material": "ABS"},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMaterial", "en")


def test_apply_label_to_3d_success_with_default_uv_mode():
    for lang in ("en", "tr", "sw"):
        files = {
            "file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream"),
            "label_png": ("label.png", _png_bytes((64, 64)), "image/png"),
        }
        response = client.post(
            "/apply-label-to-3d",
            files=files,
            data={"packaging_type": "box", "texture_resolution": "256", "language": lang},
        )
        assert response.status_code == 200
        assert unquote(response.headers["X-Api-Message"]) == get_message("api.labelAppliedTo3D", lang)
        assert response.headers["X-UV-Mode"] == "box"
        assert response.headers["X-Texture-Resolution"] == "256x256"
        assert response.headers["X-File-Count"] == "1"
        assert int(response.headers["X-Label-Mapping-Stage-Count"]) >= 8
        assert float(response.headers["X-Label-Mapping-Duration-Ms"]) >= 0
        assert response.content[:4] == b"glTF"


def test_apply_label_to_3d_bottle_defaults_to_bottle_blend():
    files = {
        "file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream"),
        "label_png": ("label.png", _png_bytes((64, 64)), "image/png"),
    }
    response = client.post("/apply-label-to-3d", files=files, data={"packaging_type": "bottle"})
    assert response.status_code == 200
    assert response.headers["X-UV-Mode"] == "bottle_blend"


def test_apply_label_to_3d_explicit_uv_mode_override():
    files = {
        "file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream"),
        "label_png": ("label.png", _png_bytes((64, 64)), "image/png"),
    }
    response = client.post(
        "/apply-label-to-3d",
        files=files,
        data={"packaging_type": "bottle", "uv_mode": "cylindrical"},
    )
    assert response.status_code == 200
    assert response.headers["X-UV-Mode"] == "cylindrical"


def test_apply_label_to_3d_missing_label_returns_400():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    response = client.post("/apply-label-to-3d", files=files, data={"packaging_type": "box"})
    assert response.status_code == 400


def test_apply_label_to_3d_invalid_packaging_type_returns_400():
    files = {
        "file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream"),
        "label_png": ("label.png", _png_bytes((64, 64)), "image/png"),
    }
    response = client.post("/apply-label-to-3d", files=files, data={"packaging_type": "drum"})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidPackagingType", "en")


def test_apply_label_to_3d_svg_only_returns_503():
    files = {"file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream")}
    response = client.post(
        "/apply-label-to-3d",
        files=files,
        data={"packaging_type": "box", "label_svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>"},
    )
    assert response.status_code == 503
    assert response.json()["detail"] == get_message("errors.modelUnavailable", "en")


def test_apply_label_to_3d_timeout_returns_structured_error(monkeypatch):
    import packlab3d.backend.label_mapping.service as label_service

    def slow_pipeline(*_args, **_kwargs):
        time.sleep(0.1)
        return {}

    monkeypatch.setattr(label_service, "DEFAULT_LABEL_MAPPING_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(label_service, "apply_label_mapping_pipeline", slow_pipeline)

    files = {
        "file": ("box.obj", _box_obj_bytes(10, 20, 30), "application/octet-stream"),
        "label_png": ("label.png", _png_bytes((64, 64)), "image/png"),
    }
    response = client.post("/apply-label-to-3d", files=files, data={"packaging_type": "box"})

    assert response.status_code == 504
    detail = response.json()["detail"]
    assert detail["code"] == "LABEL_MAPPING_TIMEOUT"
    assert detail["recoverable"] is True
