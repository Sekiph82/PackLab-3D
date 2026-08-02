"""Validation and bounded deformation for the generic editable model.

The model remains package-category independent: profiles, closed sections, and
an axis-aligned low-resolution cage are the only editing primitives here.
"""

from __future__ import annotations

import copy
import math
import hashlib
import json
from typing import Iterable


MODEL_REVISION = "modelRevision"
CAGE_TOPOLOGY_VERSION = 2
DEFAULT_CAGE_LAYERS = 7
DEFAULT_CAGE_RINGS = 8


class GeometryValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("; ".join(errors))


def ensure_editable_model(model: dict) -> dict:
    model = copy.deepcopy(model or {})
    model.setdefault("version", 2)
    model.setdefault(MODEL_REVISION, 1)
    model.setdefault("symmetryConstraints", {"mode": "auto"})
    model.setdefault("editHistory", [])
    model.setdefault("controlCage", {}).setdefault("nodes", [])
    model.setdefault("controlCage", {}).setdefault("edges", [])
    model["profiles"] = model.get("profiles") or {
        "front": copy.deepcopy(model.get("frontProfile", [])),
        "rear": copy.deepcopy(model.get("frontProfile", [])),
        "left": copy.deepcopy(model.get("sideProfile", [])),
        "right": copy.deepcopy(model.get("sideProfile", [])),
    }
    for section in model.get("crossSections", []):
        section.setdefault("points", [])
        section.setdefault("rotationDeg", 0.0)
        section.setdefault("centerOffsetMm", [0.0, 0.0])
    for node in model["controlCage"]["nodes"]:
        node.setdefault("restPositionMm", list(node.get("positionMm", [0.0, 0.0, 0.0])))
        node.setdefault("lockedAxes", [])
        node.setdefault("mirrorNodeIds", [])
        node.setdefault("region", node.get("group", "body"))
    ensure_cage_lattice(model)
    return model


def ensure_cage_lattice(model: dict, layer_count: int = DEFAULT_CAGE_LAYERS, ring_count: int = DEFAULT_CAGE_RINGS) -> dict:
    """Add deterministic generic lattice metadata without replacing existing user nodes."""
    cage = model.setdefault("controlCage", {})
    cage.setdefault("topologyVersion", CAGE_TOPOLOGY_VERSION)
    cage.setdefault("layerCount", layer_count)
    cage.setdefault("ringCount", ring_count)
    cage.setdefault("symmetry", {"x": True, "z": True})
    cage.setdefault("falloff", {"mode": "medium", "customRadius": None})
    cage.setdefault("selectedNodeIds", [])
    if cage.get("nodes"):
        for node in cage["nodes"]:
            node.setdefault("layerIndex", round(float(node.get("heightRatio", 0.5)) * (int(cage["layerCount"]) - 1)))
            node.setdefault("ringIndex", 0)
            node.setdefault("revision", 1)
        return model
    sections = sorted(model.get("crossSections", []), key=lambda item: float(item.get("heightRatio", 0.0)))
    height = max(float(model.get("heightMm", 1.0)), 1.0)
    max_width = max([float(item.get("widthMm", 1.0)) for item in sections] or [1.0])
    max_depth = max([float(item.get("depthMm", 1.0)) for item in sections] or [1.0])
    nodes = []
    for layer in range(layer_count):
        ratio = layer / max(layer_count - 1, 1)
        section = min(sections, key=lambda item: abs(float(item.get("heightRatio", 0.5)) - ratio)) if sections else {}
        width = float(section.get("widthMm", max_width))
        depth = float(section.get("depthMm", max_depth))
        y = ratio * height
        region = "base" if ratio < 0.15 else "cap" if ratio > 0.86 else "lower-body" if ratio < 0.35 else "upper-body" if ratio > 0.68 else "mid-body"
        for ring in range(ring_count):
            angle = (2.0 * math.pi * ring) / ring_count
            position = [round((width * 0.5) * math.cos(angle), 4), round(y, 4), round((depth * 0.5) * math.sin(angle), 4)]
            nodes.append({
                "id": f"cage-layer-{layer:02d}-ring-{ring:02d}",
                "layerIndex": layer,
                "ringIndex": ring,
                "restPositionMm": position[:],
                "positionMm": position[:],
                "pinned": False,
                "lockedAxes": [],
                "region": region,
                "mirrorNodeIds": [],
                "revision": 1,
            })
    edges = []
    for layer in range(layer_count):
        for ring in range(ring_count):
            current = f"cage-layer-{layer:02d}-ring-{ring:02d}"
            next_ring = f"cage-layer-{layer:02d}-ring-{(ring + 1) % ring_count:02d}"
            edges.append({"id": f"cage-ring-{layer:02d}-{ring:02d}-{(ring + 1) % ring_count:02d}", "from": current, "to": next_ring})
            if layer < layer_count - 1:
                above = f"cage-layer-{layer + 1:02d}-ring-{ring:02d}"
                edges.append({"id": f"cage-vertical-{layer:02d}-{ring:02d}", "from": current, "to": above})
    cage["nodes"] = nodes
    cage["edges"] = edges
    for node in nodes:
        mirror_ring = (-node["ringIndex"]) % ring_count
        node["mirrorNodeIds"] = [f"cage-layer-{node['layerIndex']:02d}-ring-{mirror_ring:02d}"] if mirror_ring != node["ringIndex"] else []
    return model


def cage_topology_checksum(cage: dict) -> str:
    payload = {"topologyVersion": cage.get("topologyVersion"), "nodes": [node.get("id") for node in cage.get("nodes", [])], "edges": cage.get("edges", [])}
    return "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def build_cage_bindings(vertices: Iterable[Iterable[float]], cage: dict, model_revision: int = 1) -> dict:
    """Build deterministic vertical/angular lattice bindings for mesh vertices."""
    nodes = cage.get("nodes", [])
    layers = max(int(cage.get("layerCount", DEFAULT_CAGE_LAYERS)), 2)
    rings = max(int(cage.get("ringCount", DEFAULT_CAGE_RINGS)), 3)
    by_layer = {layer: [node for node in nodes if int(node.get("layerIndex", 0)) == layer] for layer in range(layers)}
    vertex_values = [[float(value) for value in list(vertex)[:3]] for vertex in vertices]
    bindings = []
    max_radius = max([math.hypot(value[0], value[2]) for value in vertex_values] or [1.0])
    min_vertex_y = min([value[1] for value in vertex_values] or [0.0]); max_vertex_y = max([value[1] for value in vertex_values] or [1.0])
    for index, vertex in enumerate(vertex_values):
        x, y, z = [float(value) for value in list(vertex)[:3]]
        normalized_y = max(0.0, min(1.0, (y - min_vertex_y) / max(max_vertex_y - min_vertex_y, 1e-9)))
        scaled = normalized_y * (layers - 1)
        lower = min(layers - 2, max(0, int(math.floor(scaled))))
        vertical_weight = scaled - lower
        angle = (math.atan2(z, x) % (2.0 * math.pi)) / (2.0 * math.pi) * rings
        angular_a = int(math.floor(angle)) % rings
        angular_b = (angular_a + 1) % rings
        angular_weight = angle - math.floor(angle)
        bindings.append({"vertexIndex": index, "lowerLayer": lower, "upperLayer": lower + 1, "angularNodeA": angular_a, "angularNodeB": angular_b, "verticalWeight": round(vertical_weight, 6), "angularWeight": round(angular_weight, 6), "radialWeight": round(max(0.0, min(1.0, math.hypot(x, z) / max_radius)), 6), "restPositionMm": [x, y, z]})
    cache_key = f"{model_revision}:{len(bindings)}:{cage_topology_checksum(cage)}"
    return {"cacheKey": cache_key, "topologyChecksum": cage_topology_checksum(cage), "bindings": bindings}


def deform_vertices_with_cage(vertices: Iterable[Iterable[float]], cage: dict, binding_cache: dict, falloff: str = "medium") -> list[list[float]]:
    """Apply bilinear-plus-vertical cage displacement while preserving mesh topology."""
    nodes = {(int(node.get("layerIndex", 0)), int(node.get("ringIndex", 0))): node for node in cage.get("nodes", [])}
    radius = {"local": 1.0, "medium": 2.0, "wide": 4.0}.get(falloff, 2.0)
    moved = []
    for binding in binding_cache.get("bindings", []):
        lower = int(binding["lowerLayer"]); upper = int(binding["upperLayer"])
        a = int(binding["angularNodeA"]); b = int(binding["angularNodeB"])
        vertical = float(binding["verticalWeight"]); angular = float(binding["angularWeight"])
        delta = [0.0, 0.0, 0.0]
        for key, weight in [((lower, a), (1 - vertical) * (1 - angular)), ((lower, b), (1 - vertical) * angular), ((upper, a), vertical * (1 - angular)), ((upper, b), vertical * angular)]:
            node = nodes.get(key)
            if not node:
                continue
            rest = node.get("restPositionMm", node.get("positionMm", [0, 0, 0])); position = node.get("positionMm", rest)
            for axis in range(3):
                delta[axis] += (float(position[axis]) - float(rest[axis])) * weight
        original = list(binding["restPositionMm"])
        distance_factor = max(0.0, min(1.0, float(binding.get("radialWeight", 1.0)) / radius))
        eased = distance_factor * distance_factor * (3 - 2 * distance_factor)
        moved.append([round(original[axis] + delta[axis] * eased, 5) for axis in range(3)])
    return moved


def validate_profile(points: Iterable[dict], minimum: int = 3) -> dict:
    points = list(points or [])
    errors: list[str] = []
    if len(points) < minimum:
        errors.append(f"profile requires at least {minimum} points")
    ys = []
    for point in points:
        try:
            y = float(point.get("heightRatio", point.get("y", 0.0)))
            extent = float(point.get("halfExtentMm", point.get("value", 0.0)))
        except (TypeError, ValueError):
            errors.append("profile contains non-numeric coordinates")
            continue
        if not math.isfinite(y) or not math.isfinite(extent):
            errors.append("profile contains non-finite coordinates")
        if extent <= 0:
            errors.append("profile contains a non-positive extent")
        if not 0 <= y <= 1:
            errors.append("profile height must be between 0 and 1")
        ys.append(y)
    if len(ys) != len(set(round(y, 7) for y in ys)):
        errors.append("profile contains duplicate vertical positions")
    if ys and ys != sorted(ys):
        errors.append("profile points must be ordered by height")
    return {"valid": not errors, "errors": errors}


def validate_section(section: dict) -> dict:
    errors: list[str] = []
    points = section.get("points") or []
    if points:
        if len(points) < 6:
            errors.append("section loop requires at least 6 points")
        for point in points:
            values = point if isinstance(point, (list, tuple)) else [point.get("xMm"), point.get("zMm")]
            if len(values) < 2 or not all(math.isfinite(float(value)) for value in values[:2]):
                errors.append("section contains non-finite coordinates")
        if _signed_area(points) == 0:
            errors.append("section loop has zero area")
    for key in ("widthMm", "depthMm"):
        try:
            value = float(section.get(key, 0))
            if not math.isfinite(value) or value <= 0:
                errors.append(f"section {key} must be positive")
        except (TypeError, ValueError):
            errors.append(f"section {key} is not numeric")
    try:
        height = float(section.get("heightRatio", 0))
        if not 0 <= height <= 1:
            errors.append("section height must be between 0 and 1")
    except (TypeError, ValueError):
        errors.append("section height is not numeric")
    return {"valid": not errors, "errors": errors}


def validate_model(model: dict) -> dict:
    errors: list[str] = []
    profile_reports = {}
    for name in ("frontProfile", "sideProfile"):
        profile_reports[name] = validate_profile(model.get(name, []))
        errors.extend(f"{name}: {error}" for error in profile_reports[name]["errors"])
    sections = model.get("crossSections", [])
    heights = [float(section.get("heightRatio", 0)) for section in sections]
    if heights != sorted(heights) or len(heights) != len(set(heights)):
        errors.append("cross-sections must have unique ascending heights")
    section_reports = {}
    for section in sections:
        section_reports[section.get("id", "unknown")] = validate_section(section)
        errors.extend(f"{section.get('id', 'section')}: {error}" for error in section_reports[section.get("id", "unknown")]["errors"])
    return {"valid": not errors, "errors": errors, "profiles": profile_reports, "sections": section_reports}


def apply_profile_points(model: dict, profile_name: str, points: list[dict], symmetry: bool = True) -> dict:
    model = ensure_editable_model(model)
    report = validate_profile(points)
    if not report["valid"]:
        raise GeometryValidationError(report["errors"])
    target = "frontProfile" if profile_name in {"front", "frontProfile", "rear", "rearProfile"} else "sideProfile"
    model[target] = copy.deepcopy(points)
    for point in model[target]:
        point.setdefault("source", "manual")
        point.setdefault("mode", "smooth")
        point.setdefault("tangentIn", [0.0, 0.0])
        point.setdefault("tangentOut", [0.0, 0.0])
    if symmetry:
        mirror = "rearProfile" if target == "frontProfile" else "rightProfile"
        model["profiles"][mirror.replace("Profile", "")] = copy.deepcopy(model[target])
    return model


def apply_sections(model: dict, edits: list[dict]) -> dict:
    model = ensure_editable_model(model)
    by_id = {section.get("id"): section for section in model.get("crossSections", [])}
    for edit in edits:
        section = by_id.get(edit.get("id"))
        if section is None:
            section = {"id": edit.get("id"), "heightRatio": 0.5, "widthMm": 20.0, "depthMm": 20.0}
            model.setdefault("crossSections", []).append(section)
            by_id[section["id"]] = section
        if section.get("locked"):
            continue
        for key in ("heightRatio", "widthMm", "depthMm", "rotationDeg", "points"):
            if key in edit:
                section[key] = copy.deepcopy(edit[key])
        if "centerOffsetMm" in edit:
            section["centerOffsetMm"] = list(edit["centerOffsetMm"])
        section.setdefault("points", [])
    model["crossSections"].sort(key=lambda item: float(item.get("heightRatio", 0)))
    report = validate_model(model)
    if not report["valid"]:
        raise GeometryValidationError(report["errors"])
    return model


def apply_cage_edits(model: dict, edits: list[dict], falloff: str = "medium", symmetry: bool = True) -> dict:
    model = ensure_editable_model(model)
    nodes = {node.get("id"): node for node in model["controlCage"].get("nodes", [])}
    sections = model.get("crossSections", [])
    if not sections:
        return model
    radius = {"local": 0.12, "medium": 0.24, "wide": 0.45}.get(falloff, 0.24)
    for edit in edits:
        node = nodes.get(edit.get("id"))
        if not node or node.get("pinned"):
            continue
        delta = [float(value) for value in (edit.get("deltaMm") or [0, 0, 0])]
        locked_axes = set(node.get("lockedAxes", []))
        delta = [0.0 if axis in locked_axes else value for axis, value in zip(("x", "y", "z"), delta)]
        node["positionMm"] = [round(float(value) + delta[index], 3) for index, value in enumerate(node.get("positionMm", [0, 0, 0]))]
        if symmetry:
            for mirror_id in node.get("mirrorNodeIds", []):
                mirror = nodes.get(mirror_id)
                if mirror and not mirror.get("pinned"):
                    mirror_delta = [-delta[0], delta[1], -delta[2]]
                    mirror["positionMm"] = [round(float(value) + mirror_delta[index], 3) for index, value in enumerate(mirror.get("positionMm", [0, 0, 0]))]
        node_y = (float(node.get("heightRatio", 0.5)) - 0.5) * float(model.get("heightMm", 1))
        for section in sections:
            section_y = (float(section.get("heightRatio", 0.5)) - 0.5) * float(model.get("heightMm", 1))
            weight = max(0.0, 1.0 - abs(section_y - node_y) / max(float(model.get("heightMm", 1)) * radius, 1e-6))
            weight = weight * weight * (3.0 - 2.0 * weight)
            if weight <= 0:
                continue
            section["widthMm"] = round(max(1.0, float(section.get("widthMm", 1)) + abs(delta[0]) * weight * 2.0), 3)
            section["depthMm"] = round(max(1.0, float(section.get("depthMm", 1)) + abs(delta[2]) * weight * 2.0), 3)
            section.setdefault("deformationWeights", {})[node["id"]] = round(weight, 5)
    report = validate_model(model)
    if not report["valid"]:
        raise GeometryValidationError(report["errors"])
    return model


def _signed_area(points: list) -> float:
    values = []
    for point in points:
        if isinstance(point, (list, tuple)):
            values.append((float(point[0]), float(point[1])))
        else:
            values.append((float(point.get("xMm", 0)), float(point.get("zMm", 0))))
    return 0.5 * sum(values[index][0] * values[(index + 1) % len(values)][1] - values[(index + 1) % len(values)][0] * values[index][1] for index in range(len(values)))
