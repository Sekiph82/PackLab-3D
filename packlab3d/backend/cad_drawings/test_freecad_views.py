import pytest

from packlab3d.backend.cad_drawings.freecad_views import generate_freecad_views
from packlab3d.core.utils.errors import ModelNotAvailableError


def test_generate_freecad_views_raises_without_freecad():
    # FreeCAD is genuinely not installed in this environment (desktop app, not pip).
    with pytest.raises(ModelNotAvailableError):
        generate_freecad_views(mesh_path="dummy.obj", output_dir="/tmp")
