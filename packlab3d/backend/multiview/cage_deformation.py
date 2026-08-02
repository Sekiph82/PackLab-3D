"""Authoritative cage deformation, deterministic checksums, and edit transforms."""

from __future__ import annotations

import hashlib
import json
import math
from copy import deepcopy

import numpy as np

from packlab3d.backend.multiview.editable_geometry import build_cage_bindings, cage_topology_checksum


VERTEX_QUANTIZATION = 1e-6


def _digest(value) -> str:
    return "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")).hexdigest()


def checksum_vertices(vertices, precision: float = VERTEX_QUANTIZATION) -> str:
    values = np.asarray(vertices, dtype=np.float64).reshape((-1, 3))
    quantized = np.rint(values / precision).astype("<i8")
    return "sha256:" + hashlib.sha256(quantized.tobytes(order="C")).hexdigest()


def checksum_faces(faces) -> str:
    values = np.asarray(faces, dtype="<i8").reshape((-1, 3))
    return "sha256:" + hashlib.sha256(values.tobytes(order="C")).hexdigest()


def checksum_cage(cage: dict) -> str:
    return _digest({
        "topologyVersion": cage.get("topologyVersion"),
        "layerCount": cage.get("layerCount"),
        "ringCount": cage.get("ringCount"),
        "symmetry": cage.get("symmetry", {}),
        "falloff": cage.get("falloff", {}),
        "nodes": [{key: node.get(key) for key in ("id", "layerIndex", "ringIndex", "positionMm", "pinned", "lockedAxes", "mirrorNodeIds")} for node in cage.get("nodes", [])],
        "edges": cage.get("edges", []),
    })


def checksum_bindings(bindings: dict) -> str:
    return _digest({"cacheKey": bindings.get("cacheKey"), "topologyChecksum": bindings.get("topologyChecksum"), "bindings": bindings.get("bindings", [])})


def build_authoritative_bindings(vertices, cage: dict, model_revision: int) -> dict:
    bindings = build_cage_bindings(vertices, cage, model_revision=model_revision)
    bindings["bindingChecksum"] = checksum_bindings(bindings)
    return bindings


def _falloff_factor(mode: str, radial_weight: float, custom_radius=None) -> float:
    radius = {"local": 1.0, "medium": 2.0, "wide": 4.0}.get(mode, 2.0)
    if mode == "custom" and custom_radius is not None:
        radius = max(0.1, min(8.0, float(custom_radius)))
    value = max(0.0, min(1.0, float(radial_weight) / radius))
    return value * value * (3.0 - 2.0 * value)


def apply_cage_deformation(rest_vertices, faces, cage_topology: dict, cage_nodes: list[dict], bindings: dict, constraints: dict | None = None, quality_mode: str = "preview") -> dict:
    """Apply the same bounded vertex operation for preview and final output.

    ``quality_mode`` only controls metadata; it never changes vertex math.
    """
    constraints = constraints or {}
    cage = deepcopy(cage_topology or {})
    cage["nodes"] = deepcopy(cage_nodes or cage.get("nodes", []))
    node_map = {(int(node.get("layerIndex", 0)), int(node.get("ringIndex", 0))): node for node in cage.get("nodes", [])}
    mode = constraints.get("falloff", cage.get("falloff", {}).get("mode", "medium")) if isinstance(constraints.get("falloff", cage.get("falloff", {})), str) else "medium"
    custom_radius = constraints.get("customRadius", cage.get("falloff", {}).get("customRadius"))
    output = []
    for binding in bindings.get("bindings", []):
        lower = int(binding["lowerLayer"]); upper = int(binding["upperLayer"])
        a = int(binding["angularNodeA"]); b = int(binding["angularNodeB"])
        vertical = float(binding["verticalWeight"]); angular = float(binding["angularWeight"])
        delta = np.zeros(3, dtype=np.float64)
        for key, weight in [((lower, a), (1 - vertical) * (1 - angular)), ((lower, b), (1 - vertical) * angular), ((upper, a), vertical * (1 - angular)), ((upper, b), vertical * angular)]:
            node = node_map.get(key)
            if not node or node.get("pinned"):
                continue
            rest = np.asarray(node.get("restPositionMm", node.get("positionMm", [0, 0, 0])), dtype=np.float64)
            current = np.asarray(node.get("positionMm", rest.tolist()), dtype=np.float64)
            displacement = current - rest
            for axis, name in enumerate(("x", "y", "z")):
                if name in set(node.get("lockedAxes", [])):
                    displacement[axis] = 0.0
            delta += displacement * float(weight)
        factor = _falloff_factor(mode, binding.get("radialWeight", 1.0), custom_radius)
        original = np.asarray(binding["restPositionMm"], dtype=np.float64)
        output.append((original + delta * factor).tolist())
    values = np.asarray(output, dtype=np.float64)
    return {"vertices": values.tolist(), "vertexChecksum": checksum_vertices(values), "faceChecksum": checksum_faces(faces) if faces is not None else None, "qualityMode": quality_mode, "bindingChecksum": checksum_bindings(bindings), "cageChecksum": checksum_cage(cage), "topologyChecksum": cage_topology_checksum(cage)}


def transform_nodes(nodes: list[dict], selected_ids: list[str], *, scale=(1.0, 1.0, 1.0), rotation_deg=(0.0, 0.0, 0.0), pivot_mode="centroid", pivot=None, symmetry=True) -> dict:
    selected = [node for node in nodes if node.get("id") in set(selected_ids)]
    if pivot is None:
        if pivot_mode == "active-node" and selected:
            pivot = list(selected[0].get("positionMm", [0, 0, 0]))
        else:
            pivot = (np.mean([node.get("positionMm", [0, 0, 0]) for node in selected], axis=0).tolist() if selected else [0.0, 0.0, 0.0])
    pivot = np.asarray(pivot, dtype=np.float64)
    scale_values = np.maximum(np.asarray(scale, dtype=np.float64), 1e-4)
    angles = np.radians(np.asarray(rotation_deg, dtype=np.float64))
    rx, ry, rz = angles
    matrices = [np.array([[1, 0, 0], [0, math.cos(rx), -math.sin(rx)], [0, math.sin(rx), math.cos(rx)]]), np.array([[math.cos(ry), 0, math.sin(ry)], [0, 1, 0], [-math.sin(ry), 0, math.cos(ry)]]), np.array([[math.cos(rz), -math.sin(rz), 0], [math.sin(rz), math.cos(rz), 0], [0, 0, 1]])]
    rotation = matrices[2] @ matrices[1] @ matrices[0]
    selected_set = set(selected_ids)
    changed = []
    result = deepcopy(nodes)
    for node in result:
        if node.get("id") not in selected_set or node.get("pinned"):
            continue
        current = np.asarray(node.get("positionMm", [0, 0, 0]), dtype=np.float64)
        target = pivot + rotation @ ((current - pivot) * scale_values)
        movement = target - current
        for axis, name in enumerate(("x", "y", "z")):
            if name in set(node.get("lockedAxes", [])):
                movement[axis] = 0.0
        node["positionMm"] = [round(float(value), 6) for value in current + movement]
        changed.append(node.get("id"))
    if symmetry:
        by_id = {node.get("id"): node for node in result}
        for node_id in list(changed):
            node = by_id.get(node_id)
            for mirror_id in node.get("mirrorNodeIds", []):
                mirror = by_id.get(mirror_id)
                if mirror and mirror.get("id") not in selected_set and not mirror.get("pinned"):
                    mirror["positionMm"] = [round(-node["positionMm"][0], 6), node["positionMm"][1], round(-node["positionMm"][2], 6)]
                    changed.append(mirror.get("id"))
    return {"nodes": result, "pivot": pivot.tolist(), "changedIds": changed, "scale": scale_values.tolist(), "rotationDeg": np.degrees(angles).tolist(), "pivotMode": pivot_mode}
