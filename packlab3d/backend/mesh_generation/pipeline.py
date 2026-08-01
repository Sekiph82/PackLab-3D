import enum

import numpy as np
import open3d as o3d
from PIL import Image

from packlab3d.core.utils.errors import ModelNotAvailableError


class MeshBackend(str, enum.Enum):
    TRIPOSR = "triposr"
    HUNYUAN3D = "hunyuan3d"
    PICTOMESH = "pictomesh"


def generate_mesh(
    image: Image.Image, backend: MeshBackend = MeshBackend.TRIPOSR, **kwargs
) -> o3d.geometry.TriangleMesh:
    if backend == MeshBackend.TRIPOSR:
        return _generate_triposr(image, **kwargs)
    if backend in (MeshBackend.HUNYUAN3D, MeshBackend.PICTOMESH):
        raise ModelNotAvailableError(
            f"'{backend.value}' backend is not wired up yet. Use MeshBackend.TRIPOSR "
            "for single-view mesh generation until this backend is implemented."
        )
    raise ValueError(f"Unknown mesh backend: {backend}")


def _generate_triposr(
    image: Image.Image, chunk_size: int = 8192, device: str = "cpu"
) -> o3d.geometry.TriangleMesh:
    """Reference integration for VAST-AI-Research/TripoSR.

    Requires torch and the `tsr` package (cloned from the TripoSR repo; not on PyPI).
    Matches TripoSR's published run.py as of its public README — re-check against
    your installed version if this raises AttributeError.
    """
    try:
        import torch
        from tsr.system import TSR
    except ImportError as exc:
        raise ModelNotAvailableError(
            "TripoSR requires torch and the 'tsr' package from "
            "https://github.com/VAST-AI-Research/TripoSR "
            "(pip install -r requirements.txt from that repo; 'tsr' is not on PyPI)."
        ) from exc

    model = TSR.from_pretrained(
        "stabilityai/TripoSR", config_name="config.yaml", weight_name="model.ckpt"
    )
    model.renderer.set_chunk_size(chunk_size)
    model.to(device)

    with torch.no_grad():
        scene_codes = model([image.convert("RGB")], device=device)
    meshes = model.extract_mesh(scene_codes, has_vertex_color=True)
    trimesh_mesh = meshes[0]
    return mesh_from_vertices_faces(
        np.asarray(trimesh_mesh.vertices), np.asarray(trimesh_mesh.faces)
    )


def mesh_from_vertices_faces(vertices: np.ndarray, faces: np.ndarray) -> o3d.geometry.TriangleMesh:
    """Build an Open3D mesh from raw vertex/face arrays (duck-types trimesh output)."""
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
