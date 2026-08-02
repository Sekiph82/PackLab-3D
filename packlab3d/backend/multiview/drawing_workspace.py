from __future__ import annotations

import copy
import datetime as dt
import math
import re
import uuid
import xml.etree.ElementTree as ET


REQUIRED_SVG_GROUPS = (
    "outline",
    "dimensions",
    "centerlines",
    "reference-lines",
    "label-area",
    "sections",
    "notes",
    "title-block",
)

REQUIRED_DXF_LAYERS = (
    "OUTLINE",
    "DIMENSIONS",
    "CENTERLINES",
    "REFERENCE_LINES",
    "LABEL_AREA",
    "SECTIONS",
    "HATCH",
    "NOTES",
    "TITLE_BLOCK",
)


def build_drawing_document(drawing_package: dict, reconstruction_model: dict, previous: dict | None = None) -> dict:
    previous = previous or {}
    metadata = drawing_package.get("metadata", {})
    bbox = metadata.get("bounding_box_mm", [None, None, None])
    title = previous.get("titleBlock", {}).get("title", "PackLab 3D Technical Drawing")
    document = {
        "version": 2,
        "linkedModelVersion": reconstruction_model.get("version"),
        "units": "mm",
        "page": previous.get("page", {"size": "A3", "orientation": "landscape", "marginMm": 12, "scale": "1:1", "grid": True}),
        "views": previous.get("views") or [
            {"id": "front-view", "type": "front", "visible": True, "scale": 1.0, "placement": {"x": 40, "y": 50}},
            {"id": "rear-view", "type": "rear", "visible": True, "scale": 1.0, "placement": {"x": 160, "y": 50}},
            {"id": "left-view", "type": "left", "visible": True, "scale": 1.0, "placement": {"x": 280, "y": 50}},
            {"id": "right-view", "type": "right", "visible": True, "scale": 1.0, "placement": {"x": 400, "y": 50}},
            {"id": "top-view", "type": "top", "visible": True, "scale": 1.0, "placement": {"x": 40, "y": 210}},
            {"id": "bottom-view", "type": "bottom", "visible": True, "scale": 1.0, "placement": {"x": 160, "y": 210}},
        ],
        "dimensions": _linked_dimensions(reconstruction_model, bbox, previous.get("dimensions", [])),
        "notes": previous.get("notes", []),
        "leaders": previous.get("leaders", []),
        "referenceLines": previous.get("referenceLines", []),
        "centerLines": previous.get("centerLines", _default_center_lines()),
        "sectionLines": previous.get("sectionLines", []),
        "sectionViews": previous.get("sectionViews", []),
        "labelAreas": previous.get("labelAreas", [_label_area_from_model(reconstruction_model)]),
        "layers": list(REQUIRED_DXF_LAYERS),
        "titleBlock": {**{"title": title, "revision": "A", "scale": "1:1", "units": "mm", "drawingNumber": ""}, **previous.get("titleBlock", {})},
        "manualOverridesPreserved": True,
        "validation": drawing_package.get("validation", {}),
    }
    return document


def apply_drawing_patch(document: dict, patch: dict) -> dict:
    updated = copy.deepcopy(document or {})
    for note in patch.get("notes", []) or []:
        item = {**{"id": note.get("id") or f"note-{uuid.uuid4().hex[:8]}", "x": 10, "y": 10, "type": "free-note"}, **note}
        _merge_by_id(updated.setdefault("notes", []), item)
    for line in patch.get("referenceLines", []) or []:
        item = {**{"id": line.get("id") or f"ref-{uuid.uuid4().hex[:8]}", "visible": True, "locked": False}, **line}
        _merge_by_id(updated.setdefault("referenceLines", []), item)
    for line in patch.get("sectionLines", []) or []:
        line_id = line.get("id", f"section-line-{uuid.uuid4().hex[:8]}")
        item = {**{"id": line_id, "label": f"A-{len(updated.get('sectionLines', [])) + 1}", "direction": "forward", "visible": True}, **line}
        _merge_by_id(updated.setdefault("sectionLines", []), item)
        section_view_id = f"section-view-{line_id}"
        if not any(view.get("id") == section_view_id for view in updated.setdefault("sectionViews", [])):
            updated["sectionViews"].append({"id": section_view_id, "sourceLineId": line_id, "type": "vertical-section", "visible": True, "estimatedInnerProfile": True})
    for dimension in patch.get("dimensions", []) or []:
        _merge_by_id(updated.setdefault("dimensions", []), dimension)
    if "page" in patch:
        updated["page"] = {**updated.get("page", {}), **patch["page"]}
    if "titleBlock" in patch:
        updated["titleBlock"] = {**updated.get("titleBlock", {}), **patch["titleBlock"]}
    return updated


def validate_svg(svg: str) -> dict:
    warnings = []
    try:
        root = ET.fromstring(svg)
    except ET.ParseError as exc:
        return {"valid": False, "groups": 0, "pathCount": 0, "textCount": 0, "warnings": [str(exc)]}
    id_values = [node.attrib.get("id") for node in root.iter() if node.attrib.get("id")]
    ids = set(id_values)
    duplicate_ids = sorted({item for item in id_values if id_values.count(item) > 1})
    if duplicate_ids:
        warnings.append("Duplicate SVG IDs: " + ", ".join(duplicate_ids))
    missing = [item for item in REQUIRED_SVG_GROUPS if item not in ids]
    if missing:
        warnings.append("Missing SVG groups: " + ", ".join(missing))
    values = re.findall(r"[-+]?(?:\d*\.\d+|\d+)", svg)
    if any(not math.isfinite(float(value)) for value in values):
        warnings.append("SVG contains non-finite numeric value")
    return {
        "valid": not missing and not warnings,
        "groups": len([item for item in REQUIRED_SVG_GROUPS if item in ids]),
        "pathCount": len(list(root.iter("{http://www.w3.org/2000/svg}path"))) + len(list(root.iter("path"))),
        "textCount": len(list(root.iter("{http://www.w3.org/2000/svg}text"))) + len(list(root.iter("text"))),
        "warnings": warnings,
    }


def validate_dxf(dxf: str) -> dict:
    warnings = []
    lines = dxf.splitlines()
    if len(lines) % 2:
        warnings.append("DXF contains an odd number of group-code lines")
    pairs = []
    for index in range(0, len(lines) - 1, 2):
        code = lines[index].strip()
        value = lines[index + 1].strip()
        if not re.fullmatch(r"-?\d+", code):
            warnings.append(f"Invalid DXF group code at line {index + 1}: {code}")
            break
        pairs.append((int(code), value))
    if not dxf.startswith("0\nSECTION"):
        warnings.append("DXF does not start with SECTION")
    if not dxf.rstrip().endswith("EOF"):
        warnings.append("DXF missing EOF")
    if not any(code == 2 and value == "HEADER" for code, value in pairs):
        warnings.append("DXF missing HEADER section")
    if not any(code == 2 and value == "TABLES" for code, value in pairs):
        warnings.append("DXF missing TABLES section")
    if not any(code == 2 and value == "ENTITIES" for code, value in pairs):
        warnings.append("DXF missing ENTITIES section")
    found = sorted(set(re.findall(r"\n8\n([A-Z_]+)", dxf)))
    missing = [layer for layer in REQUIRED_DXF_LAYERS if layer not in found]
    if missing:
        warnings.append("Missing DXF layers: " + ", ".join(missing))
    for token in ("nan", "inf", "-inf"):
        if token in dxf.lower():
            warnings.append(f"DXF contains {token}")
    entity_count = sum(dxf.count(f"\n0\n{entity}") for entity in ("LINE", "POLYLINE", "TEXT", "LWPOLYLINE"))
    return {
        "valid": not warnings,
        "layers": len(found),
        "layerNames": found,
        "entityCount": entity_count,
        "units": "mm",
        "warnings": warnings,
    }


def export_validation_report(package: dict) -> dict:
    svg_reports = [validate_svg(view["svg"]) for view in package.get("views", {}).values()]
    dxf_reports = [validate_dxf(view["dxf"]) for view in package.get("views", {}).values()]
    return {
        "svg": _combine_svg(svg_reports),
        "dxf": _combine_dxf(dxf_reports),
    }


def create_version_snapshot(project, name: str, note: str = "", parent: str | None = None) -> dict:
    return {
        "id": f"version-{uuid.uuid4().hex[:10]}",
        "name": name,
        "timestamp": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "userNote": note,
        "sourceModelRevision": project.reconstructionModel.get("version") if project.reconstructionModel else None,
        "reconstructionState": copy.deepcopy(project.reconstruction),
        "editable3DState": copy.deepcopy(project.editable3DState),
        "drawingState": copy.deepcopy(project.drawingDocument),
        "measurementState": copy.deepcopy(project.measurements),
        "photoAnalysisReferences": list((project.photoAnalysis.get("photos") or {}).keys()) if project.photoAnalysis else [],
        "confidenceSummary": copy.deepcopy(project.optimizationReport.get("confidence", {})) if project.optimizationReport else {},
        "thumbnail": None,
        "parentVersion": parent,
        "changeSummary": [],
        "model": copy.deepcopy(project.reconstructionModel),
        "labelRegion": copy.deepcopy(project.labelRegion),
        "status": "working",
    }


def compare_versions(left: dict, right: dict) -> dict:
    left_model = left.get("model") or {}
    right_model = right.get("model") or {}
    changes = []
    for label, key in (("Height", "heightMm"),):
        if left_model.get(key) != right_model.get(key):
            changes.append(f"{label}: {left_model.get(key)} -> {right_model.get(key)} mm")
    left_width = _max_section(left_model, "widthMm")
    right_width = _max_section(right_model, "widthMm")
    if left_width != right_width:
        changes.append(f"Maximum width: {left_width} -> {right_width} mm")
    left_depth = _max_section(left_model, "depthMm")
    right_depth = _max_section(right_model, "depthMm")
    if left_depth != right_depth:
        changes.append(f"Maximum depth: {left_depth} -> {right_depth} mm")
    notes_delta = len((right.get("drawingState") or {}).get("notes", [])) - len((left.get("drawingState") or {}).get("notes", []))
    if notes_delta:
        changes.append(f"Drawing notes changed by {notes_delta}")
    return {"leftVersionId": left.get("id"), "rightVersionId": right.get("id"), "changes": changes, "changed": bool(changes)}


def autosave_metadata(interval_seconds: int = 45) -> dict:
    return {
        "enabled": True,
        "intervalSeconds": interval_seconds,
        "lastSuccessfulSave": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "atomicWrites": True,
        "recoveryFile": "project.packlab3d.recovery.json",
        "dirty": False,
    }


def _linked_dimensions(reconstruction_model: dict, bbox: list, previous: list[dict]) -> list[dict]:
    by_id = {item["id"]: item for item in previous if "id" in item}

    def dim(item):
        old = by_id.get(item["id"], {})
        placement = old.get("placement", item["placement"])
        return {**item, **{key: old[key] for key in ("visible", "lockedPlacement", "precision", "prefix", "suffix") if key in old}, "placement": placement}

    return [
        dim({"id": "dim-overall-height", "type": "vertical-linear", "viewId": "front-view", "featureRefs": ["model-top", "support-plane"], "valueMm": reconstruction_model.get("heightMm"), "source": "linked-model", "placement": {"offset": 28, "textOffset": [0, 0]}, "visible": True, "lockedPlacement": False}),
        dim({"id": "dim-overall-height-front", "type": "vertical-linear", "viewId": "front-view", "featureRefs": ["model-top", "support-plane"], "valueMm": reconstruction_model.get("heightMm"), "source": "linked-model", "placement": {"offset": 28, "textOffset": [0, 0]}, "visible": True, "lockedPlacement": False}),
        dim({"id": "dim-max-width-front", "type": "horizontal-linear", "viewId": "front-view", "featureRefs": ["max-left", "max-right"], "valueMm": bbox[0] if len(bbox) > 0 else None, "source": "linked-model", "placement": {"offset": 18, "textOffset": [0, 0]}, "visible": True, "lockedPlacement": False}),
        dim({"id": "dim-max-depth-side", "type": "horizontal-linear", "viewId": "left-view", "featureRefs": ["max-front", "max-rear"], "valueMm": bbox[2] if len(bbox) > 2 else None, "source": "linked-model", "placement": {"offset": 18, "textOffset": [0, 0]}, "visible": True, "lockedPlacement": False}),
        dim({"id": "dim-label-height-front", "type": "vertical-linear", "viewId": "front-view", "featureRefs": ["label-top", "label-bottom"], "valueMm": _label_height(reconstruction_model), "source": "estimated", "placement": {"offset": 10, "textOffset": [0, 0]}, "visible": True, "lockedPlacement": False}),
    ]


def _default_center_lines() -> list[dict]:
    return [
        {"id": "center-front-vertical", "viewId": "front-view", "type": "vertical-centre-line", "featureRef": "symmetry-axis", "visible": True, "locked": True},
        {"id": "center-top-horizontal", "viewId": "top-view", "type": "horizontal-centre-line", "featureRef": "centerline", "visible": True, "locked": True},
    ]


def _label_area_from_model(model: dict) -> dict:
    label = model.get("labelRegion", {})
    return {"id": "label-area-front", "viewId": "front-view", "source": label.get("source", "estimated"), "wrapPercent": label.get("wrapPercent", 62), "safeMarginMm": 2.0, "visible": True}


def _label_height(model: dict) -> float | None:
    label = model.get("labelRegion", {})
    height = model.get("heightMm")
    if not height:
        return None
    return round(float(height) * (float(label.get("heightRatioEnd", 0.72)) - float(label.get("heightRatioStart", 0.22))), 3)


def _merge_by_id(items: list[dict], update: dict) -> None:
    for idx, item in enumerate(items):
        if item.get("id") == update.get("id"):
            items[idx] = {**item, **update}
            return
    items.append(update)


def _max_section(model: dict, key: str):
    values = [section.get(key) for section in model.get("crossSections", []) if section.get(key) is not None]
    return max(values) if values else None


def _combine_svg(reports: list[dict]) -> dict:
    warnings = [warning for report in reports for warning in report.get("warnings", [])]
    return {
        "valid": all(report.get("valid") for report in reports),
        "groups": min([report.get("groups", 0) for report in reports] or [0]),
        "pathCount": sum(report.get("pathCount", 0) for report in reports),
        "textCount": sum(report.get("textCount", 0) for report in reports),
        "warnings": warnings,
    }


def _combine_dxf(reports: list[dict]) -> dict:
    warnings = [warning for report in reports for warning in report.get("warnings", [])]
    layers = sorted({layer for report in reports for layer in report.get("layerNames", [])})
    return {
        "valid": all(report.get("valid") for report in reports),
        "layers": len(layers),
        "layerNames": layers,
        "entityCount": sum(report.get("entityCount", 0) for report in reports),
        "units": "mm",
        "warnings": warnings,
    }
