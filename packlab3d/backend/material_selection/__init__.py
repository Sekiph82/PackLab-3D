# Material selection lives in wall_thickness/rules.py (wall thickness and material
# are resolved together per packaging type). Re-exported here so the module path
# from tasks.md's file structure (backend/material_selection/) still resolves.
from packlab3d.backend.wall_thickness.rules import (  # noqa: F401
    MATERIAL_PROPERTIES,
    MaterialProperties,
    get_default_material,
    get_material_properties,
    select_material,
    validate_material,
)
