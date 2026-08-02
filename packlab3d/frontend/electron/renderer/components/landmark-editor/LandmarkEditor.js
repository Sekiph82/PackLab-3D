import { actionButton, clamp, el, makePanel, svgEl, tr } from '../editorUtils.js';
import { createCoordinateMapper } from '../photo-geometry/CoordinateMapper.js';

const WIDTH = 320;
const HEIGHT = 220;

export function mountLandmarkEditor(container, { i18n, photo, landmarks = [], onSave, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.landmark.editor', 'Landmark Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const svg = svgEl('svg', { class: 'landmark-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img' });
  const status = el('div', 'interactive-editor__status');
  let selectedId = null;
  let draggingId = null;
  let points = normalizeLandmarks(landmarks, photo);
  let undoStack = [];
  let redoStack = [];
  const revisions = photo?.geometry?.revisions || {};
  let currentRevision = Number(revisions.landmarks ?? photo?.landmarkRevision ?? 0);
  const mapper = createCoordinateMapper({
    sourceWidth: photo?.width || photo?.workingWidth || WIDTH,
    sourceHeight: photo?.height || photo?.workingHeight || HEIGHT,
    workingWidth: photo?.workingWidth || photo?.width || WIDTH,
    workingHeight: photo?.workingHeight || photo?.height || HEIGHT,
    viewportWidth: WIDTH,
    viewportHeight: HEIGHT,
    rotation: photo?.rotation || 0,
  });

  toolbar.append(
    actionButton(tr('phase7.landmark.add', 'Add Landmark', i18n), addLandmark),
    actionButton(tr('phase7.landmark.delete', 'Delete Optional', i18n), deleteSelected),
    actionButton(tr('phase7.landmark.lock', 'Lock/Unlock', i18n), toggleLock),
    actionButton(tr('phase7.landmark.mirror', 'Mirror', i18n), mirrorSelected),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.save', 'Save', i18n), save),
  );
  panel.append(toolbar, svg, status);
  container.appendChild(panel);
  render();

  svg.addEventListener('mousemove', drag);
  svg.addEventListener('pointermove', drag);
  window.addEventListener('mouseup', stop);
  window.addEventListener('pointerup', stop);

  function normalizeLandmarks(items, currentPhoto) {
    const source = items.length ? items : [
      { id: `${currentPhoto?.id || 'photo'}-top`, type: 'highest-visible-point', x: 0.5, y: 0.92, confidence: 0.5, source: 'default', locked: false },
      { id: `${currentPhoto?.id || 'photo'}-support`, type: 'bottom-support-plane', x: 0.5, y: 0.08, confidence: 0.5, source: 'default', locked: false },
    ];
    return source.map((item, index) => ({
      id: item.id || `manual-landmark-${index}`,
      type: item.type || item.name || 'custom',
      view: item.view || currentPhoto?.viewType || 'custom',
      x: clamp(item.x ?? 0.5),
      y: clamp(item.y ?? 0.5),
      confidence: clamp(item.confidence ?? 1),
      source: item.source || 'manual',
      locked: Boolean(item.locked),
    }));
  }

  function snapshot() {
    undoStack.push(JSON.stringify(points));
    redoStack = [];
  }

  function restore(serialized) {
    points = JSON.parse(serialized);
    selectedId = null;
    render();
  }

  function render() {
    svg.innerHTML = '';
    const bg = svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' });
    svg.appendChild(bg);
    points.forEach((point) => {
      const css = mapper.normalizedToCanvasCss({ normalizedX: point.x, normalizedY: 1 - point.y });
      const x = css.canvasCssX;
      const y = css.canvasCssY;
      const circle = svgEl('circle', {
        cx: x,
        cy: y,
        r: selectedId === point.id ? 7 : 5,
        fill: point.locked ? '#f59e0b' : '#0ea5e9',
        stroke: '#082f49',
        'stroke-width': selectedId === point.id ? 2 : 1,
        'data-landmark-id': point.id,
      });
      circle.addEventListener('mousedown', (event) => startDrag(event, point.id));
      circle.addEventListener('pointerdown', (event) => startDrag(event, point.id));
      const label = svgEl('text', { x: x + 8, y: y - 8, 'font-size': 10, fill: '#0f172a' });
      label.textContent = `${point.type} ${(point.confidence * 100).toFixed(0)}%`;
      svg.append(circle, label);
    });
    status.textContent = `${tr('phase7.landmark.count', 'Landmarks', i18n)}: ${points.length}`;
  }

  function startDrag(event, id) {
    event.preventDefault();
    selectedId = id;
    draggingId = id;
    snapshot();
    render();
  }

  function drag(event) {
    if (!draggingId) return;
    event.preventDefault();
    const point = points.find((item) => item.id === draggingId);
    if (!point || point.locked) return;
    const rect = svg.getBoundingClientRect();
    const normalized = mapper.canvasCssToNormalized({
      canvasCssX: event.clientX - rect.left,
      canvasCssY: event.clientY - rect.top,
    });
    point.x = clamp(normalized.normalizedX);
    point.y = clamp(1 - normalized.normalizedY);
    point.source = 'manual';
    point.confidence = 1;
    onDirty?.({ type: 'landmark-drag', landmarkId: point.id, photoId: photo?.uploadedId || photo?.id });
    render();
  }

  function stop() {
    draggingId = null;
  }

  function addLandmark() {
    snapshot();
    const id = `manual-landmark-${Date.now().toString(36)}`;
    points.push({ id, type: 'custom', view: photo?.viewType || 'custom', x: 0.5, y: 0.5, confidence: 1, source: 'manual', locked: false });
    selectedId = id;
    onDirty?.({ type: 'landmark-add', landmarkId: id });
    render();
  }

  function deleteSelected() {
    if (!selectedId) return;
    const item = points.find((point) => point.id === selectedId);
    if (!item || item.source === 'automatic') return;
    snapshot();
    points = points.filter((point) => point.id !== selectedId);
    onDirty?.({ type: 'landmark-delete', landmarkId: selectedId });
    selectedId = null;
    render();
  }

  function toggleLock() {
    const item = points.find((point) => point.id === selectedId);
    if (!item) return;
    snapshot();
    item.locked = !item.locked;
    item.source = 'manual';
    onDirty?.({ type: 'landmark-lock', landmarkId: item.id });
    render();
  }

  function mirrorSelected() {
    const item = points.find((point) => point.id === selectedId);
    if (!item) return;
    snapshot();
    item.x = clamp(1 - item.x);
    item.source = 'manual';
    onDirty?.({ type: 'landmark-mirror', landmarkId: item.id });
    render();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify(points));
    restore(previous);
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(points));
    restore(next);
  }

  async function save() {
    const result = await onSave?.(points, { expectedRevision: currentRevision });
    currentRevision = Number(result?.geometry?.revisions?.landmarks ?? result?.landmarkRevision ?? currentRevision + 1);
    status.textContent = tr('phase7.landmark.saved', 'Landmarks saved and reconstruction constraints updated.', i18n);
  }

  return {
    getLandmarks: () => points,
    destroy() {
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('pointerup', stop);
    },
  };
}
