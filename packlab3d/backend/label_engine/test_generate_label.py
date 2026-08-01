import zipfile
from io import BytesIO

import pytest
from PIL import Image

from packlab3d.backend.label_engine.generate_label import (
    build_zip_package,
    count_files,
    generate_label_package,
)
from packlab3d.backend.label_engine.render import LabelContent, LabelSpec
from packlab3d.backend.label_engine.shapes import LabelShape
from packlab3d.backend.label_engine.styles import LabelStyle


def _full_spec(style=LabelStyle.MINIMAL_MODERN, shape=LabelShape.RECTANGLE, language="en"):
    return LabelSpec(
        style=style,
        shape=shape,
        width_mm=80,
        height_mm=50,
        language=language,
        content=LabelContent(
            brand_name="Acme",
            product_name="Sparkling Water",
            ingredients="Water, CO2",
            warnings="Keep refrigerated",
            volume_ml=500,
            material="PET",
            symbols=["recycle", "ce"],
            custom_text_blocks=["Made in Kenya"],
            barcode_data="1234567890",
            qr_data="https://packlab3d.example/p/1",
        ),
    )


def test_generate_label_package_structure():
    package = generate_label_package(_full_spec())
    assert package["png"].startswith(b"\x89PNG\r\n\x1a\n")
    assert package["svg"].strip().startswith("<svg")
    assert package["metadata"]["style"] == "minimal_modern"
    assert package["metadata"]["style_display_name"] == "Minimal Modern"
    assert package["metadata"]["shape"] == "rectangle"
    assert package["metadata"]["width_mm"] == 80
    assert package["metadata"]["height_mm"] == 50
    assert package["metadata"]["dpi"] == 300
    assert package["metadata"]["language"] == "en"
    assert package["metadata"]["material"] == "PET"


def test_generate_label_package_png_is_openable_and_correct_size():
    package = generate_label_package(_full_spec())
    img = Image.open(BytesIO(package["png"]))
    img.load()
    assert img.size == (round(80 * 300 / 25.4), round(50 * 300 / 25.4))


def test_build_zip_package_contains_expected_files():
    package = generate_label_package(_full_spec())
    zip_bytes = build_zip_package(package)
    with zipfile.ZipFile(BytesIO(zip_bytes)) as zf:
        names = set(zf.namelist())
        assert names == {"label.png", "label.svg", "metadata.json"}
        assert len(zf.read("label.png")) > 0
        assert len(zf.read("label.svg")) > 0
        assert count_files() == len(zf.namelist())


@pytest.mark.parametrize("style", list(LabelStyle))
@pytest.mark.parametrize("shape", list(LabelShape))
def test_all_style_shape_combinations_render_without_error(style, shape):
    package = generate_label_package(_full_spec(style=style, shape=shape))
    assert len(package["png"]) > 0
    assert package["svg"].strip().startswith("<svg")


@pytest.mark.parametrize("language", ["en", "tr", "sw"])
def test_generate_label_package_all_languages(language):
    package = generate_label_package(_full_spec(language=language))
    assert package["metadata"]["language"] == language
    assert len(package["png"]) > 0
