import numpy as np

from packlab3d.backend.mesh_scaling.scaling import get_bounding_size

# Axis convention matches Stage 3/4: X=width, Y=depth, Z=height (Z-up).
# top: viewed along -Z onto XY. front: viewed along -Y onto XZ. side: viewed along -X onto YZ.
PROJECTION_AXES = {
    "top": (0, 1),
    "front": (0, 2),
    "side": (1, 2),
}
VIEWS = tuple(PROJECTION_AXES)


def _monotone_chain_hull(points: np.ndarray) -> np.ndarray:
    """2D convex hull (Andrew's monotone chain), no scipy dependency.

    Approximates the silhouette: exact for convex shapes, loses concave
    features (e.g. a bottle neck) — true concave silhouette extraction from a
    mesh projection needs hidden-line removal (OpenCascade, see occ_solid.py).
    """
    pts = np.unique(points, axis=0)
    if len(pts) <= 2:
        return pts
    pts = pts[np.lexsort((pts[:, 1], pts[:, 0]))]

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in pts[::-1]:
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.array(lower[:-1] + upper[:-1])


def project_silhouette(mesh, view: str) -> np.ndarray:
    if view not in PROJECTION_AXES:
        raise ValueError(f"Unknown view: {view}. Expected one of {VIEWS}")
    axes = PROJECTION_AXES[view]
    vertices = np.asarray(mesh.vertices)
    return _monotone_chain_hull(vertices[:, axes])


def get_view_dimensions(mesh, view: str):
    if view not in PROJECTION_AXES:
        raise ValueError(f"Unknown view: {view}. Expected one of {VIEWS}")
    size = get_bounding_size(mesh)
    axes = PROJECTION_AXES[view]
    return float(size[axes[0]]), float(size[axes[1]])


def render_view_svg(
    hull_points: np.ndarray, dim_x_mm: float, dim_y_mm: float, view_label: str, margin_mm: float = 20
) -> str:
    min_xy = hull_points.min(axis=0)
    pts = hull_points - min_xy

    canvas_w = dim_x_mm + margin_mm * 2 + 40
    canvas_h = dim_y_mm + margin_mm * 2 + 40

    def to_svg_xy(p):
        return p[0] + margin_mm, (dim_y_mm - p[1]) + margin_mm

    poly_pts = " ".join(f"{x:.2f},{y:.2f}" for x, y in (to_svg_xy(p) for p in pts))
    dim_y_line_y = margin_mm + dim_y_mm + 15
    dim_x_line_x = margin_mm + dim_x_mm + 15

    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{canvas_w:.1f}" height="{canvas_h:.1f}" viewBox="0 0 {canvas_w:.1f} {canvas_h:.1f}">
  <rect width="100%" height="100%" fill="#FFFFFF"/>
  <text x="{margin_mm:.2f}" y="{margin_mm - 6:.2f}" font-size="12" fill="#0A0A0A">{view_label}</text>
  <polygon points="{poly_pts}" fill="none" stroke="#0A0A0A" stroke-width="1"/>
  <line x1="{margin_mm:.2f}" y1="{dim_y_line_y:.2f}" x2="{margin_mm + dim_x_mm:.2f}" y2="{dim_y_line_y:.2f}" stroke="#0057FF" stroke-width="0.8"/>
  <text x="{margin_mm + dim_x_mm / 2:.2f}" y="{dim_y_line_y + 12:.2f}" font-size="10" text-anchor="middle" fill="#0057FF">{dim_x_mm:.1f} mm</text>
  <line x1="{dim_x_line_x:.2f}" y1="{margin_mm:.2f}" x2="{dim_x_line_x:.2f}" y2="{margin_mm + dim_y_mm:.2f}" stroke="#0057FF" stroke-width="0.8"/>
  <text x="{dim_x_line_x + 4:.2f}" y="{margin_mm + dim_y_mm / 2:.2f}" font-size="10" text-anchor="start" fill="#0057FF">{dim_y_mm:.1f} mm</text>
</svg>
'''


def _dxf_polyline(points: np.ndarray, layer: str = "SILHOUETTE") -> str:
    lines = ["0", "POLYLINE", "8", layer, "66", "1", "70", "1"]
    for x, y in points:
        lines += ["0", "VERTEX", "8", layer, "10", f"{x:.4f}", "20", f"{y:.4f}"]
    lines += ["0", "SEQEND"]
    return "\n".join(lines) + "\n"


def _dxf_line(x1, y1, x2, y2, layer: str = "DIMENSIONS") -> str:
    return "\n".join(
        [
            "0", "LINE", "8", layer,
            "10", f"{x1:.4f}", "20", f"{y1:.4f}", "30", "0.0",
            "11", f"{x2:.4f}", "21", f"{y2:.4f}", "31", "0.0",
        ]
    ) + "\n"


def _dxf_text(x, y, height, text, layer: str = "DIMENSIONS") -> str:
    return "\n".join(
        ["0", "TEXT", "8", layer, "10", f"{x:.4f}", "20", f"{y:.4f}", "30", "0.0", "40", f"{height:.3f}", "1", text]
    ) + "\n"


def render_view_dxf(hull_points: np.ndarray, dim_x_mm: float, dim_y_mm: float, view_label: str) -> str:
    """Minimal valid ASCII DXF R12: HEADER/TABLES omitted, single ENTITIES section."""
    min_xy = hull_points.min(axis=0)
    pts = hull_points - min_xy

    entities = _dxf_polyline(pts)
    entities += _dxf_line(0, -5, dim_x_mm, -5)
    entities += _dxf_text(dim_x_mm / 2 - 8, -9, 3, f"{dim_x_mm:.1f} mm")
    entities += _dxf_line(dim_x_mm + 5, 0, dim_x_mm + 5, dim_y_mm)
    entities += _dxf_text(dim_x_mm + 7, dim_y_mm / 2, 3, f"{dim_y_mm:.1f} mm")
    entities += _dxf_text(0, dim_y_mm + 5, 4, view_label)

    return "0\nSECTION\n2\nENTITIES\n" + entities + "0\nENDSEC\n0\nEOF\n"
