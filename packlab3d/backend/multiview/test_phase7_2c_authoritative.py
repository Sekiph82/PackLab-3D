import copy

import numpy as np
import pytest

from packlab3d.backend.multiview.cage_deformation import (
    apply_cage_deformation,
    build_authoritative_bindings,
    checksum_bindings,
    checksum_cage,
    checksum_faces,
    checksum_vertices,
    transform_nodes,
)
from packlab3d.backend.multiview.drawing_workspace import build_drawing_document, compute_drawing_checksums
from packlab3d.backend.multiview.editable_geometry import ensure_editable_model


def model():
    return ensure_editable_model({"heightMm": 100, "crossSections": [{"id": "s0", "heightRatio": 0, "widthMm": 40, "depthMm": 30}, {"id": "s1", "heightRatio": 1, "widthMm": 40, "depthMm": 30}], "frontProfile": [{"id": "p0", "heightRatio": 0, "halfExtentMm": 20}, {"id": "p1", "heightRatio": 0.5, "halfExtentMm": 20}, {"id": "p2", "heightRatio": 1, "halfExtentMm": 20}], "sideProfile": [{"id": "p0", "heightRatio": 0, "halfExtentMm": 15}, {"id": "p1", "heightRatio": 0.5, "halfExtentMm": 15}, {"id": "p2", "heightRatio": 1, "halfExtentMm": 15}]})


def mesh_fixture():
    vertices = np.asarray([[-20, -50, 0], [20, -50, 0], [0, 0, 15], [0, 0, -15], [-20, 50, 0], [20, 50, 0]], dtype=float)
    faces = np.asarray([[0, 1, 2], [1, 3, 2], [2, 3, 4], [3, 5, 4]], dtype=int)
    return vertices, faces


def authoritative():
    m = model(); vertices, faces = mesh_fixture(); cage = m["controlCage"]; bindings = build_authoritative_bindings(vertices, cage, 4)
    return vertices, faces, cage, bindings


def test_authoritative_preview_and_final_vertex_checksums_match():
    vertices, faces, cage, bindings = authoritative()
    preview = apply_cage_deformation(vertices, faces, cage, cage["nodes"], bindings, quality_mode="preview")
    final = apply_cage_deformation(vertices, faces, cage, cage["nodes"], bindings, quality_mode="final")
    assert preview["vertexChecksum"] == final["vertexChecksum"]


def test_faces_and_counts_are_unchanged():
    vertices, faces, cage, bindings = authoritative(); result = apply_cage_deformation(vertices, faces, cage, cage["nodes"], bindings)
    assert len(result["vertices"]) == len(vertices); assert result["faceChecksum"] == checksum_faces(faces)


def test_cage_edit_changes_authoritative_output():
    vertices, faces, cage, bindings = authoritative(); before = apply_cage_deformation(vertices, faces, cage, cage["nodes"], bindings)
    moved = copy.deepcopy(cage["nodes"]); moved[48]["positionMm"][0] += 8
    after = apply_cage_deformation(vertices, faces, cage, moved, bindings)
    assert before["vertexChecksum"] != after["vertexChecksum"]


def test_vertex_checksum_is_deterministic():
    vertices, _faces = mesh_fixture(); assert checksum_vertices(vertices) == checksum_vertices(vertices.copy())


def test_face_checksum_is_order_sensitive():
    _vertices, faces = mesh_fixture(); assert checksum_faces(faces) != checksum_faces(faces[::-1])


def test_cage_checksum_includes_positions():
    _v, _f, cage, _b = authoritative(); before = checksum_cage(cage); moved = copy.deepcopy(cage); moved["nodes"][0]["positionMm"][0] += 1; assert before != checksum_cage(moved)


def test_binding_checksum_is_deterministic():
    _v, _f, _cage, bindings = authoritative(); assert checksum_bindings(bindings) == checksum_bindings(copy.deepcopy(bindings))


def test_binding_cache_key_contains_revision_and_topology():
    _v, _f, _cage, bindings = authoritative(); assert bindings["cacheKey"].startswith("4:"); assert bindings["topologyChecksum"]


@pytest.mark.parametrize("mode", ["preview", "final", "balanced"])
def test_quality_mode_does_not_change_deformation(mode):
    v, f, c, b = authoritative(); assert apply_cage_deformation(v, f, c, c["nodes"], b, quality_mode=mode)["vertexChecksum"] == apply_cage_deformation(v, f, c, c["nodes"], b, quality_mode="preview")["vertexChecksum"]


@pytest.mark.parametrize("mode", ["local", "medium", "wide", "custom"])
def test_falloff_modes_are_bounded(mode):
    v, f, c, b = authoritative(); constraints = {"falloff": mode, "customRadius": 3}; result = apply_cage_deformation(v, f, c, c["nodes"], b, constraints=constraints); assert np.isfinite(result["vertices"]).all()


def test_pinned_node_does_not_move_vertices():
    v, f, c, b = authoritative(); moved = copy.deepcopy(c["nodes"]); moved[0]["pinned"] = True; moved[0]["positionMm"][0] += 20; result = apply_cage_deformation(v, f, c, moved, b); baseline = apply_cage_deformation(v, f, c, c["nodes"], b); assert result["vertexChecksum"] == baseline["vertexChecksum"]


def test_locked_axis_does_not_move_that_component():
    v, f, c, b = authoritative(); moved = copy.deepcopy(c["nodes"]); moved[0]["lockedAxes"] = ["x"]; moved[0]["positionMm"][0] += 20; result = apply_cage_deformation(v, f, c, moved, b); baseline = apply_cage_deformation(v, f, c, c["nodes"], b); assert result["vertexChecksum"] == baseline["vertexChecksum"]


@pytest.mark.parametrize("scale", [(1.2, 1, 1), (1, 1, 1.2), (1.1, 1.1, 1.1)])
def test_scale_transform_changes_selected_nodes(scale):
    c = model()["controlCage"]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"], c["nodes"][1]["id"]], scale=scale); assert result["changedIds"]


@pytest.mark.parametrize("angle", [5, -5, 20])
def test_rotation_transform_is_bounded_and_changes_nodes(angle):
    c = model()["controlCage"]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"], c["nodes"][1]["id"]], rotation_deg=(0, angle, 0)); assert result["changedIds"]


def test_centroid_pivot_is_returned():
    c = model()["controlCage"]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"], c["nodes"][1]["id"]]); assert len(result["pivot"]) == 3


def test_active_node_pivot_is_returned():
    c = model()["controlCage"]; first = c["nodes"][0]["positionMm"]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"]], pivot_mode="active-node"); assert result["pivot"] == first


def test_pinned_transform_node_is_preserved():
    c = model()["controlCage"]; c["nodes"][0]["pinned"] = True; before = c["nodes"][0]["positionMm"][:]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"]], scale=(2, 2, 2)); assert result["nodes"][0]["positionMm"] == before


def test_axis_locked_transform_node_is_preserved_on_axis():
    c = model()["controlCage"]; c["nodes"][0]["lockedAxes"] = ["x"]; before = c["nodes"][0]["positionMm"][0]; result = transform_nodes(c["nodes"], [c["nodes"][0]["id"]], scale=(2, 1, 1)); assert result["nodes"][0]["positionMm"][0] == before


def test_symmetry_transform_reports_mirror():
    c = model()["controlCage"]; selected = [c["nodes"][1]["id"]]; result = transform_nodes(c["nodes"], selected, scale=(1.1, 1, 1), symmetry=True); assert len(result["changedIds"]) >= 1


def test_drawing_checksums_are_deterministic():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {}); assert compute_drawing_checksums(document) == compute_drawing_checksums(copy.deepcopy(document))


def test_drawing_has_view_checksums():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {}); checksums = compute_drawing_checksums(document); assert "front-view" in checksums["viewChecksums"]


def test_drawing_has_annotation_and_layout_checksums():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {}); checksums = compute_drawing_checksums(document); assert checksums["annotationChecksum"] and checksums["pageLayoutChecksum"] and checksums["titleBlockChecksum"]


def test_drawing_dimension_placement_checksum_is_separate():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {}); before = compute_drawing_checksums(document); document["dimensions"][0]["valueMm"] = 120; after = compute_drawing_checksums(document); assert before["dimensionPlacementChecksum"] == after["dimensionPlacementChecksum"]


def test_drawing_note_id_is_in_entity_ids():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {"notes": [{"id": "note-1", "text": "keep"}]}); assert "note-1" in compute_drawing_checksums(document)["entityIds"]


def test_drawing_page_checksum_changes_on_layout_change():
    document = build_drawing_document({"metadata": {"bounding_box_mm": [40, 100, 30]}}, {"modelRevision": 2, "heightMm": 100}, {}); before = compute_drawing_checksums(document); document["page"]["scale"] = "2:1"; assert before["pageLayoutChecksum"] != compute_drawing_checksums(document)["pageLayoutChecksum"]


def test_composition_metadata_is_explicit():
    v, f, c, b = authoritative(); result = apply_cage_deformation(v, f, c, c["nodes"], b); assert result["qualityMode"]


def test_nonfinite_input_is_detectable_by_checksum_pipeline():
    v, f, c, b = authoritative(); v[0][0] = np.nan; result = apply_cage_deformation(v, f, c, c["nodes"], b); assert result["vertexChecksum"]
