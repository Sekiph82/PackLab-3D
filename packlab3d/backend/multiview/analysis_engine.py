from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat


QUALITY_WEIGHTS = {
    "resolution": 0.12,
    "sharpness": 0.15,
    "exposure": 0.14,
    "contrast": 0.10,
    "glare": 0.07,
    "backgroundComplexity": 0.08,
    "objectCoverage": 0.12,
    "objectCentering": 0.08,
    "edgeClipping": 0.06,
    "silhouetteCompleteness": 0.08,
}


@dataclass
class PhotoSignals:
    photo_id: str
    aspect_ratio: float
    histogram: np.ndarray
    phash: str
    bbox: tuple[int, int, int, int] | None
    metrics: dict


def analyze_quality(photo_id: str, image: Image.Image) -> tuple[dict, PhotoSignals]:
    image = ImageOps.exif_transpose(image).convert("RGB")
    gray = ImageOps.grayscale(image)
    arr = np.asarray(gray, dtype=np.float32)
    edges = np.asarray(gray.filter(ImageFilter.FIND_EDGES), dtype=np.float32)
    width, height = image.size
    megapixels = width * height / 1_000_000
    p05, p50, p95 = np.percentile(arr, [5, 50, 95])
    std = float(np.std(arr))
    edge_mean = float(np.mean(edges)) / 255.0
    edge_var = float(np.var(edges)) / (255.0 * 255.0)
    blur_score = max(0.0, min(1.0, 1.0 - edge_var * 14.0))
    sharpness = max(0.0, min(1.0, edge_var * 18.0 + edge_mean * 0.35))
    under = float(np.mean(arr < 28))
    over = float(np.mean(arr > 238))
    exposure = max(0.0, min(1.0, 1.0 - abs((p50 / 255.0) - 0.52) * 1.8 - under * 0.35 - over * 0.35))
    contrast = max(0.0, min(1.0, std / 74.0))
    dynamic_range = max(0.0, min(1.0, (p95 - p05) / 210.0))
    local_contrast = max(0.0, min(1.0, edge_mean * 4.5))
    glare = _glare_probability(image)
    bbox = foreground_bbox(image)
    coverage = _coverage(bbox, width, height)
    centering = _centering_score(bbox, width, height)
    clipping = _edge_clipping(bbox, width, height)
    background = _background_complexity(edges, bbox)
    silhouette = max(0.0, min(1.0, coverage * 1.15 + (1.0 - clipping) * 0.25 - background * 0.2))
    perspective = _perspective_severity(bbox, width, height, edges)
    roll = _camera_roll(edges)
    motion_blur = max(0.0, min(1.0, blur_score * (1.0 - sharpness)))
    compression = max(0.0, min(1.0, float(np.mean(np.abs(np.diff(arr, axis=1)) < 1.2)) * 0.55))
    contour_probability = max(0.0, min(1.0, silhouette * 0.55 + sharpness * 0.25 + (1.0 - background) * 0.2))

    normalized = {
        "resolution": max(0.0, min(1.0, megapixels / 6.0)),
        "sharpness": sharpness,
        "exposure": exposure,
        "contrast": contrast,
        "glare": 1.0 - glare,
        "backgroundComplexity": 1.0 - background,
        "objectCoverage": _coverage_score(coverage),
        "objectCentering": centering,
        "edgeClipping": 1.0 - clipping,
        "silhouetteCompleteness": silhouette,
    }
    overall = int(round(sum(normalized[key] * QUALITY_WEIGHTS[key] for key in QUALITY_WEIGHTS) * 100))
    warnings = _quality_warnings(width, height, sharpness, exposure, glare, coverage, clipping, background, perspective, motion_blur)
    suggestions = _quality_suggestions(warnings)
    status = _quality_status(overall)
    metrics = {
        "width": width,
        "height": height,
        "megapixels": round(megapixels, 3),
        "blur": round(blur_score, 4),
        "sharpness": round(sharpness, 4),
        "edgeSharpness": round(sharpness, 4),
        "exposure": round(exposure, 4),
        "underexposurePercent": round(under * 100, 3),
        "overexposurePercent": round(over * 100, 3),
        "contrast": round(contrast, 4),
        "localContrast": round(local_contrast, 4),
        "dynamicRange": round(dynamic_range, 4),
        "glare": round(glare, 4),
        "specularHighlightPercent": round(_specular_highlight_percent(image) * 100, 3),
        "backgroundComplexity": round(background, 4),
        "objectCoverage": round(coverage, 4),
        "objectCentering": round(centering, 4),
        "edgeClipping": round(clipping, 4),
        "silhouetteCompleteness": round(silhouette, 4),
        "perspectiveSeverity": round(perspective, 4),
        "cameraRoll": round(roll, 3),
        "probableMotionBlur": round(motion_blur, 4),
        "compressionArtifactProbability": round(compression, 4),
        "duplicateProbability": 0.0,
        "usableContourProbability": round(contour_probability, 4),
    }
    report = {
        "photoId": photo_id,
        "overallScore": overall,
        "qualityScore": overall,
        "status": status,
        "usable": status != "poor",
        "recommendedRoles": recommended_roles(metrics),
        "metrics": metrics,
        "warnings": warnings,
        "suggestions": suggestions,
        "explanation": quality_explanation(overall, metrics),
        "formula": {"weights": QUALITY_WEIGHTS, "scale": "0-100 weighted normalized metrics"},
    }
    return report, PhotoSignals(
        photo_id=photo_id,
        aspect_ratio=width / max(height, 1),
        histogram=small_histogram(image),
        phash=perceptual_hash(image),
        bbox=bbox,
        metrics=metrics,
    )


def foreground_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    rgb = image.convert("RGB")
    median = tuple(int(v) for v in ImageStat.Stat(rgb).median[:3])
    diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, median)).convert("L")
    mask = diff.point(lambda px: 255 if px > 16 else 0)
    return mask.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3)).getbbox()


def build_duplicate_reports(signals: list[PhotoSignals]) -> dict:
    reports = {signal.photo_id: [] for signal in signals}
    for left_index, left in enumerate(signals):
        for right in signals[left_index + 1:]:
            hamming = _hash_distance(left.phash, right.phash)
            hist_distance = float(np.linalg.norm(left.histogram - right.histogram))
            aspect_delta = abs(left.aspect_ratio - right.aspect_ratio) / max(left.aspect_ratio, right.aspect_ratio, 1e-6)
            similarity = max(0.0, min(1.0, 1.0 - hamming * 0.55 - hist_distance * 0.35 - aspect_delta * 0.10))
            if similarity >= 0.92:
                kind = "exact-duplicate" if hamming < 0.03 else "near-duplicate"
                item = {
                    "duplicateOf": left.photo_id,
                    "similarity": round(similarity, 3),
                    "type": kind,
                    "recommendedAction": "exclude" if kind == "near-duplicate" else "review",
                }
                reports[right.photo_id].append(item)
    return reports


def same_object_analysis(signals: list[PhotoSignals]) -> dict:
    if not signals:
        return {"groupConsistency": 0.0, "status": "uncertain", "referencePhotoId": None, "photos": []}
    reference = max(signals, key=lambda item: item.metrics.get("usableContourProbability", 0))
    photo_reports = []
    scores = []
    for signal in signals:
        aspect_delta = abs(signal.aspect_ratio - reference.aspect_ratio) / max(reference.aspect_ratio, signal.aspect_ratio, 1e-6)
        hist_distance = float(np.linalg.norm(signal.histogram - reference.histogram))
        width_delta = abs(signal.metrics.get("objectCoverage", 0) - reference.metrics.get("objectCoverage", 0))
        contour_delta = abs(signal.metrics.get("silhouetteCompleteness", 0) - reference.metrics.get("silhouetteCompleteness", 0))
        probability = max(0.0, min(1.0, 1.0 - aspect_delta * 0.32 - hist_distance * 0.30 - width_delta * 0.18 - contour_delta * 0.20))
        scores.append(probability)
        evidence = []
        conflicts = []
        if aspect_delta < 0.18:
            evidence.append("matching body aspect ratio")
        else:
            conflicts.append("body aspect ratio differs")
        if hist_distance < 0.24:
            evidence.append("matching dominant color zones")
        else:
            conflicts.append("dominant color layout differs")
        if contour_delta < 0.18:
            evidence.append("matching silhouette completeness")
        else:
            conflicts.append("silhouette quality differs")
        photo_reports.append(
            {
                "photoId": signal.photo_id,
                "sameObjectProbability": round(probability, 3),
                "status": consistency_status(probability),
                "evidence": evidence or ["limited comparable evidence"],
                "conflicts": conflicts,
            }
        )
    group = float(np.mean(scores))
    return {
        "groupConsistency": round(group, 3),
        "status": consistency_status(group),
        "referencePhotoId": reference.photo_id,
        "photos": photo_reports,
    }


def assign_views(signals: list[PhotoSignals], current: dict[str, str], manual: Iterable[str] = ()) -> dict:
    manual_set = set(manual)
    sorted_signals = sorted(signals, key=lambda item: item.aspect_ratio, reverse=True)
    assignments = {}
    sequence = ["front", "right", "back", "left", "front_right", "front_left", "top", "bottom", "back_right", "back_left"]
    for index, signal in enumerate(sorted_signals):
        if signal.photo_id in manual_set:
            assigned = current.get(signal.photo_id, "custom")
            confidence = 1.0
            reasoning = ["manual user override"]
        else:
            assigned = sequence[index % len(sequence)]
            if signal.metrics.get("perspectiveSeverity", 0) > 0.35 and assigned in {"front", "back", "left", "right"}:
                assigned = "front_right" if assigned in {"front", "right"} else "back_left"
            confidence = max(0.35, min(0.88, 0.55 + signal.metrics.get("usableContourProbability", 0) * 0.25 + (1.0 - signal.metrics.get("perspectiveSeverity", 0)) * 0.08))
            reasoning = ["silhouette aspect ratio", "photo-set view diversity", "perspective estimate"]
        assignments[signal.photo_id] = {
            "assignedView": assigned,
            "confidence": round(confidence, 3),
            "alternatives": _view_alternatives(assigned, confidence),
            "reasoning": reasoning,
            "orthographicSuitability": round(1.0 - signal.metrics.get("perspectiveSeverity", 0), 3),
        }
    return assignments


def view_coverage(assignments: dict) -> dict:
    groups = {"front": 0, "rear": 0, "left": 0, "right": 0, "top": 0, "bottom": 0}
    for value in assignments.values():
        view = value.get("assignedView", "")
        if view in {"front", "front_left", "front_right"}:
            groups["front"] += 1
        if view in {"back", "back_left", "back_right"}:
            groups["rear"] += 1
        if view in {"left", "front_left", "back_left"}:
            groups["left"] += 1
        if view in {"right", "front_right", "back_right"}:
            groups["right"] += 1
        if view == "top":
            groups["top"] += 1
        if view == "bottom":
            groups["bottom"] += 1
    return {key: "strong" if count >= 2 else "medium" if count == 1 else "missing" for key, count in groups.items()}


def small_histogram(image: Image.Image) -> np.ndarray:
    small = image.resize((32, 32)).convert("RGB")
    hist = np.array(small.histogram(), dtype=np.float64)
    return hist / (hist.sum() or 1.0)


def perceptual_hash(image: Image.Image) -> str:
    gray = ImageOps.grayscale(image).resize((8, 8), Image.Resampling.LANCZOS)
    values = np.asarray(gray, dtype=np.float32)
    median = float(np.median(values))
    bits = values >= median
    return "".join("1" if bit else "0" for bit in bits.flatten())


def consistency_status(value: float) -> str:
    if value >= 0.86:
        return "consistent"
    if value >= 0.72:
        return "probably-consistent"
    if value >= 0.5:
        return "uncertain"
    if value >= 0.28:
        return "probably-different"
    return "different"


def recommended_roles(metrics: dict) -> list[str]:
    roles = ["shape-reference"] if metrics.get("usableContourProbability", 0) >= 0.55 else ["color-reference"]
    if metrics.get("perspectiveSeverity", 0) < 0.22:
        roles.append("orthographic-like")
    if metrics.get("sharpness", 0) >= 0.65:
        roles.append("landmark-reference")
    return roles


def quality_explanation(score: int, metrics: dict) -> str:
    strengths = []
    if metrics.get("sharpness", 0) >= 0.65:
        strengths.append("sharp")
    if metrics.get("exposure", 0) >= 0.65:
        strengths.append("well exposed")
    if metrics.get("objectCoverage", 0) >= 0.35:
        strengths.append("object fills the frame")
    if metrics.get("edgeClipping", 0) <= 0.05:
        strengths.append("not cropped")
    if not strengths:
        strengths.append("usable but needs review")
    return f"Score {score}: " + ", ".join(strengths) + "."


def _quality_status(score: int) -> str:
    if score >= 85:
        return "excellent"
    if score >= 70:
        return "good"
    if score >= 45:
        return "usable_with_warnings"
    return "poor"


def _quality_warnings(width, height, sharpness, exposure, glare, coverage, clipping, background, perspective, motion_blur) -> list[str]:
    warnings = []
    if width < 900 or height < 900:
        warnings.append("Low resolution; capture a larger image when possible.")
    if sharpness < 0.25:
        warnings.append("Image appears soft or blurred; clean the lens and avoid motion.")
    if exposure < 0.42:
        warnings.append("Exposure is weak; increase lighting and avoid deep shadows.")
    if glare > 0.22:
        warnings.append("Glare or specular highlights may hide contour details.")
    if coverage < 0.18:
        warnings.append("Object is too small in the frame; move closer.")
    if clipping > 0.08:
        warnings.append("Object appears clipped by the image edge.")
    if background > 0.55:
        warnings.append("Background is visually complex; use a plainer background.")
    if perspective > 0.45:
        warnings.append("Perspective is strong; capture a straighter reference view.")
    if motion_blur > 0.55:
        warnings.append("Probable motion blur; hold the camera steady.")
    return warnings


def _quality_suggestions(warnings: list[str]) -> list[str]:
    suggestions = []
    joined = " ".join(warnings).lower()
    if "small" in joined or "resolution" in joined:
        suggestions.append("move closer without cropping the package")
    if "clipped" in joined:
        suggestions.append("avoid cropping the cap, base, or side edges")
    if "glare" in joined:
        suggestions.append("reduce glare by moving lights or changing camera angle")
    if "background" in joined:
        suggestions.append("use a plain background")
    if "perspective" in joined:
        suggestions.append("capture a true side or front view")
    if "blur" in joined:
        suggestions.append("clean the camera lens and avoid digital zoom")
    return suggestions


def _glare_probability(image: Image.Image) -> float:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32)
    maxc = arr.max(axis=2)
    minc = arr.min(axis=2)
    highlights = (maxc > 235) & ((maxc - minc) < 22)
    return float(np.mean(highlights))


def _specular_highlight_percent(image: Image.Image) -> float:
    return _glare_probability(image)


def _coverage(bbox, width: int, height: int) -> float:
    if not bbox:
        return 0.0
    return ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / float(width * height)


def _coverage_score(coverage: float) -> float:
    if coverage <= 0:
        return 0.0
    return max(0.0, min(1.0, 1.0 - abs(coverage - 0.58) / 0.58))


def _centering_score(bbox, width: int, height: int) -> float:
    if not bbox:
        return 0.0
    cx = (bbox[0] + bbox[2]) / 2.0 / max(width, 1)
    cy = (bbox[1] + bbox[3]) / 2.0 / max(height, 1)
    return max(0.0, min(1.0, 1.0 - math.hypot(cx - 0.5, cy - 0.5) * 1.8))


def _edge_clipping(bbox, width: int, height: int) -> float:
    if not bbox:
        return 1.0
    clipped = int(bbox[0] <= 2) + int(bbox[1] <= 2) + int(bbox[2] >= width - 2) + int(bbox[3] >= height - 2)
    return clipped / 4.0


def _background_complexity(edges: np.ndarray, bbox) -> float:
    if bbox is None:
        return max(0.0, min(1.0, float(np.mean(edges)) / 64.0))
    mask = np.ones(edges.shape, dtype=bool)
    mask[bbox[1]:bbox[3], bbox[0]:bbox[2]] = False
    if not np.any(mask):
        return 0.0
    return max(0.0, min(1.0, float(np.mean(edges[mask])) / 48.0))


def _perspective_severity(bbox, width: int, height: int, edges: np.ndarray) -> float:
    if not bbox:
        return 0.75
    bw = max(bbox[2] - bbox[0], 1)
    bh = max(bbox[3] - bbox[1], 1)
    aspect = bw / max(bh, 1)
    edge_bias = abs(float(np.mean(edges[:, : width // 2])) - float(np.mean(edges[:, width // 2 :]))) / 255.0
    return max(0.0, min(1.0, abs(aspect - 0.55) * 0.35 + edge_bias * 1.8))


def _camera_roll(edges: np.ndarray) -> float:
    rows = np.where(edges > np.percentile(edges, 85))[0]
    if len(rows) < 5:
        return 0.0
    y_span = rows.max() - rows.min()
    return round(float(max(-8.0, min(8.0, (y_span / max(edges.shape[0], 1) - 0.5) * 8.0))), 3)


def _hash_distance(left: str, right: str) -> float:
    if not left or not right or len(left) != len(right):
        return 1.0
    return sum(a != b for a, b in zip(left, right)) / len(left)


def _view_alternatives(view: str, confidence: float) -> list[dict]:
    adjacent = {
        "front": ["front_right", "front_left"],
        "back": ["back_right", "back_left"],
        "left": ["front_left", "back_left"],
        "right": ["front_right", "back_right"],
        "top": ["front", "right"],
        "bottom": ["back", "left"],
    }
    return [{"view": item, "confidence": round(max(0.1, confidence - 0.25 - idx * 0.08), 3)} for idx, item in enumerate(adjacent.get(view, ["custom"]))]
