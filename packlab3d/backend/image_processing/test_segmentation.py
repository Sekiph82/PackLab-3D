import numpy as np
from PIL import Image, ImageDraw

from packlab3d.backend.image_processing.segmentation import remove_background, segment_image


def test_native_segmentation_returns_mask_and_alpha_without_external_runtime():
    image = Image.new("RGB", (64, 48), "white")
    ImageDraw.Draw(image).rectangle((16, 8, 48, 40), fill=(10, 20, 30))

    result = segment_image(image)

    assert result.mask.shape == (48, 64)
    assert result.mask.dtype == np.bool_
    assert result.foreground.size == (64, 48)
    assert result.foreground.mode == "RGBA"
    alpha = np.asarray(result.foreground)[:, :, 3]
    assert alpha[24, 32] == 255


def test_native_segmentation_falls_back_to_full_mask_for_uniform_image():
    result = segment_image(Image.new("RGB", (8, 8), (10, 20, 30)))
    assert bool(result.mask.all())


def test_remove_background_returns_rgba():
    assert remove_background(Image.new("RGB", (16, 16))).mode == "RGBA"
