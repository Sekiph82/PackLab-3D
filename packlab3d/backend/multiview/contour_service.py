import hashlib
import time
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from PIL import Image


DEFAULT_REVISIONS = {
    "photoGeometry": 0,
    "automaticMask": 0,
    "manualMask": 0,
    "activeMask": 0,
    "automaticContour": 0,
    "manualContour": 0,
    "activeContour": 0,
    "landmarks": 0,
    "analysis": 0,
    "reconstructionInput": 0,
}

DEFAULT_STALE = {
    "contour": True,
    "landmarks": True,
    "analysis": True,
    "reconstruction": True,
}


class RevisionConflict(ValueError):
    def __init__(self, resource: str, expected: int, current: int):
        self.resource = resource
        self.expected = expected
        self.current = current
        super().__init__(f"The {resource} was updated by another operation. Reload before saving.")

    def to_dict(self) -> dict:
        return {
            "error": "revision_conflict",
            "resource": self.resource,
            "expectedRevision": self.expected,
            "currentRevision": self.current,
            "message": str(self),
        }


@dataclass
class ContourValidation:
    valid: bool
    errors: list[str]


def default_geometry_state(photo_id: str) -> dict:
    return {
        "photoId": photo_id,
        "revisions": dict(DEFAULT_REVISIONS),
        "stale": dict(DEFAULT_STALE),
        "activeMaskSource": "none",
        "activeContourSource": "none",
        "approved": False,
        "updatedAt": time.time(),
    }


def ensure_geometry_state(project, photo_id: str) -> dict:
    state = project.photoGeometry.get(photo_id) if hasattr(project, "photoGeometry") else None
    if not state:
        state = default_geometry_state(photo_id)
        project.photoGeometry[photo_id] = state
    state.setdefault("revisions", {}).update({key: state.get("revisions", {}).get(key, value) for key, value in DEFAULT_REVISIONS.items()})
    state.setdefault("stale", {}).update({key: state.get("stale", {}).get(key, value) for key, value in DEFAULT_STALE.items()})
    return state


def check_revision(state: dict, resource: str, expected) -> None:
    if expected is None:
        return
    current = int(state["revisions"].get(resource, 0))
    expected_int = int(expected)
    if expected_int != current:
        raise RevisionConflict(resource, expected_int, current)


def increment_revision(state: dict, resource: str) -> int:
    state["revisions"][resource] = int(state["revisions"].get(resource, 0)) + 1
    state["revisions"]["photoGeometry"] = int(state["revisions"].get("photoGeometry", 0)) + 1
    state["updatedAt"] = time.time()
    return state["revisions"][resource]


def mark_mask_changed(state: dict, manual: bool) -> None:
    increment_revision(state, "manualMask" if manual else "automaticMask")
    state["revisions"]["activeMask"] = state["revisions"]["manualMask" if manual else "automaticMask"]
    state["activeMaskSource"] = "manual" if manual else "automatic"
    state["stale"].update({"contour": True, "landmarks": True, "analysis": True, "reconstruction": True})


def mark_contour_changed(state: dict, manual: bool) -> None:
    increment_revision(state, "manualContour" if manual else "automaticContour")
    state["revisions"]["activeContour"] = int(state["revisions"].get("activeContour", 0)) + 1
    state["activeContourSource"] = "manual" if manual else "automatic"
    state["stale"].update({"contour": False, "landmarks": True, "analysis": True, "reconstruction": True})


def mark_landmarks_changed(state: dict) -> None:
    increment_revision(state, "landmarks")
    state["stale"].update({"landmarks": False, "analysis": True, "reconstruction": True})


def mask_checksum(mask: np.ndarray) -> str:
    return "sha256:" + hashlib.sha256(np.asarray(mask, dtype=np.uint8).tobytes()).hexdigest()


def load_mask(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert("L"), dtype=np.uint8) > 0


def contour_from_mask(mask: np.ndarray, photo_id: str, revision: int = 0, source: str = "automatic") -> dict:
    rows = np.where(mask.any(axis=1))[0]
    if len(rows) < 3:
        points = _fallback_points(photo_id)
    else:
        height, width = mask.shape
        left = []
        right = []
        sample_rows = np.linspace(rows[0], rows[-1], min(48, max(8, len(rows)))).round().astype(int)
        for row in sample_rows:
            cols = np.where(mask[row])[0]
            if len(cols):
                left.append({"x": float(cols[0]) / max(width - 1, 1), "y": float(row) / max(height - 1, 1)})
                right.append({"x": float(cols[-1]) / max(width - 1, 1), "y": float(row) / max(height - 1, 1)})
        outline = left + list(reversed(right))
        points = [
            {"id": f"{photo_id}-contour-{index:04d}", "x": round(item["x"], 5), "y": round(item["y"], 5), "locked": False, "source": source}
            for index, item in enumerate(outline)
        ]
    normalized = normalized_silhouette(points, photo_id)
    return {
        "photoId": photo_id,
        "revision": revision,
        "sourceMaskRevision": revision,
        "source": source,
        "closed": True,
        "rawPointCount": len(points),
        "editablePointCount": len(points),
        "points": points,
        "holes": [],
        "normalizedSilhouette": normalized,
        "checksum": contour_checksum(points),
        "confidence": 0.85 if len(points) >= 8 else 0.35,
        "updatedAt": time.time(),
    }


def normalized_silhouette(points: list[dict], photo_id: str = "") -> dict:
    if not points:
        points = _fallback_points(photo_id)
    xs = np.asarray([float(item["x"]) for item in points], dtype=np.float64)
    ys = np.asarray([float(item["y"]) for item in points], dtype=np.float64)
    min_y = float(ys.min())
    max_y = float(ys.max())
    height = max(max_y - min_y, 1e-6)
    levels = []
    for y_norm in np.linspace(0.0, 1.0, 24):
        source_y = min_y + y_norm * height
        near = np.abs(ys - source_y) <= max(height / 18.0, 0.025)
        if not near.any():
            left = float(xs.min())
            right = float(xs.max())
        else:
            left = float(xs[near].min())
            right = float(xs[near].max())
        width = max(right - left, 0.001)
        center = (left + right) / 2.0
        levels.append({
            "y": round(float(y_norm), 4),
            "left": round(float(left - center), 4),
            "right": round(float(right - center), 4),
            "width": round(float(width / max(float(xs.max() - xs.min()), 1e-6)), 4),
            "centerX": round(float(center), 4),
        })
    return {
        "photoId": photo_id,
        "centerlineX": round(float(np.median(xs)), 4),
        "supportPlaneY": round(float(max_y), 4),
        "height": 1.0,
        "normalizedHeight": 1.0,
        "normalizedWidth": round(float(xs.max() - xs.min()), 4),
        "widthProfile": levels,
        "levels": levels,
    }


def validate_contour(contour: dict) -> ContourValidation:
    points = contour.get("points") or []
    errors = []
    if len(points) < 3:
        errors.append("A closed contour requires at least 3 points.")
    for point in points:
        try:
            x = float(point["x"])
            y = float(point["y"])
        except (KeyError, TypeError, ValueError):
            errors.append("Contour contains invalid point coordinates.")
            continue
        if not np.isfinite(x) or not np.isfinite(y):
            errors.append("Contour contains non-finite coordinates.")
        if x < -0.05 or x > 1.05 or y < -0.05 or y > 1.05:
            errors.append("Contour point is outside normalized bounds.")
    if abs(_area(points)) < 0.0005:
        errors.append("Contour area is too small.")
    if _self_intersects(points):
        errors.append("Contour self-intersects.")
    return ContourValidation(valid=not errors, errors=list(dict.fromkeys(errors)))


def contour_checksum(points: Iterable[dict]) -> str:
    payload = "|".join(f"{point.get('id','')}:{float(point.get('x',0)):.6f}:{float(point.get('y',0)):.6f}:{int(bool(point.get('locked', False)))}" for point in points)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _fallback_points(photo_id: str) -> list[dict]:
    coords = [(0.25, 0.08), (0.75, 0.08), (0.75, 0.92), (0.25, 0.92)]
    return [{"id": f"{photo_id}-fallback-{idx}", "x": x, "y": y, "locked": False, "source": "fallback"} for idx, (x, y) in enumerate(coords)]


def _area(points: list[dict]) -> float:
    area = 0.0
    for idx, point in enumerate(points):
        nxt = points[(idx + 1) % len(points)]
        area += float(point.get("x", 0)) * float(nxt.get("y", 0)) - float(nxt.get("x", 0)) * float(point.get("y", 0))
    return area / 2.0


def _self_intersects(points: list[dict]) -> bool:
    if len(points) < 4:
        return False
    for i in range(len(points)):
        a1 = points[i]
        a2 = points[(i + 1) % len(points)]
        for j in range(i + 1, len(points)):
            if abs(i - j) <= 1 or (i == 0 and j == len(points) - 1):
                continue
            b1 = points[j]
            b2 = points[(j + 1) % len(points)]
            if _segments_intersect(a1, a2, b1, b2):
                return True
    return False


def _segments_intersect(a, b, c, d) -> bool:
    def orient(p, q, r):
        return np.sign((float(q["x"]) - float(p["x"])) * (float(r["y"]) - float(p["y"])) - (float(q["y"]) - float(p["y"])) * (float(r["x"]) - float(p["x"])))

    return orient(a, b, c) * orient(a, b, d) < 0 and orient(c, d, a) * orient(c, d, b) < 0
