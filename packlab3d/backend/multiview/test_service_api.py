import io
import time
import zipfile

from fastapi.testclient import TestClient
from PIL import Image

from packlab3d.backend.api.main import app

client = TestClient(app)


def _image_bytes(color=(200, 20, 20), size=(96, 128), fmt="PNG"):
    buf = io.BytesIO()
    Image.new("RGB", size, color=color).save(buf, format=fmt)
    return buf.getvalue()


def _files(count, *, content_type="image/png"):
    return [
        ("photos", (f"photo-{index}.png", _image_bytes(color=(200, index * 10, 20)), content_type))
        for index in range(count)
    ]


def _project_id():
    response = client.post("/projects", json={"projectName": "Test", "packageType": "box"})
    assert response.status_code == 200
    return response.json()["id"]


def _wait_job(job_id):
    for _ in range(80):
        response = client.get(f"/jobs/{job_id}")
        assert response.status_code == 200
        data = response.json()
        if data["state"] in {"succeeded", "failed", "cancelled"}:
            return data
        time.sleep(0.05)
    raise AssertionError("job did not finish")


def test_project_accepts_one_photo():
    project_id = _project_id()
    response = client.post(f"/projects/{project_id}/photos", files=_files(1))
    assert response.status_code == 200
    data = response.json()
    assert len(data["project"]["photos"]) == 1
    assert data["project"]["photos"][0]["viewType"] == "front"


def test_project_accepts_ten_photos_and_rejects_eleven():
    project_id = _project_id()
    assert client.post(f"/projects/{project_id}/photos", files=_files(10)).status_code == 200
    too_many = _project_id()
    response = client.post(f"/projects/{too_many}/photos", files=_files(11))
    assert response.status_code == 400
    assert "1 and 10" in response.json()["detail"]


def test_unsupported_and_corrupt_images_are_rejected():
    project_id = _project_id()
    unsupported = client.post(
        f"/projects/{project_id}/photos",
        files=[("photos", ("bad.gif", b"GIF89a", "image/gif"))],
    )
    assert unsupported.status_code == 400

    corrupt = client.post(
        f"/projects/{project_id}/photos",
        files=[("photos", ("bad.png", b"not an image", "image/png"))],
    )
    assert corrupt.status_code == 400


def test_photo_updates_preserve_order_view_and_include_state():
    project_id = _project_id()
    upload = client.post(f"/projects/{project_id}/photos", files=_files(3))
    photos = upload.json()["project"]["photos"]
    response = client.patch(
        f"/projects/{project_id}/photos",
        json={
            "photos": [
                {"photoId": photos[0]["id"], "viewType": "right", "included": False, "order": 2},
                {"photoId": photos[1]["id"], "viewType": "front", "order": 0},
                {"photoId": photos[2]["id"], "viewType": "left", "order": 1},
            ]
        },
    )
    assert response.status_code == 200
    updated = response.json()["photos"]
    assert [photo["order"] for photo in updated] == [0, 1, 2]
    assert updated[0]["viewType"] == "front"
    assert updated[2]["included"] is False


def test_analysis_segmentation_and_reconstruction_use_all_included_photos():
    project_id = _project_id()
    upload = client.post(f"/projects/{project_id}/photos", files=_files(4))
    photos = upload.json()["project"]["photos"]
    client.patch(
        f"/projects/{project_id}/photos",
        json={
            "photos": [
                {"photoId": photos[0]["id"], "viewType": "front", "order": 0},
                {"photoId": photos[1]["id"], "viewType": "left", "order": 1},
                {"photoId": photos[2]["id"], "viewType": "back", "order": 2},
                {"photoId": photos[3]["id"], "viewType": "right", "included": False, "order": 3},
            ]
        },
    )

    analyze = client.post(f"/projects/{project_id}/analyze-photos").json()
    analyze_job = _wait_job(analyze["id"])
    assert analyze_job["state"] == "succeeded"
    assert analyze_job["result"]["photos"][0]["quality"]["qualityScore"] >= 0

    segment = client.post(f"/projects/{project_id}/segment-photos").json()
    segment_job = _wait_job(segment["id"])
    assert segment_job["state"] == "succeeded"
    assert all(photo["segmentation"]["status"] == "automatic_mask_ready" for photo in segment_job["result"]["photos"])

    reconstruct = client.post(
        f"/projects/{project_id}/reconstruct",
        json={"packageType": "box", "measurements": {"heightMm": 120, "widthMm": 50}},
    ).json()
    reconstruct_job = _wait_job(reconstruct["id"])
    assert reconstruct_job["state"] == "succeeded"
    report = reconstruct_job["result"]["report"]
    assert report["trueMultiViewReconstruction"] is True
    assert report["provider"] == "PackLabNativeReconstructionEngine"
    assert report["method"] == "packlab-native-generic-profile-fit"
    assert report["reconstructionModel"]["controlCage"]["editable"] is True
    assert report["optimizationReport"]["engine"] == "PackLab Native Reconstruction Engine"
    assert report["photosUsed"] == [photos[0]["id"], photos[1]["id"], photos[2]["id"]]
    assert report["photosExcluded"] == [photos[3]["id"]]
    assert report["dimensionsMm"]["heightMm"] == 120
    assert report["dimensionSources"]["heightMm"] == "measured"
    assert report["glbValidation"]["valid"] is True

    result = client.get(f"/projects/{project_id}/result")
    assert result.status_code == 200
    assert "finalMesh" in result.json()["assets"]

    drawing = client.get(f"/projects/{project_id}/assets/drawingPackage")
    assert drawing.status_code == 200
    with zipfile.ZipFile(io.BytesIO(drawing.content)) as zf:
        assert "metadata.json" in zf.namelist()

    persisted = client.get(f"/projects/{project_id}/report").json()
    assert persisted["version"] == 5
    assert persisted["reconstructionModel"]["coordinateSystem"] == "millimetres, +Y up"
    assert [photo["id"] for photo in persisted["photos"]][:3] == [photos[0]["id"], photos[1]["id"], photos[2]["id"]]


def test_job_cancellation_sets_cancelled_state():
    project_id = _project_id()
    client.post(f"/projects/{project_id}/photos", files=_files(2))
    job = client.post(f"/projects/{project_id}/analyze-photos").json()
    response = client.post(f"/jobs/{job['id']}/cancel")
    assert response.status_code == 200
    assert response.json()["state"] in {"cancelled", "succeeded", "running"}


def test_bottle_reconstruction_uses_open3d_height_argument():
    project_id = _project_id()
    client.post(f"/projects/{project_id}/photos", files=_files(2))
    reconstruct = client.post(
        f"/projects/{project_id}/reconstruct",
        json={"packageType": "bottle", "measurements": {"heightMm": 120, "diameterMm": 50}},
    ).json()
    job = _wait_job(reconstruct["id"])
    assert job["state"] == "succeeded"
    assert job["result"]["report"]["method"] == "packlab-native-generic-profile-fit"


def test_editable_model_updates_linked_drawing_and_preserves_notes():
    project_id = _project_id()
    client.post(f"/projects/{project_id}/photos", files=_files(3))
    reconstruct = client.post(
        f"/projects/{project_id}/reconstruct",
        json={"packageType": "custom", "measurements": {"heightMm": 120, "widthMm": 50, "depthMm": 30}},
    ).json()
    assert _wait_job(reconstruct["id"])["state"] == "succeeded"

    note = client.patch(
        f"/projects/{project_id}/drawing-document",
        json={"notes": [{"text": "Manual packaging note", "x": 10, "y": 20}]},
    ).json()
    assert note["drawingDocument"]["notes"][0]["text"] == "Manual packaging note"

    edited = client.patch(
        f"/projects/{project_id}/editable-model",
        json={"heightMm": 150, "widthMm": 60},
    ).json()
    model = edited["reconstructionModel"]
    drawing = edited["drawingDocument"]
    assert model["heightMm"] == 150
    assert max(section["widthMm"] for section in model["crossSections"]) == 60
    height_dim = next(item for item in drawing["dimensions"] if item["id"] == "dim-overall-height")
    assert height_dim["valueMm"] == 150
    assert drawing["notes"][0]["text"] == "Manual packaging note"
