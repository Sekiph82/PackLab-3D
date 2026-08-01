import tempfile
from urllib.parse import unquote

import open3d as o3d
import pytest
from fastapi.testclient import TestClient

from packlab3d.backend.api.main import app
from packlab3d.backend.i18n import SUPPORTED_LANGUAGES, get_message

client = TestClient(app)

ALL_ERROR_KEYS = [
    "invalidImage",
    "invalidDimensions",
    "unsupportedLanguage",
    "meshGenerationFailed",
    "drawingGenerationFailed",
    "labelGenerationFailed",
    "exportFailed",
    "notImplemented",
    "modelUnavailable",
    "invalidMesh",
    "missingTargetDimension",
    "invalidPackagingType",
    "invalidMaterial",
]


def _box_obj_bytes(w=10, h=10, d=10):
    mesh = o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".obj")
    tmp.close()
    o3d.io.write_triangle_mesh(tmp.name, mesh)
    with open(tmp.name, "rb") as f:
        return f.read()


@pytest.mark.parametrize("key", ALL_ERROR_KEYS)
@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_every_error_key_resolves_non_empty_for_every_language(key, lang):
    message = get_message(f"errors.{key}", lang)
    assert message
    assert message != f"errors.{key}"  # did not fall through to the raw key path


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_invalid_packaging_type_error_is_localized_end_to_end(lang):
    files = {"file": ("box.obj", _box_obj_bytes(), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness", files=files, data={"packaging_type": "drum", "language": lang}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidPackagingType", lang)


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_invalid_material_error_is_localized_end_to_end(lang):
    files = {"file": ("box.obj", _box_obj_bytes(), "application/octet-stream")}
    response = client.post(
        "/apply-wall-thickness",
        files=files,
        data={"packaging_type": "bottle", "material": "ABS", "language": lang},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMaterial", lang)


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_invalid_mesh_error_is_localized_end_to_end(lang):
    files = {"file": ("garbage.obj", b"not a mesh", "application/octet-stream")}
    response = client.post("/scale-mesh", files=files, data={"width_mm": "10", "language": lang})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.invalidMesh", lang)


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_missing_target_dimension_error_is_localized_end_to_end(lang):
    files = {"file": ("box.obj", _box_obj_bytes(), "application/octet-stream")}
    response = client.post("/scale-mesh", files=files, data={"language": lang})
    assert response.status_code == 400
    assert response.json()["detail"] == get_message("errors.missingTargetDimension", lang)


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_model_unavailable_error_is_localized_end_to_end(lang):
    files = {"file": ("box.obj", _box_obj_bytes(), "application/octet-stream")}
    response = client.post(
        "/generate-2d", files=files, data={"backend": "freecad", "language": lang}
    )
    assert response.status_code == 503
    assert response.json()["detail"] == get_message("errors.modelUnavailable", lang)


@pytest.mark.parametrize("lang", SUPPORTED_LANGUAGES)
def test_success_message_headers_percent_decode_correctly_for_every_language(lang):
    files = {"file": ("box.obj", _box_obj_bytes(), "application/octet-stream")}
    response = client.post(
        "/cleanup-mesh", files=files, data={"up_axis": "z", "language": lang}
    )
    assert response.status_code == 200
    decoded = unquote(response.headers["X-Api-Message"])
    assert decoded == get_message("api.meshCleaned", lang)
    # Round-trip through percent-encoding must not corrupt non-Latin-1 chars
    # (this is exactly the bug fixed in Stage 5 — guard against regressing it).
    decoded.encode("utf-8")  # would already have raised if mangled
