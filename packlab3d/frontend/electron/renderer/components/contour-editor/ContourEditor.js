import { actionButton, makePanel, svgEl, tr } from '../editorUtils.js';
import { createCoordinateMapper } from '../photo-geometry/CoordinateMapper.js';
import { nearestSegment, normalizeContour, simplifyPoints, smoothPoints, validateContourPoints } from './contourGeometry.js';

const WIDTH = 360;
const HEIGHT = 260;

export function mountContourEditor(container, { i18n, photo, contour, landmarks = [], onSaveContour, onDirty, onConflict } = {}) {
  const panel = makePanel(tr('phase7.geometry.contourEditor', 'Contour Editor', i18n));
  const toolbar = document.createElement('div');
  toolbar.className = 'contour-editor__toolbar';
  const svg = svgEl('svg', { class: 'contour-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' });
  const status = document.createElement('div');
  status.className = 'contour-editor__status';
  const validation = document.createElement('div');
  validation.className = 'contour-editor__validation';
  panel.append(toolbar, svg, status, validation);
  container.appendChild(panel);

  const mapper = createCoordinateMapper({
    sourceWidth: photo?.width || photo?.workingWidth || WIDTH,
    sourceHeight: photo?.height || photo?.workingHeight || HEIGHT,
    workingWidth: photo?.workingWidth || photo?.width || WIDTH,
    workingHeight: photo?.workingHeight || photo?.height || HEIGHT,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    rotation: photo?.rotation || 0,
    objectBounds: contour?.normalizedSilhouette?.objectBounds || { x: 0.12, y: 0.08, width: 0.76, height: 0.84 },
    centerlineX: contour?.normalizedSilhouette?.centerlineX ?? 0.5,
    supportPlaneY: contour?.normalizedSilhouette?.supportPlaneY ?? 0.92,
  });
  let current = normalizeContour(contour, photo);
  let points = current.points.map((point) => ({ ...point }));
  let selectedIds = new Set();
  let history = [];
  let redoStack = [];
  let drag = null;
  let dirty = false;

  toolbar.append(
    actionButton(tr('phase7.geometry.insertNode', 'Insert Node', i18n), insertNode),
    actionButton(tr('phase7.geometry.deleteNode', 'Delete Node', i18n), deleteSelected),
    actionButton(tr('phase7.geometry.smooth', 'Smooth', i18n), smoothSelected),
    actionButton(tr('phase7.geometry.simplify', 'Simplify', i18n), simplifySelected),
    actionButton(tr('phase7.geometry.lockNode', 'Lock/Unlock', i18n), toggleLock),
    actionButton(tr('phase7.geometry.restoreContour', 'Restore Automatic', i18n), restoreAutomatic),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.save', 'Save', i18n), save)
  );

  svg.addEventListener('pointerdown', pointerDown);
  svg.addEventListener('pointermove', pointerMove);
  window.addEventListener('pointerup', pointerUp);
  render();

  function render() {
    svg.innerHTML = '';
    const bg = svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#0d1f34' });
    const bounds = svgEl('rect', { x: 36, y: 20, width: WIDTH - 72, height: HEIGHT - 40, class: 'contour-editor__bounds' });
    const center = mapper.normalizedToCanvasCss({ normalizedX: mapper.config.centerlineX, normalizedY: 0.5 });
    const support = mapper.normalizedToCanvasCss({ normalizedX: 0.5, normalizedY: mapper.config.supportPlaneY });
    const centerline = svgEl('line', { x1: center.canvasCssX, y1: 12, x2: center.canvasCssX, y2: HEIGHT - 12, class: 'contour-editor__centerline' });
    const supportLine = svgEl('line', { x1: 18, y1: support.canvasCssY, x2: WIDTH - 18, y2: support.canvasCssY, class: 'contour-editor__support' });
    svg.append(bg, bounds, centerline, supportLine);

    const path = contourPath(points);
    svg.appendChild(svgEl('path', { d: path, class: 'contour-editor__path', 'data-contour-path': 'active' }));
    for (const landmark of landmarks || []) {
      const css = mapper.normalizedToCanvasCss({ normalizedX: landmark.x ?? 0.5, normalizedY: 1 - (landmark.y ?? 0.5) });
      svg.appendChild(svgEl('circle', { cx: css.canvasCssX, cy: css.canvasCssY, r: 3, class: 'contour-editor__landmark' }));
    }
    points.forEach((point) => {
      const css = mapper.normalizedToCanvasCss({ normalizedX: point.x, normalizedY: point.y });
      const attrs = {
        cx: css.canvasCssX,
        cy: css.canvasCssY,
        r: selectedIds.has(point.id) ? 6 : 4,
        class: `contour-editor__node${point.locked ? ' contour-editor__node--locked' : ''}`,
        'data-contour-point-id': point.id,
      };
      const circle = svgEl('circle', attrs);
      circle.addEventListener('pointerdown', (event) => startDrag(event, point.id));
      svg.appendChild(circle);
    });
    const report = validateContourPoints(points);
    status.textContent = `${tr('phase7.geometry.points', 'Points', i18n)}: ${points.length} | ${tr('phase7.geometry.revision', 'Revision', i18n)}: ${current.revision}`;
    validation.textContent = report.valid
      ? tr('phase7.geometry.validContour', 'Contour is valid.', i18n)
      : `${tr('phase7.geometry.invalidContour', 'Contour validation failed', i18n)}: ${report.errors.join(' ')}`;
  }

  function contourPath(items) {
    return items.map((point, index) => {
      const css = mapper.normalizedToCanvasCss({ normalizedX: point.x, normalizedY: point.y });
      return `${index === 0 ? 'M' : 'L'} ${css.canvasCssX.toFixed(2)} ${css.canvasCssY.toFixed(2)}`;
    }).join(' ') + ' Z';
  }

  function pointerDown(event) {
    if (event.target?.dataset?.contourPointId) return;
    const norm = fromEvent(event);
    const nearest = nearestSegment(points, { x: norm.normalizedX, y: norm.normalizedY });
    if (nearest.distance < 0.045) {
      selectedIds = new Set([points[nearest.index].id]);
      render();
    }
  }

  function startDrag(event, id) {
    event.preventDefault();
    const point = points.find((item) => item.id === id);
    if (!point || point.locked) return;
    if (!event.shiftKey) selectedIds = new Set([id]);
    else selectedIds.add(id);
    drag = { id, before: points.map((item) => ({ ...item })) };
    render();
  }

  function pointerMove(event) {
    if (!drag) return;
    const norm = fromEvent(event);
    points = points.map((point) => selectedIds.has(point.id) && !point.locked
      ? { ...point, x: norm.normalizedX, y: norm.normalizedY, source: 'manual' }
      : point);
    dirty = true;
    onDirty?.({ type: 'contour-drag', photoId: photo?.uploadedId || photo?.id });
    render();
  }

  function pointerUp() {
    if (!drag) return;
    pushHistory(drag.before);
    drag = null;
  }

  function insertNode() {
    const target = selectedIds.size ? points.find((point) => selectedIds.has(point.id)) : points[0];
    const nearest = nearestSegment(points, target || { x: 0.5, y: 0.5 });
    const a = points[nearest.index];
    const b = points[(nearest.index + 1) % points.length];
    mutate(() => {
      const inserted = {
        id: `manual-contour-${Date.now().toString(36)}`,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        locked: false,
        source: 'manual',
      };
      points.splice(nearest.index + 1, 0, inserted);
      selectedIds = new Set([inserted.id]);
    }, 'contour-insert');
  }

  function deleteSelected() {
    if (!selectedIds.size || points.length - selectedIds.size < 3) {
      validation.textContent = tr('phase7.geometry.minimumPoints', 'A contour needs at least 3 points.', i18n);
      return;
    }
    mutate(() => {
      points = points.filter((point) => !selectedIds.has(point.id) || point.locked);
      selectedIds = new Set();
    }, 'contour-delete');
  }

  function smoothSelected() {
    mutate(() => {
      points = smoothPoints(points, selectedIds, 0.35);
    }, 'contour-smooth');
  }

  function simplifySelected() {
    mutate(() => {
      points = simplifyPoints(points, selectedIds, 0.018);
    }, 'contour-simplify');
  }

  function toggleLock() {
    mutate(() => {
      points = points.map((point) => selectedIds.has(point.id) ? { ...point, locked: !point.locked } : point);
    }, 'contour-lock');
  }

  function restoreAutomatic() {
    mutate(() => {
      current = normalizeContour(contour?.automatic || contour, photo);
      points = current.points.map((point) => ({ ...point }));
      selectedIds = new Set();
    }, 'contour-restore');
  }

  function undo() {
    if (!history.length) return;
    redoStack.push(points.map((point) => ({ ...point })));
    points = history.pop();
    dirty = true;
    render();
  }

  function redo() {
    if (!redoStack.length) return;
    history.push(points.map((point) => ({ ...point })));
    points = redoStack.pop();
    dirty = true;
    render();
  }

  async function save() {
    const report = validateContourPoints(points);
    if (!report.valid) {
      validation.textContent = `${tr('phase7.geometry.invalidContour', 'Contour validation failed', i18n)}: ${report.errors.join(' ')}`;
      return;
    }
    try {
      const result = await onSaveContour?.({
        expectedRevision: current.revision,
        points: points.map((point) => ({ ...point })),
        reason: 'manual contour edit',
      });
      current.revision = result?.contour?.revision ?? result?.geometry?.revisions?.activeContour ?? current.revision + 1;
      dirty = false;
      status.textContent = tr('phase7.geometry.contourSaved', 'Manual contour saved and reconstruction marked stale.', i18n);
    } catch (err) {
      if (err.status === 409) onConflict?.(err, { resource: 'contour', local: { points, expectedRevision: current.revision } });
      else throw err;
    }
  }

  function mutate(callback, type) {
    const before = points.map((point) => ({ ...point }));
    callback();
    pushHistory(before);
    dirty = true;
    redoStack = [];
    onDirty?.({ type, photoId: photo?.uploadedId || photo?.id });
    render();
  }

  function pushHistory(before) {
    history.push(before);
    if (history.length > 50) history.shift();
  }

  function fromEvent(event) {
    const rect = svg.getBoundingClientRect();
    return mapper.canvasCssToNormalized({
      canvasCssX: event.clientX - rect.left,
      canvasCssY: event.clientY - rect.top,
    });
  }

  return {
    getContour: () => ({ revision: current.revision, points: points.map((point) => ({ ...point })) }),
    getValidation: () => validateContourPoints(points),
    isDirty: () => dirty,
    destroy() {
      window.removeEventListener('pointerup', pointerUp);
    },
  };
}
