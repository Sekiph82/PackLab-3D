import io

import pytest
from PIL import Image

from packlab3d.backend.label_mapping.bake_texture import bake_texture, bake_texture_from_png
from packlab3d.core.utils.errors import ModelNotAvailableError


def _png_bytes(size=(200, 100), color=(0, 87, 255)):
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


def test_bake_texture_from_png_resizes_to_target():
    img = bake_texture_from_png(_png_bytes(), target_size=(512, 512))
    assert img.size == (512, 512)
    assert img.mode == "RGBA"


def test_bake_texture_from_png_preserves_content():
    img = bake_texture_from_png(_png_bytes(color=(0, 87, 255)), target_size=(64, 64))
    r, g, b, a = img.getpixel((32, 32))
    assert (r, g, b) == (0, 87, 255)
    assert a == 255


def test_bake_texture_dispatches_to_png():
    img = bake_texture({"png": _png_bytes()}, target_size=(256, 256))
    assert img.size == (256, 256)


def test_bake_texture_svg_only_raises_model_unavailable():
    with pytest.raises(ModelNotAvailableError):
        bake_texture({"svg": "<svg xmlns='http://www.w3.org/2000/svg'></svg>"})


def test_bake_texture_requires_png_or_svg():
    with pytest.raises(ValueError):
        bake_texture({})
