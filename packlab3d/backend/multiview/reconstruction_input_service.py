from packlab3d.backend.multiview.contour_service import ensure_geometry_state


def build_reconstruction_input(project, *, strict: bool = False) -> dict:
    photos = []
    warnings = []
    revision = 0
    photo_revisions = {}
    for photo in sorted([item for item in project.photos if item.included], key=lambda item: item.order):
        state = ensure_geometry_state(project, photo.id)
        revisions = dict(state.get("revisions", {}))
        active_contour = active_contour_for(project, photo.id)
        active_mask = active_mask_for(project, photo.id)
        silhouette = active_contour.get("normalizedSilhouette") or project.silhouettes.get(photo.id)
        if strict and not silhouette:
            raise ValueError(f"Photo {photo.id} has no usable contour or silhouette.")
        if not silhouette:
            warnings.append(f"Photo {photo.id} has no active silhouette; fallback photo geometry will be used.")
        locked = [item for item in project.landmarks.get(photo.id, []) if item.get("locked")]
        manual = [item for item in project.landmarks.get(photo.id, []) if item.get("source") == "manual"]
        photo_revisions[photo.id] = revisions.get("photoGeometry", 0)
        revision = max(revision, int(revisions.get("photoGeometry", 0)))
        photos.append({
            "photoId": photo.id,
            "view": photo.viewType,
            "photo": photo,
            "maskSource": active_mask.get("source", "none"),
            "maskRevision": revisions.get("activeMask", 0),
            "contourSource": active_contour.get("source", "none"),
            "contourRevision": revisions.get("activeContour", 0),
            "landmarkRevision": revisions.get("landmarks", 0),
            "normalizedSilhouette": silhouette,
            "lockedLandmarks": locked,
            "manualLandmarks": manual,
            "confidence": active_contour.get("confidence", silhouette.get("confidence", 0.35) if silhouette else 0.25),
            "stale": dict(state.get("stale", {})),
        })
    return {
        "projectId": project.id,
        "revision": revision,
        "photoGeometryRevisions": photo_revisions,
        "photos": photos,
        "measurements": project.measurements,
        "measurementLocks": project.measurementLocks,
        "warnings": warnings,
    }


def active_mask_for(project, photo_id: str) -> dict:
    entry = project.masks.get(photo_id, {})
    if entry.get("manualMaskPath"):
        return {"source": "manual", "path": entry.get("manualMaskPath"), "checksum": entry.get("checksum")}
    if entry.get("cleanedMaskPath") or entry.get("originalMaskPath"):
        return {"source": "automatic", "path": entry.get("cleanedMaskPath") or entry.get("originalMaskPath"), "checksum": entry.get("checksum")}
    return {"source": "none"}


def active_contour_for(project, photo_id: str) -> dict:
    entry = project.contours.get(photo_id, {})
    if entry.get("manual"):
        return entry["manual"]
    if entry.get("active"):
        return entry["active"]
    if entry.get("automatic"):
        return entry["automatic"]
    if entry.get("points"):
        return entry
    if entry.get("normalizedContour"):
        return {
            "source": entry.get("source", "automatic"),
            "normalizedSilhouette": entry.get("normalizedContour"),
            "confidence": entry.get("confidence", 0.35),
            "points": entry.get("normalizedContour", {}).get("points", []),
        }
    return {"source": "none"}
