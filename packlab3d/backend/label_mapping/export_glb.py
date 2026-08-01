import io
import os
import struct
import tempfile

import numpy as np
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
    return trimesh.load(io.BytesIO(glb_bytes), file_type="glb")


def validate_glb(glb_bytes: bytes, *, expect_texture: bool = False, expect_uv: bool = False) -> dict:
    warnings = []
    report = {
        "valid": False,
        "meshCount": 0,
        "nodeCount": 0,
        "materialCount": 0,
        "textureCount": 0,
        "hasUV": False,
        "hasPositions": False,
        "indicesValid": False,
        "imageEmbeddedOrResolvable": False,
        "boundingBoxFinite": False,
        "reloadTrimesh": False,
        "reloadPygltflib": False,
        "warnings": warnings,
    }

    if len(glb_bytes) < 20 or glb_bytes[:4] != b"glTF":
        warnings.append("Invalid GLB header.")
        return report
    _magic, version, total_length = struct.unpack_from("<III", glb_bytes, 0)
    if version != 2:
        warnings.append(f"Unsupported GLB version: {version}.")
        return report
    if total_length != len(glb_bytes):
        warnings.append("GLB length field does not match byte length.")
        return report

    offset = 12
    chunk_types = []
    while offset + 8 <= len(glb_bytes):
        chunk_length, chunk_type = struct.unpack_from("<II", glb_bytes, offset)
        offset += 8 + chunk_length
        chunk_types.append(chunk_type)
    if 0x4E4F534A not in chunk_types:
        warnings.append("JSON chunk is missing.")
    if 0x004E4942 not in chunk_types:
        warnings.append("Binary chunk is missing.")

    try:
        scene = load_glb(glb_bytes)
        report["reloadTrimesh"] = True
        geometries = list(getattr(scene, "geometry", {}).values()) if hasattr(scene, "geometry") else [scene]
        report["meshCount"] = len(geometries)
        if geometries:
            mesh = geometries[0]
            report["hasPositions"] = len(mesh.vertices) > 0
            report["indicesValid"] = len(mesh.faces) > 0 and int(mesh.faces.max()) < len(mesh.vertices)
            report["boundingBoxFinite"] = bool(mesh.bounds is not None and getattr(mesh.bounds, "size", 0) and np.isfinite(mesh.bounds).all())
            report["hasUV"] = bool(getattr(mesh.visual, "uv", None) is not None and len(mesh.visual.uv) == len(mesh.vertices))
    except Exception as exc:
        warnings.append(f"trimesh reload failed: {exc}")

    tmp_path = None
    try:
        from pygltflib import GLTF2

        with tempfile.NamedTemporaryFile(delete=False, suffix=".glb") as tmp:
            tmp.write(glb_bytes)
            tmp_path = tmp.name
        gltf = GLTF2().load_binary(tmp_path)
        report["reloadPygltflib"] = True
        report["nodeCount"] = len(gltf.nodes or [])
        report["meshCount"] = max(report["meshCount"], len(gltf.meshes or []))
        report["materialCount"] = len(gltf.materials or [])
        report["textureCount"] = len(gltf.textures or [])
        images = gltf.images or []
        report["imageEmbeddedOrResolvable"] = bool(
            not expect_texture
            or any(image.bufferView is not None or image.uri for image in images)
        )
    except Exception as exc:
        warnings.append(f"pygltflib reload failed: {exc}")
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if expect_texture and report["textureCount"] == 0:
        warnings.append("Texture was expected but none was found.")
    if expect_uv and not report["hasUV"]:
        warnings.append("UV coordinates were expected but none were found.")

    report["valid"] = bool(
        report["reloadTrimesh"]
        and report["reloadPygltflib"]
        and report["meshCount"] >= 1
        and report["nodeCount"] >= 1
        and report["hasPositions"]
        and report["indicesValid"]
        and report["boundingBoxFinite"]
        and (not expect_texture or report["textureCount"] >= 1)
        and (not expect_uv or report["hasUV"])
    )
    return report
