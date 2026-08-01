import enum
import io
import json
import zipfile
from typing import Optional

from packlab3d.backend.cad_drawings.freecad_views import generate_freecad_views
from packlab3d.backend.cad_drawings.mesh_projection import (
    VIEWS,
    get_view_dimensions,
    project_silhouette,
    render_view_dxf,
    render_view_svg,
)
from packlab3d.backend.cad_drawings.occ_solid import convert_mesh_to_solid
from packlab3d.backend.mesh_scaling.scaling import estimated_volume_ml, get_bounding_size


class CadBackend(str, enum.Enum):
    MESH_PROJECTION = "mesh_projection"
    FREECAD = "freecad"
    OCC = "occ"


def generate_technical_drawing_package(
    mesh,
    backend: CadBackend = CadBackend.MESH_PROJECTION,
    material: Optional[str] = None,
    wall_thickness_mm: Optional[float] = None,
) -> dict:
    if backend == CadBackend.FREECAD:
        generate_freecad_views(mesh_path="", output_dir="")  # raises ModelNotAvailableError
    if backend == CadBackend.OCC:
        convert_mesh_to_solid(mesh_path="")  # raises ModelNotAvailableError
    if backend != CadBackend.MESH_PROJECTION:
        raise ValueError(f"Unknown CAD backend: {backend}")

    views = {}
    for view in VIEWS:
        hull = project_silhouette(mesh, view)
        dim_x, dim_y = get_view_dimensions(mesh, view)
        label = f"{view.capitalize()} View"
        views[view] = {
            "svg": render_view_svg(hull, dim_x, dim_y, label),
            "dxf": render_view_dxf(hull, dim_x, dim_y, label),
            "width_mm": dim_x,
            "height_mm": dim_y,
        }

    solid = {
        "step": None,
        "iges": None,
        "skipped_reason": (
            "OpenCascade (pythonocc-core) not installed; STEP/IGES export requires it."
        ),
    }

    bbox = get_bounding_size(mesh)
    metadata = {
        "bounding_box_mm": [round(float(v), 3) for v in bbox],
        "volume_ml": estimated_volume_ml(mesh),
        "material": material,
        "wall_thickness_mm": wall_thickness_mm,
    }

    return {"views": views, "solid": solid, "metadata": metadata}


def build_zip_package(package: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for view_name, data in package["views"].items():
            zf.writestr(f"{view_name}.svg", data["svg"])
            zf.writestr(f"{view_name}.dxf", data["dxf"])
        if package["solid"].get("step"):
            zf.writestr("solid.step", package["solid"]["step"])
        if package["solid"].get("iges"):
            zf.writestr("solid.iges", package["solid"]["iges"])
        zf.writestr("metadata.json", json.dumps(package["metadata"], indent=2))
    return buf.getvalue()


def count_files(package: dict) -> int:
    count = len(package["views"]) * 2 + 1  # svg+dxf per view, + metadata.json
    if package["solid"].get("step"):
        count += 1
    if package["solid"].get("iges"):
        count += 1
    return count
