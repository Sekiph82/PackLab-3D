import { actionButton, clamp, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 360;
const HEIGHT = 300;
const POINTS = 16;

function copy(value) { return JSON.parse(JSON.stringify(value ?? [])); }
function defaultLoop(section) {
  return Array.from({ length: POINTS }, (_, index) => {
    const angle = index * Math.PI * 2 / POINTS;
    return { id: `${section.id}-point-${String(index).padStart(2, '0')}`, xMm: Math.cos(angle) * Number(section.widthMm || 20) / 2, zMm: Math.sin(angle) * Number(section.depthMm || 20) / 2, locked: false };
  });
}
function ensureLoop(section) { if (!section.points?.length) section.points = defaultLoop(section); return section.points; }

export function validateSection(section) {
  const errors = [];
  const points = section?.points || [];
  if (points.length < 6) errors.push('A section needs at least six points.');
  if (!(Number(section?.widthMm) > 0) || !(Number(section?.depthMm) > 0)) errors.push('Section dimensions must be positive.');
  if (points.some((point) => !Number.isFinite(Number(point.xMm)) || !Number.isFinite(Number(point.zMm)))) errors.push('Section contains non-finite points.');
  return { valid: errors.length === 0, errors };
}

export function mountSectionEditor(container, { i18n, model, onApply, onDirty, onPreview } = {}) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.section.editor', 'Section Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const list = document.createElement('select');
  const svg = svgEl('svg', { class: 'section-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, tabindex: '0', role: 'application' });
  const validation = el('div', 'interactive-editor__validation');
  const status = el('div', 'interactive-editor__status');
  let sections = copy(model?.crossSections || []).map((section) => ({ ...section, points: copy(section.points || []) }));
  sections.forEach(ensureLoop);
  let selectedId = sections[Math.floor(sections.length / 2)]?.id;
  let selectedPoint = null;
  let dragMode = null;
  let falloff = 'medium';
  let undoStack = [];
  let redoStack = [];
  toolbar.append(list, actionButton(tr('phase7.section.add', 'Add Section', i18n), add), actionButton(tr('phase7.section.duplicate', 'Duplicate', i18n), duplicate), actionButton(tr('phase7.section.delete', 'Delete', i18n), remove), actionButton(tr('phase7.section.smooth', 'Smooth', i18n), smooth), actionButton(tr('phase7.section.falloff', 'Falloff', i18n), cycleFalloff), actionButton(tr('common.undo', 'Undo', i18n), undo), actionButton(tr('common.redo', 'Redo', i18n), redo), actionButton(tr('common.apply', 'Apply', i18n), apply));
  panel.append(toolbar, svg, validation, status); container.appendChild(panel);
  function selected() { return sections.find((section) => section.id === selectedId); }
  function snapshot(label = 'Section edit') { undoStack.push({ label, value: copy(sections) }); redoStack = []; }
  function project(point, section) { const scale = Math.min(120 / Math.max(Number(section.widthMm || 1), Number(section.depthMm || 1)), 5); return { x: WIDTH / 2 + Number(point.xMm) * scale, y: HEIGHT / 2 - Number(point.zMm) * scale }; }
  function render() {
    list.innerHTML = '';
    sections.forEach((section) => { const option = document.createElement('option'); option.value = section.id; option.textContent = `${section.id} ${(Number(section.heightRatio || 0) * 100).toFixed(0)}%`; option.selected = section.id === selectedId; list.appendChild(option); });
    list.onchange = () => { selectedId = list.value; selectedPoint = null; render(); };
    svg.innerHTML = ''; svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
    svg.appendChild(svgEl('line', { x1: WIDTH / 2, y1: 20, x2: WIDTH / 2, y2: HEIGHT - 20, stroke: '#94a3b8', 'stroke-dasharray': '4 4' }));
    const section = selected(); if (!section) return;
    const loop = ensureLoop(section); const path = loop.map((point) => project(point, section)).map(({ x, y }) => `${x},${y}`).join(' ');
    svg.appendChild(svgEl('polygon', { points: path, fill: 'rgba(14,165,233,0.12)', stroke: '#0284c7', 'stroke-width': 3, 'data-section-loop': section.id }));
    loop.forEach((point) => { const p = project(point, section); const node = svgEl('circle', { cx: p.x, cy: p.y, r: point.id === selectedPoint ? 8 : 5, fill: point.locked ? '#f59e0b' : '#22c55e', stroke: '#052e16', 'data-section-point-id': point.id }); node.addEventListener('pointerdown', (event) => startPoint(event, point.id)); node.addEventListener('mousedown', (event) => startPoint(event, point.id)); svg.appendChild(node); });
    const widthHandle = svgEl('circle', { cx: WIDTH / 2 + Math.max(10, Number(section.widthMm) * 1.2), cy: HEIGHT / 2, r: 7, fill: '#22c55e', 'data-handle': 'width' });
    const depthHandle = svgEl('circle', { cx: WIDTH / 2, cy: HEIGHT / 2 + Math.max(10, Number(section.depthMm) * 1.2), r: 7, fill: '#f59e0b', 'data-handle': 'depth' });
    widthHandle.addEventListener('pointerdown', (event) => startHandle(event, 'width')); widthHandle.addEventListener('mousedown', (event) => startHandle(event, 'width')); depthHandle.addEventListener('pointerdown', (event) => startHandle(event, 'depth')); depthHandle.addEventListener('mousedown', (event) => startHandle(event, 'depth')); svg.append(widthHandle, depthHandle);
    const report = validateSection(section); validation.textContent = report.valid ? `${tr('phase7.section.valid', 'Valid section', i18n)} | ${tr('phase7.section.falloffMode', 'Falloff', i18n)}: ${falloff}` : `${tr('phase7.section.invalid', 'Invalid section', i18n)}: ${report.errors.join(' ')}`; validation.classList.toggle('is-error', !report.valid); status.textContent = `${section.id}: ${Number(section.widthMm).toFixed(3)} x ${Number(section.depthMm).toFixed(3)} mm | ${loop.length} points`;
  }
  function startPoint(event, id) { if (dragMode) return; event.preventDefault(); selectedPoint = id; snapshot('Move section point'); dragMode = { type: 'point', id, pointerId: event.pointerId }; svg.setPointerCapture?.(event.pointerId); render(); }
  function startHandle(event, type) { if (dragMode) return; event.preventDefault(); snapshot(`Scale section ${type}`); dragMode = { type, pointerId: event.pointerId }; render(); }
  function drag(event) { if (!dragMode) return; event.preventDefault(); const section = selected(); if (!section || section.locked) return; const local = localPoint(event, svg, WIDTH, HEIGHT); if (dragMode.type === 'width') { const legacy = localPoint(event, svg, 300, 240); section.widthMm = Math.max(1, Math.abs(legacy.x - 150) / 1.2); } else if (dragMode.type === 'depth') { const legacy = localPoint(event, svg, 300, 240); section.depthMm = Math.max(1, Math.abs(legacy.y - 120) / 1.2); } else { const point = section.points.find((item) => item.id === dragMode.id); if (!point || point.locked) return; const scale = Math.min(120 / Math.max(Number(section.widthMm || 1), Number(section.depthMm || 1)), 5); point.xMm = (local.x - WIDTH / 2) / scale; point.zMm = (HEIGHT / 2 - local.y) / scale; section.widthMm = Math.max(section.widthMm, Math.max(...section.points.map((item) => Math.abs(Number(item.xMm))), 0) * 2); section.depthMm = Math.max(section.depthMm, Math.max(...section.points.map((item) => Math.abs(Number(item.zMm))), 0) * 2); } onPreview?.({ sections: copy(sections), falloff }); onDirty?.({ type: 'section-drag', sectionId: section.id }); render(); }
  function stop() { if (!dragMode) return; dragMode = null; onPreview?.({ sections: copy(sections), falloff, settled: true }); render(); }
  function add() { snapshot('Add section'); const base = copy(selected() || { widthMm: 40, depthMm: 30, heightRatio: 0.5 }); const item = { ...base, id: `section-${Date.now().toString(36)}`, heightRatio: clamp(Number(base.heightRatio || 0.5) + 0.03), locked: false, points: [] }; ensureLoop(item); sections.push(item); sections.sort((a, b) => a.heightRatio - b.heightRatio); selectedId = item.id; render(); }
  function duplicate() { const base = selected(); if (!base) return; snapshot('Duplicate section'); const item = { ...copy(base), id: `section-${Date.now().toString(36)}`, heightRatio: clamp(Number(base.heightRatio) + 0.02), locked: false }; item.points = item.points.map((point) => ({ ...point, id: `${item.id}-${point.id.split('-').pop()}` })); sections.push(item); sections.sort((a, b) => a.heightRatio - b.heightRatio); selectedId = item.id; render(); }
  function remove() { if (!selectedId || sections.length <= 4) return; snapshot('Delete section'); sections = sections.filter((section) => section.id !== selectedId); selectedId = sections[0]?.id; render(); }
  function smooth() { const index = sections.findIndex((section) => section.id === selectedId); if (index <= 0 || index >= sections.length - 1) return; snapshot('Smooth section'); const current = sections[index]; current.widthMm = (sections[index - 1].widthMm + sections[index + 1].widthMm) / 2; current.depthMm = (sections[index - 1].depthMm + sections[index + 1].depthMm) / 2; ensureLoop(current); render(); }
  function cycleFalloff() { falloff = falloff === 'local' ? 'medium' : falloff === 'medium' ? 'wide' : 'local'; render(); }
  function undo() { const item = undoStack.pop(); if (!item) return; redoStack.push({ label: item.label, value: copy(sections) }); sections = item.value; render(); }
  function redo() { const item = redoStack.pop(); if (!item) return; undoStack.push({ label: item.label, value: copy(sections) }); sections = item.value; render(); }
  async function apply() { const invalid = sections.map(validateSection).find((report) => !report.valid); if (invalid) { render(); return; } const result = await onApply?.({ sections: copy(sections), falloff, sourceEditor: 'section', operationId: `section-${Date.now()}` }); status.textContent = tr('phase7.section.applied', 'Section edits regenerated the 3D model and linked drawing.', i18n); return result; }
  svg.addEventListener('pointermove', drag); svg.addEventListener('mousemove', drag); window.addEventListener('pointerup', stop); window.addEventListener('mouseup', stop); render();
  return { getSections: () => copy(sections), getSelectedId: () => selectedId, getFalloff: () => falloff, getValidation: () => validateSection(selected()), destroy: () => {} };
}
