import numpy as np
import pytest

from packlab3d.backend.label_engine.shapes import (
    LabelShape,
    get_shape_mask,
    get_shape_svg_clip_path,
    validate_shape,
)


def test_validate_shape():
    for shape in LabelShape:
        assert validate_shape(shape.value) is True
    assert validate_shape("hexagon") is False


@pytest.mark.parametrize("shape", [LabelShape.RECTANGLE, LabelShape.SQUARE, LabelShape.WRAP_AROUND, LabelShape.SACHET_LABEL])
def test_rectangular_masks_are_fully_opaque(shape):
    mask = get_shape_mask(shape, 100, 60)
    arr = np.array(mask)
    assert arr.min() == 255
    assert arr.shape == (60, 100)


@pytest.mark.parametrize("shape", [LabelShape.CIRCLE, LabelShape.OVAL, LabelShape.CAP_LABEL])
def test_elliptical_masks_clip_corners(shape):
    mask = get_shape_mask(shape, 100, 100)
    arr = np.array(mask)
    assert arr[50, 50] == 255  # center inside
    assert arr[0, 0] == 0  # corner outside the inscribed ellipse


def test_get_shape_mask_rejects_unknown_shape():
    with pytest.raises(ValueError):
        get_shape_mask("hexagon", 10, 10)


def test_get_shape_svg_clip_path_rectangular():
    clip_id, svg = get_shape_svg_clip_path(LabelShape.RECTANGLE, 80, 50)
    assert clip_id in svg
    assert "<rect" in svg
    assert 'width="80.00"' in svg
    assert 'height="50.00"' in svg


def test_get_shape_svg_clip_path_elliptical():
    clip_id, svg = get_shape_svg_clip_path(LabelShape.CIRCLE, 40, 40)
    assert clip_id in svg
    assert "<ellipse" in svg


def test_get_shape_svg_clip_path_generates_unique_ids():
    id1, _ = get_shape_svg_clip_path(LabelShape.OVAL, 50, 30)
    id2, _ = get_shape_svg_clip_path(LabelShape.OVAL, 50, 30)
    assert id1 != id2


def test_get_shape_svg_clip_path_rejects_unknown_shape():
    with pytest.raises(ValueError):
        get_shape_svg_clip_path("hexagon", 10, 10)
