import pytest

from packlab3d.backend.wall_thickness.rules import (
    MATERIAL_PROPERTIES,
    get_default_material,
    get_default_wall_thickness_mm,
    get_material_properties,
    get_wall_thickness_range,
    select_material,
    validate_material,
    validate_wall_thickness_mm,
)
from packlab3d.core.utils.packaging import Material, PackagingType


@pytest.mark.parametrize(
    "packaging_type,expected_range",
    [
        (PackagingType.BOTTLE, (0.8, 1.2)),
        (PackagingType.BOX, (1.2, 2.0)),
        (PackagingType.SACHET, (0.1, 0.2)),
        (PackagingType.JERRYCAN, (2.0, 3.5)),
    ],
)
def test_wall_thickness_ranges_match_tasks_md(packaging_type, expected_range):
    assert get_wall_thickness_range(packaging_type) == expected_range
    assert get_wall_thickness_range(packaging_type.value) == expected_range


def test_get_default_wall_thickness_is_range_midpoint():
    assert get_default_wall_thickness_mm(PackagingType.BOTTLE) == pytest.approx(1.0)
    assert get_default_wall_thickness_mm(PackagingType.SACHET) == pytest.approx(0.15)


def test_validate_wall_thickness_mm():
    assert validate_wall_thickness_mm(PackagingType.BOTTLE, 1.0) is True
    assert validate_wall_thickness_mm(PackagingType.BOTTLE, 0.5) is False
    assert validate_wall_thickness_mm(PackagingType.JERRYCAN, 3.0) is True
    assert validate_wall_thickness_mm(PackagingType.JERRYCAN, 5.0) is False


def test_get_wall_thickness_range_rejects_unknown_type():
    with pytest.raises(ValueError):
        get_wall_thickness_range("drum")


@pytest.mark.parametrize(
    "packaging_type,expected_material",
    [
        (PackagingType.BOTTLE, Material.PET),
        (PackagingType.BOX, Material.PP),
        (PackagingType.SACHET, Material.LDPE),
        (PackagingType.JERRYCAN, Material.HDPE),
    ],
)
def test_default_material_by_packaging_type(packaging_type, expected_material):
    assert get_default_material(packaging_type) == expected_material


def test_get_default_material_rejects_unknown_type():
    with pytest.raises(ValueError):
        get_default_material("drum")


def test_validate_material():
    for material in Material:
        assert validate_material(material.value) is True
    assert validate_material("ABS") is False


def test_all_materials_have_properties():
    for material in Material:
        assert material in MATERIAL_PROPERTIES
        props = get_material_properties(material.value)
        assert props.density_g_cm3 > 0
        assert 1 <= props.relative_stiffness <= 5


def test_get_material_properties_rejects_unknown_material():
    with pytest.raises(ValueError):
        get_material_properties("ABS")


def test_select_material_default():
    assert select_material(PackagingType.BOTTLE) == Material.PET


def test_select_material_valid_override():
    assert select_material(PackagingType.BOTTLE, override="HDPE") == Material.HDPE


def test_select_material_invalid_override_raises():
    with pytest.raises(ValueError):
        select_material(PackagingType.BOTTLE, override="ABS")
