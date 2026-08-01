from dataclasses import dataclass
from typing import Optional, Tuple

from packlab3d.core.utils.packaging import Material, PackagingType

# tasks.md 4.4 — automatic wall thickness by packaging type (mm).
WALL_THICKNESS_RANGE_MM = {
    PackagingType.BOTTLE: (0.8, 1.2),
    PackagingType.BOX: (1.2, 2.0),
    PackagingType.SACHET: (0.1, 0.2),
    PackagingType.JERRYCAN: (2.0, 3.5),
}

# tasks.md 4.5 — automatic material selection, mapped to the packaging type it's
# most conventionally used for (PET bottles, PP rigid boxes/tubs, LDPE flexible
# sachet film, HDPE chemical-resistant jerrycans).
DEFAULT_MATERIAL_BY_PACKAGING_TYPE = {
    PackagingType.BOTTLE: Material.PET,
    PackagingType.BOX: Material.PP,
    PackagingType.SACHET: Material.LDPE,
    PackagingType.JERRYCAN: Material.HDPE,
}


@dataclass(frozen=True)
class MaterialProperties:
    density_g_cm3: float
    # 1 (most flexible) - 5 (most rigid). Comparative ranking derived from typical
    # published tensile-modulus ordering (PET > PP > HDPE > PE > LDPE), not a
    # certified per-grade engineering spec.
    relative_stiffness: int


MATERIAL_PROPERTIES = {
    Material.PET: MaterialProperties(density_g_cm3=1.38, relative_stiffness=5),
    Material.PP: MaterialProperties(density_g_cm3=0.905, relative_stiffness=4),
    Material.HDPE: MaterialProperties(density_g_cm3=0.95, relative_stiffness=3),
    Material.PE: MaterialProperties(density_g_cm3=0.93, relative_stiffness=2),
    Material.LDPE: MaterialProperties(density_g_cm3=0.92, relative_stiffness=1),
}


def get_wall_thickness_range(packaging_type) -> Tuple[float, float]:
    try:
        return WALL_THICKNESS_RANGE_MM[PackagingType(packaging_type)]
    except ValueError as exc:
        raise ValueError(f"Unknown packaging type: {packaging_type}") from exc


def get_default_wall_thickness_mm(packaging_type) -> float:
    lo, hi = get_wall_thickness_range(packaging_type)
    return round((lo + hi) / 2, 3)


def validate_wall_thickness_mm(packaging_type, thickness_mm: float) -> bool:
    lo, hi = get_wall_thickness_range(packaging_type)
    return lo <= thickness_mm <= hi


def get_default_material(packaging_type) -> Material:
    try:
        return DEFAULT_MATERIAL_BY_PACKAGING_TYPE[PackagingType(packaging_type)]
    except ValueError as exc:
        raise ValueError(f"Unknown packaging type: {packaging_type}") from exc


def validate_material(material) -> bool:
    try:
        Material(material)
        return True
    except ValueError:
        return False


def get_material_properties(material) -> MaterialProperties:
    try:
        return MATERIAL_PROPERTIES[Material(material)]
    except ValueError as exc:
        raise ValueError(f"Unknown material: {material}") from exc


def select_material(packaging_type, override: Optional[str] = None) -> Material:
    if override is not None:
        if not validate_material(override):
            raise ValueError(f"Unknown material: {override}")
        return Material(override)
    return get_default_material(packaging_type)
