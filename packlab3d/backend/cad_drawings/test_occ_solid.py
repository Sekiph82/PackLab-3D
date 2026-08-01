import pytest

from packlab3d.backend.cad_drawings.occ_solid import convert_mesh_to_solid
from packlab3d.core.utils.errors import ModelNotAvailableError


def test_convert_mesh_to_solid_raises_without_pythonocc():
    # pythonocc-core has no PyPI wheels; genuinely not installed here.
    with pytest.raises(ModelNotAvailableError):
        convert_mesh_to_solid(mesh_path="dummy.obj")
