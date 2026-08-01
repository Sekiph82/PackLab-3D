import numpy as np
import pytest
from PIL import Image

from packlab3d.backend.label_engine.render import (
    LabelContent,
    LabelSpec,
    render_label_png,
    render_label_svg,
    render_svg_to_png_via_cairo,
)
from packlab3d.backend.label_engine.shapes import LabelShape
from packlab3d.backend.label_engine.styles import LabelStyle
from packlab3d.core.utils.errors import ModelNotAvailableError


def _hex_to_rgb(hex_color: str):
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def test_render_label_png_has_correct_pixel_size_at_300dpi():
    spec = LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, width_mm=80, height_mm=50, dpi=300)
    img = render_label_png(spec)
    assert img.mode == "RGBA"
    assert img.size == (round(80 * 300 / 25.4), round(50 * 300 / 25.4))


def test_render_label_png_background_matches_style():
    spec = LabelSpec(style=LabelStyle.ECO_GREEN, shape=LabelShape.RECTANGLE, width_mm=40, height_mm=40, dpi=150)
    img = render_label_png(spec)
    corner = img.getpixel((2, 2))
    assert corner[:3] == _hex_to_rgb("#F2FFF7")
    assert corner[3] == 255  # rectangle mask is fully opaque


def test_render_label_png_shape_clipping_sets_alpha():
    spec = LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.CIRCLE, width_mm=40, height_mm=40, dpi=150)
    img = render_label_png(spec)
    arr = np.array(img)
    h, w = arr.shape[:2]
    assert arr[h // 2, w // 2, 3] == 255  # center inside circle
    assert arr[0, 0, 3] == 0  # corner outside circle


def test_render_label_png_with_barcode_and_qr_does_not_crash():
    spec = LabelSpec(
        style=LabelStyle.INDUSTRIAL_TECH,
        shape=LabelShape.RECTANGLE,
        width_mm=80,
        height_mm=50,
        content=LabelContent(barcode_data="1234567890", qr_data="https://packlab3d.example/p/1"),
    )
    img = render_label_png(spec)
    assert isinstance(img, Image.Image)


def test_render_label_svg_multilanguage_ingredients_prefix():
    content = LabelContent(ingredients="Water, Salt")
    en_svg = render_label_svg(LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, language="en", content=content))
    tr_svg = render_label_svg(LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, language="tr", content=content))
    sw_svg = render_label_svg(LabelSpec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, language="sw", content=content))

    assert "Ingredients: Water, Salt" in en_svg
    assert "İçindekiler: Water, Salt" in tr_svg
    assert "Viungo: Water, Salt" in sw_svg


def test_render_label_svg_contains_brand_colors_and_clip_path():
    spec = LabelSpec(style=LabelStyle.BOLD_COLORFUL, shape=LabelShape.OVAL, content=LabelContent(brand_name="Acme"))
    svg = render_label_svg(spec)
    assert "<svg" in svg
    assert "#FF3366" in svg
    assert "clipPath" in svg
    assert "<ellipse" in svg


def test_render_label_svg_escapes_special_characters():
    spec = LabelSpec(
        style=LabelStyle.MINIMAL_MODERN,
        shape=LabelShape.RECTANGLE,
        content=LabelContent(product_name="Salt & <Pepper>"),
    )
    svg = render_label_svg(spec)
    assert "Salt &amp; &lt;Pepper&gt;" in svg
    assert "<Pepper>" not in svg


def test_render_label_svg_embeds_barcode_and_qr_as_base64():
    spec = LabelSpec(
        style=LabelStyle.MINIMAL_MODERN,
        shape=LabelShape.RECTANGLE,
        content=LabelContent(barcode_data="1234567890", qr_data="https://packlab3d.example"),
    )
    svg = render_label_svg(spec)
    assert svg.count("data:image/png;base64,") == 2


def test_render_svg_to_png_via_cairo_raises_without_native_lib():
    # cairosvg package is installed but libcairo isn't present on this system.
    with pytest.raises(ModelNotAvailableError):
        render_svg_to_png_via_cairo("<svg xmlns='http://www.w3.org/2000/svg'></svg>")
