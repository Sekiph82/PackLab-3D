import json

from fastapi.testclient import TestClient

from packlab3d.backend.api.main import app, multiview_service
from packlab3d.backend.multiview.contour_service import contour_from_mask, validate_contour
from packlab3d.backend.multiview.reconstruction_input_service import build_reconstruction_input
from packlab3d.backend.multiview.test_phase7_engine import _package_image, _upload, _wait

client = TestClient(app)


def _project():
    response = client.post("/projects", json={"projectName": "Phase 7.1B", "packageType": "custom"})
    assert response.status_code == 200
    return response.json()["id"]


def _photo_project():
    project_id = _project()
    photos = _upload(project_id, [_package_image()])
    return project_id, photos[0]["id"]


def _mask(width=20, height=24, left=5, right=14):
    values = [0] * (width * height)
    for y in range(3, height - 3):
        for x in range(left, right):
            values[y * width + x] = 255
    return values


def _manual_contour():
    return [
        {"id": "c0", "x": 0.35, "y": 0.08, "locked": False},
        {"id": "c1", "x": 0.65, "y": 0.08, "locked": False},
        {"id": "c2", "x": 0.8, "y": 0.5, "locked": False},
        {"id": "c3", "x": 0.65, "y": 0.92, "locked": False},
        {"id": "c4", "x": 0.35, "y": 0.92, "locked": False},
        {"id": "c5", "x": 0.2, "y": 0.5, "locked": False},
    ]


def test_new_photo_has_geometry_revision_state():
    project_id, photo_id = _photo_project()
    geometry = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry")
    assert geometry.status_code == 200
    assert geometry.json()["geometry"]["revisions"]["photoGeometry"] == 0
    assert geometry.json()["geometry"]["stale"]["reconstruction"] is True


def test_manual_mask_save_increments_revisions_and_marks_reconstruction_stale():
    project_id, photo_id = _photo_project()
    response = client.put(
        f"/projects/{project_id}/photos/{photo_id}/mask",
        json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0},
    )
    assert response.status_code == 200
    geometry = response.json()["geometry"]
    assert geometry["revisions"]["manualMask"] == 1
    assert geometry["revisions"]["activeMask"] == 1
    assert geometry["stale"]["reconstruction"] is True
    assert response.json()["contour"]["source"] == "manual-mask"


def test_manual_mask_revision_conflict_returns_409():
    project_id, photo_id = _photo_project()
    payload = {"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0}
    assert client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json=payload).status_code == 200
    conflict = client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json=payload)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["error"] == "revision_conflict"
    assert conflict.json()["detail"]["resource"] == "activeMask"


def test_contour_from_mask_extracts_points_and_silhouette_width():
    import numpy as np

    mask = np.asarray(_mask(), dtype="uint8").reshape((24, 20)) > 0
    contour = contour_from_mask(mask, "photo-x")
    assert contour["editablePointCount"] >= 8
    assert contour["normalizedSilhouette"]["normalizedWidth"] > 0
    assert contour["checksum"].startswith("sha256:")


def test_manual_contour_save_increments_revision_and_sets_active_source():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    response = client.put(
        f"/projects/{project_id}/photos/{photo_id}/contour",
        json={"expectedRevision": revision, "points": _manual_contour(), "reason": "test"},
    )
    assert response.status_code == 200
    assert response.json()["geometry"]["activeContourSource"] == "manual"
    assert response.json()["contour"]["source"] == "manual"
    assert response.json()["contour"]["checksum"].startswith("sha256:")


def test_manual_contour_revision_conflict_returns_409():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    payload = {"expectedRevision": revision, "points": _manual_contour()}
    assert client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json=payload).status_code == 200
    conflict = client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json=payload)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["resource"] == "activeContour"


def test_invalid_self_intersecting_contour_is_rejected():
    report = validate_contour({"points": [
        {"x": 0.2, "y": 0.2},
        {"x": 0.8, "y": 0.8},
        {"x": 0.8, "y": 0.2},
        {"x": 0.2, "y": 0.8},
    ]})
    assert report.valid is False
    project_id, photo_id = _photo_project()
    response = client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": 0, "points": [
        {"id": "a", "x": 0.2, "y": 0.2},
        {"id": "b", "x": 0.8, "y": 0.8},
        {"id": "c", "x": 0.8, "y": 0.2},
        {"id": "d", "x": 0.2, "y": 0.8},
    ]})
    assert response.status_code == 400


def test_landmark_save_revision_and_conflict():
    project_id, photo_id = _photo_project()
    landmarks = [{"id": "lm", "type": "shoulder-transition", "x": 0.4, "y": 0.7, "locked": True}]
    ok = client.put(f"/projects/{project_id}/photos/{photo_id}/landmarks", json={"photoId": photo_id, "landmarks": landmarks, "expectedRevision": 0})
    assert ok.status_code == 200
    assert ok.json()["geometry"]["revisions"]["landmarks"] == 1
    conflict = client.put(f"/projects/{project_id}/photos/{photo_id}/landmarks", json={"photoId": photo_id, "landmarks": landmarks, "expectedRevision": 0})
    assert conflict.status_code == 409


def test_locked_landmark_survives_mask_recompute():
    project_id, photo_id = _photo_project()
    locked = [{"id": "locked-shoulder", "type": "shoulder-transition", "x": 0.43, "y": 0.76, "locked": True}]
    client.put(f"/projects/{project_id}/photos/{photo_id}/landmarks", json={"photoId": photo_id, "landmarks": locked, "expectedRevision": 0})
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(left=4, right=16), "expectedRevision": 0})
    landmarks = client.get(f"/projects/{project_id}/photos/{photo_id}/landmarks").json()["landmarks"]
    assert any(item["id"] == "locked-shoulder" and item["locked"] for item in landmarks)


def test_reconstruction_input_uses_manual_mask_and_manual_contour_provenance():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    project = multiview_service.get_project(project_id)
    reconstruction_input = build_reconstruction_input(project)
    item = reconstruction_input["photos"][0]
    assert item["maskSource"] == "manual"
    assert item["contourSource"] == "manual"
    assert item["contourRevision"] == project.photoGeometry[photo_id]["revisions"]["activeContour"]


def test_reconstruction_records_current_geometry_revision_and_clears_stale():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120}}).json()
    assert _wait(job["id"])["state"] == "succeeded"
    geometry = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]
    assert geometry["stale"]["reconstruction"] is False
    report = client.get(f"/projects/{project_id}/report").json()
    assert report["reconstruction"]["photoGeometryRevisions"][photo_id] == geometry["revisions"]["photoGeometry"]


def test_manual_contour_changes_reconstruction_profile_shape():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(left=7, right=12), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120}}).json()
    assert _wait(job["id"])["state"] == "succeeded"
    model = client.get(f"/projects/{project_id}/editable-model").json()["reconstructionModel"]
    extents = [point["halfExtentMm"] for point in model["frontProfile"]]
    assert max(extents) > min(extents)
    assert model["sourcePhotoGeometryRevisions"][photo_id] >= 1


def test_project_save_and_reload_preserves_manual_geometry():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    client.put(f"/projects/{project_id}/photos/{photo_id}/landmarks", json={"photoId": photo_id, "landmarks": [{"id": "lm", "type": "cap-top", "x": 0.5, "y": 0.9, "locked": True}], "expectedRevision": 0})
    multiview_service._projects.pop(project_id, None)
    reloaded = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()
    assert reloaded["mask"]["manualOverride"] is True
    assert reloaded["contour"]["source"] == "manual"
    assert reloaded["geometry"]["revisions"]["landmarks"] == 1
    assert any(item["locked"] for item in reloaded["landmarks"])


def test_contour_reset_restores_automatic_active_hierarchy():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    revision = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    reset = client.post(f"/projects/{project_id}/photos/{photo_id}/contour/reset")
    assert reset.status_code == 200
    assert reset.json()["geometry"]["activeContourSource"] in {"automatic", "manual-mask"}


def test_geometry_approve_is_persisted():
    project_id, photo_id = _photo_project()
    approved = client.post(f"/projects/{project_id}/photos/{photo_id}/geometry/approve")
    assert approved.status_code == 200
    assert approved.json()["geometry"]["approved"] is True
    multiview_service._projects.pop(project_id, None)
    assert client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()["geometry"]["approved"] is True


def test_strict_reconstruction_input_rejects_missing_geometry():
    project_id, _photo_id = _photo_project()
    project = multiview_service.get_project(project_id)
    try:
        build_reconstruction_input(project, strict=True)
    except ValueError as exc:
        assert "no usable contour" in str(exc)
    else:
        raise AssertionError("strict mode should reject missing geometry")


def test_geometry_report_serializes_to_json():
    project_id, photo_id = _photo_project()
    geometry = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()
    assert json.loads(json.dumps(geometry))["photoId"] == photo_id


def test_mask_save_checksum_and_path_are_persisted():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual-checksum", "maskData": _mask(), "expectedRevision": 0})
    report = client.get(f"/projects/{project_id}/report").json()
    assert report["masks"][photo_id]["checksum"] == "manual-checksum"
    assert report["masks"][photo_id]["manualMaskPath"].endswith("-manual.png")


def test_landmark_constraints_are_carried_into_reconstruction_model():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(), "expectedRevision": 0})
    client.put(f"/projects/{project_id}/photos/{photo_id}/landmarks", json={"photoId": photo_id, "landmarks": [{"id": "locked-1", "type": "neck-transition", "x": 0.51, "y": 0.82, "locked": True}], "expectedRevision": 0})
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120}}).json()
    assert _wait(job["id"])["state"] == "succeeded"
    model = client.get(f"/projects/{project_id}/editable-model").json()["reconstructionModel"]
    assert any(item.get("source") == "locked-user-landmark" for item in model["landmarkConstraints"])


def test_manual_contour_has_priority_over_contour_generated_from_manual_mask():
    project_id, photo_id = _photo_project()
    client.put(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 20, "height": 24, "checksum": "manual", "maskData": _mask(left=6, right=13), "expectedRevision": 0})
    geometry = client.get(f"/projects/{project_id}/photos/{photo_id}/geometry").json()
    assert geometry["contour"]["source"] == "manual-mask"
    revision = geometry["geometry"]["revisions"]["activeContour"]
    client.put(f"/projects/{project_id}/photos/{photo_id}/contour", json={"expectedRevision": revision, "points": _manual_contour()})
    active = client.get(f"/projects/{project_id}/photos/{photo_id}/contour").json()["contour"]
    assert active["source"] == "manual"
    assert active["points"][0]["id"] == "c0"
