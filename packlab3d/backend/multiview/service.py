import hashlib
import io
import json
import math
import os
import tempfile
import threading
import time
import uuid
import zipfile
import datetime as dt
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterable, Optional

import numpy as np
import open3d as o3d
import trimesh
from PIL import Image, ImageChops, ImageFilter, ImageOps, ImageStat, UnidentifiedImageError

from packlab3d.backend.cad_drawings.generate_2d import (
    CadBackend,
    build_zip_package,
    generate_technical_drawing_package,
)
from packlab3d.backend.label_mapping.export_glb import validate_glb
from packlab3d.backend.mesh_cleanup.cleanup import cleanup_mesh
from packlab3d.backend.multiview.analysis_engine import (
    analyze_quality,
    assign_views,
    build_duplicate_reports,
    same_object_analysis,
    view_coverage,
)
from packlab3d.backend.multiview.drawing_workspace import (
    apply_drawing_patch,
    autosave_metadata,
    build_drawing_document,
    compute_drawing_checksums,
    compare_versions,
    create_version_snapshot,
)
from packlab3d.backend.multiview.native_reconstruction import analyze_photo_geometry, build_native_reconstruction, mesh_from_generic_model
from packlab3d.backend.multiview.contour_service import (
    RevisionConflict,
    check_revision,
    contour_checksum,
    contour_from_mask,
    ensure_geometry_state,
    mark_contour_changed,
    mark_landmarks_changed,
    mark_mask_changed,
    normalized_silhouette,
    validate_contour,
)
from packlab3d.backend.multiview.reconstruction_input_service import build_reconstruction_input
from packlab3d.backend.multiview.editable_geometry import (
    GeometryValidationError,
    apply_cage_edits,
    apply_profile_points,
    apply_sections,
    ensure_editable_model,
    validate_model,
)
from packlab3d.backend.multiview.cage_deformation import (
    apply_cage_deformation,
    build_authoritative_bindings,
    checksum_cage,
    checksum_faces,
    checksum_vertices,
    transform_nodes,
)

SUPPORTED_IMAGE_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}
VIEW_TYPES = {
    "front",
    "back",
    "left",
    "right",
    "top",
    "bottom",
    "front_left",
    "front_right",
    "back_left",
    "back_right",
    "custom",
}
MAX_PHOTOS = 10
MAX_FILE_SIZE = 25 * 1024 * 1024
MAX_TOTAL_SIZE = 150 * 1024 * 1024
MAX_WORKING_DIMENSION = 2048


@dataclass
class PhotoRecord:
    id: str
    originalName: str
    contentType: str
    size: int
    viewType: str
    order: int
    included: bool
    originalPath: str
    workingPath: str
    maskPath: Optional[str]
    width: int
    height: int
    workingWidth: int
    workingHeight: int
    rotation: int = 0
    quality: dict = field(default_factory=dict)
    segmentation: dict = field(default_factory=lambda: {"status": "not_processed"})
    camera: dict = field(default_factory=dict)
    sha256: str = ""


@dataclass
class ProjectRecord:
    id: str
    version: int
    projectName: str
    packageType: str
    rootPath: str
    photos: list[PhotoRecord] = field(default_factory=list)
    photoAnalysis: dict = field(default_factory=dict)
    sameObjectAnalysis: dict = field(default_factory=dict)
    viewAssignments: dict = field(default_factory=dict)
    masks: dict = field(default_factory=dict)
    contours: dict = field(default_factory=dict)
    silhouettes: dict = field(default_factory=dict)
    landmarks: dict = field(default_factory=dict)
    photoGeometry: dict = field(default_factory=dict)
    cameraEstimates: dict = field(default_factory=dict)
    measurements: dict = field(default_factory=dict)
    measurementLocks: dict = field(default_factory=dict)
    reconstruction: dict = field(default_factory=dict)
    reconstructionModel: dict = field(default_factory=dict)
    optimizationReport: dict = field(default_factory=dict)
    optimizationRuns: list[dict] = field(default_factory=list)
    editable3DState: dict = field(default_factory=dict)
    controlCage: dict = field(default_factory=dict)
    drawingDocument: dict = field(default_factory=dict)
    drawingLayout: dict = field(default_factory=dict)
    labelRegion: dict = field(default_factory=dict)
    editHistory: list[dict] = field(default_factory=list)
    versions: list[dict] = field(default_factory=list)
    autosaveMetadata: dict = field(default_factory=dict)
    exports: list[dict] = field(default_factory=list)
    assets: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)


@dataclass
class JobRecord:
    id: str
    projectId: str
    type: str
    state: str = "queued"
    stage: str = "queued"
    message: str = "Queued"
    overallProgress: int = 0
    stageProgress: int = 0
    completedPhotos: int = 0
    totalPhotos: int = 0
    warnings: list[str] = field(default_factory=list)
    result: Optional[dict] = None
    error: Optional[str] = None
    cancelRequested: bool = False


class MultiViewProjectService:
    def __init__(self, root_dir: Optional[Path] = None):
        self.root_dir = Path(root_dir or Path(tempfile.gettempdir()) / "PackLab3D" / "projects")
        self.root_dir.mkdir(parents=True, exist_ok=True)
        self._projects: dict[str, ProjectRecord] = {}
        self._jobs: dict[str, JobRecord] = {}
        self._lock = threading.RLock()

    def create_project(self, project_name: str = "", package_type: str = "bottle") -> dict:
        project_id = f"project-{uuid.uuid4().hex[:12]}"
        project_root = self.root_dir / project_id
        for child in ("originals", "working", "masks", "contours", "results"):
            (project_root / child).mkdir(parents=True, exist_ok=True)
        project = ProjectRecord(
            id=project_id,
            # Keep the public project schema version at v5 for existing clients;
            # editor-state evolution is tracked by editable3DState.version.
            version=5,
            projectName=project_name or "Untitled PackLab 3D Project",
            packageType=package_type or "bottle",
            rootPath=str(project_root),
            autosaveMetadata=autosave_metadata(),
        )
        with self._lock:
            self._projects[project_id] = project
        self._save_project(project)
        return self._project_json(project)

    def get_project(self, project_id: str) -> ProjectRecord:
        with self._lock:
            project = self._projects.get(project_id)
        if project is None:
            project = self._load_project(project_id)
        if project is None:
            raise KeyError(project_id)
        return project

    def add_photos(self, project_id: str, uploads: Iterable, view_types: Optional[list[str]] = None) -> dict:
        project = self.get_project(project_id)
        upload_list = list(uploads)
        if not 1 <= len(upload_list) <= MAX_PHOTOS:
            raise ValueError("Upload between 1 and 10 photos.")
        if len(project.photos) + len(upload_list) > MAX_PHOTOS:
            raise ValueError("A project can contain at most 10 photos.")

        total_size = sum(_upload_size(upload) for upload in upload_list)
        if total_size > MAX_TOTAL_SIZE:
            raise ValueError("Combined upload size exceeds 150 MB.")

        added = []
        for index, upload in enumerate(upload_list):
            size = _upload_size(upload)
            content_type = getattr(upload, "content_type", "") or ""
            if content_type not in SUPPORTED_IMAGE_TYPES:
                raise ValueError(f"Unsupported file type: {content_type or 'unknown'}.")
            if size > MAX_FILE_SIZE:
                raise ValueError(f"{upload.filename} exceeds 25 MB.")
            data = upload.file.read()
            sha = hashlib.sha256(data).hexdigest()
            try:
                image = Image.open(io.BytesIO(data))
                image = ImageOps.exif_transpose(image)
                image.load()
            except (UnidentifiedImageError, OSError) as exc:
                raise ValueError("Uploaded file is not a valid image.") from exc

            photo_id = f"photo-{uuid.uuid4().hex[:12]}"
            suffix = SUPPORTED_IMAGE_TYPES[content_type]
            original_path = Path(project.rootPath) / "originals" / f"{photo_id}{suffix}"
            working_path = Path(project.rootPath) / "working" / f"{photo_id}.png"
            original_path.write_bytes(data)

            working = image.convert("RGB")
            working.thumbnail((MAX_WORKING_DIMENSION, MAX_WORKING_DIMENSION), Image.Resampling.LANCZOS)
            working.save(working_path, "PNG")
            view_type = _normalize_view_type((view_types or [None] * len(upload_list))[index])
            if view_type == "custom":
                view_type = _suggest_view_type(len(project.photos) + len(added))
            record = PhotoRecord(
                id=photo_id,
                originalName=upload.filename or f"photo-{index + 1}{suffix}",
                contentType=content_type,
                size=size,
                viewType=view_type,
                order=len(project.photos) + len(added),
                included=True,
                originalPath=str(original_path),
                workingPath=str(working_path),
                maskPath=None,
                width=image.width,
                height=image.height,
                workingWidth=working.width,
                workingHeight=working.height,
                quality={"status": "not_analyzed"},
                segmentation={"status": "not_processed"},
                camera={"viewSuggestion": view_type, "confidence": "low"},
                sha256=sha,
            )
            added.append(record)

        with self._lock:
            project.photos.extend(added)
            for photo in added:
                ensure_geometry_state(project, photo.id)
            self._save_project(project)
        return {"project": self._project_json(project), "added": [asdict(photo) for photo in added]}

    def list_photos(self, project_id: str) -> list[dict]:
        return [asdict(photo) for photo in self.get_project(project_id).photos]

    def delete_photo(self, project_id: str, photo_id: str) -> dict:
        project = self.get_project(project_id)
        project.photos = [photo for photo in project.photos if photo.id != photo_id]
        for index, photo in enumerate(sorted(project.photos, key=lambda p: p.order)):
            photo.order = index
        self._save_project(project)
        return self._project_json(project)

    def update_photos(self, project_id: str, updates: list[dict]) -> dict:
        project = self.get_project(project_id)
        by_id = {photo.id: photo for photo in project.photos}
        for update in updates:
            photo = by_id.get(update.get("photoId") or update.get("id"))
            if not photo:
                continue
            if "viewType" in update:
                photo.viewType = _normalize_view_type(update["viewType"])
                photo.camera["manualOverride"] = True
                photo.camera["assignedView"] = photo.viewType
                project.viewAssignments[photo.id] = {
                    "assignedView": photo.viewType,
                    "confidence": 1.0,
                    "alternatives": [],
                    "reasoning": ["manual user override"],
                }
            if "included" in update:
                photo.included = bool(update["included"])
            if "order" in update:
                photo.order = int(update["order"])
        project.photos.sort(key=lambda p: p.order)
        for index, photo in enumerate(project.photos):
            photo.order = index
        self._save_project(project)
        return self._project_json(project)

    def start_job(self, project_id: str, job_type: str, payload: Optional[dict] = None) -> dict:
        self.get_project(project_id)
        job = JobRecord(
            id=f"job-{uuid.uuid4().hex[:12]}",
            projectId=project_id,
            type=job_type,
            totalPhotos=len(self._included_photos(project_id)),
        )
        with self._lock:
            self._jobs[job.id] = job
        thread = threading.Thread(target=self._run_job, args=(job.id, payload or {}), daemon=True)
        thread.start()
        return self._job_json(job)

    def get_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
        if job is None:
            raise KeyError(job_id)
        return self._job_json(job)

    def cancel_job(self, job_id: str) -> dict:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                raise KeyError(job_id)
            job.cancelRequested = True
            if job.state in {"queued", "running"}:
                job.state = "cancelled"
                job.stage = "cancelled"
                job.message = "Cancellation requested."
        return self._job_json(job)

    def project_result(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        return {
            "projectId": project.id,
            "reconstruction": project.reconstruction,
            "assets": project.assets,
            "warnings": project.warnings,
        }

    def project_report(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        return self._project_json(project)

    def editable_model(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        project.reconstructionModel = ensure_editable_model(project.reconstructionModel)
        return {
            "projectId": project.id,
            "reconstructionModel": project.reconstructionModel,
            "optimizationReport": project.optimizationReport,
            "editable3DState": project.editable3DState,
            "controlCage": project.controlCage,
            "drawingDocument": project.drawingDocument,
            "drawingLayout": project.drawingLayout,
            "labelRegion": project.labelRegion,
            "versions": project.versions,
            "autosaveMetadata": project.autosaveMetadata,
            "modelRevision": int(project.reconstructionModel.get("modelRevision", 1)),
            "geometryValidation": validate_model(project.reconstructionModel),
            "deformationChecksums": project.editable3DState.get("deformationChecksums", {}),
            "deformationProvenance": project.editable3DState.get("deformationProvenance", {}),
            "linkedDrawingUpdateReport": project.editable3DState.get("linkedDrawingUpdateReport", {}),
        }

    def deformation_report(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        return {"projectId": project.id, "modelRevision": int(project.reconstructionModel.get("modelRevision", 1)), "checksums": project.editable3DState.get("deformationChecksums", {}), "provenance": project.editable3DState.get("deformationProvenance", {}), "drawing": (project.drawingDocument or {}).get("checksums", {}), "linkedDrawingUpdateReport": project.editable3DState.get("linkedDrawingUpdateReport", {})}

    def drawing_checksums(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        checksums = compute_drawing_checksums(project.drawingDocument or {})
        project.drawingDocument["checksums"] = checksums
        return {"projectId": project.id, **checksums}

    def editor_state(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        state = project.editable3DState.get("editorState", {})
        return {"projectId": project.id, "editorState": state, "modelRevision": int(project.reconstructionModel.get("modelRevision", 1) or 1)}

    def update_editor_state(self, project_id: str, payload: dict) -> dict:
        project = self.get_project(project_id)
        model_revision = int(project.reconstructionModel.get("modelRevision", 1) or 1)
        expected = payload.get("expectedRevision")
        if expected is not None and int(expected) != model_revision:
            raise RevisionConflict("editable-model-editor-state", int(expected), model_revision)
        state = json.loads(json.dumps(payload.get("editorState") or {}))
        camera = state.get("cameraState") or {}
        for key in ("position", "target", "up"):
            values = camera.get(key)
            if values is not None and (not isinstance(values, list) or len(values) != 3 or not all(math.isfinite(float(value)) for value in values)):
                raise ValueError(f"Invalid cameraState.{key}")
        state.setdefault("version", 3)
        state.setdefault("modelRevision", model_revision)
        state.setdefault("history", {"entries": [], "cursor": 0, "maxEntries": 100})
        state.setdefault("cageState", {})
        project.editable3DState["editorState"] = state
        project.editable3DState["editorStateRevision"] = int(project.editable3DState.get("editorStateRevision", 0)) + 1
        self._save_project(project)
        return self.editor_state(project_id)

    def update_editable_model(self, project_id: str, edits: dict) -> dict:
        project = self.get_project(project_id)
        if not project.reconstructionModel:
            raise ValueError("No reconstruction model exists for this project.")
        model = ensure_editable_model(project.reconstructionModel)
        expected_revision = edits.get("expectedModelRevision")
        current_revision = int(model.get("modelRevision", 1))
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RevisionConflict("editable-model", int(expected_revision), current_revision)
        operations = []
        cage_before = {node.get("id"): list(node.get("positionMm", [0, 0, 0])) for node in model.get("controlCage", {}).get("nodes", [])}
        if "heightMm" in edits:
            old = model["heightMm"]
            model["heightMm"] = float(edits["heightMm"])
            operations.append({"type": "set-height", "before": old, "after": model["heightMm"]})
        scale_width = _positive(edits.get("widthMm"))
        scale_depth = _positive(edits.get("depthMm"))
        if scale_width is not None:
            old_max = max(section["widthMm"] for section in model["crossSections"])
            factor = scale_width / max(old_max, 1e-6)
            for section in model["crossSections"]:
                section["widthMm"] = round(section["widthMm"] * factor, 3)
            operations.append({"type": "scale-width", "before": old_max, "after": scale_width})
        if scale_depth is not None:
            old_max = max(section["depthMm"] for section in model["crossSections"])
            factor = scale_depth / max(old_max, 1e-6)
            for section in model["crossSections"]:
                section["depthMm"] = round(section["depthMm"] * factor, 3)
            operations.append({"type": "scale-depth", "before": old_max, "after": scale_depth})
        profile_targets = [edits.get("profileName")] if edits.get("profileName") in {"frontProfile", "sideProfile"} else ["frontProfile", "sideProfile"]
        for point in edits.get("profilePoints", []) or []:
            target_id = point.get("id")
            half_extent = _positive(point.get("halfExtentMm"))
            if not target_id or half_extent is None:
                continue
            found = False
            for profile_name in profile_targets:
                for item in model.get(profile_name, []):
                    if item["id"] == target_id and not item.get("locked"):
                        old = item["halfExtentMm"]
                        item["halfExtentMm"] = round(half_extent, 3)
                        if "heightRatio" in point:
                            item["heightRatio"] = round(max(0.0, min(1.0, float(point["heightRatio"]))), 4)
                        operations.append({"type": "move-profile-point", "profile": profile_name, "target": target_id, "before": old, "after": item["halfExtentMm"]})
                        found = True
            if not found and edits.get("profileName") in {"frontProfile", "sideProfile"}:
                item = {
                    "id": target_id,
                    "heightRatio": round(max(0.0, min(1.0, float(point.get("heightRatio", 0.5)))), 4),
                    "halfExtentMm": round(half_extent, 3),
                    "source": "manual",
                    "locked": False,
                }
                model.setdefault(edits["profileName"], []).append(item)
                model[edits["profileName"]].sort(key=lambda entry: entry.get("heightRatio", 0.0))
                operations.append({"type": "insert-profile-point", "profile": edits["profileName"], "target": target_id, "after": item})
        for section_edit in edits.get("sections", []) or []:
            section_id = section_edit.get("id")
            found_section = False
            for section in model.get("crossSections", []):
                if section["id"] != section_id or section.get("locked"):
                    continue
                before = dict(section)
                if _positive(section_edit.get("widthMm")) is not None:
                    section["widthMm"] = round(float(section_edit["widthMm"]), 3)
                if _positive(section_edit.get("depthMm")) is not None:
                    section["depthMm"] = round(float(section_edit["depthMm"]), 3)
                if "heightRatio" in section_edit:
                    section["heightRatio"] = round(max(0.0, min(1.0, float(section_edit["heightRatio"]))), 4)
                operations.append({"type": "edit-section", "target": section_id, "before": before, "after": dict(section)})
                found_section = True
            if not found_section and section_id and _positive(section_edit.get("widthMm")) is not None and _positive(section_edit.get("depthMm")) is not None:
                section = {
                    "id": section_id,
                    "heightRatio": round(max(0.0, min(1.0, float(section_edit.get("heightRatio", 0.5)))), 4),
                    "widthMm": round(float(section_edit["widthMm"]), 3),
                    "depthMm": round(float(section_edit["depthMm"]), 3),
                    "centerOffsetMm": section_edit.get("centerOffsetMm", [0, 0]),
                    "rotationDeg": round(float(section_edit.get("rotationDeg", 0)), 3),
                    "source": "manual",
                    "locked": False,
                }
                model.setdefault("crossSections", []).append(section)
                model["crossSections"].sort(key=lambda entry: entry.get("heightRatio", 0.0))
                operations.append({"type": "add-section", "target": section_id, "after": section})
        for cage_edit in edits.get("cageNodes", []) or []:
            node_id = cage_edit.get("id")
            delta = cage_edit.get("deltaMm") or [0, 0, 0]
            node = next((item for item in model.get("controlCage", {}).get("nodes", []) if item.get("id") == node_id), None)
            if not node or node.get("pinned"):
                continue
            before = list(node.get("positionMm", [0, 0, 0]))
            after = [round(float(before[idx]) + float(delta[idx]), 3) for idx in range(3)]
            operations.append({"type": "move-cage-node", "target": node_id, "before": before, "after": after, "deformation": "weighted section-aware lattice"})
        if edits.get("cageTransform"):
            transform = edits["cageTransform"]
            selected_ids = list(transform.get("selectedNodeIds", []))
            transformed = transform_nodes(
                model.get("controlCage", {}).get("nodes", []),
                selected_ids,
                scale=transform.get("scale", [1.0, 1.0, 1.0]),
                rotation_deg=transform.get("rotationDeg", [0.0, 0.0, 0.0]),
                pivot_mode=transform.get("pivotMode", "centroid"),
                pivot=transform.get("pivot"),
                symmetry=edits.get("symmetry", True),
            )
            model["controlCage"]["nodes"] = transformed["nodes"]
            operations.append({"type": "transform-cage-selection", "affectedIds": transformed["changedIds"], "scale": transformed["scale"], "rotationDeg": transformed["rotationDeg"], "pivot": transformed["pivot"], "pivotMode": transformed["pivotMode"]})
        if edits.get("profilePoints") and edits.get("profileName") and len(edits.get("profilePoints") or []) >= 3:
            model = apply_profile_points(model, edits["profileName"], edits["profilePoints"], symmetry=edits.get("symmetry", True))
        if edits.get("sections"):
            model = apply_sections(model, edits["sections"])
        if edits.get("cageNodes") and not edits.get("cageTransform"):
            model = apply_cage_edits(model, edits["cageNodes"], falloff=edits.get("falloff", "medium"), symmetry=edits.get("symmetry", True))
        if not operations:
            return self.editable_model(project_id)
        model["modelRevision"] = current_revision + 1
        model["lastOperationId"] = edits.get("operationId") or uuid.uuid4().hex
        model["lastEditor"] = edits.get("sourceEditor", "editable-model")
        validation = validate_model(model)
        if not validation["valid"]:
            raise GeometryValidationError(validation["errors"])
        project.versions.append(create_version_snapshot(project, "Automatic snapshot before edit", "Created before 3D edit", project.versions[-1]["id"] if project.versions else None))
        project.reconstructionModel = model
        project.editHistory.extend(operations)
        cage_after = {node.get("id"): list(node.get("positionMm", [0, 0, 0])) for node in model.get("controlCage", {}).get("nodes", [])}
        patch_items = [{"path": ["controlCage", "nodes", node_id, "positionMm"], "before": cage_before.get(node_id), "after": cage_after.get(node_id)} for node_id in sorted(set(cage_before) | set(cage_after)) if cage_before.get(node_id) != cage_after.get(node_id)]
        editor_state = project.editable3DState.setdefault("editorState", {"version": 3})
        history = editor_state.setdefault("history", {"entries": [], "cursor": 0, "maxEntries": 100})
        entries = list(history.get("entries", []))[: int(history.get("cursor", len(history.get("entries", []))))]
        entries.append({"id": f"history-{uuid.uuid4().hex[:12]}", "timestamp": time.time(), "editor": edits.get("sourceEditor", "editable-model"), "operation": operations[-1].get("type", "edit"), "label": operations[-1].get("type", "Edit geometry"), "modelRevisionBefore": current_revision, "modelRevisionAfter": model["modelRevision"], "affectedIds": [item.get("path", [None, None, None])[2] for item in patch_items], "forwardPatch": patch_items, "reversePatch": [{**item, "before": item.get("after"), "after": item.get("before")} for item in patch_items]})
        history["entries"] = entries[-int(history.get("maxEntries", 100)):]
        history["cursor"] = len(history["entries"])
        editor_state["modelRevision"] = model["modelRevision"]
        project.editable3DState["historySize"] = len(project.editHistory)
        project.editable3DState["lastOperation"] = operations[-1]["type"]
        project.editable3DState["modelRevision"] = model["modelRevision"]
        project.editable3DState["geometryValidation"] = validation
        self._persist_model_outputs(project)
        self._save_project(project)
        return self.editable_model(project_id)

    def _apply_editor_history_entry(self, project: ProjectRecord, entry: dict, direction: str) -> None:
        patch_key = "reversePatch" if direction == "undo" else "forwardPatch"
        for item in entry.get(patch_key, []):
            path = item.get("path") or []
            if len(path) != 4 or path[0:2] != ["controlCage", "nodes"] or path[3] != "positionMm":
                continue
            node_id = path[2]
            node = next((candidate for candidate in project.reconstructionModel.get("controlCage", {}).get("nodes", []) if candidate.get("id") == node_id), None)
            if node is not None and item.get("after") is not None:
                node["positionMm"] = [float(value) for value in item["after"]]

    def _history_action(self, project_id: str, direction: str, expected_revision: Optional[int] = None) -> dict:
        project = self.get_project(project_id)
        model = ensure_editable_model(project.reconstructionModel)
        current_revision = int(model.get("modelRevision", 1))
        if expected_revision is not None and int(expected_revision) != current_revision:
            raise RevisionConflict("editable-model-history", int(expected_revision), current_revision)
        editor_state = project.editable3DState.setdefault("editorState", {"version": 3})
        history = editor_state.setdefault("history", {"entries": [], "cursor": 0, "maxEntries": 100})
        entries = list(history.get("entries", []))
        cursor = int(history.get("cursor", len(entries)))
        project.reconstructionModel = model
        if direction == "undo":
            if cursor <= 0:
                return self.editable_model(project_id)
            entry = entries[cursor - 1]
            self._apply_editor_history_entry(project, entry, "undo")
            history["cursor"] = cursor - 1
        else:
            if cursor >= len(entries):
                return self.editable_model(project_id)
            entry = entries[cursor]
            self._apply_editor_history_entry(project, entry, "redo")
            history["cursor"] = cursor + 1
        model["modelRevision"] = current_revision + 1
        model["lastOperationId"] = f"history-{direction}-{uuid.uuid4().hex[:12]}"
        model["lastEditor"] = "history"
        validation = validate_model(model)
        if not validation["valid"]:
            raise GeometryValidationError(validation["errors"])
        project.reconstructionModel = model
        editor_state["modelRevision"] = model["modelRevision"]
        project.editable3DState["modelRevision"] = model["modelRevision"]
        project.editable3DState["geometryValidation"] = validation
        self._persist_model_outputs(project)
        self._save_project(project)
        return self.editable_model(project_id)

    def undo_editor_history(self, project_id: str, expected_revision: Optional[int] = None) -> dict:
        return self._history_action(project_id, "undo", expected_revision)

    def redo_editor_history(self, project_id: str, expected_revision: Optional[int] = None) -> dict:
        return self._history_action(project_id, "redo", expected_revision)

    def finalize_editable_model(self, project_id: str, edits: dict) -> dict:
        report = self.deformation_report(project_id)
        expected = edits.get("expectedModelRevision")
        current = int(report.get("modelRevision", 1))
        expected_cage = edits.get("inputCageChecksum")
        current_cage = (report.get("checksums") or {}).get("cageStateChecksum")
        if expected is not None and int(expected) != current:
            raise RevisionConflict("stale-final-deformation", int(expected), current)
        if expected_cage and current_cage and expected_cage != current_cage:
            raise RevisionConflict("stale-final-deformation", current, current)
        return self.update_editable_model(project_id, edits)

    def update_drawing_document(self, project_id: str, patch: dict) -> dict:
        project = self.get_project(project_id)
        document = apply_drawing_patch(project.drawingDocument or {}, patch)
        document["drawingRevision"] = int(document.get("drawingRevision", 0)) + 1
        document["checksums"] = compute_drawing_checksums(document)
        project.drawingDocument = document
        project.drawingLayout = document.get("page", {})
        project.editHistory.append({"type": "drawing-patch", "patchKeys": sorted(patch.keys()), "timestamp": time.time()})
        self._save_project(project)
        return {"projectId": project.id, "drawingDocument": document}

    def save_version(self, project_id: str, name: str, note: str = "") -> dict:
        project = self.get_project(project_id)
        parent = project.versions[-1]["id"] if project.versions else None
        snapshot = create_version_snapshot(project, name or f"Version {len(project.versions) + 1}", note, parent)
        project.versions.append(snapshot)
        project.editable3DState["currentVersion"] = snapshot["id"]
        self._save_project(project)
        return {"projectId": project.id, "version": snapshot, "versions": project.versions}

    def compare_project_versions(self, project_id: str, left_id: str, right_id: str) -> dict:
        project = self.get_project(project_id)
        by_id = {version["id"]: version for version in project.versions}
        if left_id not in by_id or right_id not in by_id:
            raise KeyError("version")
        return compare_versions(by_id[left_id], by_id[right_id])

    def restore_version(self, project_id: str, version_id: str) -> dict:
        project = self.get_project(project_id)
        by_id = {version["id"]: version for version in project.versions}
        if version_id not in by_id:
            raise KeyError(version_id)
        project.versions.append(create_version_snapshot(project, "Automatic snapshot before restore", "Created before version restore", project.versions[-1]["id"] if project.versions else None))
        snapshot = by_id[version_id]
        project.reconstructionModel = json.loads(json.dumps(snapshot.get("model") or {}))
        project.reconstruction = json.loads(json.dumps(snapshot.get("reconstructionState") or {}))
        project.editable3DState = json.loads(json.dumps(snapshot.get("editable3DState") or {}))
        project.drawingDocument = json.loads(json.dumps(snapshot.get("drawingState") or {}))
        project.measurements = json.loads(json.dumps(snapshot.get("measurementState") or {}))
        project.labelRegion = json.loads(json.dumps(snapshot.get("labelRegion") or {}))
        project.editable3DState["currentVersion"] = version_id
        if project.reconstructionModel:
            self._persist_model_outputs(project)
        self._save_project(project)
        return self.editable_model(project_id)

    def get_photo_geometry(self, project_id: str, photo_id: str) -> dict:
        project = self.get_project(project_id)
        photo = next((item for item in project.photos if item.id == photo_id), None)
        if not photo:
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        return {
            "projectId": project.id,
            "photoId": photo_id,
            "geometry": state,
            "mask": project.masks.get(photo_id, {}),
            "contour": self.get_photo_contour(project_id, photo_id)["contour"],
            "landmarks": project.landmarks.get(photo_id, []),
        }

    def get_photo_contour(self, project_id: str, photo_id: str) -> dict:
        project = self.get_project(project_id)
        if not any(item.id == photo_id for item in project.photos):
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        entry = project.contours.get(photo_id, {})
        active = entry.get("manual") or entry.get("active") or entry.get("automatic") or entry
        return {"projectId": project.id, "photoId": photo_id, "geometry": state, "contour": active}

    def update_manual_contour(self, project_id: str, photo_id: str, payload: dict) -> dict:
        project = self.get_project(project_id)
        photo = next((item for item in project.photos if item.id == photo_id), None)
        if not photo:
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        check_revision(state, "activeContour", payload.get("expectedRevision"))
        points = payload.get("points") or []
        contour = {
            "photoId": photo_id,
            "revision": int(state["revisions"].get("manualContour", 0)) + 1,
            "sourceMaskRevision": state["revisions"].get("activeMask", 0),
            "source": "manual",
            "closed": True,
            "rawPointCount": len(points),
            "editablePointCount": len(points),
            "points": points,
            "holes": payload.get("holes") or [],
            "normalizedSilhouette": normalized_silhouette(points, photo_id),
            "checksum": contour_checksum(points),
            "confidence": 0.92,
            "updatedAt": time.time(),
        }
        validation = validate_contour(contour)
        if not validation.valid:
            raise ValueError("; ".join(validation.errors))
        project.contours[photo_id] = {
            **project.contours.get(photo_id, {}),
            "manual": contour,
            "active": contour,
            "validation": {"valid": True, "errors": []},
        }
        project.silhouettes[photo_id] = {
            **contour["normalizedSilhouette"],
            "viewType": photo.viewType,
            "confidence": contour["confidence"],
        }
        mark_contour_changed(state, manual=True)
        contour["revision"] = state["revisions"]["activeContour"]
        project.contours[photo_id]["manual"] = contour
        project.contours[photo_id]["active"] = contour
        project.editHistory.append({"type": "manual-contour-edit", "photoId": photo_id, "revision": state["revisions"]["activeContour"], "timestamp": time.time()})
        self._save_project(project)
        return {"projectId": project.id, "photoId": photo_id, "geometry": state, "contour": contour}

    def reset_photo_contour(self, project_id: str, photo_id: str) -> dict:
        project = self.get_project(project_id)
        state = ensure_geometry_state(project, photo_id)
        entry = project.contours.get(photo_id, {})
        if "manual" in entry:
            entry.pop("manual", None)
        active = entry.get("automatic") or entry.get("fromManualMask") or entry.get("active") or entry
        entry["active"] = active
        project.contours[photo_id] = entry
        state["activeContourSource"] = "automatic" if entry.get("automatic") else "manual-mask" if entry.get("fromManualMask") else state.get("activeContourSource", "none")
        state["revisions"]["activeContour"] = int(state["revisions"].get("activeContour", 0)) + 1
        state["stale"].update({"analysis": True, "reconstruction": True})
        self._save_project(project)
        return {"projectId": project.id, "photoId": photo_id, "geometry": state, "contour": active}

    def approve_photo_geometry(self, project_id: str, photo_id: str) -> dict:
        project = self.get_project(project_id)
        if not any(item.id == photo_id for item in project.photos):
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        state["approved"] = True
        state["approvedAt"] = time.time()
        self._save_project(project)
        return self.get_photo_geometry(project_id, photo_id)

    def update_landmarks(self, project_id: str, photo_id: str, landmarks: list[dict], expected_revision=None) -> dict:
        project = self.get_project(project_id)
        if not any(item.id == photo_id for item in project.photos):
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        check_revision(state, "landmarks", expected_revision)
        normalized = []
        for landmark in landmarks:
            item = {
                "id": landmark.get("id") or f"landmark-{uuid.uuid4().hex[:8]}",
                "type": landmark.get("type") or landmark.get("name") or "custom",
                "view": landmark.get("view") or "custom",
                "x": float(landmark.get("x", 0.5)),
                "y": float(landmark.get("y", 0.5)),
                "confidence": float(landmark.get("confidence", 1.0)),
                "source": landmark.get("source", "manual"),
                "locked": bool(landmark.get("locked", False)),
            }
            normalized.append(item)
        project.landmarks[photo_id] = normalized
        mark_landmarks_changed(state)
        project.editHistory.append({"type": "landmark-edit", "photoId": photo_id, "count": len(normalized), "timestamp": time.time()})
        self._save_project(project)
        return {"projectId": project.id, "photoId": photo_id, "geometry": state, "landmarks": normalized, "landmarkRevision": state["revisions"]["landmarks"]}

    def update_manual_mask(self, project_id: str, photo_id: str, payload: dict) -> dict:
        project = self.get_project(project_id)
        photo = next((item for item in project.photos if item.id == photo_id), None)
        if not photo:
            raise KeyError(photo_id)
        state = ensure_geometry_state(project, photo_id)
        check_revision(state, "activeMask", payload.get("expectedRevision"))
        width = int(payload.get("width") or 0)
        height = int(payload.get("height") or 0)
        values = payload.get("maskData") or []
        if width <= 0 or height <= 0 or len(values) != width * height:
            raise ValueError("Mask dimensions do not match mask data.")
        array = np.asarray(values, dtype=np.uint8).reshape((height, width))
        mask = Image.fromarray(array, "L")
        mask_path = Path(project.rootPath) / "masks" / f"{photo.id}-manual.png"
        mask_path.parent.mkdir(parents=True, exist_ok=True)
        mask.save(mask_path, "PNG")
        photo.maskPath = str(mask_path)
        photo.segmentation = {
            "status": "manual_mask_ready",
            "provider": "ManualMaskProvider",
            "maskPath": str(mask_path),
            "checksum": payload.get("checksum"),
            "manualOverride": True,
            "approved": True,
        }
        silhouette = analyze_photo_geometry(photo, mask_path=str(mask_path))
        project.masks[photo.id] = {
            **project.masks.get(photo.id, {}),
            "manualMaskPath": str(mask_path),
            "cleanedMaskPath": str(mask_path),
            "checksum": payload.get("checksum"),
            "manualOverride": True,
            "revision": int(state["revisions"].get("manualMask", 0)) + 1,
            "updatedAt": time.time(),
        }
        mark_mask_changed(state, manual=True)
        project.silhouettes[photo.id] = silhouette
        contour = contour_from_mask(array > 0, photo.id, revision=state["revisions"]["activeMask"], source="manual-mask")
        project.contours[photo.id] = {
            **project.contours.get(photo.id, {}),
            "active": contour,
            "automatic": project.contours.get(photo.id, {}).get("automatic"),
            "fromManualMask": contour,
        }
        mark_contour_changed(state, manual=False)
        contour["revision"] = state["revisions"]["activeContour"]
        contour["sourceMaskRevision"] = state["revisions"]["activeMask"]
        project.contours[photo.id]["active"] = contour
        project.contours[photo.id]["fromManualMask"] = contour
        state["activeContourSource"] = "manual-mask"
        existing_locked = [item for item in project.landmarks.get(photo.id, []) if item.get("locked")]
        automatic = _photo_landmarks_from_silhouette(silhouette)
        project.landmarks[photo.id] = _merge_locked_landmarks(automatic, existing_locked)
        state["stale"].update({"landmarks": True, "analysis": True, "reconstruction": True})
        project.editHistory.append({"type": "manual-mask-edit", "photoId": photo.id, "checksum": payload.get("checksum"), "timestamp": time.time()})
        self._save_project(project)
        return {
            "projectId": project.id,
            "photo": asdict(photo),
            "mask": project.masks[photo.id],
            "geometry": state,
            "contour": contour,
            "silhouette": silhouette,
            "landmarks": project.landmarks[photo.id],
        }

    def save_recovery_snapshot(self, project_id: str, state: dict) -> dict:
        project = self.get_project(project_id)
        timestamp = time.time()
        recovery = {
            "projectId": project.id,
            "schemaVersion": project.version,
            "timestamp": timestamp,
            "state": state,
            "project": self._project_json(project),
        }
        path = Path(project.rootPath) / "project.packlab3d.recovery.json"
        tmp = path.with_suffix(".recovery.tmp")
        tmp.write_text(json.dumps(recovery, indent=2), encoding="utf-8")
        os.replace(tmp, path)
        project.autosaveMetadata = {
            **project.autosaveMetadata,
            "dirty": False,
            "lastSuccessfulSave": dt.datetime.utcfromtimestamp(timestamp).isoformat(timespec="seconds") + "Z",
            "recoveryFile": path.name,
            "recoveryAvailable": True,
        }
        self._save_project(project)
        return {"projectId": project.id, "recovery": project.autosaveMetadata}

    def get_recovery_snapshot(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        path = Path(project.rootPath) / "project.packlab3d.recovery.json"
        if not path.exists():
            return {"projectId": project.id, "available": False}
        data = json.loads(path.read_text(encoding="utf-8"))
        return {"projectId": project.id, "available": True, "recovery": data}

    def discard_recovery_snapshot(self, project_id: str) -> dict:
        project = self.get_project(project_id)
        path = Path(project.rootPath) / "project.packlab3d.recovery.json"
        if path.exists():
            path.unlink()
        project.autosaveMetadata = {**project.autosaveMetadata, "dirty": False, "recoveryAvailable": False}
        self._save_project(project)
        return {"projectId": project.id, "available": False}

    def _run_job(self, job_id: str, payload: dict) -> None:
        job = self._jobs[job_id]
        try:
            if job.type == "analyze_photos":
                self._run_analysis(job)
            elif job.type == "segment_photos":
                self._run_segmentation(job)
            elif job.type == "reconstruct":
                self._run_reconstruction(job, payload)
            else:
                raise ValueError(f"Unknown job type: {job.type}")
            if job.state != "cancelled":
                self._progress(job, job.stage, "Completed", 100, state="succeeded")
        except Exception as exc:
            job.state = "failed"
            job.stage = "failed"
            job.message = str(exc)
            job.error = str(exc)

    def _run_analysis(self, job: JobRecord) -> None:
        project = self.get_project(job.projectId)
        photos = self._included_photos(job.projectId)
        self._progress(job, "validating", "Validating photos", 5, total=len(photos))
        signals = []
        for index, photo in enumerate(photos):
            self._check_cancelled(job)
            self._progress(job, "analyzing_quality", f"Analyzing photo {index + 1} of {len(photos)}", 10 + int(index / max(len(photos), 1) * 55), completed=index, total=len(photos))
            image = Image.open(photo.workingPath).convert("RGB")
            photo.quality, signal = analyze_quality(photo.id, image)
            signals.append(signal)
        duplicates = build_duplicate_reports(signals)
        for photo in photos:
            if duplicates.get(photo.id):
                match = duplicates[photo.id][0]
                photo.quality["duplicate"] = match
                photo.quality["warnings"].append(f"{match['type']} of {match['duplicateOf']}; review whether both views are needed.")
                photo.quality["metrics"]["duplicateProbability"] = match["similarity"]
        same_object = same_object_analysis(signals)
        assignments = assign_views(
            signals,
            {photo.id: photo.viewType for photo in photos},
            manual=[photo.id for photo in photos if photo.camera.get("manualOverride")],
        )
        coverage = view_coverage(assignments)
        for photo in photos:
            assignment = assignments.get(photo.id)
            if assignment and not photo.camera.get("manualOverride"):
                photo.viewType = assignment["assignedView"]
            photo.camera = {
                **photo.camera,
                **(assignment or {}),
                "viewSuggestion": assignment.get("assignedView") if assignment else photo.viewType,
                "viewCoverage": coverage,
                "rollCorrectionDeg": photo.quality["metrics"].get("cameraRoll", 0),
                "perspectiveSeverity": photo.quality["metrics"].get("perspectiveSeverity", 0),
                "orthographicLike": (assignment or {}).get("orthographicSuitability", 0) >= 0.75,
            }
        warnings = _same_object_warnings_from_report(same_object)
        project.photoAnalysis = {
            "photos": {photo.id: photo.quality for photo in photos},
            "sameObject": same_object,
            "duplicates": duplicates,
            "viewAssignments": assignments,
            "viewCoverage": coverage,
            "algorithm": "Deterministic Pillow/NumPy quality, perceptual hash, histogram, silhouette and view-diversity metrics",
        }
        project.sameObjectAnalysis = same_object
        project.viewAssignments = assignments
        project.cameraEstimates = {photo.id: photo.camera for photo in photos}
        project.warnings = [warning for warning in project.warnings if "different object" not in warning.lower()] + warnings
        self._save_project(project)
        job.result = {"photos": [asdict(photo) for photo in photos], "warnings": warnings, "sameObject": same_object, "duplicates": duplicates, "viewCoverage": coverage}
        self._progress(job, "checking_consistency", "Checking object consistency", 90, completed=len(photos), total=len(photos), warnings=warnings)

    def _run_segmentation(self, job: JobRecord) -> None:
        project = self.get_project(job.projectId)
        photos = self._included_photos(job.projectId)
        for index, photo in enumerate(photos):
            self._check_cancelled(job)
            self._progress(job, "segmenting", f"Segmenting photo {index + 1} of {len(photos)}", 5 + int((index / max(len(photos), 1)) * 85), completed=index, total=len(photos))
            image = Image.open(photo.workingPath).convert("RGB")
            mask, bbox = _classical_mask(image)
            mask_path = Path(project.rootPath) / "masks" / f"{photo.id}.png"
            mask.save(mask_path, "PNG")
            photo.maskPath = str(mask_path)
            photo.segmentation = {
                "status": "automatic_mask_ready",
                "provider": "classical_contour",
                "bbox": bbox,
                "requiresManualReview": bbox is None,
                "warnings": [] if bbox else ["Classical contour fallback could not isolate the object confidently."],
            }
            project.masks[photo.id] = {
                "originalMaskPath": str(mask_path),
                "cleanedMaskPath": str(mask_path),
                "manualOverride": False,
                "bbox": bbox,
                "toolsAvailable": ["brush-add", "brush-remove", "polygon-add", "polygon-subtract", "fill-hole", "remove-component"],
            }
            state = ensure_geometry_state(project, photo.id)
            mark_mask_changed(state, manual=False)
            if bbox:
                silhouette = analyze_photo_geometry(photo, mask_path=str(mask_path))
                project.silhouettes[photo.id] = silhouette
                automatic_landmarks = _photo_landmarks_from_silhouette(silhouette)
                project.landmarks[photo.id] = _merge_locked_landmarks(automatic_landmarks, [item for item in project.landmarks.get(photo.id, []) if item.get("locked")])
                contour = contour_from_mask(np.asarray(mask, dtype=np.uint8) > 0, photo.id, revision=state["revisions"]["activeMask"], source="automatic")
                project.contours[photo.id] = {
                    **project.contours.get(photo.id, {}),
                    "automatic": contour,
                    "active": project.contours.get(photo.id, {}).get("manual") or contour,
                    "confidence": silhouette["confidence"],
                    "sourcePixelMapping": {"workingWidth": photo.workingWidth, "workingHeight": photo.workingHeight},
                }
                mark_contour_changed(state, manual=False)
                state["stale"].update({"contour": False, "landmarks": False, "analysis": False, "reconstruction": True})
                photo.segmentation["contourConfidence"] = silhouette["confidence"]
        self._save_project(project)
        job.result = {"photos": [asdict(photo) for photo in photos]}

    def _run_reconstruction(self, job: JobRecord, payload: dict) -> None:
        project = self.get_project(job.projectId)
        photos = self._included_photos(job.projectId)
        if not photos:
            raise ValueError("At least one included photo is required.")
        if project.reconstructionModel:
            project.versions.append(create_version_snapshot(project, "Automatic snapshot before reconstruction", "Created before reconstruction job", project.versions[-1]["id"] if project.versions else None))
        self._progress(job, "aligning_views", "Aligning usable views", 12, total=len(photos))
        measurements = payload.get("measurements") or {}
        package_type = payload.get("packageType") or project.packageType or "custom"
        dimensions, dimension_sources = _infer_dimensions(photos, measurements, package_type)
        reconstruction_input = build_reconstruction_input(project)
        if os.environ.get("PACKLAB_E2E") == "1":
            delay_ms = min(30000, max(0, int(os.environ.get("PACKLAB_E2E_RECONSTRUCTION_DELAY_MS", "0"))))
            if delay_ms:
                time.sleep(delay_ms / 1000)
        self._progress(job, "generating_reference_geometry", "Generating unified reference geometry", 35)
        model_measurements = dict(measurements)
        for key, value in dimensions.items():
            if _positive(model_measurements.get(key)) is None:
                model_measurements[key] = value
        native_mesh, reconstruction_model, optimization_report = build_native_reconstruction(photos, model_measurements, dimension_sources, reconstruction_input)
        mesh = native_mesh
        reference_path = Path(project.rootPath) / "results" / "reference_mesh.obj"
        o3d.io.write_triangle_mesh(str(reference_path), mesh)
        self._progress(job, "cleaning_mesh", "Cleaning mesh", 55)
        cleaned_mesh, cleanup_report = cleanup_mesh(mesh)
        clean_path = Path(project.rootPath) / "results" / "clean_mesh.obj"
        o3d.io.write_triangle_mesh(str(clean_path), cleaned_mesh)
        self._progress(job, "generating_2d_drawings", "Generating one 2D drawing package", 72)
        drawing_package = generate_technical_drawing_package(cleaned_mesh, backend=CadBackend.MESH_PROJECTION)
        drawing_package["metadata"]["reconstruction_method"] = "packlab-native-generic-profile-fit"
        drawing_package["metadata"]["dimension_sources"] = dimension_sources
        drawing_zip = build_zip_package(drawing_package)
        drawing_path = Path(project.rootPath) / "results" / "technical_drawing.zip"
        drawing_path.write_bytes(drawing_zip)
        self._progress(job, "exporting_glb", "Exporting unified GLB", 84)
        glb_bytes = _mesh_to_glb(cleaned_mesh)
        glb_path = Path(project.rootPath) / "results" / "visualization.glb"
        glb_path.write_bytes(glb_bytes)
        glb_validation = validate_glb(glb_bytes)
        method = "packlab-native-generic-profile-fit"
        confidence = optimization_report["confidence"]["level"]
        limitations = [
            "This is a native bounded multi-photo profile reconstruction, not neural image-to-3D or true photogrammetry.",
            "Hidden geometry and fine surface details are estimated.",
        ]
        report = {
            "method": method,
            "provider": "PackLabNativeReconstructionEngine",
            "trueMultiViewReconstruction": True,
            "photosUsed": [photo.id for photo in photos],
            "photosExcluded": [photo.id for photo in project.photos if not photo.included],
            "dimensionsMm": dimensions,
            "dimensionSources": dimension_sources,
            "coordinateSystem": "millimetres, +Y up",
            "confidence": confidence,
            "limitations": limitations,
            "reconstructionModel": reconstruction_model,
            "optimizationReport": optimization_report,
            "sameObjectAnalysis": project.sameObjectAnalysis,
            "viewAssignments": project.viewAssignments,
            "cleanupReport": cleanup_report,
            "glbValidation": glb_validation,
            "drawingValidation": drawing_package.get("validation", {}),
            "reconstructionInput": {
                "revision": reconstruction_input["revision"],
                "photoGeometryRevisions": reconstruction_input["photoGeometryRevisions"],
                "warnings": reconstruction_input["warnings"],
            },
        }
        report_path = Path(project.rootPath) / "results" / "reconstruction_report.json"
        report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
        project.measurements = measurements
        project.measurementLocks = reconstruction_model.get("measurementConstraints", {})
        project.packageType = package_type
        project.reconstruction = {
            "provider": "PackLabNativeReconstructionEngine",
            "method": method,
            "status": "complete",
            "confidence": confidence,
            "warnings": limitations,
            "inputRevision": reconstruction_input["revision"],
            "photoGeometryRevisions": reconstruction_input["photoGeometryRevisions"],
        }
        project.reconstructionModel = reconstruction_model
        project.optimizationReport = optimization_report
        project.optimizationRuns.append(optimization_report)
        project.editable3DState = {
            "profileEditing": True,
            "crossSectionEditing": True,
            "controlCageEditing": True,
            "selectionModes": ["object", "region", "profile-point", "section", "cage-node", "landmark", "label-area"],
            "undoRedoReady": True,
            "currentVersion": "fit-001",
            "historySize": len(project.editHistory),
        }
        project.controlCage = reconstruction_model.get("controlCage", {})
        project.drawingDocument = build_drawing_document(drawing_package, reconstruction_model, project.drawingDocument)
        project.drawingLayout = project.drawingDocument.get("page", {})
        project.labelRegion = reconstruction_model.get("labelRegion", {})
        if not project.versions:
            initial = create_version_snapshot(project, "Initial native fit", "Created from reconstruction", None)
            initial["id"] = "fit-001"
            project.versions = [initial]
        project.autosaveMetadata = autosave_metadata()
        project.assets = {
            "referenceMesh": str(reference_path),
            "cleanMesh": str(clean_path),
            "finalMesh": str(glb_path),
            "drawingPackage": str(drawing_path),
            "report": str(report_path),
        }
        if self._reconstruction_input_is_current(project, reconstruction_input):
            for input_photo in reconstruction_input.get("photos", []):
                state = ensure_geometry_state(project, input_photo["photoId"])
                state["revisions"]["reconstructionInput"] = reconstruction_input["revision"]
                state["stale"]["reconstruction"] = False
        else:
            project.reconstruction["status"] = "older-geometry-checkpoint"
            project.reconstruction["warnings"] = limitations + ["Reconstruction completed from an older geometry revision."]
        self._save_project(project)
        job.result = {"projectId": project.id, "assets": project.assets, "report": report}
        self._progress(job, "preparing_final_result", "Preparing final result", 96, completed=len(photos), total=len(photos))

    def _persist_model_outputs(self, project: ProjectRecord) -> None:
        mesh = mesh_from_generic_model(project.reconstructionModel)
        rest_vertices = np.asarray(mesh.vertices, dtype=np.float64)
        rest_faces = np.asarray(mesh.triangles, dtype=np.int64)
        cage = project.reconstructionModel.get("controlCage", {})
        bindings = build_authoritative_bindings(rest_vertices, cage, int(project.reconstructionModel.get("modelRevision", 1)))
        deformation = apply_cage_deformation(
            rest_vertices,
            rest_faces,
            cage,
            cage.get("nodes", []),
            bindings,
            constraints={"falloff": (cage.get("falloff") or {}).get("mode", "medium")},
            quality_mode="final",
        )
        deformed_mesh = o3d.geometry.TriangleMesh(
            o3d.utility.Vector3dVector(np.asarray(deformation["vertices"], dtype=np.float64)),
            o3d.utility.Vector3iVector(rest_faces),
        )
        deformed_mesh.compute_vertex_normals()
        project.editable3DState["deformationChecksums"] = {
            "restVertexChecksum": checksum_vertices(rest_vertices),
            "finalVertexChecksum": deformation["vertexChecksum"],
            "faceChecksum": checksum_faces(rest_faces),
            "cageStateChecksum": checksum_cage(cage),
            "bindingChecksum": deformation["bindingChecksum"],
            "topologyChecksum": deformation["topologyChecksum"],
            "qualityMode": "final",
        }
        project.editable3DState["deformationProvenance"] = {
            "modelRevision": int(project.reconstructionModel.get("modelRevision", 1)),
            "compositionOrder": ["base", "profile", "section", "cage", "measurement-locks"],
            "bindingCacheKey": bindings.get("cacheKey"),
        }
        cleaned_mesh, cleanup_report = cleanup_mesh(deformed_mesh)
        clean_path = Path(project.rootPath) / "results" / "clean_mesh.obj"
        o3d.io.write_triangle_mesh(str(clean_path), cleaned_mesh)
        glb_bytes = _mesh_to_glb(cleaned_mesh)
        glb_path = Path(project.rootPath) / "results" / "visualization.glb"
        glb_path.write_bytes(glb_bytes)
        project.editable3DState["deformationChecksums"]["glbChecksum"] = "sha256:" + hashlib.sha256(glb_bytes).hexdigest()
        drawing_package = generate_technical_drawing_package(cleaned_mesh, backend=CadBackend.MESH_PROJECTION)
        drawing_package["metadata"]["reconstruction_method"] = project.reconstruction.get("method", "packlab-native-generic-profile-fit")
        drawing_zip = build_zip_package(drawing_package)
        drawing_path = Path(project.rootPath) / "results" / "technical_drawing.zip"
        drawing_path.write_bytes(drawing_zip)
        before_document_revision = int((project.drawingDocument or {}).get("drawingRevision", 0))
        before_checksums = (project.drawingDocument or {}).get("checksums", {})
        project.drawingDocument = build_drawing_document(drawing_package, project.reconstructionModel, project.drawingDocument)
        after_checksums = project.drawingDocument.get("checksums", {})
        project.editable3DState["linkedDrawingUpdateReport"] = {
            "sourceModelRevision": int(project.reconstructionModel.get("modelRevision", 1)),
            "drawingRevisionBefore": before_document_revision,
            "drawingRevisionAfter": int(project.drawingDocument.get("drawingRevision", 1)),
            "changedViewIds": sorted([view_id for view_id, value in after_checksums.get("viewChecksums", {}).items() if value != before_checksums.get("viewChecksums", {}).get(view_id)]),
            "preservedEntityIds": sorted(set(before_checksums.get("entityIds", [])) & set(after_checksums.get("entityIds", []))),
            "checksumsBefore": before_checksums,
            "checksumsAfter": after_checksums,
        }
        project.drawingLayout = project.drawingDocument.get("page", {})
        project.optimizationReport.setdefault("editUpdates", []).append({"operations": len(project.editHistory), "cleanup": cleanup_report})
        project.assets.update({"cleanMesh": str(clean_path), "finalMesh": str(glb_path), "drawingPackage": str(drawing_path)})
        project.exports.append({"type": "drawing-validation", "validation": drawing_package.get("validation", {}), "timestamp": time.time()})

    def _included_photos(self, project_id: str) -> list[PhotoRecord]:
        return [photo for photo in self.get_project(project_id).photos if photo.included]

    def _reconstruction_input_is_current(self, project: ProjectRecord, reconstruction_input: dict) -> bool:
        for photo_id, revision in reconstruction_input.get("photoGeometryRevisions", {}).items():
            state = ensure_geometry_state(project, photo_id)
            if int(state["revisions"].get("photoGeometry", 0)) != int(revision):
                return False
        return True

    def _progress(self, job: JobRecord, stage: str, message: str, overall: int, *, state: str = "running", completed: Optional[int] = None, total: Optional[int] = None, warnings: Optional[list[str]] = None) -> None:
        if job.state == "cancelled":
            return
        job.state = state
        job.stage = stage
        job.message = message
        job.overallProgress = max(job.overallProgress, max(0, min(100, overall)))
        job.stageProgress = job.overallProgress
        if completed is not None:
            job.completedPhotos = completed
        if total is not None:
            job.totalPhotos = total
        if warnings:
            job.warnings.extend(warnings)

    def _check_cancelled(self, job: JobRecord) -> None:
        if job.cancelRequested or job.state == "cancelled":
            job.state = "cancelled"
            raise RuntimeError("Job cancelled.")

    def _project_json(self, project: ProjectRecord) -> dict:
        data = asdict(project)
        data["photos"] = [asdict(photo) for photo in project.photos]
        return data

    def _job_json(self, job: JobRecord) -> dict:
        return asdict(job)

    def _save_project(self, project: ProjectRecord) -> None:
        Path(project.rootPath).mkdir(parents=True, exist_ok=True)
        project_path = Path(project.rootPath) / "project.packlab3d.json"
        project_path.write_text(json.dumps(self._project_json(project), indent=2), encoding="utf-8")

    def _load_project(self, project_id: str) -> Optional[ProjectRecord]:
        project_path = self.root_dir / project_id / "project.packlab3d.json"
        if not project_path.exists():
            return None
        data = json.loads(project_path.read_text(encoding="utf-8"))
        project = ProjectRecord(
            id=data["id"],
            version=data.get("version", 2),
            projectName=data.get("projectName", ""),
            packageType=data.get("packageType", "bottle"),
            rootPath=data.get("rootPath", str(project_path.parent)),
            photos=[PhotoRecord(**photo) for photo in data.get("photos", [])],
            photoAnalysis=data.get("photoAnalysis", {}),
            sameObjectAnalysis=data.get("sameObjectAnalysis", data.get("photoAnalysis", {}).get("sameObject", {})),
            viewAssignments=data.get("viewAssignments", data.get("photoAnalysis", {}).get("viewAssignments", {})),
            masks=data.get("masks", {}),
            contours=data.get("contours", {}),
            silhouettes=data.get("silhouettes", {}),
            landmarks=data.get("landmarks", {}),
            photoGeometry=data.get("photoGeometry", {}),
            cameraEstimates=data.get("cameraEstimates", {}),
            measurements=data.get("measurements", {}),
            measurementLocks=data.get("measurementLocks", {}),
            reconstruction=data.get("reconstruction", {}),
            reconstructionModel=data.get("reconstructionModel", {}),
            optimizationReport=data.get("optimizationReport", {}),
            optimizationRuns=data.get("optimizationRuns", []),
            editable3DState=data.get("editable3DState", {}),
            controlCage=data.get("controlCage", data.get("reconstructionModel", {}).get("controlCage", {})),
            drawingDocument=data.get("drawingDocument", {}),
            drawingLayout=data.get("drawingLayout", data.get("drawingDocument", {}).get("page", {})),
            labelRegion=data.get("labelRegion", {}),
            editHistory=data.get("editHistory", []),
            versions=data.get("versions", []),
            autosaveMetadata=data.get("autosaveMetadata", autosave_metadata()),
            exports=data.get("exports", []),
            assets=data.get("assets", {}),
            warnings=data.get("warnings", []),
        )
        if project.version < 5:
            project.version = 5
            for photo in project.photos:
                ensure_geometry_state(project, photo.id)
        project.editable3DState.setdefault("editorState", {"version": 3, "history": {"entries": [], "cursor": 0, "maxEntries": 100}, "cageState": {}})
        self._save_project(project)
        with self._lock:
            self._projects[project_id] = project
        return project


def _upload_size(upload) -> int:
    pos = upload.file.tell()
    upload.file.seek(0, 2)
    size = upload.file.tell()
    upload.file.seek(pos)
    return size


def _normalize_view_type(value: Optional[str]) -> str:
    value = (value or "custom").strip().lower().replace("-", "_")
    return value if value in VIEW_TYPES else "custom"


def _suggest_view_type(index: int) -> str:
    return ["front", "back", "left", "right", "front_left", "front_right", "top", "bottom", "back_left", "back_right"][index % 10]


def _quality_report(photo_id: str, image: Image.Image) -> dict:
    gray = ImageOps.grayscale(image)
    edges = gray.filter(ImageFilter.FIND_EDGES)
    blur_score = float(ImageStat.Stat(edges).var[0] / 10000.0)
    stat = ImageStat.Stat(gray)
    mean = stat.mean[0] / 255.0
    exposure_score = 1.0 - min(abs(mean - 0.5) * 2.0, 1.0)
    median_color = tuple(int(value) for value in ImageStat.Stat(image).median[:3])
    bbox = ImageChops.difference(image, Image.new("RGB", image.size, median_color)).getbbox()
    coverage = 0.0
    if bbox:
        coverage = ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / float(image.width * image.height)
    warnings = []
    if image.width < 640 or image.height < 640:
        warnings.append("Low resolution image.")
    if blur_score < 0.02:
        warnings.append("Possible blur.")
    if exposure_score < 0.35:
        warnings.append("Poor exposure.")
    if coverage < 0.18:
        warnings.append("Object may occupy too little of the frame.")
    score = int(max(0, min(100, 35 + blur_score * 300 + exposure_score * 35 + coverage * 20 - len(warnings) * 8)))
    if score >= 85:
        status = "excellent"
    elif score >= 70:
        status = "good"
    elif score >= 45:
        status = "usable_with_warnings"
    else:
        status = "poor"
    return {
        "photoId": photo_id,
        "usable": True,
        "qualityScore": score,
        "status": status,
        "warnings": warnings,
        "metrics": {
            "blurScore": round(blur_score, 4),
            "exposureScore": round(exposure_score, 4),
            "objectCoverage": round(coverage, 4),
            "duplicateProbability": 0.0,
        },
    }


def _small_histogram(image: Image.Image) -> np.ndarray:
    small = image.resize((32, 32)).convert("RGB")
    hist = np.array(small.histogram(), dtype=np.float64)
    total = hist.sum() or 1.0
    return hist / total


def _same_object_warnings(photos: list[PhotoRecord], aspect_ratios: list[float], histograms: list[np.ndarray]) -> list[str]:
    if len(photos) < 2:
        return []
    warnings = []
    median_aspect = float(np.median(aspect_ratios))
    for photo, aspect, hist in zip(photos, aspect_ratios, histograms):
        color_distance = min(float(np.linalg.norm(hist - other)) for other in histograms if other is not hist) if len(histograms) > 1 else 0.0
        if median_aspect and abs(aspect - median_aspect) / median_aspect > 0.65:
            warnings.append(f"{photo.id} may show a different object from the rest of the photo set.")
        if color_distance > 0.55:
            warnings.append(f"{photo.id} has unusual color distribution compared with the photo set.")
    return warnings


def _same_object_report(photos: list[PhotoRecord], aspect_ratios: list[float], histograms: list[np.ndarray]) -> list[dict]:
    if len(photos) < 2:
        return [
            {
                "photoId": photos[0].id,
                "sameObjectProbability": 1.0,
                "status": "consistent",
                "evidence": ["single photo project"],
            }
        ] if photos else []
    median_aspect = float(np.median(aspect_ratios))
    reports = []
    for photo, aspect, hist in zip(photos, aspect_ratios, histograms):
        color_distance = min(float(np.linalg.norm(hist - other)) for other in histograms if other is not hist) if len(histograms) > 1 else 0.0
        aspect_penalty = min(abs(aspect - median_aspect) / max(median_aspect, 1e-6), 1.0)
        probability = max(0.0, min(1.0, 1.0 - aspect_penalty * 0.55 - color_distance * 0.45))
        if probability >= 0.85:
            status = "consistent"
        elif probability >= 0.7:
            status = "probably-consistent"
        elif probability >= 0.45:
            status = "uncertain"
        elif probability >= 0.25:
            status = "probably-different"
        else:
            status = "different"
        evidence = []
        if aspect_penalty < 0.2:
            evidence.append("matching width-to-height ratio")
        if color_distance < 0.25:
            evidence.append("matching dominant color layout")
        if not evidence:
            evidence.append("low agreement; user review recommended")
        reports.append(
            {
                "photoId": photo.id,
                "sameObjectProbability": round(probability, 3),
                "status": status,
                "evidence": evidence,
            }
        )
    return reports


def _same_object_warnings_from_report(report: dict) -> list[str]:
    warnings = []
    for item in report.get("photos", []):
        if item.get("status") in {"probably-different", "different"}:
            conflicts = "; ".join(item.get("conflicts", [])) or "low same-object probability"
            warnings.append(f"{item['photoId']} may show a different object from the rest of the photo set: {conflicts}.")
        elif item.get("status") == "uncertain":
            warnings.append(f"{item['photoId']} needs same-object review before reconstruction.")
    return warnings


def _classical_mask(image: Image.Image) -> tuple[Image.Image, Optional[list[int]]]:
    rgb = image.convert("RGB")
    bg = Image.new("RGB", rgb.size, tuple(int(value) for value in ImageStat.Stat(rgb).median[:3]))
    diff = ImageChops.difference(rgb, bg).convert("L")
    threshold = diff.point(lambda px: 255 if px > 18 else 0)
    bbox = threshold.getbbox()
    if not bbox:
        return Image.new("L", rgb.size, 255), None
    return threshold.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3)), list(bbox)


def _photo_landmarks_from_silhouette(silhouette: dict) -> list[dict]:
    levels = silhouette.get("levels") or []
    if not levels:
        return []
    widths = np.asarray([level["width"] for level in levels], dtype=np.float64)
    max_idx = int(np.argmax(widths))
    gradients = np.abs(np.diff(widths))
    curvature_idx = int(np.argmax(gradients)) if len(gradients) else max_idx
    return [
        {"id": f"{silhouette['photoId']}-top", "type": "highest-visible-point", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": 1.0, "confidence": silhouette["confidence"], "source": "automatic", "locked": False},
        {"id": f"{silhouette['photoId']}-support", "type": "bottom-support-plane", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": 0.0, "confidence": silhouette["confidence"], "source": "automatic", "locked": False},
        {"id": f"{silhouette['photoId']}-max-width", "type": "maximum-width-height", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": levels[max_idx]["y"], "confidence": silhouette["confidence"], "source": "automatic", "locked": False},
        {"id": f"{silhouette['photoId']}-curvature", "type": "major-curvature-change", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": levels[curvature_idx]["y"], "confidence": round(silhouette["confidence"] * 0.7, 3), "source": "automatic", "locked": False},
        {"id": f"{silhouette['photoId']}-label-top", "type": "labelable-area-top", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": 0.72, "confidence": round(silhouette["confidence"] * 0.55, 3), "source": "automatic", "locked": False},
        {"id": f"{silhouette['photoId']}-label-bottom", "type": "labelable-area-bottom", "view": silhouette["viewType"], "x": silhouette["centerlineX"], "y": 0.22, "confidence": round(silhouette["confidence"] * 0.55, 3), "source": "automatic", "locked": False},
    ]


def _merge_locked_landmarks(automatic: list[dict], locked: list[dict]) -> list[dict]:
    if not locked:
        return automatic
    by_id = {item.get("id"): item for item in automatic}
    for item in locked:
        by_id[item.get("id")] = {**item, "locked": True, "source": item.get("source", "manual")}
    return list(by_id.values())


def _infer_dimensions(photos: list[PhotoRecord], measurements: dict, package_type: str) -> tuple[dict, dict]:
    ratios = [photo.workingWidth / max(photo.workingHeight, 1) for photo in photos]
    front_ratios = [photo.workingWidth / max(photo.workingHeight, 1) for photo in photos if photo.viewType in {"front", "back", "front_left", "front_right"}] or ratios
    side_ratios = [photo.workingWidth / max(photo.workingHeight, 1) for photo in photos if photo.viewType in {"left", "right", "back_left", "back_right"}]
    height = _positive(measurements.get("heightMm") or measurements.get("height_mm")) or 120.0
    width = _positive(measurements.get("widthMm") or measurements.get("width_mm") or measurements.get("diameterMm") or measurements.get("diameter_mm"))
    depth = _positive(measurements.get("depthMm") or measurements.get("depth_mm") or measurements.get("diameterMm") or measurements.get("diameter_mm"))
    if width is None:
        width = max(25.0, height * float(np.median(front_ratios)) * 0.72)
    if depth is None:
        depth = max(20.0, height * float(np.median(side_ratios)) * 0.72) if side_ratios else max(20.0, width * 0.72)
    dimensions = {"widthMm": round(width, 3), "heightMm": round(height, 3), "depthMm": round(depth, 3)}
    sources = {
        "widthMm": "measured" if _positive(measurements.get("widthMm") or measurements.get("width_mm") or measurements.get("diameterMm") or measurements.get("diameter_mm")) else "estimated-from-photo-set",
        "heightMm": "measured" if _positive(measurements.get("heightMm") or measurements.get("height_mm")) else "estimated-default",
        "depthMm": "measured" if _positive(measurements.get("depthMm") or measurements.get("depth_mm") or measurements.get("diameterMm") or measurements.get("diameter_mm")) else "estimated-from-side-or-proportion",
    }
    return dimensions, sources


def _positive(value) -> Optional[float]:
    try:
        numeric = float(value)
        return numeric if numeric > 0 else None
    except (TypeError, ValueError):
        return None


def _mesh_to_glb(mesh) -> bytes:
    vertices = np.asarray(mesh.vertices)
    faces = np.asarray(mesh.triangles)
    tm = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    return tm.export(file_type="glb")


def _drawing_document_from_package(drawing_package: dict, reconstruction_model: dict) -> dict:
    metadata = drawing_package.get("metadata", {})
    return {
        "version": 1,
        "linkedModelVersion": reconstruction_model.get("version"),
        "units": "mm",
        "views": [
            {"id": "front-view", "type": "front", "visible": True, "scale": 1.0},
            {"id": "rear-view", "type": "rear", "visible": True, "scale": 1.0},
            {"id": "left-view", "type": "left", "visible": True, "scale": 1.0},
            {"id": "right-view", "type": "right", "visible": True, "scale": 1.0},
            {"id": "top-view", "type": "top", "visible": True, "scale": 1.0},
            {"id": "bottom-view", "type": "bottom", "visible": True, "scale": 1.0},
        ],
        "dimensions": [
            {"id": "dim-overall-height", "feature": "overall-height", "valueMm": reconstruction_model.get("heightMm"), "source": "linked-model", "visible": True},
            {"id": "dim-max-width", "feature": "maximum-width", "valueMm": metadata.get("bounding_box_mm", [None, None, None])[0], "source": "linked-model", "visible": True},
            {"id": "dim-max-depth", "feature": "maximum-depth", "valueMm": metadata.get("bounding_box_mm", [None, None, None])[2], "source": "linked-model", "visible": True},
        ],
        "notes": [],
        "sectionLines": [],
        "titleBlock": {"title": "PackLab 3D Technical Drawing", "revision": "A", "scale": "1:1"},
        "manualOverridesPreserved": True,
    }


def build_project_export(project: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("project.packlab3d.json", json.dumps(project, indent=2))
    return buf.getvalue()
