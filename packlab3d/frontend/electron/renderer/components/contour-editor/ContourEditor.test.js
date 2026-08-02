import { mountContourEditor } from './ContourEditor.js';
import { validateContourPoints } from './contourGeometry.js';

const i18n = { t: (_key, fallback) => fallback };

function host() {
  document.body.innerHTML = '<div id="root"></div>';
  return document.getElementById('root');
}

function setRect(node, width = 360, height = 260) {
  node.getBoundingClientRect = () => ({ left: 0, top: 0, width, height, right: width, bottom: height });
}

function pointer(node, type, x, y, extra = {}) {
  node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ...extra }));
}

const contour = {
  revision: 2,
  source: 'automatic',
  points: [
    { id: 'a', x: 0.25, y: 0.2 },
    { id: 'b', x: 0.75, y: 0.2 },
    { id: 'c', x: 0.75, y: 0.8 },
    { id: 'd', x: 0.25, y: 0.8 },
  ],
};

test('contour editor renders visible contour nodes', () => {
  mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  expect(document.querySelectorAll('[data-contour-point-id]').length).toBe(4);
  expect(document.querySelector('[data-contour-path="active"]')).not.toBeNull();
});

test('contour node drag updates normalized coordinates', () => {
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  const svg = document.querySelector('svg');
  setRect(svg);
  const node = document.querySelector('[data-contour-point-id="a"]');
  pointer(node, 'pointerdown', 90, 55);
  pointer(svg, 'pointermove', 120, 80);
  pointer(window, 'pointerup', 120, 80);
  const point = editor.getContour().points.find((item) => item.id === 'a');
  expect(point.x).toBeGreaterThan(0.25);
  expect(point.y).toBeGreaterThan(0.2);
});

test('one drag creates one undoable contour history entry', () => {
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  const svg = document.querySelector('svg');
  setRect(svg);
  pointer(document.querySelector('[data-contour-point-id="a"]'), 'pointerdown', 90, 55);
  pointer(svg, 'pointermove', 125, 80);
  pointer(svg, 'pointermove', 130, 85);
  pointer(window, 'pointerup', 130, 85);
  const changed = editor.getContour().points.find((item) => item.id === 'a').x;
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Undo').click();
  const restored = editor.getContour().points.find((item) => item.id === 'a').x;
  expect(restored).toBeLessThan(changed);
});

test('contour insertion adds a stable manual point', () => {
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Insert Node').click();
  expect(editor.getContour().points.length).toBe(5);
  expect(editor.getContour().points.some((point) => point.id.startsWith('manual-contour-'))).toBe(true);
});

test('contour deletion preserves minimum point count', () => {
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  setRect(document.querySelector('svg'));
  pointer(document.querySelector('[data-contour-point-id="a"]'), 'pointerdown', 90, 55);
  pointer(window, 'pointerup', 90, 55);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Delete Node').click();
  expect(editor.getContour().points.length).toBe(3);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Delete Node').click();
  expect(editor.getContour().points.length).toBeGreaterThanOrEqual(3);
});

test('locked contour node is not moved by drag', () => {
  const lockedContour = { ...contour, points: contour.points.map((point) => point.id === 'a' ? { ...point, locked: true } : point) };
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour: lockedContour });
  setRect(document.querySelector('svg'));
  pointer(document.querySelector('[data-contour-point-id="a"]'), 'pointerdown', 90, 55);
  pointer(document.querySelector('svg'), 'pointermove', 150, 150);
  pointer(window, 'pointerup', 150, 150);
  expect(editor.getContour().points.find((point) => point.id === 'a').x).toBe(0.25);
});

test('contour smoothing mutates selected unlocked node', () => {
  const editor = mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour });
  setRect(document.querySelector('svg'));
  pointer(document.querySelector('[data-contour-point-id="a"]'), 'pointerdown', 90, 55);
  pointer(window, 'pointerup', 90, 55);
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Smooth').click();
  expect(editor.getContour().points.find((point) => point.id === 'a').x).toBeGreaterThan(0.25);
});

test('contour validation rejects self-intersection', () => {
  const invalid = validateContourPoints([
    { id: 'a', x: 0.2, y: 0.2 },
    { id: 'b', x: 0.8, y: 0.8 },
    { id: 'c', x: 0.8, y: 0.2 },
    { id: 'd', x: 0.2, y: 0.8 },
  ]);
  expect(invalid.valid).toBe(false);
});

test('saving valid contour sends expected revision and points', async () => {
  const save = jest.fn().mockResolvedValue({ contour: { revision: 3 } });
  mountContourEditor(host(), { i18n, photo: { id: 'p1', width: 100, height: 100 }, contour, onSaveContour: save });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2, points: expect.any(Array) }));
});

test('revision conflict is surfaced through onConflict callback', async () => {
  const error = new Error('conflict');
  error.status = 409;
  error.detail = { error: 'revision_conflict', currentRevision: 4 };
  const onConflict = jest.fn();
  mountContourEditor(host(), {
    i18n,
    photo: { id: 'p1', width: 100, height: 100 },
    contour,
    onSaveContour: jest.fn().mockRejectedValue(error),
    onConflict,
  });
  [...document.querySelectorAll('button')].find((button) => button.textContent === 'Save').click();
  await Promise.resolve();
  await Promise.resolve();
  expect(onConflict).toHaveBeenCalledWith(error, expect.objectContaining({ resource: 'contour' }));
});
