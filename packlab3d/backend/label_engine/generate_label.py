import io
import json
import zipfile

from packlab3d.backend.label_engine.render import LabelSpec, render_label_png, render_label_svg
from packlab3d.backend.label_engine.shapes import LabelShape
from packlab3d.backend.label_engine.styles import LabelStyle, get_display_name


def generate_label_package(spec: LabelSpec) -> dict:
    png_img = render_label_png(spec)
    svg_str = render_label_svg(spec)

    buf = io.BytesIO()
    png_img.save(buf, format="PNG", dpi=(spec.dpi, spec.dpi))

    style = spec.style.value if isinstance(spec.style, LabelStyle) else LabelStyle(spec.style).value
    shape = spec.shape.value if isinstance(spec.shape, LabelShape) else LabelShape(spec.shape).value

    metadata = {
        "style": style,
        "style_display_name": get_display_name(spec.style),
        "shape": shape,
        "width_mm": spec.width_mm,
        "height_mm": spec.height_mm,
        "dpi": spec.dpi,
        "language": spec.language,
        "material": spec.content.material,
    }
    return {"png": buf.getvalue(), "svg": svg_str, "metadata": metadata}


def build_zip_package(package: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("label.png", package["png"])
        zf.writestr("label.svg", package["svg"])
        zf.writestr("metadata.json", json.dumps(package["metadata"], indent=2))
    return buf.getvalue()


def count_files() -> int:
    return 3  # label.png, label.svg, metadata.json
