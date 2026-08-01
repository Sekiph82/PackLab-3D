import base64
import io
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

from PIL import Image, ImageDraw, ImageFont

from packlab3d.backend.label_engine.shapes import LabelShape, get_shape_mask, get_shape_svg_clip_path
from packlab3d.backend.label_engine.styles import LabelStyle, WARNING_COLOR, get_style_colors
from packlab3d.core.utils.errors import ModelNotAvailableError

VALID_SYMBOLS = ("recycle", "ce", "food_safe", "hazard")
_SYMBOL_GLYPH = {"recycle": "\u267B", "ce": "CE", "food_safe": "FS", "hazard": "!"}

_FONT_CANDIDATES = {
    False: ["C:/Windows/Fonts/segoeui.ttf", "C:/Windows/Fonts/arial.ttf"],
    True: ["C:/Windows/Fonts/segoeuib.ttf", "C:/Windows/Fonts/arialbd.ttf"],
}


@dataclass
class LabelContent:
    brand_name: Optional[str] = None
    product_name: Optional[str] = None
    ingredients: Optional[str] = None
    warnings: Optional[str] = None
    volume_ml: Optional[float] = None
    material: Optional[str] = None
    symbols: List[str] = field(default_factory=list)
    barcode_data: Optional[str] = None
    qr_data: Optional[str] = None
    custom_text_blocks: List[str] = field(default_factory=list)
    logo: Optional[Image.Image] = None


@dataclass
class LabelSpec:
    style: LabelStyle
    shape: LabelShape
    width_mm: float = 80.0
    height_mm: float = 50.0
    language: str = "en"
    dpi: int = 300
    content: LabelContent = field(default_factory=LabelContent)


def _frontend_i18n_dir() -> Path:
    return Path(__file__).resolve().parents[2] / "frontend" / "i18n"


def load_frontend_labels(lang: str) -> dict:
    path = _frontend_i18n_dir() / f"{lang}.json"
    if not path.exists():
        path = _frontend_i18n_dir() / "en.json"
    return json.loads(path.read_text(encoding="utf-8"))


def _get_font(size_px: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for candidate in _FONT_CANDIDATES[bold]:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size_px)
    return ImageFont.load_default()


def _generate_barcode_image(data: str) -> Image.Image:
    from barcode import Code128
    from barcode.writer import ImageWriter

    code = Code128(data, writer=ImageWriter())
    buf = io.BytesIO()
    code.write(buf, options={"write_text": False})
    buf.seek(0)
    return Image.open(buf).convert("RGBA")


def _generate_qr_image(data: str) -> Image.Image:
    import qrcode

    return qrcode.make(data).convert("RGBA")


def render_label_png(spec: LabelSpec) -> Image.Image:
    """Renders the label at spec.dpi (default 300) using Pillow.

    Layout is a fixed vertical stack with mm-based padding/spacing — there is no
    dynamic font-scaling or overflow detection in this version; content that
    exceeds the label height is simply clipped by the canvas/shape mask.
    Brand typefaces (Inter/Manrope/Space Grotesk/...) aren't bundled with the
    logo pack, so a neutral system sans-serif (Segoe UI, falling back to Arial)
    substitutes for them.
    """
    mm_to_px = spec.dpi / 25.4
    width_px = round(spec.width_mm * mm_to_px)
    height_px = round(spec.height_mm * mm_to_px)

    colors = get_style_colors(spec.style)
    img = Image.new("RGBA", (width_px, height_px), colors.background)
    draw = ImageDraw.Draw(img)

    labels = load_frontend_labels(spec.language)
    content_labels = labels["label"]["content"]
    material_labels = labels["form"]["materials"]

    padding = round(4 * mm_to_px)
    y = padding
    c = spec.content

    if c.logo is not None:
        logo_h = round(12 * mm_to_px)
        ratio = logo_h / c.logo.height
        logo_w = round(c.logo.width * ratio)
        logo_resized = c.logo.convert("RGBA").resize((logo_w, logo_h))
        img.paste(logo_resized, (round((width_px - logo_w) / 2), y), logo_resized)
        y += logo_h + round(2 * mm_to_px)

    if c.brand_name:
        font = _get_font(round(6 * mm_to_px), bold=True)
        draw.text((width_px / 2, y), c.brand_name, font=font, fill=colors.primary, anchor="ma")
        y += round(7 * mm_to_px)

    if c.product_name:
        font = _get_font(round(4.5 * mm_to_px), bold=True)
        draw.text((width_px / 2, y), c.product_name, font=font, fill=colors.text, anchor="ma")
        y += round(5.5 * mm_to_px)

    vol_mat_parts = []
    if c.volume_ml is not None:
        vol_mat_parts.append(f"{c.volume_ml:g} mL")
    if c.material:
        vol_mat_parts.append(material_labels.get(c.material, c.material))
    if vol_mat_parts:
        font = _get_font(round(3.2 * mm_to_px))
        draw.text((width_px / 2, y), " \u00b7 ".join(vol_mat_parts), font=font, fill=colors.text, anchor="ma")
        y += round(4 * mm_to_px)

    font_custom = _get_font(round(3 * mm_to_px))
    for block in c.custom_text_blocks:
        draw.text((width_px / 2, y), block, font=font_custom, fill=colors.text, anchor="ma")
        y += round(3.8 * mm_to_px)

    if c.ingredients:
        prefix = content_labels.get("ingredients", "Ingredients")
        font = _get_font(round(2.6 * mm_to_px))
        draw.text((padding, y), f"{prefix}: {c.ingredients}", font=font, fill=colors.text)
        y += round(3.2 * mm_to_px)

    if c.warnings:
        prefix = content_labels.get("warnings", "Warnings")
        font = _get_font(round(2.6 * mm_to_px), bold=True)
        draw.text((padding, y), f"{prefix}: {c.warnings}", font=font, fill=WARNING_COLOR)
        y += round(3.5 * mm_to_px)

    if c.symbols:
        badge_size = round(6 * mm_to_px)
        gap = round(1.5 * mm_to_px)
        total_w = len(c.symbols) * (badge_size + gap) - gap
        bx = round((width_px - total_w) / 2)
        by = height_px - padding - badge_size - round(10 * mm_to_px)
        font_badge = _get_font(round(2.6 * mm_to_px))
        for sym in c.symbols:
            draw.ellipse(
                [bx, by, bx + badge_size, by + badge_size],
                outline=colors.primary,
                width=max(1, round(0.3 * mm_to_px)),
            )
            draw.text(
                (bx + badge_size / 2, by + badge_size / 2),
                _SYMBOL_GLYPH.get(sym, "?"),
                font=font_badge,
                fill=colors.primary,
                anchor="mm",
            )
            bx += badge_size + gap

    bottom_y = height_px - padding
    if c.barcode_data:
        barcode_img = _generate_barcode_image(c.barcode_data)
        target_h = round(8 * mm_to_px)
        ratio = target_h / barcode_img.height
        target_w = round(barcode_img.width * ratio)
        barcode_img = barcode_img.resize((target_w, target_h))
        bx = padding if c.qr_data else round((width_px - target_w) / 2)
        img.paste(barcode_img, (bx, bottom_y - target_h))

    if c.qr_data:
        qr_img = _generate_qr_image(c.qr_data)
        target_size = round(10 * mm_to_px)
        qr_img = qr_img.resize((target_size, target_size))
        img.paste(qr_img, (width_px - padding - target_size, bottom_y - target_size))

    mask = get_shape_mask(spec.shape, width_px, height_px)
    img.putalpha(mask)
    return img


def _image_to_base64_png(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def render_label_svg(spec: LabelSpec) -> str:
    """Hand-written SVG (mm units) mirroring render_label_png's layout.

    Barcode/QR are embedded as base64 PNG <image> elements — the document
    itself is a valid vector SVG; those two sub-elements are raster within it.
    """
    colors = get_style_colors(spec.style)
    labels = load_frontend_labels(spec.language)
    content_labels = labels["label"]["content"]
    material_labels = labels["form"]["materials"]

    padding = 4.0
    y = padding
    c = spec.content
    elements = []

    clip_id, clip_def = get_shape_svg_clip_path(spec.shape, spec.width_mm, spec.height_mm)

    if c.logo is not None:
        logo_h = 12.0
        ratio = logo_h / c.logo.height
        logo_w = c.logo.width * ratio
        b64 = _image_to_base64_png(c.logo.convert("RGBA"))
        lx = (spec.width_mm - logo_w) / 2
        elements.append(
            f'<image x="{lx:.2f}" y="{y:.2f}" width="{logo_w:.2f}" height="{logo_h:.2f}" '
            f'href="data:image/png;base64,{b64}"/>'
        )
        y += logo_h + 2

    if c.brand_name:
        y += 6
        elements.append(
            f'<text x="{spec.width_mm/2:.2f}" y="{y:.2f}" font-size="6" font-weight="bold" '
            f'text-anchor="middle" fill="{colors.primary}">{_esc(c.brand_name)}</text>'
        )
        y += 1

    if c.product_name:
        y += 4.5
        elements.append(
            f'<text x="{spec.width_mm/2:.2f}" y="{y:.2f}" font-size="4.5" font-weight="bold" '
            f'text-anchor="middle" fill="{colors.text}">{_esc(c.product_name)}</text>'
        )
        y += 1

    vol_mat_parts = []
    if c.volume_ml is not None:
        vol_mat_parts.append(f"{c.volume_ml:g} mL")
    if c.material:
        vol_mat_parts.append(material_labels.get(c.material, c.material))
    if vol_mat_parts:
        y += 3.2
        text = " \u00b7 ".join(vol_mat_parts)
        elements.append(
            f'<text x="{spec.width_mm/2:.2f}" y="{y:.2f}" font-size="3.2" '
            f'text-anchor="middle" fill="{colors.text}">{_esc(text)}</text>'
        )
        y += 1

    for block in c.custom_text_blocks:
        y += 3.0
        elements.append(
            f'<text x="{spec.width_mm/2:.2f}" y="{y:.2f}" font-size="3" '
            f'text-anchor="middle" fill="{colors.text}">{_esc(block)}</text>'
        )
        y += 0.8

    if c.ingredients:
        prefix = content_labels.get("ingredients", "Ingredients")
        y += 2.6
        elements.append(
            f'<text x="{padding:.2f}" y="{y:.2f}" font-size="2.6" fill="{colors.text}">'
            f"{_esc(prefix)}: {_esc(c.ingredients)}</text>"
        )
        y += 0.6

    if c.warnings:
        prefix = content_labels.get("warnings", "Warnings")
        y += 2.6
        elements.append(
            f'<text x="{padding:.2f}" y="{y:.2f}" font-size="2.6" font-weight="bold" '
            f'fill="{WARNING_COLOR}">{_esc(prefix)}: {_esc(c.warnings)}</text>'
        )
        y += 0.9

    if c.symbols:
        badge = 6.0
        gap = 1.5
        total_w = len(c.symbols) * (badge + gap) - gap
        bx = (spec.width_mm - total_w) / 2
        by = spec.height_mm - padding - badge - 10
        for sym in c.symbols:
            cx, cy = bx + badge / 2, by + badge / 2
            elements.append(
                f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{badge/2:.2f}" fill="none" '
                f'stroke="{colors.primary}" stroke-width="0.3"/>'
            )
            elements.append(
                f'<text x="{cx:.2f}" y="{cy:.2f}" font-size="2.6" text-anchor="middle" '
                f'dominant-baseline="middle" fill="{colors.primary}">{_esc(_SYMBOL_GLYPH.get(sym, "?"))}</text>'
            )
            bx += badge + gap

    bottom_y = spec.height_mm - padding
    if c.barcode_data:
        barcode_img = _generate_barcode_image(c.barcode_data)
        target_h = 8.0
        target_w = barcode_img.width * (target_h / barcode_img.height)
        bx = padding if c.qr_data else (spec.width_mm - target_w) / 2
        b64 = _image_to_base64_png(barcode_img)
        elements.append(
            f'<image x="{bx:.2f}" y="{bottom_y - target_h:.2f}" width="{target_w:.2f}" '
            f'height="{target_h:.2f}" href="data:image/png;base64,{b64}"/>'
        )

    if c.qr_data:
        qr_img = _generate_qr_image(c.qr_data)
        target_size = 10.0
        b64 = _image_to_base64_png(qr_img)
        qx = spec.width_mm - padding - target_size
        elements.append(
            f'<image x="{qx:.2f}" y="{bottom_y - target_size:.2f}" width="{target_size:.2f}" '
            f'height="{target_size:.2f}" href="data:image/png;base64,{b64}"/>'
        )

    body = "\n  ".join(elements)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{spec.width_mm:.2f}mm" height="{spec.height_mm:.2f}mm" viewBox="0 0 {spec.width_mm:.2f} {spec.height_mm:.2f}">
  <defs>{clip_def}</defs>
  <g clip-path="url(#{clip_id})">
  <rect x="0" y="0" width="{spec.width_mm:.2f}" height="{spec.height_mm:.2f}" fill="{colors.background}"/>
  {body}
  </g>
</svg>
'''


def _esc(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_svg_to_png_via_cairo(svg_string: str, output_width_px: Optional[int] = None) -> bytes:
    """Optional SVG->PNG rasterization path for pixel-parity checks.

    Not required for the label package (render_label_png already produces the
    PNG directly via Pillow) — this exists only as an alternate path.
    """
    try:
        import cairosvg
    except ImportError as exc:
        raise ModelNotAvailableError(
            "cairosvg is not installed. pip install cairosvg"
        ) from exc
    except OSError as exc:
        # cairocffi tries to dlopen the native libcairo library at import time,
        # not at call time — missing it fails the import itself, not svg2png().
        raise ModelNotAvailableError(
            "cairosvg is installed but its native libcairo library isn't available on "
            "this system (Windows needs the GTK3 runtime or cairo DLLs on PATH). "
            "render_label_png() (Pillow) is the working default PNG path — this is only "
            "an optional SVG-to-PNG parity check."
        ) from exc

    try:
        return cairosvg.svg2png(bytestring=svg_string.encode("utf-8"), output_width=output_width_px)
    except OSError as exc:
        raise ModelNotAvailableError(
            "cairosvg's native libcairo library failed during rendering."
        ) from exc
