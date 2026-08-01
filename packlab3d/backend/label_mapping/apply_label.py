from dataclasses import dataclass

import numpy as np
import open3d as o3d
from PIL import Image

from packlab3d.backend.label_mapping.uv import compute_uv, unweld_mesh_with_uvs, validate_uvs, UVMode


@dataclass
class LabelMappingResult:
    vertices: np.ndarray
    faces: np.ndarray
    uvs: np.ndarray
    texture: Image.Image
    uv_mode: UVMode
    validation: dict


def count_inverted_triangles(mesh: o3d.geometry.TriangleMesh) -> int:
    """Heuristic: a triangle is 'inverted' if its normal points toward the mesh
    centroid instead of away from it. Valid for star-shaped-from-centroid
    packaging geometry (bottles, boxes, jerrycans) — not a general-purpose check.
    """
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    if len(triangles) == 0:
        return 0
    centroid = vertices.mean(axis=0)
    v0, v1, v2 = vertices[triangles[:, 0]], vertices[triangles[:, 1]], vertices[triangles[:, 2]]
    face_centers = (v0 + v1 + v2) / 3
    normals = np.cross(v1 - v0, v2 - v0)
    norms = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = normals / np.where(norms == 0, 1, norms)
    outward = face_centers - centroid
    outward_norms = np.linalg.norm(outward, axis=1, keepdims=True)
    outward = outward / np.where(outward_norms == 0, 1, outward_norms)
    dots = np.sum(normals * outward, axis=1)
    return int(np.sum(dots < 0))


def apply_label_to_mesh(mesh: o3d.geometry.TriangleMesh, uv_mode, texture: Image.Image) -> LabelMappingResult:
    uv_mode = UVMode(uv_mode)
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)

    corner_uvs = compute_uv(vertices, faces, uv_mode)
    uv_check = validate_uvs(corner_uvs)
    inverted_count = count_inverted_triangles(mesh)

    new_vertices, new_faces, new_uvs = unweld_mesh_with_uvs(vertices, faces, corner_uvs)
    new_uvs = np.clip(new_uvs, 0.0, 1.0)
    missing_uv_count = int(np.isnan(new_uvs).sum())

    validation = {
        "uv_in_range": uv_check["in_range"],
        "uv_min": uv_check["min"],
        "uv_max": uv_check["max"],
        "missing_uv_count": missing_uv_count,
        "inverted_triangle_count": inverted_count,
        "vertex_count": len(new_vertices),
        "triangle_count": len(new_faces),
    }

    return LabelMappingResult(
        vertices=new_vertices,
        faces=new_faces,
        uvs=new_uvs,
        texture=texture,
        uv_mode=uv_mode,
        validation=validation,
    )
