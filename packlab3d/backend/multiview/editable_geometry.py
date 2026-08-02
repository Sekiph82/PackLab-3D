"""Validation and bounded deformation for the generic editable model.

The model remains package-category independent: profiles, closed sections, and
an axis-aligned low-resolution cage are the only editing primitives here.
"""

from __future__ import annotations

import copy
import math
from typing import Iterable


MODEL_REVISION = "modelRevision"


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
    return model


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
