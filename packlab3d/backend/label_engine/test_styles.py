import pytest

from packlab3d.backend.label_engine.styles import (
    LabelStyle,
    get_display_name,
    get_style_colors,
    validate_style,
)


@pytest.mark.parametrize(
    "style,expected",
    [
        (LabelStyle.MINIMAL_MODERN, {"background": "#FFFFFF", "primary": "#0057FF"}),
        (LabelStyle.PREMIUM_GOLD, {"background": "#1A1A1A", "primary": "#C9A86A"}),
        (LabelStyle.ECO_GREEN, {"background": "#F2FFF7", "primary": "#00D26A"}),
        (LabelStyle.INDUSTRIAL_TECH, {"background": "#DDE3EA", "primary": "#3A4A5A"}),
        (LabelStyle.BOLD_COLORFUL, {"background": "#FFFFFF", "primary": "#FF3366"}),
    ],
)
def test_style_colors_match_brand_identity(style, expected):
    colors = get_style_colors(style)
    assert colors.background == expected["background"]
    assert colors.primary == expected["primary"]


def test_bold_colorful_has_three_accents():
    colors = get_style_colors(LabelStyle.BOLD_COLORFUL)
    assert colors.primary == "#FF3366"
    assert colors.accent2 == "#00C2FF"
    assert colors.accent3 == "#FFB800"


@pytest.mark.parametrize(
    "style,name",
    [
        (LabelStyle.MINIMAL_MODERN, "Minimal Modern"),
        (LabelStyle.PREMIUM_GOLD, "Premium Gold"),
        (LabelStyle.ECO_GREEN, "Eco Green"),
        (LabelStyle.INDUSTRIAL_TECH, "Industrial Tech"),
        (LabelStyle.BOLD_COLORFUL, "Bold Colorful"),
    ],
)
def test_display_names_are_untranslated_brand_names(style, name):
    assert get_display_name(style) == name
    assert get_display_name(style.value) == name


def test_validate_style():
    for style in LabelStyle:
        assert validate_style(style.value) is True
    assert validate_style("neon_wave") is False


def test_get_style_colors_rejects_unknown():
    with pytest.raises(ValueError):
        get_style_colors("neon_wave")


def test_get_display_name_rejects_unknown():
    with pytest.raises(ValueError):
        get_display_name("neon_wave")
