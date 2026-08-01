from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

import numpy as np
import open3d as o3d

from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh
from packlab3d.backend.label_mapping.bake_texture import bake_texture
from packlab3d.backend.label_mapping.export_glb import export_to_glb, validate_glb

MAX_TEXTURE_RESOLUTION = 4096
DEFAULT_LABEL_MAPPING_TIMEOUT_SECONDS = float(os.environ.get("PACKLAB_LABEL_MAPPING_TIMEOUT_SECONDS", "30"))
PREFERRED_TRIANGLE_COUNT = 80000
HARD_TRIANGLE_LIMIT = 250000


class LabelMappingValidationError(ValueError):
    def __init__(self, errors: list[str], report: dict):
        super().__init__("; ".join(errors))
        self.errors = errors
        self.report = report


@dataclass
class StageTimer:
    started_at: float = field(default_factory=time.perf_counter)
    stages: list[dict] = field(default_factory=list)

    def mark(self, stage: str) -> None:
        now = time.perf_counter()
        previous = self.stages[-1]["at"] if self.stages else self.started_at
        self.stages.append(
            {
                "stage": stage,
                "at": now,
                "elapsedMs": round((now - self.started_at) * 1000, 2),
                "durationMs": round((now - previous) * 1000, 2),
            }
        )

    def report(self) -> list[dict]:
        return [{k: v for k, v in item.items() if k != "at"} for item in self.stages]


def validate_mesh_for_label_mapping(mesh: o3d.geometry.TriangleMesh) -> dict:
    vertices = np.asarray(mesh.vertices)
    triangles = np.asarray(mesh.triangles)
    errors: list[str] = []
    warnings: list[str] = []
    bbox_min = vertices.min(axis=0).tolist() if len(vertices) else None
    bbox_max = vertices.max(axis=0).tolist() if len(vertices) else None
    bbox_extent = (np.asarray(bbox_max) - np.asarray(bbox_min)).tolist() if bbox_min is not None else None

    if len(vertices) == 0:
        errors.append("Mesh has no vertices.")
    if len(triangles) == 0:
        errors.append("Mesh has no triangles.")
    if len(vertices) and not np.isfinite(vertices).all():
        errors.append("Mesh contains non-finite vertices.")
    if len(triangles) and (triangles.min() < 0 or triangles.max() >= len(vertices)):
        errors.append("Mesh contains invalid triangle indices.")
    if bbox_extent is not None and max(bbox_extent) <= 1e-9:
        errors.append("Mesh has no usable surface area.")

    duplicate_triangles = 0
    degenerate_triangles = 0
    if len(triangles) and len(vertices):
        sorted_faces = np.sort(triangles, axis=1)
        duplicate_triangles = int(len(sorted_faces) - len(np.unique(sorted_faces, axis=0)))
        v0, v1, v2 = vertices[triangles[:, 0]], vertices[triangles[:, 1]], vertices[triangles[:, 2]]
        areas = np.linalg.norm(np.cross(v1 - v0, v2 - v0), axis=1) / 2.0
        degenerate_triangles = int(np.sum(areas <= 1e-12))
        if degenerate_triangles == len(triangles):
            errors.append("Mesh triangles are all degenerate.")
        elif degenerate_triangles:
            warnings.append(f"Mesh contains {degenerate_triangles} degenerate triangles.")
        if duplicate_triangles:
            warnings.append(f"Mesh contains {duplicate_triangles} duplicate triangles.")

    triangle_count = int(len(triangles))
    if triangle_count > HARD_TRIANGLE_LIMIT:
        errors.append(f"Mesh has {triangle_count} triangles, above the hard limit of {HARD_TRIANGLE_LIMIT}.")
    elif triangle_count > PREFERRED_TRIANGLE_COUNT:
        warnings.append(f"Mesh has {triangle_count} triangles; label mapping may be slower.")

    report = {
        "valid": not errors,
        "errors": errors,
        "warnings": warnings,
        "vertexCount": int(len(vertices)),
        "triangleCount": triangle_count,
        "watertight": bool(mesh.is_watertight()) if len(triangles) else False,
        "edgeManifold": bool(mesh.is_edge_manifold()) if len(triangles) else False,
        "vertexManifold": bool(mesh.is_vertex_manifold()) if len(triangles) else False,
        "duplicateTriangles": duplicate_triangles,
        "degenerateTriangles": degenerate_triangles,
        "boundingBox": {"min": bbox_min, "max": bbox_max, "extent": bbox_extent},
    }
    if errors:
        raise LabelMappingValidationError(errors, report)
    return report


def clamp_texture_resolution(texture_resolution: int) -> tuple[int, list[str]]:
    warnings: list[str] = []
    try:
        value = int(texture_resolution)
    except Exception:
        value = 1024
        warnings.append("Invalid texture resolution; using 1024.")
    if value <= 0:
        value = 1024
        warnings.append("Texture resolution must be positive; using 1024.")
    if value > MAX_TEXTURE_RESOLUTION:
        warnings.append(f"Texture resolution reduced from {value} to {MAX_TEXTURE_RESOLUTION}.")
        value = MAX_TEXTURE_RESOLUTION
    return value, warnings


def apply_label_mapping_pipeline(mesh, label_package, uv_mode, texture_resolution: int) -> dict:
    timer = StageTimer()
    timer.mark("Request received")

    forced_sleep = float(os.environ.get("PACKLAB_FORCE_LABEL_MAPPING_SLEEP_SECONDS", "0") or 0)
    if forced_sleep > 0:
        time.sleep(forced_sleep)

    mesh_report = validate_mesh_for_label_mapping(mesh)
    timer.mark("Mesh parsed")

    timer.mark("Label image parsed")

    resolution, warnings = clamp_texture_resolution(texture_resolution)
    timer.mark("Texture bake started")
    texture = bake_texture(label_package, target_size=(resolution, resolution))
    timer.mark("Texture bake completed")

    timer.mark("UV generation started")
    result = apply_label_to_mesh(mesh, uv_mode, texture)
    timer.mark("UV generation completed")

    timer.mark("GLB export started")
    glb_bytes = export_to_glb(result)
    timer.mark("GLB export completed")

    validation = validate_glb(glb_bytes, expect_texture=True, expect_uv=True)
    timer.mark("Response created")
    if not validation["valid"]:
        raise ValueError(f"Generated GLB failed validation: {validation['warnings']}")

    return {
        "glb": glb_bytes,
        "uvMode": result.uv_mode.value,
        "textureResolution": resolution,
        "meshReport": mesh_report,
        "mappingReport": result.validation,
        "glbValidation": validation,
        "warnings": warnings + mesh_report.get("warnings", []),
        "timings": timer.report(),
    }
