import { selectionPivot, selectNodesInBox, constrainedDelta, transformSelectedNodes } from './editors/cage/ControlCageEditor.js';

function nodes() {
  return [
    { id: 'a', positionMm: [-10, 0, 0], lockedAxes: [], pinned: false },
    { id: 'b', positionMm: [10, 0, 0], lockedAxes: [], pinned: false },
    { id: 'c', positionMm: [0, 20, 10], lockedAxes: ['z'], pinned: false },
    { id: 'd', positionMm: [0, 40, -10], lockedAxes: [], pinned: true },
  ];
}

test('centroid pivot is stable', () => expect(selectionPivot(nodes(), ['a', 'b'])).toEqual([0, 0, 0]));
test('active selection can be boxed', () => expect(selectNodesInBox(nodes(), { x0: -11, y0: -1, x1: 11, y1: 1 })).toEqual(['a', 'b']));
test('box selection excludes distant nodes', () => expect(selectNodesInBox(nodes(), { x0: -5, y0: -5, x1: 5, y1: 5 })).toEqual([]));
test('locked axis constrains movement', () => expect(constrainedDelta(nodes()[2], [3, 4, 5])).toEqual([3, 4, 0]));
test('pinned node constrains all movement', () => expect(constrainedDelta(nodes()[3], [3, 4, 5])).toEqual([0, 0, 0]));
test('translation changes selected node', () => expect(transformSelectedNodes(nodes(), ['a'], [2, 0, 0])[0].positionMm).toEqual([-8, 0, 0]));
test('unselected node remains unchanged', () => expect(transformSelectedNodes(nodes(), ['a'], [2, 0, 0])[1].positionMm).toEqual([10, 0, 0]));
test('uniform scale changes distance from pivot', () => expect(transformSelectedNodes(nodes(), ['a', 'b'], [0, 0, 0], { scale: 2 })[0].positionMm).toEqual([-20, 0, 0]));
test('x scale is supported', () => expect(transformSelectedNodes(nodes(), ['a', 'b'], [0, 0, 0], { scale: 1.5 })[1].positionMm[0]).toBe(15));
test('rotation changes radial coordinate around a multi-selection pivot', () => expect(transformSelectedNodes(nodes(), ['a', 'b'], [0, 0, 0], { rotationDeg: 90 })[0].positionMm[2]).toBeCloseTo(-10));
test('explicit pivot is honored', () => expect(transformSelectedNodes(nodes(), ['a'], [0, 0, 0], { scale: 2, pivot: [10, 0, 0] })[0].positionMm[0]).toBe(-30));
test('pinned node does not scale', () => expect(transformSelectedNodes(nodes(), ['d'], [0, 0, 0], { scale: 2 })[3].positionMm).toEqual([0, 40, -10]));
test('locked x axis does not scale x', () => expect(transformSelectedNodes(nodes(), ['c'], [0, 0, 0], { scale: 2 })[2].positionMm[0]).toBe(0));
test('locked z axis does not rotate z', () => expect(transformSelectedNodes(nodes(), ['c'], [0, 0, 0], { rotationDeg: 45 })[2].positionMm[2]).toBe(10));
test('selection pivot returns three coordinates', () => expect(selectionPivot(nodes(), ['a']).length).toBe(3));
test('empty selection pivot is origin', () => expect(selectionPivot(nodes(), []).every((v) => v === 0)).toBe(true));
test('box selection accepts reversed corners', () => expect(selectNodesInBox(nodes(), { x0: 11, y0: 1, x1: -11, y1: -1 })).toEqual(['a', 'b']));
test('box projection can use arbitrary coordinates', () => expect(selectNodesInBox(nodes(), { x0: 0, y0: 0, x1: 2, y1: 2 }, () => ({ x: 1, y: 1 }))).toEqual(['a', 'b', 'c', 'd']));
test('transform preserves stable ids', () => expect(transformSelectedNodes(nodes(), ['a'], [1, 2, 3]).map((n) => n.id)).toEqual(['a', 'b', 'c', 'd']));
test('transform preserves pin metadata', () => expect(transformSelectedNodes(nodes(), ['d'], [1, 1, 1])[3].pinned).toBe(true));
test('transform preserves lock metadata', () => expect(transformSelectedNodes(nodes(), ['c'], [1, 1, 1])[2].lockedAxes).toEqual(['z']));
test('positive translation is exact', () => expect(transformSelectedNodes(nodes(), ['b'], [3, 4, 5])[1].positionMm).toEqual([13, 4, 5]));
test('negative translation is exact', () => expect(transformSelectedNodes(nodes(), ['a'], [-3, -4, -5])[0].positionMm).toEqual([-13, -4, -5]));
test('rotation is bounded by caller input', () => expect(Math.abs(transformSelectedNodes(nodes(), ['a'], [0, 0, 0], { rotationDeg: 30 })[0].positionMm[2])).toBeLessThanOrEqual(10));
test('scale does not create negative factor through helper', () => expect(transformSelectedNodes(nodes(), ['a'], [0, 0, 0], { scale: -1 })[0].positionMm[0]).toBeCloseTo(-10));
test('multi-selection translates together', () => expect(transformSelectedNodes(nodes(), ['a', 'b'], [2, 0, 0]).slice(0, 2).map((n) => n.positionMm[0])).toEqual([-8, 12]));
test('custom pivot scale is deterministic', () => expect(transformSelectedNodes(nodes(), ['a', 'b'], [0, 0, 0], { scale: 1.1, pivot: [0, 0, 0] }).map((n) => n.positionMm[0]).slice(0, 2)).toEqual([-11, 11]));
test('box selection uses inclusive boundaries', () => expect(selectNodesInBox(nodes(), { x0: -10, y0: 0, x1: -10, y1: 0 })).toEqual(['a']));
test('selected transform output is a new array', () => expect(transformSelectedNodes(nodes(), ['a'], [1, 0, 0])).not.toBe(nodes()));
test('selection helper does not mutate input', () => { const input = nodes(); transformSelectedNodes(input, ['a'], [1, 0, 0]); expect(input[0].positionMm).toEqual([-10, 0, 0]); });
test('scale preserves y when scale is scalar', () => expect(transformSelectedNodes(nodes(), ['a'], [0, 0, 0], { scale: 2 })[0].positionMm[1]).toBe(0));
test('rotation preserves stable coordinate length', () => expect(transformSelectedNodes(nodes(), ['a'], [0, 0, 0], { rotationDeg: 15 })[0].positionMm.length).toBe(3));
test('box selection returns ids rather than objects', () => expect(selectNodesInBox(nodes(), { x0: -100, y0: -100, x1: 100, y1: 100 }).every((id) => typeof id === 'string')).toBe(true));
