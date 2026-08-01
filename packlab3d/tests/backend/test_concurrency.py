import asyncio
import io
import tempfile
from concurrent.futures import ThreadPoolExecutor

import httpx
import open3d as o3d
import pytest
from fastapi.testclient import TestClient

from packlab3d.backend.api.main import app
from packlab3d.backend.i18n import get_message

sync_client = TestClient(app)


def _box_obj_bytes(w, h, d):
    mesh = o3d.geometry.TriangleMesh.create_box(width=w, height=h, depth=d)
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".obj")
    tmp.close()
    o3d.io.write_triangle_mesh(tmp.name, mesh)
    with open(tmp.name, "rb") as f:
        return f.read()


@pytest.mark.asyncio
async def test_concurrent_set_language_requests_do_not_cross_talk():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        languages = ["en", "tr", "sw"] * 5

        async def call(lang):
            response = await client.post("/set-language", json={"language": lang})
            return lang, response.json()["message"]

        results = await asyncio.gather(*(call(lang) for lang in languages))

    for lang, message in results:
        assert message == get_message("api.languageSet", lang)


@pytest.mark.asyncio
async def test_concurrent_scale_mesh_requests_stay_isolated():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        # Each concurrent request scales a DIFFERENT box to a DIFFERENT target —
        # if the stateless design leaked state between requests, results would
        # cross-contaminate and this assertion would fail.
        # Axis convention (mesh_scaling): width_mm->X (factors[0]), depth_mm->Y (factors[1]).
        targets = [(100, 100), (200, 50), (30, 300), (500, 500), (10, 10)]

        async def call(target_w, target_d):
            files = {"file": ("box.obj", _box_obj_bytes(10, 10, 10), "application/octet-stream")}
            data = {"width_mm": str(target_w), "depth_mm": str(target_d), "height_mm": "10"}
            response = await client.post("/scale-mesh", files=files, data=data)
            factors = [float(v) for v in response.headers["X-Scale-Factors"].split(",")]
            return target_w, target_d, factors

        results = await asyncio.gather(*(call(w, d) for w, d in targets))

    for target_w, target_d, factors in results:
        assert factors[0] == pytest.approx(target_w / 10, rel=1e-3)
        assert factors[1] == pytest.approx(target_d / 10, rel=1e-3)


def test_thread_pool_concurrent_wall_thickness_requests_stay_isolated():
    packaging_types = ["bottle", "box", "sachet", "jerrycan"] * 3

    def call(packaging_type):
        files = {"file": ("box.obj", _box_obj_bytes(100, 100, 100), "application/octet-stream")}
        response = sync_client.post(
            "/apply-wall-thickness", files=files, data={"packaging_type": packaging_type}
        )
        return packaging_type, response.status_code, response.headers.get("X-Material")

    expected_material = {"bottle": "PET", "box": "PP", "sachet": "LDPE", "jerrycan": "HDPE"}

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(call, packaging_types))

    for packaging_type, status_code, material in results:
        assert status_code == 200
        assert material == expected_material[packaging_type]
