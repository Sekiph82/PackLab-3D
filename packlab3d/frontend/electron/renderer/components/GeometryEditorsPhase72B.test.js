import { applyCageDelta, constrainedDelta, selectNodesInBox, selectionPivot, transformSelectedNodes } from './editors/cage/ControlCageEditor.js';

const nodes = [
  { id: 'a', positionMm: [0, 0, 0], restPositionMm: [0, 0, 0] },
  { id: 'b', positionMm: [10, 20, 0], restPositionMm: [10, 20, 0] },
  { id: 'c', positionMm: [0, 40, 10], restPositionMm: [0, 40, 10], pinned: true },
  { id: 'd', positionMm: [-10, 60, 0], restPositionMm: [-10, 60, 0], lockedAxes: ['x'] },
];

test('selection pivot is centroid of selected nodes', () => expect(selectionPivot(nodes, ['a', 'b'])).toEqual([5, 10, 0]));
test('empty selection pivot is origin', () => expect(selectionPivot(nodes, [])).toEqual([0, 0, 0]));
test('box selection returns nodes inside bounds', () => expect(selectNodesInBox(nodes, { x0: -1, y0: -1, x1: 11, y1: 21 })).toEqual(['a', 'b', 'c']));
test('box selection ignores nodes outside bounds', () => expect(selectNodesInBox(nodes, { x0: -1, y0: -1, x1: 1, y1: 1 })).toEqual(['a']));
test('box selection accepts reversed corners', () => expect(selectNodesInBox(nodes, { x0: 11, y0: 21, x1: -1, y1: -1 })).toEqual(['a', 'b', 'c']));
test('box projection can use screen coordinates', () => expect(selectNodesInBox(nodes, { x0: 0, y0: 0, x1: 15, y1: 15 }, (node) => ({ x: node.positionMm[0] + 5, y: node.positionMm[2] + 5 }))).toEqual(['a', 'b', 'c']));
test('constrained delta blocks pinned nodes', () => expect(constrainedDelta({ pinned: true }, [4, 5, 6])).toEqual([0, 0, 0]));
test('constrained delta blocks x axis', () => expect(constrainedDelta({ lockedAxes: ['x'] }, [4, 5, 6])).toEqual([0, 5, 6]));
test('constrained delta blocks multiple axes', () => expect(constrainedDelta({ lockedAxes: ['x', 'z'] }, [4, 5, 6])).toEqual([0, 5, 0]));
test('constrained delta accepts free movement', () => expect(constrainedDelta({}, [4, 5, 6])).toEqual([4, 5, 6]));
test('single cage movement changes selected node', () => expect(applyCageDelta(nodes, ['a'], [3, 0, 2])[0].positionMm).toEqual([3, 0, 2]));
test('unselected cage nodes remain unchanged', () => expect(applyCageDelta(nodes, ['a'], [3, 0, 2])[1].positionMm).toEqual([10, 20, 0]));
test('pinned cage node remains unchanged', () => expect(applyCageDelta(nodes, ['c'], [3, 0, 2])[2].positionMm).toEqual([0, 40, 10]));
test('axis locked cage node remains exact on locked axis', () => expect(applyCageDelta(nodes, ['d'], [3, 0, 2])[3].positionMm[0]).toBe(-10));
test('axis unlocked cage node changes allowed axis', () => expect(applyCageDelta(nodes, ['d'], [3, 0, 2])[3].positionMm[2]).toBe(2));
test('transform scale changes selected distance from pivot', () => expect(transformSelectedNodes(nodes, ['a', 'b'], [0, 0, 0], { scale: 2 })[0].positionMm).toEqual([-5, -10, 0]));
test('transform translation applies to selected nodes', () => expect(transformSelectedNodes(nodes, ['a', 'b'], [2, 3, 4])[0].positionMm).toEqual([2, 3, 4]));
test('transform leaves unselected nodes unchanged', () => expect(transformSelectedNodes(nodes, ['a'], [2, 3, 4])[1].positionMm).toEqual([10, 20, 0]));
test('transform preserves pinned selected node', () => expect(transformSelectedNodes(nodes, ['c'], [2, 3, 4])[2].positionMm).toEqual([0, 40, 10]));
test('transform preserves locked axis', () => expect(transformSelectedNodes(nodes, ['d'], [3, 4, 5])[3].positionMm[0]).toBe(-10));
test('transform rotation changes selected position', () => expect(transformSelectedNodes(nodes, ['b'], [0, 0, 0], { rotationDeg: 90, pivot: [0, 0, 0] })[1].positionMm[0]).toBeCloseTo(0));
test('transform rotation remains finite', () => expect(transformSelectedNodes(nodes, ['b'], [0, 0, 0], { rotationDeg: 45 })[1].positionMm.every(Number.isFinite)).toBe(true));
test('transform zero scale is bounded', () => expect(transformSelectedNodes(nodes, ['a'], [0, 0, 0], { scale: 0 })[0].positionMm.every(Number.isFinite)).toBe(true));
test('falloff argument remains accepted for local', () => expect(applyCageDelta(nodes, ['a'], [1, 0, 0], { falloff: 'local' })).toHaveLength(4));
test('falloff argument remains accepted for medium', () => expect(applyCageDelta(nodes, ['a'], [1, 0, 0], { falloff: 'medium' })).toHaveLength(4));
test('falloff argument remains accepted for wide', () => expect(applyCageDelta(nodes, ['a'], [1, 0, 0], { falloff: 'wide' })).toHaveLength(4));
test('selection IDs are stable through transform', () => expect(transformSelectedNodes(nodes, ['a', 'b'], [1, 0, 0]).map((node) => node.id)).toEqual(['a', 'b', 'c', 'd']));
test('rest positions are not mutated by transform', () => { const value = transformSelectedNodes(nodes, ['a'], [2, 0, 0]); expect(value[0].restPositionMm).toEqual([0, 0, 0]); });
test('node arrays are copied by cage delta', () => { const value = applyCageDelta(nodes, ['a'], [2, 0, 0]); expect(value).not.toBe(nodes); });
test('selection with missing ID is harmless', () => expect(selectionPivot(nodes, ['missing'])).toEqual([0, 0, 0]));
test('box selection with empty bounds is deterministic', () => expect(selectNodesInBox(nodes, { x0: 1, y0: 1, x1: 1, y1: 1 })).toEqual([]));
test('transform metadata supports an explicit pivot', () => expect(transformSelectedNodes(nodes, ['a'], [0, 0, 0], { pivot: [5, 0, 0] })[0].positionMm).toEqual([0, 0, 0]));
