import { actionButton, clamp, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 420;
const HEIGHT = 300;
const MIN_POINTS = 3;

function copy(value) { return JSON.parse(JSON.stringify(value ?? [])); }

export function validateProfilePoints(points) {
  const errors = [];
  if (!Array.isArray(points) || points.length < MIN_POINTS) errors.push('A profile needs at least three points.');
  const ys = (points || []).map((point) => Number(point.heightRatio));
  if (ys.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) errors.push('Profile heights must be between 0 and 1.');
  if (ys.some((value, index) => index > 0 && value <= ys[index - 1])) errors.push('Profile points must be ordered by height.');
  if ((points || []).some((point) => !Number.isFinite(Number(point.halfExtentMm)) || Number(point.halfExtentMm) <= 0)) errors.push('Profile extents must be positive finite values.');
  return { valid: errors.length === 0, errors };
}

export function profilePointFromEvent(event, svg, maxExtent) {
  const local = localPoint(event, svg, WIDTH, HEIGHT);
  return {
    heightRatio: clamp(1 - ((local.y - 18) / (HEIGHT - 36))),
    halfExtentMm: Math.max(0.5, ((local.x - WIDTH / 2) / (WIDTH * 0.38)) * maxExtent),
  };
}

export function mountProfileEditor(container, { i18n, model, onApply, onDirty, onPreview } = {}) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.profile.editor', 'Profile Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const svg = svgEl('svg', { class: 'profile-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, tabindex: '0', role: 'application' });
  const status = el('div', 'interactive-editor__status');
  const validation = el('div', 'interactive-editor__validation');
  let profileName = 'frontProfile';
  let points = copy(model?.[profileName] || model?.profiles?.front || []);
  let selected = new Set();
  let dragging = null;
  let undoStack = [];
  let redoStack = [];
  let symmetry = true;
  let tangentLock = false;

  const profileSelect = document.createElement('select');
  [['frontProfile', 'Front'], ['sideProfile', 'Side']].forEach(([value, label]) => {
    const option = document.createElement('option'); option.value = value; option.textContent = label; profileSelect.appendChild(option);
  });
  profileSelect.addEventListener('change', () => { profileName = profileSelect.value; points = copy(model?.[profileName] || []); selected.clear(); render(); });
  toolbar.append(
    profileSelect,
    actionButton(tr('phase7.profile.symmetry', 'Symmetry', i18n), () => { symmetry = !symmetry; render(); }),
    actionButton(tr('phase7.profile.insertPoint', 'Insert Point', i18n), insertPoint),
    actionButton(tr('phase7.profile.deletePoint', 'Delete Point', i18n), deletePoint),
    actionButton(tr('phase7.profile.smooth', 'Smooth', i18n), smooth),
    actionButton(tr('phase7.profile.corner', 'Corner', i18n), () => setMode('corner')),
    actionButton(tr('phase7.profile.tangentLock', 'Lock Tangent', i18n), () => { tangentLock = !tangentLock; render(); }),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.apply', 'Apply', i18n), apply),
  );
  panel.append(toolbar, svg, validation, status);
  container.appendChild(panel);

  function maxExtent() { return Math.max(...points.map((point) => Number(point.halfExtentMm) || 1), 1); }
  function project(point) {
    return { x: WIDTH / 2 + Number(point.halfExtentMm || 0) / maxExtent() * WIDTH * 0.38, y: HEIGHT - Number(point.heightRatio || 0) * (HEIGHT - 36) - 18 };
  }
  function snapshot(label = 'Profile edit') { undoStack.push({ label, value: copy(points) }); redoStack = []; }
  function render() {
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
    svg.appendChild(svgEl('line', { x1: WIDTH / 2, y1: 10, x2: WIDTH / 2, y2: HEIGHT - 10, stroke: '#94a3b8', 'stroke-dasharray': '4 4' }));
    const line = points.map(project).map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    svg.appendChild(svgEl('polyline', { points: line, fill: 'none', stroke: '#0284c7', 'stroke-width': 3, 'data-profile-path': 'true' }));
    points.forEach((point) => {
      const p = project(point);
      const circle = svgEl('circle', { cx: p.x, cy: p.y, r: selected.has(point.id) ? 8 : 6, fill: point.locked || point.measurementLocked ? '#f59e0b' : selected.has(point.id) ? '#f97316' : '#22c55e', stroke: '#052e16', 'data-profile-point-id': point.id });
      circle.addEventListener('pointerdown', (event) => start(event, point.id));
      circle.addEventListener('mousedown', (event) => start(event, point.id));
      svg.appendChild(circle);
      if (selected.has(point.id)) {
        const tangent = svgEl('line', { x1: p.x, y1: p.y, x2: p.x + Number(point.tangentOut?.[0] || 0) * 50, y2: p.y - Number(point.tangentOut?.[1] || 0) * 50, stroke: '#f97316', 'stroke-dasharray': '3 2', 'data-tangent-for': point.id });
        svg.appendChild(tangent);
      }
    });
    const report = validateProfilePoints(points);
    validation.textContent = report.valid ? `${tr('phase7.profile.valid', 'Valid profile', i18n)} | ${symmetry ? tr('phase7.profile.symmetryOn', 'Symmetry on', i18n) : tr('phase7.profile.symmetryOff', 'Symmetry off', i18n)}` : `${tr('phase7.profile.invalid', 'Invalid profile', i18n)}: ${report.errors.join(' ')}`;
    validation.classList.toggle('is-error', !report.valid);
    status.textContent = `${tr('phase7.profile.points', 'Profile points', i18n)}: ${points.length} | ${tr('phase7.profile.selected', 'Selected', i18n)}: ${selected.size}`;
  }
  function start(event, id) {
    if (dragging) return;
    event.preventDefault();
    if (event.shiftKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); } else selected = new Set([id]);
    const point = points.find((item) => item.id === id);
    if (!point) return;
    snapshot('Move profile point');
    dragging = { id, before: copy(point), pointerId: event.pointerId };
    svg.setPointerCapture?.(event.pointerId);
    render();
  }
  function drag(event) {
    if (!dragging) return;
    event.preventDefault();
    const point = points.find((item) => item.id === dragging.id);
    if (!point || point.locked || point.measurementLocked) return;
    const next = profilePointFromEvent(event, svg, maxExtent());
    point.heightRatio = next.heightRatio;
    point.halfExtentMm = next.halfExtentMm;
    if (tangentLock) point.tangentOut = [0, 0];
    if (symmetry && point.mirroredWith) {
      const mirror = points.find((item) => item.id === point.mirroredWith);
      if (mirror && !mirror.locked) mirror.heightRatio = point.heightRatio;
    }
    onPreview?.({ profileName, points: copy(points) });
    onDirty?.({ type: 'profile-drag', pointId: point.id });
    render();
  }
  function stop() { if (!dragging) return; dragging = null; onPreview?.({ profileName, points: copy(points), settled: true }); render(); }
  function insertPoint() {
    if (points.length < 1) return;
    snapshot('Insert profile point');
    const index = Math.max(0, points.findIndex((point) => selected.has(point.id)));
    const a = points[index] || points[0]; const b = points[index + 1] || points[index];
    const item = { id: `profile-${profileName}-${Date.now().toString(36)}`, heightRatio: (Number(a.heightRatio) + Number(b.heightRatio)) / 2, halfExtentMm: (Number(a.halfExtentMm) + Number(b.halfExtentMm)) / 2, mode: 'smooth', tangentIn: [0, 0], tangentOut: [0, 0], locked: false, source: 'manual' };
    points.splice(index + 1, 0, item); selected = new Set([item.id]); render(); onDirty?.({ type: 'profile-insert', pointId: item.id });
  }
  function deletePoint() { if (selected.size !== 1 || points.length <= MIN_POINTS) return; snapshot('Delete profile point'); points = points.filter((point) => !selected.has(point.id)); selected.clear(); render(); onDirty?.({ type: 'profile-delete' }); }
  function smooth() { if (!selected.size) return; snapshot('Smooth profile region'); points.forEach((point, index) => { if (selected.has(point.id) && index > 0 && index < points.length - 1 && !point.locked) point.halfExtentMm = (Number(points[index - 1].halfExtentMm) + Number(points[index + 1].halfExtentMm)) / 2; }); render(); }
  function setMode(mode) { points.forEach((point) => { if (selected.has(point.id)) point.mode = mode; }); render(); }
  function undo() { const entry = undoStack.pop(); if (!entry) return; redoStack.push({ label: entry.label, value: copy(points) }); points = entry.value; render(); }
  function redo() { const entry = redoStack.pop(); if (!entry) return; undoStack.push({ label: entry.label, value: copy(points) }); points = entry.value; render(); }
  async function apply() {
    const report = validateProfilePoints(points);
    if (!report.valid) { render(); return; }
    const result = await onApply?.({ profileName, profilePoints: copy(points), symmetry, sourceEditor: 'profile', operationId: `profile-${Date.now()}` });
    status.textContent = tr('phase7.profile.applied', 'Profile edit regenerated the 3D model.', i18n);
    return result;
  }
  svg.addEventListener('pointermove', drag); svg.addEventListener('mousemove', drag);
  window.addEventListener('pointerup', stop); window.addEventListener('mouseup', stop);
  render();
  return { getPoints: () => copy(points), getValidation: () => validateProfilePoints(points), getSelectedIds: () => [...selected], destroy: () => {} };
}
