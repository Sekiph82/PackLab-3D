import io

from PIL import Image

from packlab3d.core.utils.errors import ModelNotAvailableError


def bake_texture_from_png(png_bytes: bytes, target_size=(1024, 1024)) -> Image.Image:
    img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return img.resize(target_size, Image.LANCZOS)


def bake_texture_from_svg(svg_string: str, target_size=(1024, 1024)) -> Image.Image:
    """SVG rasterization fallback — gated.

    Both attempted rasterization paths on this system need the native libcairo
    library, which isn't installed on this Windows box (same gap as the
    Stage 6 CairoSVG path):
      - cairosvg -> cairocffi -> dlopen('libcairo-2.dll') fails
      - svglib + reportlab.renderPM -> rlPyCairo -> cairocffi -> same failure
    bake_texture_from_png() is the real, working default — Stage 6 always
    produces a PNG alongside the SVG, so this path is only hit if a caller
    supplies SVG-only label content.
    """
    raise ModelNotAvailableError(
        "SVG rasterization requires a native libcairo library not present on this "
        "system (tried cairosvg and reportlab/rlPyCairo, both blocked the same way). "
        "Install the GTK3 runtime (or any distribution shipping libcairo-2.dll) to "
        "enable this path, or supply a PNG label instead."
    )


def bake_texture(label_package: dict, target_size=(1024, 1024)) -> Image.Image:
    if label_package.get("png"):
        return bake_texture_from_png(label_package["png"], target_size)
    if label_package.get("svg"):
        return bake_texture_from_svg(label_package["svg"], target_size)
    raise ValueError("label_package must contain a non-empty 'png' or 'svg' key.")
