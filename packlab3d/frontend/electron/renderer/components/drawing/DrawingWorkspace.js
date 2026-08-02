import { actionButton, el, localPoint, makePanel, svgEl, tr } from '../editorUtils.js';

const WIDTH = 520;
const HEIGHT = 360;

export function mountDrawingWorkspace(container, { i18n, document: drawingDocument, onPatch, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.drawing.workspace', 'Linked 2D Drawing Workspace', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const svg = svgEl('svg', { class: 'drawing-workspace__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  const status = el('div', 'interactive-editor__status');
  let drawing = JSON.parse(JSON.stringify(drawingDocument || {}));
  let mode = 'select';
  let selected = null;
  let dragStart = null;
  let sectionStart = null;
  let undoStack = [];
  let redoStack = [];

  toolbar.append(
    actionButton(tr('phase7.drawing.select', 'Select', i18n), () => { mode = 'select'; updateStatus(); }),
    actionButton(tr('phase7.dimension.add', 'Add Dimension', i18n), () => { mode = 'dimension'; updateStatus(); }),
    actionButton(tr('phase7.note.add', 'Add Note', i18n), () => { mode = 'note'; updateStatus(); }),
    actionButton(tr('phase7.referenceLine.add', 'Add Reference Line', i18n), () => { mode = 'reference'; updateStatus(); }),
    actionButton(tr('phase7.sectionLine.add', 'Add Section Line', i18n), () => { mode = 'section'; updateStatus(); }),
    actionButton(tr('phase7.drawing.autoArrange', 'Auto Arrange Dimensions', i18n), autoArrange),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.save', 'Save', i18n), save),
  );
  panel.append(toolbar, svg, status);
  container.appendChild(panel);
  render();

  svg.addEventListener('mousedown', down);
  svg.addEventListener('mousemove', move);
  window.addEventListener('mouseup', up);
  svg.addEventListener('pointerdown', down);
  svg.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);

  function snapshot() {
    undoStack.push(JSON.stringify(drawing));
    redoStack = [];
  }

  function render() {
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#ffffff', stroke: '#cbd5e1' }));
    renderViews();
    (drawing.referenceLines || []).forEach(renderReferenceLine);
    (drawing.sectionLines || []).forEach(renderSectionLine);
    (drawing.dimensions || []).filter((dim) => dim.visible !== false).forEach(renderDimension);
    (drawing.notes || []).forEach(renderNote);
    renderTitleBlock();
    updateStatus();
  }

  function renderViews() {
    (drawing.views || []).forEach((view) => {
      if (view.visible === false) return;
      const x = view.placement?.x || 40;
      const y = view.placement?.y || 40;
      svg.appendChild(svgEl('rect', { x, y, width: 62, height: 92, rx: 4, fill: 'none', stroke: '#334155', 'stroke-width': 1.5, 'data-view-id': view.id }));
      const text = svgEl('text', { x: x + 6, y: y + 108, 'font-size': 10, fill: '#334155' });
      text.textContent = view.type;
      svg.appendChild(text);
    });
  }

  function renderDimension(dim) {
    const placement = dim.placement || {};
    const offset = Number(placement.offset || 20);
    const textOffset = placement.textOffset || [0, 0];
    const baseX = 70 + ((dim.id?.length || 0) % 5) * 75;
    const baseY = 52 + offset;
    const line = svgEl('line', { x1: baseX, y1: baseY, x2: baseX, y2: baseY + 88, stroke: selected === dim.id ? '#f97316' : '#0284c7', 'stroke-width': 2, 'data-entity-id': dim.id, 'data-entity-kind': 'dimension' });
    const text = svgEl('text', { x: baseX + 8 + textOffset[0], y: baseY + 44 + textOffset[1], 'font-size': 11, fill: '#0f172a', 'data-entity-id': dim.id, 'data-entity-kind': 'dimension-text' });
    text.textContent = `${dim.prefix || ''}${dim.valueMm ?? '?'} mm${dim.suffix || ''}`;
    line.addEventListener('mousedown', (event) => selectAndDrag(event, dim.id, 'dimension'));
    text.addEventListener('mousedown', (event) => selectAndDrag(event, dim.id, 'dimension-text'));
    line.addEventListener('pointerdown', (event) => selectAndDrag(event, dim.id, 'dimension'));
    text.addEventListener('pointerdown', (event) => selectAndDrag(event, dim.id, 'dimension-text'));
    svg.append(line, text);
  }

  function renderNote(note) {
    const text = svgEl('text', { x: note.x || 20, y: note.y || 20, 'font-size': 12, fill: selected === note.id ? '#f97316' : '#334155', 'data-entity-id': note.id, 'data-entity-kind': 'note' });
    text.textContent = note.text || '';
    text.addEventListener('mousedown', (event) => selectAndDrag(event, note.id, 'note'));
    text.addEventListener('pointerdown', (event) => selectAndDrag(event, note.id, 'note'));
    svg.appendChild(text);
    if (note.leaderEnd) {
      svg.appendChild(svgEl('line', { x1: note.x || 20, y1: note.y || 20, x2: note.leaderEnd[0], y2: note.leaderEnd[1], stroke: '#64748b', 'stroke-width': 1 }));
    }
  }

  function renderReferenceLine(line) {
    const item = svgEl('line', { x1: line.x1 || 0, y1: line.y1 || 0, x2: line.x2 || 80, y2: line.y2 || 0, stroke: selected === line.id ? '#f97316' : '#94a3b8', 'stroke-dasharray': '5 3', 'data-entity-id': line.id, 'data-entity-kind': 'reference' });
    item.addEventListener('mousedown', (event) => selectAndDrag(event, line.id, 'reference'));
    item.addEventListener('pointerdown', (event) => selectAndDrag(event, line.id, 'reference'));
    svg.appendChild(item);
  }

  function renderSectionLine(line) {
    const points = line.points || [];
    const value = points.map(([x, y]) => `${x},${y}`).join(' ');
    const poly = svgEl('polyline', { points: value, fill: 'none', stroke: selected === line.id ? '#f97316' : '#dc2626', 'stroke-width': 2, 'data-entity-id': line.id, 'data-entity-kind': 'section' });
    poly.addEventListener('mousedown', (event) => selectAndDrag(event, line.id, 'section'));
    poly.addEventListener('pointerdown', (event) => selectAndDrag(event, line.id, 'section'));
    svg.appendChild(poly);
  }

  function renderTitleBlock() {
    const title = drawing.titleBlock?.title || 'PackLab 3D Technical Drawing';
    svg.appendChild(svgEl('rect', { x: WIDTH - 180, y: HEIGHT - 64, width: 168, height: 48, fill: 'none', stroke: '#64748b' }));
    const text = svgEl('text', { x: WIDTH - 172, y: HEIGHT - 40, 'font-size': 11, fill: '#334155' });
    text.textContent = title;
    svg.appendChild(text);
  }

  function down(event) {
    if (event.target !== svg && event.target.tagName !== 'rect') return;
    const point = localPoint(event, svg, WIDTH, HEIGHT);
    if (mode === 'note') {
      snapshot();
      drawing.notes = [...(drawing.notes || []), { id: `note-${Date.now().toString(36)}`, text: tr('phase7.note.defaultText', 'New note', i18n), x: point.x, y: point.y, leaderEnd: [point.x + 28, point.y + 18] }];
      onDirty?.({ type: 'note-add' });
      render();
    } else if (mode === 'reference') {
      snapshot();
      drawing.referenceLines = [...(drawing.referenceLines || []), { id: `ref-${Date.now().toString(36)}`, type: 'construction', x1: point.x, y1: point.y, x2: point.x + 80, y2: point.y }];
      onDirty?.({ type: 'reference-line-add' });
      render();
    } else if (mode === 'section') {
      snapshot();
      sectionStart = point;
    } else if (mode === 'dimension') {
      snapshot();
      const id = `dim-custom-${Date.now().toString(36)}`;
      drawing.dimensions = [...(drawing.dimensions || []), { id, type: 'vertical-linear', viewId: 'front-view', valueMm: 0, source: 'custom', placement: { offset: point.y - 50, textOffset: [0, 0] }, visible: true }];
      selected = id;
      onDirty?.({ type: 'dimension-add' });
      render();
    }
  }

  function selectAndDrag(event, id, kind) {
    event.preventDefault();
    snapshot();
    selected = id;
    dragStart = { point: localPoint(event, svg, WIDTH, HEIGHT), kind };
    render();
  }

  function move(event) {
    if (!dragStart) return;
    event.preventDefault();
    const point = localPoint(event, svg, WIDTH, HEIGHT);
    const dx = point.x - dragStart.point.x;
    const dy = point.y - dragStart.point.y;
    dragStart.point = point;
    if (dragStart.kind.startsWith('dimension')) {
      drawing.dimensions = (drawing.dimensions || []).map((dim) => {
        if (dim.id !== selected) return dim;
        const placement = { ...(dim.placement || {}) };
        if (dragStart.kind === 'dimension-text') {
          const old = placement.textOffset || [0, 0];
          placement.textOffset = [old[0] + dx, old[1] + dy];
        } else {
          placement.offset = Number(placement.offset || 0) + dy;
        }
        return { ...dim, placement };
      });
    } else if (dragStart.kind === 'note') {
      drawing.notes = (drawing.notes || []).map((note) => note.id === selected ? { ...note, x: (note.x || 0) + dx, y: (note.y || 0) + dy } : note);
    } else if (dragStart.kind === 'reference') {
      drawing.referenceLines = (drawing.referenceLines || []).map((line) => line.id === selected ? { ...line, x1: (line.x1 || 0) + dx, x2: (line.x2 || 0) + dx, y1: (line.y1 || 0) + dy, y2: (line.y2 || 0) + dy } : line);
    } else if (dragStart.kind === 'section') {
      drawing.sectionLines = (drawing.sectionLines || []).map((line) => line.id === selected ? { ...line, points: (line.points || []).map(([x, y]) => [x + dx, y + dy]) } : line);
    }
    onDirty?.({ type: 'drawing-drag', entityId: selected });
    render();
  }

  function up(event) {
    if (sectionStart) {
      const point = localPoint(event, svg, WIDTH, HEIGHT);
      drawing.sectionLines = [...(drawing.sectionLines || []), { id: `section-line-${Date.now().toString(36)}`, points: [[sectionStart.x, sectionStart.y], [point.x, point.y]], label: `A-${(drawing.sectionLines || []).length + 1}`, direction: 'forward', visible: true }];
      drawing.sectionViews = [...(drawing.sectionViews || []), { id: `section-view-${Date.now().toString(36)}`, type: 'vertical-section', visible: true, estimatedInnerProfile: true }];
      onDirty?.({ type: 'section-line-add' });
      sectionStart = null;
      render();
    }
    dragStart = null;
  }

  function autoArrange() {
    snapshot();
    drawing.dimensions = (drawing.dimensions || []).map((dim, index) => ({ ...dim, placement: { ...(dim.placement || {}), offset: 18 + (index * 12) } }));
    onDirty?.({ type: 'dimension-auto-arrange' });
    render();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify(drawing));
    drawing = JSON.parse(previous);
    render();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(drawing));
    drawing = JSON.parse(next);
    render();
  }

  async function save() {
    await onPatch?.({
      notes: drawing.notes || [],
      dimensions: drawing.dimensions || [],
      referenceLines: drawing.referenceLines || [],
      sectionLines: drawing.sectionLines || [],
      page: drawing.page || {},
      titleBlock: drawing.titleBlock || {},
    });
    status.textContent = tr('phase7.drawing.saved', 'Drawing edits saved and will persist after model changes.', i18n);
  }

  function updateStatus() {
    status.textContent = `${tr('phase7.drawing.mode', 'Mode', i18n)}: ${mode} | ${tr('phase7.drawing.selected', 'Selected', i18n)}: ${selected || '-'}`;
  }
}
