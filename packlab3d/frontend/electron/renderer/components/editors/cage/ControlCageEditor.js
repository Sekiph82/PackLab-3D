import { actionButton, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 320;
const HEIGHT = 240;

export function mountControlCageEditor(container, { i18n, cage, onApply, onDirty }) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.cage.editor', 'Control Cage Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const svg = svgEl('svg', { class: 'cage-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}` });
  const status = el('div', 'interactive-editor__status');
  let nodes = JSON.parse(JSON.stringify(cage?.nodes || []));
  const edges = cage?.edges || [];
  let selected = new Set();
  let draggingId = null;
  let dragStart = null;
  let pendingDelta = {};
  let undoStack = [];
  let redoStack = [];

  toolbar.append(
    actionButton(tr('phase7.cage.pin', 'Pin/Unpin', i18n), togglePin),
    actionButton(tr('phase7.cage.resetNode', 'Reset Node', i18n), resetSelected),
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

  function bounds() {
    const xs = nodes.map((node) => Number(node.positionMm?.[0]) || 0);
    const zs = nodes.map((node) => Number(node.positionMm?.[2]) || 0);
    return {
      minX: Math.min(...xs, -1),
      maxX: Math.max(...xs, 1),
      minZ: Math.min(...zs, -1),
      maxZ: Math.max(...zs, 1),
    };
  }

  function project(node) {
    const b = bounds();
    const [x, , z] = node.positionMm || [0, 0, 0];
    return {
      x: 30 + ((x - b.minX) / Math.max(b.maxX - b.minX, 1)) * (WIDTH - 60),
      y: HEIGHT - 30 - ((z - b.minZ) / Math.max(b.maxZ - b.minZ, 1)) * (HEIGHT - 60),
    };
  }

  function unproject(point, reference) {
    const b = bounds();
    const x = b.minX + ((point.x - 30) / Math.max(WIDTH - 60, 1)) * (b.maxX - b.minX);
    const z = b.minZ + ((HEIGHT - 30 - point.y) / Math.max(HEIGHT - 60, 1)) * (b.maxZ - b.minZ);
    return [x, reference.positionMm?.[1] || 0, z];
  }

  function snapshot() {
    undoStack.push(JSON.stringify(nodes));
    redoStack = [];
  }

  function render() {
    svg.innerHTML = '';
    svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
    edges.forEach((edge) => {
      const a = nodes.find((node) => node.id === edge[0]);
      const b = nodes.find((node) => node.id === edge[1]);
      if (!a || !b) return;
      const pa = project(a);
      const pb = project(b);
      svg.appendChild(svgEl('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: '#94a3b8', 'stroke-width': 1 }));
    });
    nodes.forEach((node) => {
      const point = project(node);
      const circle = svgEl('circle', {
        cx: point.x,
        cy: point.y,
        r: selected.has(node.id) ? 7 : 5,
        fill: node.pinned ? '#64748b' : selected.has(node.id) ? '#f97316' : '#0ea5e9',
        stroke: '#082f49',
        'data-cage-node-id': node.id,
      });
      circle.addEventListener('mousedown', (event) => start(event, node.id));
      circle.addEventListener('pointerdown', (event) => start(event, node.id));
      svg.appendChild(circle);
    });
    status.textContent = `${tr('phase7.cage.nodes', 'Cage nodes', i18n)}: ${nodes.length} | ${tr('phase7.cage.selected', 'Selected', i18n)}: ${selected.size}`;
  }

  function start(event, id) {
    event.preventDefault();
    if (!event.shiftKey) selected = new Set([id]);
    else if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    draggingId = id;
    dragStart = {
      point: localPoint(event, svg, WIDTH, HEIGHT),
      positions: Object.fromEntries(nodes.map((node) => [node.id, [...(node.positionMm || [0, 0, 0])]])),
    };
    snapshot();
    render();
  }

  function drag(event) {
    if (!draggingId || !dragStart) return;
    event.preventDefault();
    const active = nodes.find((node) => node.id === draggingId);
    if (!active || active.pinned) return;
    const point = localPoint(event, svg, WIDTH, HEIGHT);
    const target = unproject(point, active);
    const before = dragStart.positions[draggingId];
    const delta = [target[0] - before[0], 0, target[2] - before[2]];
    nodes.forEach((node) => {
      if (!selected.has(node.id) || node.pinned) return;
      const original = dragStart.positions[node.id];
      node.positionMm = [original[0] + delta[0], original[1], original[2] + delta[2]];
      pendingDelta[node.id] = delta;
    });
    onDirty?.({ type: 'cage-drag', nodeId: draggingId, selected: [...selected] });
    render();
  }

  function stop() {
    draggingId = null;
    dragStart = null;
  }

  function togglePin() {
    snapshot();
    nodes.forEach((node) => {
      if (selected.has(node.id)) node.pinned = !node.pinned;
    });
    render();
  }

  function resetSelected() {
    snapshot();
    nodes.forEach((node) => {
      if (selected.has(node.id)) {
        node.positionMm = node.fittedPositionMm || node.positionMm;
        pendingDelta[node.id] = [0, 0, 0];
      }
    });
    render();
  }

  function undo() {
    const previous = undoStack.pop();
    if (!previous) return;
    redoStack.push(JSON.stringify(nodes));
    nodes = JSON.parse(previous);
    pendingDelta = {};
    render();
  }

  function redo() {
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(JSON.stringify(nodes));
    nodes = JSON.parse(next);
    pendingDelta = {};
    render();
  }

  async function apply() {
    const edits = Object.entries(pendingDelta).map(([id, deltaMm]) => ({ id, deltaMm }));
    await onApply?.({ cageNodes: edits.length ? edits : [...selected].map((id) => ({ id, deltaMm: [0, 0, 0] })) });
    pendingDelta = {};
    status.textContent = tr('phase7.cage.applied', 'Control cage deformation applied to the mesh.', i18n);
  }
}
