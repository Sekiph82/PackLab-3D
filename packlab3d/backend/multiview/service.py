import hashlib
import io
import json
import tempfile
import threading
import time
import uuid
import zipfile
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
from packlab3d.backend.multiview.native_reconstruction import analyze_photo_geometry, build_native_reconstruction, mesh_from_generic_model

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
    silhouettes: dict = field(default_factory=dict)
    landmarks: dict = field(default_factory=dict)
    measurements: dict = field(default_factory=dict)
    measurementLocks: dict = field(default_factory=dict)
    reconstruction: dict = field(default_factory=dict)
    reconstructionModel: dict = field(default_factory=dict)
    optimizationReport: dict = field(default_factory=dict)
    editable3DState: dict = field(default_factory=dict)
    drawingDocument: dict = field(default_factory=dict)
    labelRegion: dict = field(default_factory=dict)
    editHistory: list[dict] = field(default_factory=list)
    versions: list[dict] = field(default_factory=list)
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
        for child in ("originals", "working", "masks", "results"):
            (project_root / child).mkdir(parents=True, exist_ok=True)
        project = ProjectRecord(
            id=project_id,
            version=3,
            projectName=project_name or "Untitled PackLab 3D Project",
            packageType=package_type or "bottle",
            rootPath=str(project_root),
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
        return {
            "projectId": project.id,
            "reconstructionModel": project.reconstructionModel,
            "editable3DState": project.editable3DState,
            "drawingDocument": project.drawingDocument,
            "labelRegion": project.labelRegion,
        }

    def update_editable_model(self, project_id: str, edits: dict) -> dict:
        project = self.get_project(project_id)
        if not project.reconstructionModel:
            raise ValueError("No reconstruction model exists for this project.")
        model = json.loads(json.dumps(project.reconstructionModel))
        operations = []
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
        for point in edits.get("profilePoints", []) or []:
            target_id = point.get("id")
            half_extent = _positive(point.get("halfExtentMm"))
            if not target_id or half_extent is None:
                continue
            for profile_name in ("frontProfile", "sideProfile"):
                for item in model.get(profile_name, []):
                    if item["id"] == target_id and not item.get("locked"):
                        old = item["halfExtentMm"]
                        item["halfExtentMm"] = round(half_extent, 3)
                        operations.append({"type": "move-profile-point", "target": target_id, "before": old, "after": item["halfExtentMm"]})
        if not operations:
            return self.editable_model(project_id)
        project.reconstructionModel = model
        project.editHistory.extend(operations)
        self._persist_model_outputs(project)
        self._save_project(project)
        return self.editable_model(project_id)

    def update_drawing_document(self, project_id: str, patch: dict) -> dict:
        project = self.get_project(project_id)
        document = json.loads(json.dumps(project.drawingDocument or {}))
        notes = document.setdefault("notes", [])
        for note in patch.get("notes", []) or []:
            if "id" not in note:
                note = {**note, "id": f"note-{uuid.uuid4().hex[:8]}"}
            notes.append(note)
        if "titleBlock" in patch:
            document["titleBlock"] = {**document.get("titleBlock", {}), **patch["titleBlock"]}
        project.drawingDocument = document
        self._save_project(project)
        return {"projectId": project.id, "drawingDocument": document}

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
        hashes = {}
        aspect_ratios = []
        histograms = []
        for index, photo in enumerate(photos):
            self._check_cancelled(job)
            self._progress(job, "analyzing_quality", f"Analyzing photo {index + 1} of {len(photos)}", 10 + int(index / max(len(photos), 1) * 55), completed=index, total=len(photos))
            image = Image.open(photo.workingPath).convert("RGB")
            photo.quality = _quality_report(photo.id, image)
            aspect_ratios.append(image.width / max(image.height, 1))
            histograms.append(_small_histogram(image))
            if photo.sha256 in hashes:
                photo.quality["warnings"].append(f"Near duplicate of {hashes[photo.sha256]}.")
                photo.quality["metrics"]["duplicateProbability"] = 1.0
            hashes[photo.sha256] = photo.id
        warnings = _same_object_warnings(photos, aspect_ratios, histograms)
        same_object = _same_object_report(photos, aspect_ratios, histograms)
        project.photoAnalysis = {
            "photos": {photo.id: photo.quality for photo in photos},
            "sameObject": same_object,
            "algorithm": "Pillow histogram, aspect-ratio, edge, exposure, and coverage metrics",
        }
        project.warnings = [warning for warning in project.warnings if "different object" not in warning.lower()] + warnings
        self._save_project(project)
        job.result = {"photos": [asdict(photo) for photo in photos], "warnings": warnings, "sameObject": same_object}
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
            if bbox:
                silhouette = analyze_photo_geometry(photo, mask_path=str(mask_path))
                project.silhouettes[photo.id] = silhouette
                project.landmarks[photo.id] = _photo_landmarks_from_silhouette(silhouette)
                photo.segmentation["contourConfidence"] = silhouette["confidence"]
        self._save_project(project)
        job.result = {"photos": [asdict(photo) for photo in photos]}

    def _run_reconstruction(self, job: JobRecord, payload: dict) -> None:
        project = self.get_project(job.projectId)
        photos = self._included_photos(job.projectId)
        if not photos:
            raise ValueError("At least one included photo is required.")
        self._progress(job, "aligning_views", "Aligning usable views", 12, total=len(photos))
        measurements = payload.get("measurements") or {}
        package_type = payload.get("packageType") or project.packageType or "custom"
        dimensions, dimension_sources = _infer_dimensions(photos, measurements, package_type)
        self._progress(job, "generating_reference_geometry", "Generating unified reference geometry", 35)
        model_measurements = dict(measurements)
        for key, value in dimensions.items():
            if _positive(model_measurements.get(key)) is None:
                model_measurements[key] = value
        native_mesh, reconstruction_model, optimization_report = build_native_reconstruction(photos, model_measurements, dimension_sources)
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
            "cleanupReport": cleanup_report,
            "glbValidation": glb_validation,
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
        }
        project.reconstructionModel = reconstruction_model
        project.optimizationReport = optimization_report
        project.editable3DState = {
            "profileEditing": True,
            "crossSectionEditing": True,
            "controlCageEditing": True,
            "undoRedoReady": False,
            "currentVersion": "fit-001",
        }
        project.drawingDocument = _drawing_document_from_package(drawing_package, reconstruction_model)
        project.labelRegion = reconstruction_model.get("labelRegion", {})
        project.versions = [{"id": "fit-001", "name": "Initial native fit", "method": method}]
        project.assets = {
            "referenceMesh": str(reference_path),
            "cleanMesh": str(clean_path),
            "finalMesh": str(glb_path),
            "drawingPackage": str(drawing_path),
            "report": str(report_path),
        }
        self._save_project(project)
        job.result = {"projectId": project.id, "assets": project.assets, "report": report}
        self._progress(job, "preparing_final_result", "Preparing final result", 96, completed=len(photos), total=len(photos))

    def _persist_model_outputs(self, project: ProjectRecord) -> None:
        mesh = mesh_from_generic_model(project.reconstructionModel)
        cleaned_mesh, cleanup_report = cleanup_mesh(mesh)
        clean_path = Path(project.rootPath) / "results" / "clean_mesh.obj"
        o3d.io.write_triangle_mesh(str(clean_path), cleaned_mesh)
        glb_bytes = _mesh_to_glb(cleaned_mesh)
        glb_path = Path(project.rootPath) / "results" / "visualization.glb"
        glb_path.write_bytes(glb_bytes)
        drawing_package = generate_technical_drawing_package(cleaned_mesh, backend=CadBackend.MESH_PROJECTION)
        drawing_package["metadata"]["reconstruction_method"] = project.reconstruction.get("method", "packlab-native-generic-profile-fit")
        drawing_zip = build_zip_package(drawing_package)
        drawing_path = Path(project.rootPath) / "results" / "technical_drawing.zip"
        drawing_path.write_bytes(drawing_zip)
        previous_notes = (project.drawingDocument or {}).get("notes", [])
        project.drawingDocument = _drawing_document_from_package(drawing_package, project.reconstructionModel)
        project.drawingDocument["notes"] = previous_notes
        project.optimizationReport.setdefault("editUpdates", []).append({"operations": len(project.editHistory), "cleanup": cleanup_report})
        project.assets.update({"cleanMesh": str(clean_path), "finalMesh": str(glb_path), "drawingPackage": str(drawing_path)})

    def _included_photos(self, project_id: str) -> list[PhotoRecord]:
        return [photo for photo in self.get_project(project_id).photos if photo.included]

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
            silhouettes=data.get("silhouettes", {}),
            landmarks=data.get("landmarks", {}),
            measurements=data.get("measurements", {}),
            measurementLocks=data.get("measurementLocks", {}),
            reconstruction=data.get("reconstruction", {}),
            reconstructionModel=data.get("reconstructionModel", {}),
            optimizationReport=data.get("optimizationReport", {}),
            editable3DState=data.get("editable3DState", {}),
            drawingDocument=data.get("drawingDocument", {}),
            labelRegion=data.get("labelRegion", {}),
            editHistory=data.get("editHistory", []),
            versions=data.get("versions", []),
            assets=data.get("assets", {}),
            warnings=data.get("warnings", []),
        )
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
        {"name": "highest_visible_point", "x": silhouette["centerlineX"], "y": 1.0, "confidence": silhouette["confidence"], "source": silhouette["photoId"]},
        {"name": "lowest_support_plane", "x": silhouette["centerlineX"], "y": 0.0, "confidence": silhouette["confidence"], "source": silhouette["photoId"]},
        {"name": "maximum_width_level", "x": silhouette["centerlineX"], "y": levels[max_idx]["y"], "confidence": silhouette["confidence"], "source": silhouette["photoId"]},
        {"name": "strong_curvature_change", "x": silhouette["centerlineX"], "y": levels[curvature_idx]["y"], "confidence": round(silhouette["confidence"] * 0.7, 3), "source": silhouette["photoId"]},
    ]


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
