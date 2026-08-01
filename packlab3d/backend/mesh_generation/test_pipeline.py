import numpy as np
import open3d as o3d
import pytest
from PIL import Image

from packlab3d.backend.mesh_generation.pipeline import (
    MeshBackend,
    generate_mesh,
    mesh_from_vertices_faces,
)


def test_mesh_from_vertices_faces_builds_valid_mesh():
    vertices = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=float)
    faces = np.array([[0, 1, 2], [0, 1, 3], [0, 2, 3], [1, 2, 3]], dtype=int)
    mesh = mesh_from_vertices_faces(vertices, faces)
    assert isinstance(mesh, o3d.geometry.TriangleMesh)
    assert len(mesh.vertices) == 4
    assert len(mesh.triangles) == 4


def test_mesh_from_vertices_faces_rejects_bad_vertex_shape():
    with pytest.raises(ValueError):
        mesh_from_vertices_faces(np.zeros((4, 2)), np.zeros((2, 3), dtype=int))


def test_mesh_from_vertices_faces_rejects_bad_face_shape():
    with pytest.raises(ValueError):
        mesh_from_vertices_faces(np.zeros((4, 3)), np.zeros((2, 4), dtype=int))


def test_generate_mesh_single_photo_path_is_retired():
    image = Image.new("RGB", (32, 32))
    with pytest.raises(RuntimeError, match="retired"):
        generate_mesh(image, backend=MeshBackend.NATIVE_PHOTO_SET)
