import { actionButton, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 300;
const HEIGHT = 240;

export function mountSectionEditor(container, { i18n, model, onApply, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.section.editor', 'Section Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const list = document.createElement('select');
  const svg = svgEl('svg', { class: 'section-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  const status = el('div', 'interactive-editor__status');
  let sections = JSON.parse(JSON.stringify(model?.crossSections || []));
  let selectedId = sections[Math.floor(sections.length / 2)]?.id;
  let dragMode = null;
  let undoStack = [];
  let redoStack = [];

  toolbar.append(
    list,
    actionButton(tr('phase7.section.add', 'Add Section', i18n), add),
    actionButton(tr('phase7.section.duplicate', 'Duplicate', i18n), duplicate),
    actionButton(tr('phase7.section.delete', 'Delete', i18n), remove),
    actionButton(tr('phase7.section.smooth', 'Smooth', i18n), smooth),
    actionButton(tr('common.undo', 'Undo', i18n), undo),
    actionButton(tr('common.redo', 'Redo', i18n), redo),
    actionButton(tr('common.apply', 'Apply', i18n), apply),
  );
  panel.append(toolbar, svg, status);
  container.appendChild(panel);
  render();

  svg.addEventListener('mousedown', start);
  svg.addEventListener('mousemove', drag);
  window.addEventListener('mouseup', stop);
  svg.addEventListener('pointerdown', start);
  svg.addEventListener('pointermove', drag);
  window.addEventListener('pointerup', stop);

  function selected() {
    return sections.find((section) => section.id === selectedId) || sections[0];
  }

  function snapshot() {
    undoStack.push(JSON.stringify(sections));
    redoStack = [];
  }

  function render() {
    list.innerHTML = '';
    sections.forEach((section) => {
      const option = document.createElement('option');
      option.value = section.id;
      option.textContent = `${section.id} ${(section.heightRatio * 100).toFixed(0)}%`;
      option.selected = section.id === selectedId;
      list.appendChild(option);
    });
    list.onchange = () => {
      selectedId = list.value;
      render();
    };
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
    const section = selected();
    if (!section) return;
    const rx = Math.max(8, Number(section.widthMm || 1) * 1.2);
    const rz = Math.max(8, Number(section.depthMm || 1) * 1.2);
    svg.appendChild(svgEl('ellipse', { cx: WIDTH / 2, cy: HEIGHT / 2, rx, ry: rz, fill: 'rgba(14,165,233,0.12)', stroke: '#0284c7', 'stroke-width': 3 }));
    svg.appendChild(svgEl('circle', { cx: WIDTH / 2 + rx, cy: HEIGHT / 2, r: 6, fill: '#22c55e', 'data-handle': 'width' }));
    svg.appendChild(svgEl('circle', { cx: WIDTH / 2, cy: HEIGHT / 2 + rz, r: 6, fill: '#f59e0b', 'data-handle': 'depth' }));
    status.textContent = `${section.id}: ${section.widthMm} x ${section.depthMm} mm`;
  }

  function start(event) {
    const handle = event.target?.getAttribute?.('data-handle');
    if (!handle) return;
    event.preventDefault();
    dragMode = handle;
    snapshot();
  }

  function drag(event) {
    if (!dragMode) return;
    event.preventDefault();
    const section = selected();
    const point = localPoint(event, svg, WIDTH, HEIGHT);
    if (dragMode === 'width') section.widthMm = Math.max(1, Math.abs(point.x - WIDTH / 2) / 1.2);
    if (dragMode === 'depth') section.depthMm = Math.max(1, Math.abs(point.y - HEIGHT / 2) / 1.2);
    onDirty?.({ type: 'section-drag', sectionId: section.id });
    render();
  }

  function stop() {
    dragMode = null;
  }

  function add() {
    snapshot();
    const base = selected() || { widthMm: 40, depthMm: 30, heightRatio: 0.5 };
    const item = { ...base, id: newSectionId(), locked: false, heightRatio: Math.min(1, Number(base.heightRatio || 0.5) + 0.03) };
    sections.push(item);
    selectedId = item.id;
    sections.sort((a, b) => a.heightRatio - b.heightRatio);
    render();
  }

  function duplicate() {
    const base = selected();
    if (!base) return;
    snapshot();
    const item = { ...base, id: newSectionId(), locked: false };
    sections.push(item);
    selectedId = item.id;
    render();
  }

  function remove() {
    if (!selectedId || sections.length <= 4) return;
    snapshot();
    sections = sections.filter((section) => section.id !== selectedId);
    selectedId = sections[0]?.id;
    render();
  }

  function smooth() {
    const index = sections.findIndex((section) => section.id === selectedId);
    if (index <= 0 || index >= sections.length - 1) return;
    snapshot();
    sections[index].widthMm = (sections[index - 1].widthMm + sections[index + 1].widthMm) / 2;
    sections[index].depthMm = (sections[index - 1].depthMm + sections[index + 1].depthMm) / 2;
    render();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify(sections));
    sections = JSON.parse(previous);
    render();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(sections));
    sections = JSON.parse(next);
    render();
  }

  async function apply() {
    await onApply?.({ sections: sections.map(({ id, widthMm, depthMm, heightRatio }) => ({ id, widthMm, depthMm, heightRatio })) });
    status.textContent = tr('phase7.section.applied', 'Section edits regenerated the 3D model and linked drawing.', i18n);
  }

  function newSectionId() {
    return `section-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }
}
