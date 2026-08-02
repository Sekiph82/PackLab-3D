import copy

import pytest

from packlab3d.backend.multiview.editable_geometry import (
    DEFAULT_CAGE_LAYERS,
    DEFAULT_CAGE_RINGS,
    apply_cage_edits,
    build_cage_bindings,
    cage_topology_checksum,
    deform_vertices_with_cage,
    ensure_editable_model,
)


def base_model():
    return ensure_editable_model({
        "heightMm": 100,
        "frontProfile": [{"id": "p0", "heightRatio": 0, "halfExtentMm": 10}, {"id": "p1", "heightRatio": 0.5, "halfExtentMm": 11}, {"id": "p2", "heightRatio": 1, "halfExtentMm": 10}],
        "sideProfile": [{"id": "s0", "heightRatio": 0, "halfExtentMm": 8}, {"id": "s1", "heightRatio": 0.5, "halfExtentMm": 9}, {"id": "s2", "heightRatio": 1, "halfExtentMm": 8}],
        "crossSections": [{"id": "s0", "heightRatio": 0, "widthMm": 20, "depthMm": 16}, {"id": "s1", "heightRatio": 1, "widthMm": 20, "depthMm": 16}],
    })


def vertices():
    return [[-10, 0, 0], [10, 0, 0], [0, 50, -8], [0, 50, 8], [-10, 100, 0], [10, 100, 0]]


def test_lattice_has_deterministic_layer_count():
    assert len(base_model()["controlCage"]["nodes"]) == DEFAULT_CAGE_LAYERS * DEFAULT_CAGE_RINGS


def test_lattice_has_stable_node_ids():
    ids = [node["id"] for node in base_model()["controlCage"]["nodes"]]
    assert ids == [f"cage-layer-{layer:02d}-ring-{ring:02d}" for layer in range(7) for ring in range(8)]


def test_lattice_has_stable_edge_ids():
    ids = [edge["id"] for edge in base_model()["controlCage"]["edges"]]
    assert ids[0].startswith("cage-ring-") and any(item.startswith("cage-vertical-") for item in ids)


def test_lattice_topology_checksum_is_repeatable():
    assert cage_topology_checksum(base_model()["controlCage"]) == cage_topology_checksum(base_model()["controlCage"])


def test_lattice_node_revisions_are_initialized():
    assert all(node["revision"] == 1 for node in base_model()["controlCage"]["nodes"])


def test_lattice_regions_are_generic():
    assert {node["region"] for node in base_model()["controlCage"]["nodes"]} >= {"base", "mid-body", "cap"}


def test_binding_cache_has_expected_key_parts():
    cache = build_cage_bindings(vertices(), base_model()["controlCage"], 4)
    assert cache["cacheKey"].startswith("4:6:")


def test_binding_cache_has_one_entry_per_vertex():
    cache = build_cage_bindings(vertices(), base_model()["controlCage"])
    assert len(cache["bindings"]) == len(vertices())


def test_binding_contains_vertical_and_angular_neighbors():
    binding = build_cage_bindings(vertices(), base_model()["controlCage"])["bindings"][0]
    assert {"lowerLayer", "upperLayer", "angularNodeA", "angularNodeB"} <= set(binding)


def test_binding_weights_are_bounded():
    for item in build_cage_bindings(vertices(), base_model()["controlCage"])["bindings"]:
        assert 0 <= item["verticalWeight"] <= 1 and 0 <= item["angularWeight"] <= 1 and 0 <= item["radialWeight"] <= 1


def test_deformation_preserves_vertex_count():
    model = base_model(); cage = model["controlCage"]; cache = build_cage_bindings(vertices(), cage)
    cage["nodes"][0]["positionMm"][0] += 4
    assert len(deform_vertices_with_cage(vertices(), cage, cache)) == len(vertices())


def test_deformation_changes_vertices_when_cage_moves():
    model = base_model(); cage = model["controlCage"]; cache = build_cage_bindings(vertices(), cage)
    cage["nodes"][0]["positionMm"][0] += 4
    assert deform_vertices_with_cage(vertices(), cage, cache) != vertices()


def test_deformation_preserves_face_independent_topology():
    model = base_model(); output = deform_vertices_with_cage(vertices(), model["controlCage"], build_cage_bindings(vertices(), model["controlCage"]))
    assert len(output) == len(vertices())


def test_rest_positions_do_not_change_during_deformation():
    model = base_model(); cage = model["controlCage"]; original = copy.deepcopy(cage["nodes"][0]["restPositionMm"]); cage["nodes"][0]["positionMm"][0] += 5
    deform_vertices_with_cage(vertices(), cage, build_cage_bindings(vertices(), cage))
    assert cage["nodes"][0]["restPositionMm"] == original


@pytest.mark.parametrize("falloff", ["local", "medium", "wide"])
def test_falloff_modes_are_supported(falloff):
    model = base_model(); cage = model["controlCage"]; cage["nodes"][24]["positionMm"][0] += 4
    assert deform_vertices_with_cage(vertices(), cage, build_cage_bindings(vertices(), cage), falloff=falloff)


def test_custom_unknown_falloff_is_bounded():
    model = base_model(); assert deform_vertices_with_cage(vertices(), model["controlCage"], build_cage_bindings(vertices(), model["controlCage"]), falloff="custom")


def test_pinned_node_edit_is_ignored():
    model = base_model(); model["controlCage"]["nodes"][0]["pinned"] = True; before = copy.deepcopy(model)
    after = apply_cage_edits(model, [{"id": model["controlCage"]["nodes"][0]["id"], "deltaMm": [20, 0, 0]}])
    assert after["controlCage"]["nodes"][0]["positionMm"] == before["controlCage"]["nodes"][0]["positionMm"]


def test_axis_lock_is_exact():
    model = base_model(); node = model["controlCage"]["nodes"][0]; node["lockedAxes"] = ["x"]
    after = apply_cage_edits(model, [{"id": node["id"], "deltaMm": [20, 2, 3]}])
    assert after["controlCage"]["nodes"][0]["positionMm"][0] == node["positionMm"][0]


def test_existing_cage_is_not_replaced_by_lattice_generation():
    model = base_model(); model["controlCage"]["nodes"] = [{"id": "user-node", "positionMm": [1, 2, 3]}]; ensure_editable_model(model)
    assert model["controlCage"]["nodes"][0]["id"] == "user-node"


def test_lattice_metadata_is_persistable_json():
    import json
    json.dumps(base_model()["controlCage"])


def test_binding_cache_topology_checksum_matches_cage():
    model = base_model(); cache = build_cage_bindings(vertices(), model["controlCage"])
    assert cache["topologyChecksum"] == cage_topology_checksum(model["controlCage"])


def test_deformation_output_coordinates_are_finite():
    import math
    model = base_model(); output = deform_vertices_with_cage(vertices(), model["controlCage"], build_cage_bindings(vertices(), model["controlCage"]))
    assert all(math.isfinite(value) for vertex in output for value in vertex)


def test_model_revision_does_not_change_during_binding_build():
    model = base_model(); before = model["modelRevision"]; build_cage_bindings(vertices(), model["controlCage"], before); assert model["modelRevision"] == before


def test_cage_edge_endpoints_reference_nodes():
    model = base_model(); ids = {node["id"] for node in model["controlCage"]["nodes"]}
    assert all(edge["from"] in ids and edge["to"] in ids for edge in model["controlCage"]["edges"])


def test_cage_ring_wraps_at_last_node():
    model = base_model(); assert any(edge["to"].endswith("ring-00") for edge in model["controlCage"]["edges"] if edge["id"].startswith("cage-ring"))


def test_cage_vertical_links_connect_adjacent_layers():
    model = base_model(); edge = next(edge for edge in model["controlCage"]["edges"] if edge["id"].startswith("cage-vertical")); assert edge["from"].split("-")[2] != edge["to"].split("-")[2]


def test_model_copy_keeps_lattice_independent():
    original = base_model(); changed = copy.deepcopy(original); changed["controlCage"]["nodes"][0]["positionMm"][0] += 3; assert original["controlCage"]["nodes"][0]["positionMm"] != changed["controlCage"]["nodes"][0]["positionMm"]


def test_mirror_ids_are_valid_or_empty():
    model = base_model(); ids = {node["id"] for node in model["controlCage"]["nodes"]}; assert all(not node["mirrorNodeIds"] or set(node["mirrorNodeIds"]) <= ids for node in model["controlCage"]["nodes"])


def test_binding_cache_is_deterministic():
    model = base_model(); assert build_cage_bindings(vertices(), model["controlCage"]) == build_cage_bindings(vertices(), model["controlCage"])


def test_lattice_position_y_is_monotonic_by_layer():
    model = base_model(); ys = [node["positionMm"][1] for node in model["controlCage"]["nodes"] if node["ringIndex"] == 0]; assert ys == sorted(ys)


def test_lattice_ring_count_is_deterministic():
    assert len({node["ringIndex"] for node in base_model()["controlCage"]["nodes"]}) == DEFAULT_CAGE_RINGS


def test_deformation_accepts_empty_vertices():
    model = base_model(); assert deform_vertices_with_cage([], model["controlCage"], build_cage_bindings([], model["controlCage"])) == []


def test_cage_state_has_selection_and_falloff_metadata():
    cage = base_model()["controlCage"]; assert "selectedNodeIds" in cage and cage["falloff"]["mode"] == "medium"
