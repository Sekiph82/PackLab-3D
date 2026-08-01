import trimesh

from packlab3d.backend.label_mapping.apply_label import LabelMappingResult


def export_to_glb(result: LabelMappingResult) -> bytes:
    """Real GLB export via trimesh — Open3D's write_triangle_mesh explicitly does
    not support writing UVs/textures to .glb (confirmed: it warns and the
    written file fails to reload), so trimesh is used here instead.
    """
    material = trimesh.visual.texture.SimpleMaterial(image=result.texture)
    visual = trimesh.visual.TextureVisuals(uv=result.uvs, image=result.texture, material=material)
    mesh = trimesh.Trimesh(vertices=result.vertices, faces=result.faces, visual=visual, process=False)
    return mesh.export(file_type="glb")


def load_glb(glb_bytes: bytes):
    """Loads a GLB back for validation/testing. Returns a trimesh Scene."""
    import io

    return trimesh.load(io.BytesIO(glb_bytes), file_type="glb")
