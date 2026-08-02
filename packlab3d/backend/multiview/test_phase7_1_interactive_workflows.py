import json

from fastapi.testclient import TestClient

from packlab3d.backend.api.main import app
from packlab3d.backend.multiview.drawing_workspace import apply_drawing_patch, validate_dxf, validate_svg
from packlab3d.backend.multiview.test_phase7_engine import _package_image, _upload, _wait

client = TestClient(app)


def _project():
    response = client.post("/projects", json={"projectName": "Phase 7.1", "packageType": "custom"})
    assert response.status_code == 200
    return response.json()["id"]


def _reconstructed_project():
    project_id = _project()
    _upload(project_id, [_package_image(), _package_image((180, 50, 50))])
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120, "widthMm": 48, "depthMm": 32}}).json()
    assert _wait(job["id"])["state"] == "succeeded"
    return project_id


def test_manual_mask_update_persists_mask_and_recomputes_geometry():
    project_id = _project()
    photos = _upload(project_id, [_package_image()])
    photo_id = photos[0]["id"]
    mask = [0] * (16 * 20)
    for y in range(4, 16):
        for x in range(5, 11):
            mask[y * 16 + x] = 255
    response = client.patch(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 16, "height": 20, "checksum": "manual-1", "maskData": mask})
    assert response.status_code == 200
    data = response.json()
    assert data["photo"]["segmentation"]["status"] == "manual_mask_ready"
    assert data["mask"]["manualOverride"] is True
    assert data["silhouette"]["confidence"] > 0
    report = client.get(f"/projects/{project_id}/report").json()
    assert report["masks"][photo_id]["checksum"] == "manual-1"
    assert report["landmarks"][photo_id]


def test_manual_mask_rejects_inconsistent_dimensions():
    project_id = _project()
    photo_id = _upload(project_id, [_package_image()])[0]["id"]
    response = client.patch(f"/projects/{project_id}/photos/{photo_id}/mask", json={"width": 8, "height": 8, "checksum": "bad", "maskData": [255]})
    assert response.status_code == 400


def test_profile_point_insert_and_section_insert_are_persisted():
    project_id = _reconstructed_project()
    model = client.get(f"/projects/{project_id}/editable-model").json()["reconstructionModel"]
    response = client.patch(
        f"/projects/{project_id}/editable-model",
        json={
            "profileName": "frontProfile",
            "profilePoints": [{"id": "manual-profile", "heightRatio": 0.37, "halfExtentMm": 33}],
            "sections": [{"id": "manual-section", "heightRatio": 0.37, "widthMm": 66, "depthMm": 41}],
        },
    )
    assert response.status_code == 200
    edited = response.json()["reconstructionModel"]
    assert len(edited["frontProfile"]) == len(model["frontProfile"]) + 1
    assert any(point["id"] == "manual-profile" for point in edited["frontProfile"])
    assert any(section["id"] == "manual-section" for section in edited["crossSections"])


def test_recovery_snapshot_is_written_restored_and_discarded():
    project_id = _reconstructed_project()
    state = {"dirtyReason": "profile-drag", "profilePoint": "fp-1"}
    saved = client.put(f"/projects/{project_id}/recovery", json={"state": state})
    assert saved.status_code == 200
    recovery = client.get(f"/projects/{project_id}/recovery")
    assert recovery.status_code == 200
    assert recovery.json()["available"] is True
    assert recovery.json()["recovery"]["state"] == state
    discarded = client.delete(f"/projects/{project_id}/recovery")
    assert discarded.status_code == 200
    assert client.get(f"/projects/{project_id}/recovery").json()["available"] is False


def test_drawing_patch_merges_stable_ids_instead_of_duplicating():
    document = {
        "dimensions": [{"id": "dim-a", "placement": {"offset": 10, "textOffset": [0, 0]}}],
        "notes": [{"id": "note-a", "text": "old", "x": 1, "y": 2}],
        "referenceLines": [{"id": "ref-a", "x1": 0, "y1": 0, "x2": 10, "y2": 0}],
        "sectionLines": [{"id": "sec-a", "points": [[0, 0], [10, 10]], "label": "A-A"}],
        "sectionViews": [{"id": "section-view-sec-a", "sourceLineId": "sec-a"}],
    }
    edited = apply_drawing_patch(
        document,
        {
            "notes": [{"id": "note-a", "text": "new", "x": 3, "y": 4}],
            "referenceLines": [{"id": "ref-a", "x1": 1, "y1": 1, "x2": 11, "y2": 1}],
            "sectionLines": [{"id": "sec-a", "points": [[2, 2], [12, 12]], "label": "B-B"}],
        },
    )
    assert len(edited["notes"]) == 1
    assert edited["notes"][0]["text"] == "new"
    assert len(edited["referenceLines"]) == 1
    assert len(edited["sectionLines"]) == 1
    assert len(edited["sectionViews"]) == 1


def test_svg_validator_rejects_duplicate_ids_and_dxf_validator_rejects_malformed_pairs():
    duplicate_svg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="outline"/><g id="outline"/></svg>'
    svg_report = validate_svg(duplicate_svg)
    assert svg_report["valid"] is False
    malformed_dxf = "0\nSECTION\n2\nENTITIES\n8\nOUTLINE\nnot-a-code\nLINE\n0\nEOF\n"
    dxf_report = validate_dxf(malformed_dxf)
    assert dxf_report["valid"] is False
    assert json.dumps(dxf_report)
