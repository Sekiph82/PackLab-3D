from dataclasses import dataclass

import numpy as np
from PIL import Image, ImageChops, ImageFilter, ImageStat


@dataclass
class SegmentationResult:
    mask: np.ndarray
    foreground: Image.Image


def segment_image(
    image: Image.Image,
) -> SegmentationResult:
    """Estimate the primary foreground using bounded native image analysis."""
    image_rgb = image.convert("RGB")
    background = Image.new("RGB", image_rgb.size, tuple(int(value) for value in ImageStat.Stat(image_rgb).median[:3]))
    difference = ImageChops.difference(image_rgb, background).convert("L")
    candidate = difference.point(lambda pixel: 255 if pixel > 18 else 0)
    cleaned = candidate.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(3))
    if cleaned.getbbox() is None:
        cleaned = Image.new("L", image_rgb.size, 255)
    mask = np.asarray(cleaned, dtype=np.uint8) > 0
    foreground = _apply_mask_alpha(image_rgb, mask)
    return SegmentationResult(mask=mask, foreground=foreground)


def remove_background(
    image: Image.Image,
) -> Image.Image:
    return segment_image(image).foreground


def _apply_mask_alpha(image_rgb: Image.Image, mask: np.ndarray) -> Image.Image:
    rgba_np = np.array(image_rgb.convert("RGBA"))
    rgba_np[:, :, 3] = mask.astype(np.uint8) * 255
    return Image.fromarray(rgba_np, mode="RGBA")
