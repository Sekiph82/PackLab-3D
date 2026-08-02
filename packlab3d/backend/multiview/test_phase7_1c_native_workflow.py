import inspect

from fastapi.testclient import TestClient

from packlab3d.backend.api.main import app
from packlab3d.backend.image_processing import segmentation


def test_capabilities_report_native_photo_geometry_without_legacy_model_capability():
    data = TestClient(app).get("/capabilities?refresh=true").json()
    assert data["photo_geometry"]["nativeMaskEstimation"]["available"] is True
    assert data["photo_geometry"]["manualMaskEditing"]["available"] is True
    assert data["photo_geometry"]["contourEditing"]["available"] is True
    assert data["photo_geometry"]["landmarkEditing"]["available"] is True
    assert "sam" not in data


def test_native_mask_estimator_has_no_external_model_import_or_checkpoint_lookup():
    source = inspect.getsource(segmentation)
    assert "segment_anything" not in source
    assert "torch" not in source
    assert "CHECKPOINT" not in source
