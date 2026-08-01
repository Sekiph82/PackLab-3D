import enum

import numpy as np
import open3d as o3d
from PIL import Image


class MeshBackend(str, enum.Enum):
    NATIVE_PHOTO_SET = "native_photo_set"


def generate_mesh(
    image: Image.Image, backend: MeshBackend = MeshBackend.NATIVE_PHOTO_SET, **_kwargs
) -> o3d.geometry.TriangleMesh:
    raise RuntimeError(
        "Single-photo mesh generation has been retired. Use the PackLab native "
        "multi-photo project reconstruction workflow instead."
    )


def mesh_from_vertices_faces(vertices: np.ndarray, faces: np.ndarray) -> o3d.geometry.TriangleMesh:
    vertices = np.asarray(vertices, dtype=np.float64)
    faces = np.asarray(faces, dtype=np.int32)
    if vertices.ndim != 2 or vertices.shape[1] != 3:
        raise ValueError(f"Expected vertices of shape (N, 3), got {vertices.shape}")
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError(f"Expected triangle faces of shape (M, 3), got {faces.shape}")
    mesh = o3d.geometry.TriangleMesh()
    mesh.vertices = o3d.utility.Vector3dVector(vertices)
    mesh.triangles = o3d.utility.Vector3iVector(faces)
    mesh.compute_vertex_normals()
    return mesh
