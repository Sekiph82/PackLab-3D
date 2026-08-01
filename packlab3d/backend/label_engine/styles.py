import enum
from dataclasses import dataclass
from typing import Optional


class LabelStyle(str, enum.Enum):
    """Brand-defined label styles. Names are brand identifiers — never translated."""

    MINIMAL_MODERN = "minimal_modern"
    PREMIUM_GOLD = "premium_gold"
    ECO_GREEN = "eco_green"
    INDUSTRIAL_TECH = "industrial_tech"
    BOLD_COLORFUL = "bold_colorful"


DISPLAY_NAMES = {
    LabelStyle.MINIMAL_MODERN: "Minimal Modern",
    LabelStyle.PREMIUM_GOLD: "Premium Gold",
    LabelStyle.ECO_GREEN: "Eco Green",
    LabelStyle.INDUSTRIAL_TECH: "Industrial Tech",
    LabelStyle.BOLD_COLORFUL: "Bold Colorful",
}


@dataclass(frozen=True)
class StyleColors:
    background: str
    primary: str
    text: str
    accent2: Optional[str] = None
    accent3: Optional[str] = None


# Exact hex values from PackLab3D_BrandIdentity.md section 2 ("Label Design Engine
# Themes") — do not alter or invent new colors here.
STYLE_COLORS = {
    LabelStyle.MINIMAL_MODERN: StyleColors(background="#FFFFFF", primary="#0057FF", text="#0A0A0A"),
    LabelStyle.PREMIUM_GOLD: StyleColors(background="#1A1A1A", primary="#C9A86A", text="#C9A86A"),
    LabelStyle.ECO_GREEN: StyleColors(background="#F2FFF7", primary="#00D26A", text="#0A0A0A"),
    LabelStyle.INDUSTRIAL_TECH: StyleColors(background="#DDE3EA", primary="#3A4A5A", text="#3A4A5A"),
    LabelStyle.BOLD_COLORFUL: StyleColors(
        background="#FFFFFF", primary="#FF3366", accent2="#00C2FF", accent3="#FFB800", text="#0A0A0A"
    ),
}

# Semantic brand color for warnings, per BrandIdentity.md's stated meaning for
# Amber ("Warning, label symbols") — applied regardless of the active style.
WARNING_COLOR = "#FFB800"


def get_style_colors(style) -> StyleColors:
    try:
        return STYLE_COLORS[LabelStyle(style)]
    except ValueError as exc:
        raise ValueError(f"Unknown label style: {style}") from exc


def get_display_name(style) -> str:
    try:
        return DISPLAY_NAMES[LabelStyle(style)]
    except ValueError as exc:
        raise ValueError(f"Unknown label style: {style}") from exc


def validate_style(style) -> bool:
    try:
        LabelStyle(style)
        return True
    except ValueError:
        return False
