import logging
import os
import platform
import sys
import tempfile
import time
import importlib
import importlib.metadata
import importlib.util
from pathlib import Path
from typing import Optional
from urllib.parse import quote

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from starlette.background import BackgroundTask

from packlab3d.backend.i18n import DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, get_message
from packlab3d.backend.i18n import set_language as i18n_set_language
from packlab3d.core.utils.errors import ModelNotAvailableError

logger = logging.getLogger("packlab3d.api")
IMPORT_STARTED_AT = time.perf_counter()
_CAPABILITY_CACHE: Optional[dict] = None

app = FastAPI(title="PackLab 3D API", version="0.1.0")

def _configure_logging() -> None:
    log_dir = os.environ.get("PACKLAB_LOG_DIR")
    handlers = [logging.StreamHandler()]
    if log_dir:
        Path(log_dir).mkdir(parents=True, exist_ok=True)
        handlers.append(logging.FileHandler(Path(log_dir) / "backend.log", encoding="utf-8"))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        handlers=handlers,
        force=True,
    )


_configure_logging()
logger.info("FastAPI import start", extra={"elapsed_ms": round((time.perf_counter() - IMPORT_STARTED_AT) * 1000, 2)})


class LanguageRequest(BaseModel):
    language: str


class LangOnlyRequest(BaseModel):
    language: Optional[str] = DEFAULT_LANGUAGE


class StatusResponse(BaseModel):
    status: str
    message: str


def _resolve_language(language: Optional[str]) -> str:
    lang = (language or DEFAULT_LANGUAGE).strip().lower()
    return lang if lang in SUPPORTED_LANGUAGES else DEFAULT_LANGUAGE


def _not_implemented(lang: str):
    raise HTTPException(status_code=501, detail=get_message("errors.notImplemented", lang))


def _api_message_header(key: str, lang: str) -> str:
    """HTTP headers are Latin-1/ASCII only — Turkish s-cedilla/g-breve/dotless-i
    fall outside that range, so localized messages must be percent-encoded
    before going into a header. Clients should urllib.parse.unquote() this."""
    return quote(get_message(key, lang), safe="")


def _open3d():
    started = time.perf_counter()
    import open3d as o3d

    logger.info("Open3D load", extra={"elapsed_ms": round((time.perf_counter() - started) * 1000, 2)})
    return o3d


def _read_uploaded_mesh(file: UploadFile, lang: str):
    o3d = _open3d()
    suffix = Path(file.filename or "").suffix or ".obj"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file.file.read())
        tmp_path = tmp.name
    try:
        mesh = o3d.io.read_triangle_mesh(tmp_path)
        if len(mesh.vertices) == 0:
            raise ValueError("empty mesh")
        return mesh
    except Exception as exc:
        raise HTTPException(
            status_code=400, detail=get_message("errors.invalidMesh", lang)
        ) from exc
    finally:
        os.unlink(tmp_path)


def _mesh_file_response(mesh, download_name: str, headers: dict) -> FileResponse:
    o3d = _open3d()
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".obj")
    tmp_path = tmp.name
    tmp.close()
    o3d.io.write_triangle_mesh(tmp_path, mesh)
    return FileResponse(
        tmp_path,
        media_type="application/octet-stream",
        filename=download_name,
        headers=headers,
        background=BackgroundTask(os.unlink, tmp_path),
    )


@app.get("/", response_model=StatusResponse)
def health():
    return StatusResponse(status="ok", message="PackLab 3D API")


@app.get("/health/live")
def health_live():
    return {"status": "alive"}


@app.get("/health/ready")
def health_ready():
    missing = []
    for name in ("open3d", "trimesh", "pygltflib"):
        if importlib.util.find_spec(name) is None:
            missing.append(name)
    return {"status": "ready" if not missing else "degraded", "missing": missing}


@app.get("/version")
def version():
    return {
        "app": app.version,
        "python": sys.version.split()[0],
        "platform": platform.platform(),
        "packaged": os.environ.get("PACKLAB_PACKAGED") == "1",
    }


def _module_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except ModuleNotFoundError:
        return False


def _module_version(distribution: str) -> Optional[str]:
    try:
        return importlib.metadata.version(distribution)
    except importlib.metadata.PackageNotFoundError:
        return None


def _capability(
    import_name: str,
    *,
    distribution: Optional[str] = None,
    import_for_version: bool = False,
    reason: Optional[str] = None,
) -> dict:
    started = time.perf_counter()
    if not _module_available(import_name):
        return {
            "available": False,
            "status": "not-installed",
            "version": None,
            "reason": reason or f"{import_name} package is not installed",
            "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
        }
    version_value = _module_version(distribution or import_name)
    if import_for_version:
        try:
            module = importlib.import_module(import_name)
            version_value = getattr(module, "__version__", version_value)
        except Exception as exc:
            return {
                "available": False,
                "status": "import-error",
                "version": version_value,
                "reason": str(exc),
                "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
            }
    return {
        "available": True,
        "status": "available",
        "version": version_value,
        "reason": None,
        "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
    }


def _static_capability(available: bool, status: str, reason: Optional[str] = None) -> dict:
    return {
        "available": bool(available),
        "status": status,
        "version": None,
        "reason": reason,
        "loadTimeMs": 0,
    }


def _cuda_capability(torch_cap: dict) -> dict:
    started = time.perf_counter()
    if not torch_cap["available"]:
        return {
            "available": False,
            "status": "torch-unavailable",
            "version": None,
            "reason": "Torch is not installed",
            "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
        }
    try:
        import torch

        available = bool(torch.cuda.is_available())
        return {
            "available": available,
            "status": "available" if available else "not-available",
            "version": getattr(torch.version, "cuda", None),
            "reason": None if available else "CUDA is not available in this environment",
            "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
        }
    except Exception as exc:
        return {
            "available": False,
            "status": "probe-error",
            "version": None,
            "reason": str(exc),
            "loadTimeMs": round((time.perf_counter() - started) * 1000, 2),
        }


def _build_capabilities() -> dict:
    open3d_cap = _capability("open3d", import_for_version=True)
    trimesh_cap = _capability("trimesh", import_for_version=True)
    pygltflib_cap = _capability("pygltflib", distribution="pygltflib")
    pillow_cap = _capability("PIL", distribution="Pillow")
    qrcode_cap = _capability("qrcode")
    barcode_cap = _capability("barcode", distribution="python-barcode")
    torch_cap = _capability("torch", import_for_version=True)
    tsr_cap = _capability("tsr", distribution="tsr", reason="The tsr package and model files are not installed")
    sam_installed = _module_available("segment_anything")
    sam_checkpoint = bool(os.environ.get("PACKLAB_SAM_CHECKPOINT"))
    sam_cap = _static_capability(
        sam_installed and sam_checkpoint,
        "available" if sam_installed and sam_checkpoint else "not-configured",
        None if sam_installed and sam_checkpoint else "segment_anything and PACKLAB_SAM_CHECKPOINT are required",
    )
    freecad_cap = _static_capability(
        _module_available("FreeCAD") and _module_available("Part"),
        "available" if _module_available("FreeCAD") and _module_available("Part") else "not-installed",
        None if _module_available("FreeCAD") and _module_available("Part") else "FreeCAD Python modules are not installed",
    )
    occ_available = _module_available("OCC") and _module_available("OCC.Core")
    occ_cap = _static_capability(
        occ_available,
        "available" if occ_available else "not-installed",
        None if occ_available else "OCC.Core is not installed",
    )
    return {
        "open3d": open3d_cap,
        "trimesh": trimesh_cap,
        "pygltflib": pygltflib_cap,
        "pillow": pillow_cap,
        "qr_generation": qrcode_cap,
        "barcode_generation": barcode_cap,
        "triposr": _static_capability(
            torch_cap["available"] and tsr_cap["available"],
            "available" if torch_cap["available"] and tsr_cap["available"] else "not-installed",
            None if torch_cap["available"] and tsr_cap["available"] else "The tsr package and model files are not installed",
        ),
        "torch": torch_cap,
        "cuda": _cuda_capability(torch_cap),
        "sam": sam_cap,
        "freecad": freecad_cap,
        "occ": occ_cap,
        "svg_generation": _static_capability(True, "available"),
        "dxf_generation": _static_capability(True, "available"),
        "label_engine": _static_capability(True, "available"),
        "glb_export": _static_capability(pygltflib_cap["available"] and trimesh_cap["available"], "available" if pygltflib_cap["available"] and trimesh_cap["available"] else "degraded"),
    }


@app.get("/capabilities")
def capabilities(refresh: bool = False):
    global _CAPABILITY_CACHE
    if refresh or _CAPABILITY_CACHE is None:
        _CAPABILITY_CACHE = _build_capabilities()
    return _CAPABILITY_CACHE


@app.post("/set-language", response_model=StatusResponse)
def set_language(payload: LanguageRequest):
    try:
        lang = i18n_set_language(payload.language)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=get_message("errors.unsupportedLanguage", DEFAULT_LANGUAGE),
        )
    return StatusResponse(status="ok", message=get_message("api.languageSet", lang))


@app.post("/process-image", response_model=StatusResponse)
async def process_image(file: UploadFile = File(...), language: Optional[str] = Form(None)):
    _not_implemented(_resolve_language(language))


@app.post("/generate-mesh")
async def generate_mesh(
    file: UploadFile = File(...),
    backend: str = Form("triposr"),
    language: Optional[str] = Form(None),
):
    from PIL import Image
    from packlab3d.backend.mesh_generation.pipeline import MeshBackend
    from packlab3d.backend.mesh_generation.pipeline import generate_mesh as run_mesh_generation

    lang = _resolve_language(language)
    try:
        mesh_backend = MeshBackend(backend)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown mesh backend: {backend}")

    try:
        image = Image.open(file.file)
        image.load()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=get_message("errors.invalidImage", lang)) from exc

    try:
        mesh = run_mesh_generation(image, backend=mesh_backend)
    except ModelNotAvailableError as exc:
        logger.warning("Mesh generation backend unavailable: %s", exc)
        raise HTTPException(status_code=503, detail=get_message("errors.modelUnavailable", lang))

    return _mesh_file_response(
        mesh,
        download_name="generated_mesh.obj",
        headers={"X-Api-Message": _api_message_header("api.meshGenerated", lang)},
    )


@app.post("/scale-mesh")
async def scale_mesh(
    file: UploadFile = File(...),
    width_mm: Optional[float] = Form(None),
    height_mm: Optional[float] = Form(None),
    depth_mm: Optional[float] = Form(None),
    diameter_mm: Optional[float] = Form(None),
    volume_ml: Optional[float] = Form(None),
    uniform: bool = Form(False),
    language: Optional[str] = Form(None),
):
    from packlab3d.backend.mesh_scaling.scaling import TargetDimensions, scale_mesh_to_dimensions

    lang = _resolve_language(language)
    mesh = _read_uploaded_mesh(file, lang)
    target = TargetDimensions(
        width_mm=width_mm,
        height_mm=height_mm,
        depth_mm=depth_mm,
        diameter_mm=diameter_mm,
        volume_ml=volume_ml,
    )

    try:
        scaled_mesh, scale_factors, resulting_size = scale_mesh_to_dimensions(
            mesh, target, uniform=uniform
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=400, detail=get_message("errors.missingTargetDimension", lang)
        ) from exc

    return _mesh_file_response(
        scaled_mesh,
        download_name="scaled_mesh.obj",
        headers={
            "X-Api-Message": _api_message_header("api.meshScaled", lang),
            "X-Scale-Factors": ",".join(f"{v:.6f}" for v in scale_factors),
            "X-Resulting-Size-Mm": ",".join(f"{v:.3f}" for v in resulting_size),
        },
    )


@app.post("/cleanup-mesh")
async def cleanup_mesh(
    file: UploadFile = File(...),
    up_axis: str = Form("y"),
    language: Optional[str] = Form(None),
):
    from packlab3d.backend.mesh_cleanup.cleanup import cleanup_mesh as run_mesh_cleanup

    lang = _resolve_language(language)
    mesh = _read_uploaded_mesh(file, lang)

    try:
        cleaned_mesh, report = run_mesh_cleanup(mesh, current_up_axis=up_axis)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return _mesh_file_response(
        cleaned_mesh,
        download_name="cleaned_mesh.obj",
        headers={
            "X-Api-Message": _api_message_header("api.meshCleaned", lang),
            "X-Is-Watertight": str(report["is_watertight"]).lower(),
            "X-Triangle-Count": str(report["triangle_count"]),
            "X-Vertex-Count": str(report["vertex_count"]),
        },
    )


@app.post("/apply-wall-thickness")
async def apply_wall_thickness(
    file: UploadFile = File(...),
    packaging_type: str = Form(...),
    thickness_mm: Optional[float] = Form(None),
    material: Optional[str] = Form(None),
    language: Optional[str] = Form(None),
):
    from packlab3d.backend.wall_thickness.apply import apply_wall_thickness as run_apply_wall_thickness
    from packlab3d.backend.wall_thickness.rules import (
        get_default_wall_thickness_mm,
        get_material_properties,
        select_material,
        validate_wall_thickness_mm,
    )
    from packlab3d.core.utils.packaging import PackagingType

    lang = _resolve_language(language)

    try:
        packaging = PackagingType(packaging_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=get_message("errors.invalidPackagingType", lang))

    try:
        resolved_material = select_material(packaging, override=material)
    except ValueError:
        raise HTTPException(status_code=400, detail=get_message("errors.invalidMaterial", lang))

    resolved_thickness = (
        thickness_mm if thickness_mm is not None else get_default_wall_thickness_mm(packaging)
    )
    if not validate_wall_thickness_mm(packaging, resolved_thickness):
        raise HTTPException(status_code=400, detail=get_message("errors.invalidDimensions", lang))

    mesh = _read_uploaded_mesh(file, lang)

    try:
        result = run_apply_wall_thickness(mesh, thickness_mm=resolved_thickness)
    except ValueError:
        raise HTTPException(status_code=400, detail=get_message("errors.invalidDimensions", lang))

    props = get_material_properties(resolved_material)
    if result.material_volume_ml is not None:
        result.estimated_material_mass_g = result.material_volume_ml * props.density_g_cm3

    def _fmt(value):
        return "" if value is None else f"{value:.6f}"

    return _mesh_file_response(
        result.combined,
        download_name="walled_mesh.obj",
        headers={
            "X-Api-Message": _api_message_header("api.wallThicknessApplied", lang),
            "X-Material": resolved_material.value,
            "X-Thickness-Mm": f"{resolved_thickness:.3f}",
            "X-Density-G-Cm3": f"{props.density_g_cm3:.3f}",
            "X-Relative-Stiffness": str(props.relative_stiffness),
            "X-Outer-Volume-Ml": _fmt(result.outer_volume_ml),
            "X-Inner-Volume-Ml": _fmt(result.inner_volume_ml),
            "X-Material-Volume-Ml": _fmt(result.material_volume_ml),
            "X-Estimated-Material-Mass-G": _fmt(result.estimated_material_mass_g),
            "X-Estimated-Internal-Capacity-Ml": _fmt(result.estimated_internal_capacity_ml),
            "X-Bounding-Box-Mm": ",".join(f"{v:.3f}" for v in result.bounding_box_mm),
            "X-Is-Watertight": str(result.is_watertight).lower(),
            "X-Outer-Watertight": str(result.outer_watertight).lower(),
            "X-Inner-Watertight": str(result.inner_watertight).lower(),
            "X-Combined-Shell-Watertight": str(result.combined_shell_watertight).lower(),
            "X-Self-Intersecting": str(result.self_intersecting).lower(),
            "X-Confidence": result.confidence,
            "X-Warnings": quote("|".join(result.warnings), safe=""),
        },
    )


@app.post("/generate-2d")
async def generate_2d(
    file: UploadFile = File(...),
    backend: str = Form("mesh_projection"),
    material: Optional[str] = Form(None),
    wall_thickness_mm: Optional[float] = Form(None),
    language: Optional[str] = Form(None),
):
    from packlab3d.backend.cad_drawings.generate_2d import (
        CadBackend,
        build_zip_package,
        count_files,
        generate_technical_drawing_package,
    )

    lang = _resolve_language(language)

    try:
        cad_backend = CadBackend(backend)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown CAD backend: {backend}")

    mesh = _read_uploaded_mesh(file, lang)

    try:
        package = generate_technical_drawing_package(
            mesh, backend=cad_backend, material=material, wall_thickness_mm=wall_thickness_mm
        )
    except ModelNotAvailableError:
        raise HTTPException(status_code=503, detail=get_message("errors.modelUnavailable", lang))

    zip_bytes = build_zip_package(package)
    bbox = package["metadata"]["bounding_box_mm"]

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="technical_drawing.zip"',
            "X-Api-Message": _api_message_header("api.drawingGenerated", lang),
            "X-Bounding-Box-Mm": ",".join(f"{v:.3f}" for v in bbox),
            "X-View-Count": str(len(package["views"])),
            "X-File-Count": str(count_files(package)),
        },
    )


@app.post("/generate-label")
async def generate_label(
    style: str = Form(...),
    shape: str = Form(...),
    width_mm: float = Form(80.0),
    height_mm: float = Form(50.0),
    language: Optional[str] = Form(None),
    brand_name: Optional[str] = Form(None),
    product_name: Optional[str] = Form(None),
    ingredients: Optional[str] = Form(None),
    warnings: Optional[str] = Form(None),
    volume_ml: Optional[float] = Form(None),
    material: Optional[str] = Form(None),
    symbols: Optional[str] = Form(None),
    custom_text_blocks: Optional[str] = Form(None),
    barcode_data: Optional[str] = Form(None),
    qr_data: Optional[str] = Form(None),
    logo: Optional[UploadFile] = File(None),
):
    from PIL import Image as PILImage
    from packlab3d.backend.label_engine.generate_label import (
        build_zip_package as build_label_zip_package,
    )
    from packlab3d.backend.label_engine.generate_label import count_files as count_label_files
    from packlab3d.backend.label_engine.generate_label import generate_label_package
    from packlab3d.backend.label_engine.render import LabelContent, LabelSpec
    from packlab3d.backend.label_engine.shapes import LabelShape
    from packlab3d.backend.label_engine.styles import LabelStyle
    from packlab3d.backend.wall_thickness.rules import validate_material

    lang = _resolve_language(language)

    try:
        label_style = LabelStyle(style)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown label style: {style}")

    try:
        label_shape = LabelShape(shape)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown label shape: {shape}")

    if material is not None and not validate_material(material):
        raise HTTPException(status_code=400, detail=get_message("errors.invalidMaterial", lang))

    logo_image = None
    if logo is not None and logo.filename:
        try:
            logo_image = PILImage.open(logo.file)
            logo_image.load()
        except Exception as exc:
            raise HTTPException(status_code=400, detail=get_message("errors.invalidImage", lang)) from exc

    content = LabelContent(
        brand_name=brand_name,
        product_name=product_name,
        ingredients=ingredients,
        warnings=warnings,
        volume_ml=volume_ml,
        material=material,
        symbols=[s.strip() for s in symbols.split(",") if s.strip()] if symbols else [],
        custom_text_blocks=(
            [s.strip() for s in custom_text_blocks.split(",") if s.strip()] if custom_text_blocks else []
        ),
        barcode_data=barcode_data,
        qr_data=qr_data,
        logo=logo_image,
    )
    spec = LabelSpec(
        style=label_style,
        shape=label_shape,
        width_mm=width_mm,
        height_mm=height_mm,
        language=lang,
        content=content,
    )

    package = generate_label_package(spec)
    zip_bytes = build_label_zip_package(package)

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="label_package.zip"',
            "X-Api-Message": _api_message_header("api.labelGenerated", lang),
            "X-Label-Style": label_style.value,
            "X-Label-Shape": label_shape.value,
            "X-File-Count": str(count_label_files()),
        },
    )


@app.post("/apply-label-to-3d")
async def apply_label_to_3d(
    file: UploadFile = File(...),
    packaging_type: str = Form(...),
    label_png: Optional[UploadFile] = File(None),
    label_svg: Optional[str] = Form(None),
    uv_mode: Optional[str] = Form(None),
    texture_resolution: int = Form(1024),
    language: Optional[str] = Form(None),
):
    from packlab3d.backend.label_mapping.apply_label import apply_label_to_mesh
    from packlab3d.backend.label_mapping.bake_texture import bake_texture
    from packlab3d.backend.label_mapping.export_glb import export_to_glb, validate_glb
    from packlab3d.backend.label_mapping.uv import UVMode
    from packlab3d.core.utils.packaging import PackagingType

    lang = _resolve_language(language)

    try:
        packaging = PackagingType(packaging_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=get_message("errors.invalidPackagingType", lang))

    if uv_mode is not None:
        try:
            resolved_uv_mode = UVMode(uv_mode)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Unknown UV mode: {uv_mode}")
    else:
        if packaging.value == "bottle":
            resolved_uv_mode = UVMode.BOTTLE_BLEND
        else:
            resolved_uv_mode = UVMode.BOX

    if label_png is not None and label_png.filename:
        label_package = {"png": await label_png.read()}
    elif label_svg:
        label_package = {"svg": label_svg}
    else:
        raise HTTPException(
            status_code=400, detail="Either a label_png file or label_svg text must be provided."
        )

    mesh = _read_uploaded_mesh(file, lang)

    try:
        texture = bake_texture(label_package, target_size=(texture_resolution, texture_resolution))
    except ModelNotAvailableError:
        raise HTTPException(status_code=503, detail=get_message("errors.modelUnavailable", lang))

    result = apply_label_to_mesh(mesh, resolved_uv_mode, texture)
    glb_bytes = export_to_glb(result)
    validation = validate_glb(glb_bytes, expect_texture=True, expect_uv=True)

    return Response(
        content=glb_bytes,
        media_type="model/gltf-binary",
        headers={
            "Content-Disposition": 'attachment; filename="labeled_model.glb"',
            "X-Api-Message": _api_message_header("api.labelAppliedTo3D", lang),
            "X-UV-Mode": resolved_uv_mode.value,
            "X-Texture-Resolution": f"{texture_resolution}x{texture_resolution}",
            "X-File-Count": "1",
            "X-GLB-Valid": str(validation["valid"]).lower(),
            "X-GLB-Mesh-Count": str(validation["meshCount"]),
            "X-GLB-Node-Count": str(validation["nodeCount"]),
            "X-GLB-Texture-Count": str(validation["textureCount"]),
            "X-GLB-Has-UV": str(validation["hasUV"]).lower(),
        },
    )


@app.post("/export", response_model=StatusResponse)
def export(payload: LangOnlyRequest):
    _not_implemented(_resolve_language(payload.language))


def _main() -> None:
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser(description="PackLab 3D backend")
    parser.add_argument("--host", default=os.environ.get("PACKLAB_BACKEND_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("PACKLAB_BACKEND_PORT", "8000")))
    args = parser.parse_args()
    logger.info("Health endpoint available", extra={"host": args.host, "port": args.port})
    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    _main()
