import enum
import uuid

from PIL import Image, ImageDraw

# tasks.md 4.7 defines rectangle/oval/wrap-around/sachet/cap; Stage 6's instructions
# add square/circle. Union of both, nothing dropped from either source.


class LabelShape(str, enum.Enum):
    RECTANGLE = "rectangle"
    SQUARE = "square"
    CIRCLE = "circle"
    OVAL = "oval"
    WRAP_AROUND = "wrap_around"
    SACHET_LABEL = "sachet_label"
    CAP_LABEL = "cap_label"


_RECTANGULAR = {LabelShape.RECTANGLE, LabelShape.SQUARE, LabelShape.WRAP_AROUND, LabelShape.SACHET_LABEL}
_ELLIPTICAL = {LabelShape.CIRCLE, LabelShape.OVAL, LabelShape.CAP_LABEL}


def validate_shape(shape) -> bool:
    try:
        LabelShape(shape)
        return True
    except ValueError:
        return False


def get_shape_mask(shape, width_px: int, height_px: int) -> Image.Image:
    """Returns an 'L' mode mask (255 = inside label, 0 = outside)."""
    shape = LabelShape(shape)
    mask = Image.new("L", (width_px, height_px), 0)
    draw = ImageDraw.Draw(mask)
    if shape in _RECTANGULAR:
        draw.rectangle([0, 0, width_px - 1, height_px - 1], fill=255)
    elif shape in _ELLIPTICAL:
        draw.ellipse([0, 0, width_px - 1, height_px - 1], fill=255)
    else:
        raise ValueError(f"Unknown shape: {shape}")
    return mask


def get_shape_svg_clip_path(shape, width_mm: float, height_mm: float, clip_id: str = None) -> str:
    shape = LabelShape(shape)
    clip_id = clip_id or f"labelClip-{uuid.uuid4().hex[:8]}"
    if shape in _RECTANGULAR:
        body = f'<rect x="0" y="0" width="{width_mm:.2f}" height="{height_mm:.2f}"/>'
    elif shape in _ELLIPTICAL:
        cx, cy = width_mm / 2, height_mm / 2
        body = f'<ellipse cx="{cx:.2f}" cy="{cy:.2f}" rx="{cx:.2f}" ry="{cy:.2f}"/>'
    else:
        raise ValueError(f"Unknown shape: {shape}")
    return clip_id, f'<clipPath id="{clip_id}">{body}</clipPath>'
