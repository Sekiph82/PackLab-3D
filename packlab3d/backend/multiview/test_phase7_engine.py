import io
import zipfile

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFilter

from packlab3d.backend.api.main import app
from packlab3d.backend.cad_drawings.mesh_projection import render_view_dxf, render_view_svg
from packlab3d.backend.multiview.drawing_workspace import validate_dxf, validate_svg


client = TestClient(app)


def _package_image(color=(210, 30, 30), size=(128, 180), blur=False):
    image = Image.new("RGB", size, (235, 235, 235))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((38, 18, 90, 162), radius=10, fill=color, outline=(20, 20, 20), width=2)
    draw.rectangle((48, 65, 80, 115), fill=(245, 245, 245))
    if blur:
        image = image.filter(ImageFilter.GaussianBlur(3))
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _upload(project_id, images):
    files = [("photos", (f"photo-{idx}.png", data, "image/png")) for idx, data in enumerate(images)]
    response = client.post(f"/projects/{project_id}/photos", files=files)
    assert response.status_code == 200
    return response.json()["project"]["photos"]


def _project():
    response = client.post("/projects", json={"projectName": "Phase 7", "packageType": "custom"})
    assert response.status_code == 200
    return response.json()["id"]


def _wait(job_id):
    import time

    for _ in range(100):
        data = client.get(f"/jobs/{job_id}").json()
        if data["state"] in {"succeeded", "failed", "cancelled"}:
            return data
        time.sleep(0.03)
    raise AssertionError("job did not finish")


def test_quality_duplicate_same_object_and_view_assignment_are_structured():
    project_id = _project()
    photos = _upload(project_id, [_package_image(), _package_image(), _package_image((20, 80, 210)), _package_image(blur=True)])
    job = client.post(f"/projects/{project_id}/analyze-photos").json()
    done = _wait(job["id"])
    assert done["state"] == "succeeded"
    first = done["result"]["photos"][0]
    assert first["quality"]["overallScore"] >= 0
    assert "sharpness" in first["quality"]["metrics"]
    assert "compressionArtifactProbability" in first["quality"]["metrics"]
    assert done["result"]["duplicates"][photos[1]["id"]][0]["type"] in {"exact-duplicate", "near-duplicate"}
    assert done["result"]["sameObject"]["status"] in {"consistent", "probably-consistent", "uncertain"}
    assert done["result"]["viewCoverage"]["front"] in {"strong", "medium", "missing"}
    report = client.get(f"/projects/{project_id}/report").json()
    assert report["version"] == 5
    assert report["viewAssignments"]


def test_reconstruction_has_objective_terms_checkpoints_and_drawing_validation():
    project_id = _project()
    photos = _upload(project_id, [_package_image(), _package_image((190, 40, 40)), _package_image((190, 60, 60))])
    client.patch(
        f"/projects/{project_id}/photos",
        json={"photos": [{"photoId": photos[0]["id"], "viewType": "front"}, {"photoId": photos[1]["id"], "viewType": "left"}, {"photoId": photos[2]["id"], "viewType": "right"}]},
    )
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120, "widthMm": 48, "depthMm": 32}}).json()
    done = _wait(job["id"])
    assert done["state"] == "succeeded"
    report = done["result"]["report"]
    objective = report["optimizationReport"]["objectiveTerms"]["silhouetteOverlap"]
    assert {"rawValue", "normalizedValue", "weight", "weightedContribution", "active"} <= set(objective)
    assert report["optimizationReport"]["checkpoints"][-1]["id"] == "final-validated-model"
    assert report["optimizationReport"]["perView"][0]["dice"] > 0
    assert report["drawingValidation"]["svg"]["valid"] is True
    assert report["drawingValidation"]["dxf"]["valid"] is True
    drawing = client.get(f"/projects/{project_id}/assets/drawingPackage")
    with zipfile.ZipFile(io.BytesIO(drawing.content)) as zf:
        assert "validation.json" in zf.namelist()


def test_section_cage_drawing_version_and_landmark_edits_change_project_state():
    project_id = _project()
    photos = _upload(project_id, [_package_image(), _package_image((190, 40, 40))])
    job = client.post(f"/projects/{project_id}/reconstruct", json={"measurements": {"heightMm": 120, "widthMm": 48, "depthMm": 32}}).json()
    assert _wait(job["id"])["state"] == "succeeded"
    model = client.get(f"/projects/{project_id}/editable-model").json()["reconstructionModel"]
    section_id = model["crossSections"][8]["id"]
    cage_id = model["controlCage"]["nodes"][3]["id"]
    edited = client.patch(
        f"/projects/{project_id}/editable-model",
        json={"sections": [{"id": section_id, "widthMm": 52}], "cageNodes": [{"id": cage_id, "deltaMm": [0, 0, 3]}]},
    ).json()
    assert any(section["id"] == section_id and section["widthMm"] == 52 for section in edited["reconstructionModel"]["crossSections"])
    assert edited["editable3DState"]["undoRedoReady"] is True
    drawing = client.patch(
        f"/projects/{project_id}/drawing-document",
        json={
            "dimensions": [{"id": "dim-overall-height-front", "placement": {"offset": 42, "textOffset": [3, 2]}, "suffix": " REF"}],
            "notes": [{"text": "Leader note", "x": 12, "y": 18}],
            "referenceLines": [{"type": "baseline", "x1": 0, "y1": 0, "x2": 20, "y2": 0}],
            "sectionLines": [{"points": [[0, 0], [10, 20]], "label": "A-A"}],
            "titleBlock": {"customer": "PackLab"},
        },
    ).json()["drawingDocument"]
    dim = next(item for item in drawing["dimensions"] if item["id"] == "dim-overall-height-front")
    assert dim["placement"]["offset"] == 42
    assert drawing["sectionViews"][0]["sourceLineId"] == drawing["sectionLines"][0]["id"]
    photo_id = client.get(f"/projects/{project_id}/photos").json()["photos"][0]["id"]
    landmark = client.patch(
        f"/projects/{project_id}/landmarks",
        json={"photoId": photo_id, "landmarks": [{"type": "shoulder-transition", "x": 0.4, "y": 0.7, "locked": True}]},
    ).json()
    assert landmark["landmarks"][0]["locked"] is True
    version_a = client.post(f"/projects/{project_id}/versions", json={"name": "Version A", "note": "baseline"}).json()["version"]
    client.patch(f"/projects/{project_id}/editable-model", json={"heightMm": 140})
    version_b = client.post(f"/projects/{project_id}/versions", json={"name": "Version B"}).json()["version"]
    comparison = client.post(f"/projects/{project_id}/versions/compare", json={"leftVersionId": version_a["id"], "rightVersionId": version_b["id"]}).json()
    assert comparison["changed"] is True
    restored = client.post(f"/projects/{project_id}/versions/{version_a['id']}/restore").json()
    assert restored["reconstructionModel"]["heightMm"] == version_a["model"]["heightMm"]


def test_svg_and_dxf_validators_reject_missing_structure():
    assert validate_svg("<svg></svg>")["valid"] is False
    assert validate_dxf("0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n")["valid"] is False
    svg = render_view_svg(__import__("numpy").array([[0, 0], [10, 0], [10, 20], [0, 20]], dtype=float), 10, 20, "Front")
    dxf = render_view_dxf(__import__("numpy").array([[0, 0], [10, 0], [10, 20], [0, 20]], dtype=float), 10, 20, "Front")
    assert validate_svg(svg)["valid"] is True
    assert validate_dxf(dxf)["valid"] is True
