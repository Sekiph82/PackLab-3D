import { actionButton, clamp, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 320;
const HEIGHT = 240;

export function mountProfileEditor(container, { i18n, model, onApply, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.profile.editor', 'Profile Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const svg = svgEl('svg', { class: 'profile-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  const status = el('div', 'interactive-editor__status');
  let profileName = 'frontProfile';
  let points = cloneProfile(profileName);
  let draggingId = null;
  let selectedId = null;
  let undoStack = [];
  let redoStack = [];

  const profileSelect = document.createElement('select');
  ['frontProfile', 'sideProfile'].forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    profileSelect.appendChild(option);
  });
  profileSelect.addEventListener('change', () => {
    profileName = profileSelect.value;
    points = cloneProfile(profileName);
    selectedId = null;
    render();
  });

  toolbar.append(
    profileSelect,
    actionButton(tr('phase7.profile.insertPoint', 'Insert Point', i18n), insertPoint),
    actionButton(tr('phase7.profile.deletePoint', 'Delete Point', i18n), deletePoint),
    actionButton(tr('phase7.profile.smooth', 'Smooth', i18n), smooth),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.apply', 'Apply', i18n), apply),
  );
  panel.append(toolbar, svg, status);
  container.appendChild(panel);
  render();

  svg.addEventListener('mousemove', drag);
  svg.addEventListener('pointermove', drag);
  window.addEventListener('mouseup', stop);
  window.addEventListener('pointerup', stop);

  function cloneProfile(name) {
    return JSON.parse(JSON.stringify(model?.[name] || []));
  }

  function snapshot() {
    undoStack.push(JSON.stringify(points));
    redoStack = [];
  }

  function render() {
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
    svg.appendChild(svgEl('line', { x1: WIDTH / 2, y1: 10, x2: WIDTH / 2, y2: HEIGHT - 10, stroke: '#94a3b8', 'stroke-dasharray': '4 4' }));
    const maxExtent = Math.max(...points.map((point) => Number(point.halfExtentMm) || 1), 1);
    const pathPoints = points.map((point) => {
      const x = WIDTH / 2 + ((Number(point.halfExtentMm) || 0) / maxExtent) * (WIDTH * 0.38);
      const y = HEIGHT - (Number(point.heightRatio) || 0) * (HEIGHT - 24) - 12;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    svg.appendChild(svgEl('polyline', { points: pathPoints, fill: 'none', stroke: '#0284c7', 'stroke-width': 3 }));
    points.forEach((point) => drawPoint(point, maxExtent));
    status.textContent = `${tr('phase7.profile.points', 'Profile points', i18n)}: ${points.length}`;
  }

  function drawPoint(point, maxExtent) {
    const x = WIDTH / 2 + ((Number(point.halfExtentMm) || 0) / maxExtent) * (WIDTH * 0.38);
    const y = HEIGHT - (Number(point.heightRatio) || 0) * (HEIGHT - 24) - 12;
    const circle = svgEl('circle', { cx: x, cy: y, r: point.id === selectedId ? 7 : 5, fill: point.locked ? '#f59e0b' : '#22c55e', stroke: '#052e16', 'data-profile-point-id': point.id });
    circle.addEventListener('mousedown', (event) => start(event, point.id));
    circle.addEventListener('pointerdown', (event) => start(event, point.id));
    svg.appendChild(circle);
  }

  function start(event, id) {
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
    const maxExtent = Math.max(...points.map((item) => Number(item.halfExtentMm) || 1), 1);
    const local = localPoint(event, svg, WIDTH, HEIGHT);
    point.halfExtentMm = Math.max(0.5, ((local.x - WIDTH / 2) / (WIDTH * 0.38)) * maxExtent);
    point.heightRatio = clamp(1 - ((local.y - 12) / (HEIGHT - 24)));
    onDirty?.({ type: 'profile-drag', pointId: point.id });
    render();
  }

  function stop() {
    draggingId = null;
  }

  function insertPoint() {
    snapshot();
    const reference = points.find((point) => point.id === selectedId) || points[Math.floor(points.length / 2)];
    points.push({ ...reference, id: `profile-point-${Date.now().toString(36)}`, locked: false });
    points.sort((a, b) => a.heightRatio - b.heightRatio);
    render();
  }

  function deletePoint() {
    if (!selectedId || points.length <= 3) return;
    snapshot();
    points = points.filter((point) => point.id !== selectedId);
    selectedId = null;
    render();
  }

  function smooth() {
    if (!selectedId) return;
    snapshot();
    const index = points.findIndex((point) => point.id === selectedId);
    if (index > 0 && index < points.length - 1) {
      points[index].halfExtentMm = (points[index - 1].halfExtentMm + points[index + 1].halfExtentMm) / 2;
    }
    render();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify(points));
    points = JSON.parse(previous);
    render();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(points));
    points = JSON.parse(next);
    render();
  }

  async function apply() {
    await onApply?.({ profileName, profilePoints: points.map((point) => ({ id: point.id, halfExtentMm: point.halfExtentMm, heightRatio: point.heightRatio })) });
    status.textContent = tr('phase7.profile.applied', 'Profile edit regenerated the 3D model.', i18n);
  }

  return { getPoints: () => points };
}
