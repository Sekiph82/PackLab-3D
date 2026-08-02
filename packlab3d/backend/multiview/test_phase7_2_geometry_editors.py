import copy

import pytest

from packlab3d.backend.multiview.editable_geometry import (
    GeometryValidationError,
    apply_cage_edits,
    apply_profile_points,
    apply_sections,
    ensure_editable_model,
    validate_model,
    validate_profile,
    validate_section,
)


def model():
    return ensure_editable_model({
        "heightMm": 120,
        "frontProfile": [
            {"id": "p0", "heightRatio": 0, "halfExtentMm": 10},
            {"id": "p1", "heightRatio": 0.5, "halfExtentMm": 20},
            {"id": "p2", "heightRatio": 1, "halfExtentMm": 12},
        ],
        "sideProfile": [
            {"id": "s0", "heightRatio": 0, "halfExtentMm": 8},
            {"id": "s1", "heightRatio": 0.5, "halfExtentMm": 14},
            {"id": "s2", "heightRatio": 1, "halfExtentMm": 9},
        ],
        "crossSections": [
            {"id": "sec-0", "heightRatio": 0, "widthMm": 20, "depthMm": 16},
            {"id": "sec-1", "heightRatio": 0.5, "widthMm": 40, "depthMm": 28},
            {"id": "sec-2", "heightRatio": 1, "widthMm": 24, "depthMm": 18},
        ],
        "controlCage": {"nodes": [
            {"id": "node-low", "heightRatio": 0.0, "positionMm": [20, -60, 0], "restPositionMm": [20, -60, 0]},
            {"id": "node-mid", "heightRatio": 0.5, "positionMm": [20, 0, 0], "restPositionMm": [20, 0, 0]},
            {"id": "node-high", "heightRatio": 1.0, "positionMm": [20, 60, 0], "restPositionMm": [20, 60, 0]},
        ], "edges": []},
    })


def test_model_has_stable_revision_and_generic_profile_aliases():
    value = model()
    assert value["modelRevision"] == 1
    assert value["profiles"]["front"][1]["id"] == "p1"


@pytest.mark.parametrize("points", [[], [{"heightRatio": 0, "halfExtentMm": 1}], [{"heightRatio": 0, "halfExtentMm": 1}, {"heightRatio": 0.5, "halfExtentMm": 2}, {"heightRatio": 0.4, "halfExtentMm": 2}]])
def test_profile_validation_rejects_invalid_points(points):
    assert validate_profile(points)["valid"] is False


def test_profile_edit_updates_real_points_and_preserves_ids():
    value = apply_profile_points(model(), "frontProfile", [
        {"id": "p0", "heightRatio": 0, "halfExtentMm": 10},
        {"id": "p1", "heightRatio": 0.5, "halfExtentMm": 31},
        {"id": "p2", "heightRatio": 1, "halfExtentMm": 12},
    ])
    assert value["frontProfile"][1]["halfExtentMm"] == 31
    assert [item["id"] for item in value["frontProfile"]] == ["p0", "p1", "p2"]


def test_profile_edit_rejects_non_positive_extent():
    with pytest.raises(GeometryValidationError):
        apply_profile_points(model(), "frontProfile", [{"heightRatio": 0, "halfExtentMm": 0}, {"heightRatio": .5, "halfExtentMm": 1}, {"heightRatio": 1, "halfExtentMm": 1}])


def test_sections_have_closed_loop_validation_when_points_are_present():
    value = model()
    value["crossSections"][1]["points"] = [{"xMm": 10, "zMm": 0}, {"xMm": 0, "zMm": 10}, {"xMm": -10, "zMm": 0}, {"xMm": 0, "zMm": -10}, {"xMm": 10, "zMm": 0}, {"xMm": 0, "zMm": 10}]
    assert validate_section(value["crossSections"][1])["valid"]


def test_section_edit_changes_width_depth_and_rotation():
    value = apply_sections(model(), [{"id": "sec-1", "widthMm": 52, "depthMm": 31, "rotationDeg": 6, "centerOffsetMm": [2, -1]}])
    section = next(item for item in value["crossSections"] if item["id"] == "sec-1")
    assert (section["widthMm"], section["depthMm"], section["rotationDeg"], section["centerOffsetMm"]) == (52, 31, 6, [2, -1])


def test_section_edit_rejects_duplicate_heights():
    with pytest.raises(GeometryValidationError):
        apply_sections(model(), [{"id": "sec-1", "heightRatio": 0}])


@pytest.mark.parametrize("falloff", ["local", "medium", "wide"])
def test_cage_falloff_is_bounded_and_changes_sections(falloff):
    before = model()
    after = apply_cage_edits(before, [{"id": "node-mid", "deltaMm": [8, 0, 3]}], falloff=falloff)
    assert after["crossSections"][1]["widthMm"] > 40
    assert all(section["widthMm"] > 0 for section in after["crossSections"])


def test_cage_nearby_section_moves_more_than_distant_section():
    after = apply_cage_edits(model(), [{"id": "node-mid", "deltaMm": [10, 0, 0]}], falloff="wide")
    mid = after["crossSections"][1]["widthMm"] - 40
    edge = after["crossSections"][0]["widthMm"] - 20
    assert mid > edge


def test_pinned_cage_node_does_not_deform_model():
    value = model(); value["controlCage"]["nodes"][1]["pinned"] = True
    after = apply_cage_edits(value, [{"id": "node-mid", "deltaMm": [10, 0, 10]}])
    assert after["crossSections"] == value["crossSections"]


def test_locked_axes_reject_axis_delta():
    value = model(); value["controlCage"]["nodes"][1]["lockedAxes"] = ["x"]
    after = apply_cage_edits(value, [{"id": "node-mid", "deltaMm": [10, 0, 4]}])
    assert after["controlCage"]["nodes"][1]["positionMm"][0] == 20
    assert after["crossSections"][1]["depthMm"] > 28


def test_cage_mirror_nodes_move_in_opposite_xz_directions():
    value = model(); value["controlCage"]["nodes"][0]["mirrorNodeIds"] = ["node-high"]
    value["controlCage"]["nodes"][2]["mirrorNodeIds"] = ["node-low"]
    after = apply_cage_edits(value, [{"id": "node-low", "deltaMm": [4, 0, 2]}])
    assert after["controlCage"]["nodes"][2]["positionMm"][: : 2] == [-4 + 20, -2]


def test_model_validation_returns_per_editor_reports():
    report = validate_model(model())
    assert report["valid"]
    assert set(report["profiles"]) == {"frontProfile", "sideProfile"}
    assert "sec-1" in report["sections"]


def test_model_copy_is_not_mutated_by_profile_edit():
    original = model(); apply_profile_points(original, "frontProfile", [{"heightRatio": 0, "halfExtentMm": 10}, {"heightRatio": .5, "halfExtentMm": 30}, {"heightRatio": 1, "halfExtentMm": 12}])
    assert original["frontProfile"][1]["halfExtentMm"] == 20


def test_model_copy_is_not_mutated_by_cage_edit():
    original = model(); apply_cage_edits(original, [{"id": "node-mid", "deltaMm": [5, 0, 0]}])
    assert original["crossSections"][1]["widthMm"] == 40


def test_cage_ids_and_topology_are_preserved():
    value = model(); before = [node["id"] for node in value["controlCage"]["nodes"]]
    after = apply_cage_edits(value, [{"id": "node-mid", "deltaMm": [5, 0, 0]}])
    assert [node["id"] for node in after["controlCage"]["nodes"]] == before
    assert after["controlCage"]["edges"] == value["controlCage"]["edges"]


def test_section_points_are_preserved_by_dimension_edit():
    value = model(); points = [{"xMm": 10, "zMm": 0}, {"xMm": 0, "zMm": 10}, {"xMm": -10, "zMm": 0}, {"xMm": 0, "zMm": -10}, {"xMm": 10, "zMm": 0}, {"xMm": 0, "zMm": 10}]; value["crossSections"][1]["points"] = points
    after = apply_sections(value, [{"id": "sec-1", "widthMm": 45}])
    assert after["crossSections"][1]["points"] == points


def test_profile_mode_and_tangents_are_preserved():
    points = [{"id": "a", "heightRatio": 0, "halfExtentMm": 10, "mode": "corner", "tangentOut": [0.2, 0]}, {"id": "b", "heightRatio": .5, "halfExtentMm": 20}, {"id": "c", "heightRatio": 1, "halfExtentMm": 10}]
    after = apply_profile_points(model(), "frontProfile", points)
    assert after["frontProfile"][0]["mode"] == "corner"
    assert after["frontProfile"][0]["tangentOut"] == [0.2, 0]


def test_wide_falloff_reaches_more_sections_than_local():
    local = apply_cage_edits(model(), [{"id": "node-mid", "deltaMm": [10, 0, 0]}], falloff="local")
    wide = apply_cage_edits(model(), [{"id": "node-mid", "deltaMm": [10, 0, 0]}], falloff="wide")
    local_changed = sum(item["widthMm"] != base["widthMm"] for item, base in zip(local["crossSections"], model()["crossSections"]))
    wide_changed = sum(item["widthMm"] != base["widthMm"] for item, base in zip(wide["crossSections"], model()["crossSections"]))
    assert wide_changed >= local_changed


def test_invalid_section_area_is_rejected():
    value = model()
    with pytest.raises(GeometryValidationError):
        apply_sections(value, [{"id": "sec-1", "points": [{"xMm": 0, "zMm": 0}] * 6}])


def test_validation_is_deterministic():
    assert validate_model(model()) == validate_model(copy.deepcopy(model()))
