import open3d as o3d
from PIL import Image

from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh
from packlab3d.backend.label_mapping.export_glb import export_to_glb, load_glb
from packlab3d.backend.label_mapping.uv import UVMode


def _box():
    return o3d.geometry.TriangleMesh.create_box(width=10, height=10, depth=10)


def _texture():
    return Image.new("RGBA", (64, 64), (255, 51, 102, 255))


def test_export_to_glb_produces_nonempty_bytes():
    result = apply_label_to_mesh(_box(), UVMode.BOX, _texture())
    glb_bytes = export_to_glb(result)
    assert len(glb_bytes) > 0
    assert glb_bytes[:4] == b"glTF"  # GLB binary magic


def test_export_to_glb_round_trips_geometry():
    result = apply_label_to_mesh(_box(), UVMode.BOX, _texture())
    glb_bytes = export_to_glb(result)
    scene = load_glb(glb_bytes)
    geometries = list(scene.geometry.values())
    assert len(geometries) >= 1
    loaded = geometries[0]
    assert len(loaded.vertices) == len(result.vertices)
    assert len(loaded.faces) == len(result.faces)


def test_export_to_glb_round_trips_uvs_and_texture():
    result = apply_label_to_mesh(_box(), UVMode.BOX, _texture())
    glb_bytes = export_to_glb(result)
    scene = load_glb(glb_bytes)
    loaded = list(scene.geometry.values())[0]
    assert loaded.visual.uv is not None
    assert len(loaded.visual.uv) == len(loaded.vertices)
