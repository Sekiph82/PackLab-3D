import { mountMaskEditor } from './mask-editor/MaskEditor.js';
import { mountLandmarkEditor } from './landmark-editor/LandmarkEditor.js';
import { mountProfileEditor } from './editors/profile/ProfileEditor.js';
import { mountSectionEditor } from './editors/section/SectionEditor.js';
import { mountControlCageEditor } from './editors/cage/ControlCageEditor.js';
import { mountDrawingWorkspace } from './drawing/DrawingWorkspace.js';
import { mountVersionManager } from './versioning/VersionManager.js';
import { mountAutosaveStatus } from './recovery/AutosaveStatus.js';
import { applyEvidenceBasedViewAssignments, suggestedViewFromPhoto } from './photo-analysis/ViewAssignmentEditor.js';

const i18n = { t: (_key, fallback) => fallback };

function host() {
  document.body.innerHTML = '<div id="root"></div>';
  return document.getElementById('root');
}

function setRect(node, width = 320, height = 240) {
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
}

function mouse(node, type, x, y, extra = {}) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...extra }));
}

const model = {
  heightMm: 120,
  frontProfile: [
    { id: 'fp-0', heightRatio: 0, halfExtentMm: 18 },
    { id: 'fp-1', heightRatio: 0.5, halfExtentMm: 24 },
    { id: 'fp-2', heightRatio: 1, halfExtentMm: 12 },
  ],
  sideProfile: [
    { id: 'sp-0', heightRatio: 0, halfExtentMm: 14 },
    { id: 'sp-1', heightRatio: 0.5, halfExtentMm: 18 },
    { id: 'sp-2', heightRatio: 1, halfExtentMm: 10 },
  ],
  crossSections: [
    { id: 'section-0', heightRatio: 0, widthMm: 36, depthMm: 24 },
    { id: 'section-1', heightRatio: 0.5, widthMm: 48, depthMm: 32 },
    { id: 'section-2', heightRatio: 1, widthMm: 24, depthMm: 20 },
  ],
  controlCage: {
    nodes: [
      { id: 'cage-a', positionMm: [-20, 0, -12] },
      { id: 'cage-b', positionMm: [20, 0, -12] },
      { id: 'cage-c', positionMm: [20, 0, 12] },
    ],
    edges: [['cage-a', 'cage-b'], ['cage-b', 'cage-c']],
  },
};

const drawing = {
  views: [{ id: 'front-view', type: 'front', visible: true, placement: { x: 40, y: 40 } }],
  dimensions: [{ id: 'dim-overall-height-front', valueMm: 120, placement: { offset: 28, textOffset: [0, 0] }, visible: true }],
  notes: [],
  referenceLines: [],
  sectionLines: [],
  sectionViews: [],
  titleBlock: { title: 'Drawing' },
};

test('mask brush changes mask checksum and save emits changed pixels', async () => {
  const save = jest.fn();
  const root = host();
  const editor = mountMaskEditor(root, { i18n, photo: { id: 'p1', url: '' }, onSaveMask: save });
  const before = editor.getMaskChecksum();
  const canvas = document.querySelector('canvas');
  setRect(canvas, 192, 256);
  mouse(canvas, 'mousedown', 20, 20);
  mouse(canvas, 'mousemove', 26, 26);
  mouse(window, 'mouseup', 26, 26);
  expect(editor.getMaskChecksum()).not.toBe(before);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save Mask').click();
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ width: 192, height: 256, checksum: editor.getMaskChecksum() }));
});

test('landmark drag updates coordinates and save emits manual landmarks', async () => {
  const save = jest.fn();
  host();
  mountLandmarkEditor(document.getElementById('root'), {
    i18n,
    photo: { id: 'p1', viewType: 'front' },
    landmarks: [{ id: 'lm-1', type: 'shoulder-transition', x: 0.4, y: 0.4, confidence: 0.8 }],
    onSave: save,
  });
  const svg = document.querySelector('svg');
  setRect(svg, 320, 220);
  const point = document.querySelector('[data-landmark-id="lm-1"]');
  mouse(point, 'mousedown', 128, 132);
  mouse(svg, 'mousemove', 240, 60);
  mouse(window, 'mouseup', 240, 60);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(save.mock.calls[0][0][0]).toEqual(expect.objectContaining({ id: 'lm-1', x: expect.any(Number), y: expect.any(Number), source: 'manual' }));
  expect(save.mock.calls[0][0][0].x).toBeGreaterThan(0.7);
});

test('landmark add, lock, mirror, undo, and redo mutate editor state', () => {
  const root = host();
  const editor = mountLandmarkEditor(root, { i18n, photo: { id: 'p1', viewType: 'front' }, landmarks: [] });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Landmark').click();
  expect(editor.getLandmarks()).toHaveLength(3);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Lock/Unlock').click();
  expect(editor.getLandmarks().some((item) => item.locked)).toBe(true);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  expect(editor.getLandmarks().some((item) => item.locked)).toBe(false);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Redo').click();
  expect(editor.getLandmarks().some((item) => item.locked)).toBe(true);
});

test('profile editor drag emits changed profile point patch', async () => {
  const apply = jest.fn();
  host();
  mountProfileEditor(document.getElementById('root'), { i18n, model, onApply: apply });
  const svg = document.querySelector('svg');
  setRect(svg, 320, 240);
  const point = document.querySelector('[data-profile-point-id="fp-1"]');
  mouse(point, 'mousedown', 200, 120);
  mouse(svg, 'mousemove', 315, 90);
  mouse(window, 'mouseup', 315, 90);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply').click();
  await Promise.resolve();
  const moved = apply.mock.calls[0][0].profilePoints.find((item) => item.id === 'fp-1');
  expect(moved.halfExtentMm).toBeGreaterThan(24);
});

test('profile editor insert and delete change control point count before apply', () => {
  host();
  const editor = mountProfileEditor(document.getElementById('root'), { i18n, model, onApply: jest.fn() });
  document.querySelector('[data-profile-point-id="fp-1"]').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 160, clientY: 120 }));
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Insert Point').click();
  expect(editor.getPoints()).toHaveLength(4);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Delete Point').click();
  expect(editor.getPoints()).toHaveLength(3);
});

test('section editor drag width handle emits changed section patch', async () => {
  const apply = jest.fn();
  host();
  mountSectionEditor(document.getElementById('root'), { i18n, model, onApply: apply });
  const svg = document.querySelector('svg');
  setRect(svg, 300, 240);
  const widthHandle = document.querySelector('[data-handle="width"]');
  mouse(widthHandle, 'mousedown', 210, 120);
  mouse(svg, 'mousemove', 250, 120);
  mouse(window, 'mouseup', 250, 120);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply').click();
  await Promise.resolve();
  expect(apply.mock.calls[0][0].sections.some((section) => section.widthMm > 70)).toBe(true);
});

test('section editor add duplicate delete and smooth mutate section state through DOM', () => {
  host();
  mountSectionEditor(document.getElementById('root'), { i18n, model, onApply: jest.fn() });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Section').click();
  expect(document.querySelectorAll('select option')).toHaveLength(4);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Duplicate').click();
  expect(document.querySelectorAll('select option')).toHaveLength(5);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Delete').click();
  expect(document.querySelectorAll('select option')).toHaveLength(4);
});

test('control cage drag emits node delta patch', async () => {
  const apply = jest.fn();
  host();
  mountControlCageEditor(document.getElementById('root'), { i18n, cage: model.controlCage, onApply: apply });
  const svg = document.querySelector('svg');
  setRect(svg, 320, 240);
  const node = document.querySelector('[data-cage-node-id="cage-b"]');
  mouse(node, 'mousedown', 290, 210);
  mouse(svg, 'mousemove', 260, 160);
  mouse(window, 'mouseup', 260, 160);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply').click();
  await Promise.resolve();
  expect(apply.mock.calls[0][0].cageNodes[0]).toEqual(expect.objectContaining({ id: 'cage-b', deltaMm: expect.any(Array) }));
});

test('control cage supports multi-selection with shift click', () => {
  host();
  mountControlCageEditor(document.getElementById('root'), { i18n, cage: model.controlCage, onApply: jest.fn() });
  mouse(document.querySelector('[data-cage-node-id="cage-a"]'), 'mousedown', 40, 200);
  mouse(document.querySelector('[data-cage-node-id="cage-b"]'), 'mousedown', 290, 200, { shiftKey: true });
  expect(document.querySelector('.interactive-editor__status').textContent).toContain('Selected: 2');
});

test('drawing workspace adds note by canvas click and save persists it', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Note').click();
  mouse(svg, 'mousedown', 200, 140);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].notes[0]).toEqual(expect.objectContaining({ text: 'New note', x: expect.any(Number), y: expect.any(Number) }));
});

test('drawing workspace drags dimension line and preserves changed placement', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  const dim = document.querySelector('[data-entity-kind="dimension"]');
  mouse(dim, 'mousedown', 70, 80);
  mouse(svg, 'mousemove', 70, 120);
  mouse(window, 'mouseup', 70, 120);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].dimensions[0].placement.offset).toBeGreaterThan(28);
});

test('drawing workspace drags dimension text separately from dimension line', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  const text = document.querySelector('[data-entity-kind="dimension-text"]');
  mouse(text, 'mousedown', 80, 120);
  mouse(svg, 'mousemove', 100, 130);
  mouse(window, 'mouseup', 100, 130);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].dimensions[0].placement.textOffset).toEqual([20, 10]);
});

test('drawing workspace draws a section line and linked section view', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Section Line').click();
  mouse(svg, 'mousedown', 100, 100);
  mouse(window, 'mouseup', 180, 180);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].sectionLines[0].points).toHaveLength(2);
});

test('drawing workspace auto-arranges dimensions without removing notes', async () => {
  const patch = jest.fn();
  const drawingWithNote = { ...drawing, notes: [{ id: 'note-1', text: 'Keep me', x: 20, y: 30 }] };
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawingWithNote, onPatch: patch });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Auto Arrange Dimensions').click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].notes[0].text).toBe('Keep me');
});

test('version manager save compare and restore call project callbacks', async () => {
  const callbacks = { onSave: jest.fn(), onCompare: jest.fn(), onRestore: jest.fn() };
  window.confirm = jest.fn(() => true);
  host();
  mountVersionManager(document.getElementById('root'), {
    i18n,
    versions: [{ id: 'v1', name: 'A' }, { id: 'v2', name: 'B' }],
    comparison: { changes: ['Height changed'] },
    ...callbacks,
  });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save Version').click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Compare Versions').click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Restore Version').click();
  await Promise.resolve();
  expect(callbacks.onSave).toHaveBeenCalled();
  expect(callbacks.onCompare).toHaveBeenCalledWith('v1', 'v2');
  expect(callbacks.onRestore).toHaveBeenCalledWith('v1');
});

test('autosave status invokes save restore and discard callbacks', () => {
  const callbacks = { onAutosave: jest.fn(), onRestore: jest.fn(), onDiscard: jest.fn() };
  host();
  mountAutosaveStatus(document.getElementById('root'), { i18n, projectId: 'project-1', dirty: true, recovery: { available: true }, ...callbacks });
  [...document.querySelectorAll('button')].forEach((button) => button.click());
  expect(callbacks.onAutosave).toHaveBeenCalled();
  expect(callbacks.onRestore).toHaveBeenCalled();
  expect(callbacks.onDiscard).toHaveBeenCalled();
});

test.each([
  [{ width: 2000, height: 1200 }, 'top'],
  [{ width: 800, height: 2200 }, 'left'],
  [{ width: 1200, height: 1600, quality: { recommendedRoles: ['front_right'] } }, 'front_right'],
])('view suggestion uses image evidence %#', (photo, expected) => {
  expect(suggestedViewFromPhoto(photo, [])).toBe(expected);
});

test('evidence based auto assignment is not a simple shuffled index mapping', () => {
  const photos = [
    { id: 'wide-top', width: 2000, height: 1100 },
    { id: 'tall-side', width: 700, height: 1800 },
    { id: 'role-front-right', width: 1200, height: 1400, quality: { recommendedRoles: ['front_right'] } },
  ];
  applyEvidenceBasedViewAssignments(photos);
  expect(photos.map((photo) => photo.viewType)).toEqual(['top', 'left', 'front_right']);
});

test('mask undo and redo restore real pixel state', () => {
  const root = host();
  const editor = mountMaskEditor(root, { i18n, photo: { id: 'p1', url: '' } });
  const canvas = document.querySelector('canvas');
  setRect(canvas, 192, 256);
  const before = editor.getMaskChecksum();
  mouse(canvas, 'mousedown', 12, 12);
  mouse(window, 'mouseup', 12, 12);
  const after = editor.getMaskChecksum();
  expect(after).not.toBe(before);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  expect(editor.getMaskChecksum()).toBe(before);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Redo').click();
  expect(editor.getMaskChecksum()).toBe(after);
});

test('locked landmark cannot be dragged until unlocked', () => {
  const root = host();
  const editor = mountLandmarkEditor(root, {
    i18n,
    photo: { id: 'p1', viewType: 'front' },
    landmarks: [{ id: 'lm-lock', type: 'cap-top', x: 0.25, y: 0.25, locked: true }],
  });
  const svg = document.querySelector('svg');
  setRect(svg, 320, 220);
  mouse(document.querySelector('[data-landmark-id="lm-lock"]'), 'mousedown', 80, 165);
  mouse(svg, 'mousemove', 300, 40);
  expect(editor.getLandmarks()[0].x).toBe(0.25);
});

test('profile smooth changes selected midpoint toward neighboring points', () => {
  const root = host();
  const editor = mountProfileEditor(root, { i18n, model, onApply: jest.fn() });
  mouse(document.querySelector('[data-profile-point-id="fp-1"]'), 'mousedown', 200, 120);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Smooth').click();
  expect(editor.getPoints().find((point) => point.id === 'fp-1').halfExtentMm).toBe(15);
});

test('section editor switches selected section through list', () => {
  host();
  mountSectionEditor(document.getElementById('root'), { i18n, model, onApply: jest.fn() });
  const select = document.querySelector('select');
  select.value = 'section-2';
  select.dispatchEvent(new Event('change'));
  expect(document.querySelector('.interactive-editor__status').textContent).toContain('section-2');
});

test('section editor undo restores width after drag', () => {
  host();
  mountSectionEditor(document.getElementById('root'), { i18n, model, onApply: jest.fn() });
  const svg = document.querySelector('svg');
  setRect(svg, 300, 240);
  const handle = document.querySelector('[data-handle="width"]');
  mouse(handle, 'mousedown', 210, 120);
  mouse(svg, 'mousemove', 250, 120);
  mouse(window, 'mouseup', 250, 120);
  expect(document.querySelector('.interactive-editor__status').textContent).toContain('83.333');
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  expect(document.querySelector('.interactive-editor__status').textContent).toContain('48');
});

test('control cage pin prevents dragged node from changing delta', async () => {
  const apply = jest.fn();
  host();
  mountControlCageEditor(document.getElementById('root'), { i18n, cage: model.controlCage, onApply: apply });
  mouse(document.querySelector('[data-cage-node-id="cage-b"]'), 'mousedown', 290, 200);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Pin/Unpin').click();
  const svg = document.querySelector('svg');
  setRect(svg, 320, 240);
  mouse(document.querySelector('[data-cage-node-id="cage-b"]'), 'mousedown', 290, 200);
  mouse(svg, 'mousemove', 240, 140);
  mouse(window, 'mouseup', 240, 140);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply').click();
  await Promise.resolve();
  expect(apply.mock.calls[0][0].cageNodes[0]).toEqual({ id: 'cage-b', deltaMm: [0, 0, 0] });
});

test('drawing workspace drags note position', async () => {
  const patch = jest.fn();
  const doc = { ...drawing, notes: [{ id: 'note-drag', text: 'Move', x: 40, y: 40 }] };
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: doc, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  const note = document.querySelector('[data-entity-kind="note"]');
  mouse(note, 'mousedown', 40, 40);
  mouse(svg, 'mousemove', 80, 70);
  mouse(window, 'mouseup', 80, 70);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].notes[0]).toEqual(expect.objectContaining({ x: 80, y: 70 }));
});

test('drawing workspace creates and drags reference line', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Reference Line').click();
  mouse(svg, 'mousedown', 50, 80);
  const ref = document.querySelector('[data-entity-kind="reference"]');
  mouse(ref, 'mousedown', 50, 80);
  mouse(svg, 'mousemove', 70, 95);
  mouse(window, 'mouseup', 70, 95);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].referenceLines[0]).toEqual(expect.objectContaining({ x1: 70, y1: 95 }));
});

test('drawing workspace adds custom dimension at clicked location', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Dimension').click();
  mouse(svg, 'mousedown', 100, 160);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].dimensions.some((dimension) => dimension.id.startsWith('dim-custom-'))).toBe(true);
});

test('version manager renders comparison changes', () => {
  host();
  mountVersionManager(document.getElementById('root'), {
    i18n,
    versions: [{ id: 'v1', name: 'A' }, { id: 'v2', name: 'B' }],
    comparison: { changes: ['Width changed', 'Note added'] },
  });
  expect(document.querySelector('.version-manager__comparison').textContent).toContain('Width changed');
  expect(document.querySelector('.version-manager__comparison').textContent).toContain('Note added');
});

test('autosave status renders dirty and recovery availability', () => {
  host();
  mountAutosaveStatus(document.getElementById('root'), { i18n, projectId: 'project-1', dirty: true, lastSaved: 'now', recovery: { available: true } });
  expect(document.querySelector('.autosave-status__text').textContent).toContain('Dirty: Yes');
  expect(document.querySelector('.autosave-status__text').textContent).toContain('Recovery available: Yes');
});

test('view suggestion skips already used front before choosing another primary view', () => {
  const suggestion = suggestedViewFromPhoto({ width: 1200, height: 1600 }, [{ viewType: 'front' }]);
  expect(suggestion).toBe('right');
});

test('view assignment keeps one stable custom fallback after coverage is exhausted', () => {
  const photos = Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, width: 1000, height: 1600 }));
  applyEvidenceBasedViewAssignments(photos);
  expect(photos[photos.length - 1].viewType).toBe('custom');
});

test('drawing workspace undo removes a newly added note before save', async () => {
  const patch = jest.fn();
  host();
  mountDrawingWorkspace(document.getElementById('root'), { i18n, document: drawing, onPatch: patch });
  const svg = document.querySelector('svg');
  setRect(svg, 520, 360);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Add Note').click();
  mouse(svg, 'mousedown', 120, 120);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(patch.mock.calls[0][0].notes).toEqual([]);
});

test('control cage undo restores selection movement before apply', async () => {
  const apply = jest.fn();
  host();
  mountControlCageEditor(document.getElementById('root'), { i18n, cage: model.controlCage, onApply: apply });
  const svg = document.querySelector('svg');
  setRect(svg, 320, 240);
  mouse(document.querySelector('[data-cage-node-id="cage-b"]'), 'mousedown', 290, 200);
  mouse(svg, 'mousemove', 250, 150);
  mouse(window, 'mouseup', 250, 150);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Apply').click();
  await Promise.resolve();
  expect(apply.mock.calls[0][0].cageNodes[0].deltaMm).toEqual([0, 0, 0]);
});
