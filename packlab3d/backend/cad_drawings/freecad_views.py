from packlab3d.core.utils.errors import ModelNotAvailableError


def generate_freecad_views(mesh_path: str, output_dir: str):
    """Reference integration for FreeCAD's Part + TechDraw workbenches.

    FreeCAD is a desktop application, not a PyPI package — its `FreeCAD`/`Part`/
    `TechDraw` Python modules are only importable from FreeCAD's own bundled
    interpreter (or by adding its install's `bin`/`lib` folder to PYTHONPATH).
    Not installed in this environment; install from https://www.freecad.org/
    to enable this backend, or use mesh_projection.py's pure-mesh approximation.

    Intended real usage once FreeCAD is available (API shape per FreeCAD's
    documented scripting reference — re-check against your installed version):

        import FreeCAD
        import Part
        import TechDraw

        doc = FreeCAD.newDocument("packlab3d")
        shape = Part.Shape()
        shape.read(mesh_path)  # or Part.show(Mesh.Mesh(mesh_path).convertToShape())
        part_obj = doc.addObject("Part::Feature", "Body")
        part_obj.Shape = shape

        page = doc.addObject("TechDraw::DrawPage", "Page")
        template = doc.addObject("TechDraw::DrawSVGTemplate", "Template")
        page.Template = template

        for name, direction in [
            ("front", FreeCAD.Vector(0, -1, 0)),
            ("side", FreeCAD.Vector(1, 0, 0)),
            ("top", FreeCAD.Vector(0, 0, -1)),
        ]:
            view = doc.addObject("TechDraw::DrawViewPart", name)
            page.addView(view)
            view.Source = [part_obj]
            view.Direction = direction
            view.ScaleType = "Automatic"

        doc.recompute()
        # Export: page.exportSvg(...) / DXF export via TechDraw's DXF exporter.
    """
    raise ModelNotAvailableError(
        "FreeCAD (with Part/TechDraw workbenches) is required for this backend. "
        "It's a desktop application, not pip-installable — install FreeCAD from "
        "https://www.freecad.org/ and run this from its bundled Python, or use "
        "CadBackend.MESH_PROJECTION for the pure-mesh approximation."
    )
