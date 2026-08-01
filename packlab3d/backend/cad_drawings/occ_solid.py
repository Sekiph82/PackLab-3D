from packlab3d.core.utils.errors import ModelNotAvailableError


def convert_mesh_to_solid(mesh_path: str):
    """Reference integration for pythonocc-core (OpenCascade) mesh-to-BREP + STEP/IGES export.

    pythonocc-core has no PyPI wheels for Windows — it's distributed only via
    conda-forge (`conda install -c conda-forge pythonocc-core`), and this
    environment has no conda. Not installed here.

    STEP/IGES are B-rep/NURBS formats — unlike SVG/DXF, there is no honest
    lightweight way to hand-write them from a triangle mesh without a real
    kernel; a fabricated file would just be invalid. This backend stays fully
    gated until OpenCascade is actually available.

    Intended real usage once pythonocc-core is available (API shape per its
    documented usage — re-check against your installed version):

        from OCC.Core.STEPControl import STEPControl_Writer, STEPControl_AsIs
        from OCC.Core.IGESControl import IGESControl_Writer
        from OCC.Core.BRepBuilderAPI import BRepBuilderAPI_Sewing
        from OCC.Extend.DataExchange import read_stl_file  # or a custom OBJ->BRep tessellation

        shape = read_stl_file(mesh_path)  # triangle-soup -> sewn shell (approximate BREP)

        step_writer = STEPControl_Writer()
        step_writer.Transfer(shape, STEPControl_AsIs)
        step_writer.Write("solid.step")

        iges_writer = IGESControl_Writer()
        iges_writer.AddShape(shape)
        iges_writer.Write("solid.iges")

    Hidden-line removal for true technical-drawing edges would use
    `OCC.Core.HLRBRep` (HLRBRep_Algo / HLRBRep_HLRToShape) projected against a
    view direction — this is what gives exact (non-convex-hull) silhouettes,
    unlike mesh_projection.py's convex-hull approximation.
    """
    raise ModelNotAvailableError(
        "pythonocc-core (OpenCascade) is required for solid conversion, STEP/IGES "
        "export, and hidden-line removal. Not pip-installable on this platform — "
        "install via conda-forge: conda install -c conda-forge pythonocc-core"
    )
