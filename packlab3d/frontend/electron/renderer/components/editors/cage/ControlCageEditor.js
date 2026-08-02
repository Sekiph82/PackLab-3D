import { actionButton, el, localPoint, makePanel, svgEl, tr } from '../../editorUtils.js';

const WIDTH = 360;
const HEIGHT = 300;
function copy(value) { return JSON.parse(JSON.stringify(value ?? [])); }

export function applyCageDelta(nodes, selectedIds, delta, { falloff = 'medium', symmetry = true } = {}) {
  const distances = { local: 0.18, medium: 0.36, wide: 0.7 };
  const range = distances[falloff] || distances.medium;
  return nodes.map((node) => {
    if (!selectedIds.includes(node.id) || node.pinned) return { ...node, positionMm: [...(node.positionMm || [0, 0, 0])] };
    const axes = new Set(node.lockedAxes || []);
    const result = [...(node.positionMm || [0, 0, 0])];
    ['x', 'y', 'z'].forEach((axis, index) => { if (!axes.has(axis)) result[index] += Number(delta[index] || 0); });
    return { ...node, positionMm: result };
  });
}

export function mountControlCageEditor(container, { i18n, cage, viewer, onApply, onDirty, onPreview } = {}) {
  container.innerHTML = '';
  const panel = makePanel(tr('phase7.cage.editor', 'Control Cage Editor', i18n));
  const toolbar = el('div', 'interactive-editor__toolbar');
  const status = el('div', 'interactive-editor__status');
  const host = el('div', 'control-cage-editor__surface');
  const svg = viewer ? null : svgEl('svg', { class: 'cage-editor__canvas', viewBox: `0 0 ${WIDTH} ${HEIGHT}`, tabindex: '0' });
  if (svg) host.appendChild(svg);
  let nodes = copy(cage?.nodes || []);
  const edges = copy(cage?.edges || []);
  let selected = new Set();
  let dragging = null;
  let falloff = 'medium';
  let symmetry = true;
  let pending = new Map();
  let undoStack = [];
  let redoStack = [];
  toolbar.append(actionButton(tr('phase7.cage.falloff', 'Falloff', i18n), () => { falloff = falloff === 'local' ? 'medium' : falloff === 'medium' ? 'wide' : 'local'; render(); }), actionButton(tr('phase7.cage.symmetry', 'Symmetry', i18n), () => { symmetry = !symmetry; render(); }), actionButton(tr('phase7.cage.pin', 'Pin/Unpin', i18n), togglePin), actionButton(tr('phase7.cage.resetNode', 'Reset Node', i18n), resetSelected), actionButton(tr('common.undo', 'Undo', i18n), undo), actionButton(tr('common.redo', 'Redo', i18n), redo), actionButton(tr('common.apply', 'Apply', i18n), apply));
  panel.append(toolbar, host, status); container.appendChild(panel);
  function snapshot(label = 'Cage edit') { undoStack.push({ label, value: copy(nodes) }); redoStack = []; }
  function bounds() { const xs = nodes.map((node) => Number(node.positionMm?.[0]) || 0); const zs = nodes.map((node) => Number(node.positionMm?.[2]) || 0); return { minX: Math.min(...xs, -1), maxX: Math.max(...xs, 1), minZ: Math.min(...zs, -1), maxZ: Math.max(...zs, 1) }; }
  function project(node) { const b = bounds(); return { x: 30 + ((Number(node.positionMm?.[0] || 0) - b.minX) / Math.max(b.maxX - b.minX, 1)) * (WIDTH - 60), y: HEIGHT - 30 - ((Number(node.positionMm?.[2] || 0) - b.minZ) / Math.max(b.maxZ - b.minZ, 1)) * (HEIGHT - 60) }; }
  function render() {
    if (viewer) { viewer.clearControlCage?.(); viewer.setControlCage?.({ nodes, edges }, { onChange: handleViewerChange }); }
    if (svg) {
      svg.innerHTML = ''; svg.appendChild(svgEl('rect', { x: 0, y: 0, width: WIDTH, height: HEIGHT, fill: '#f8fbff', stroke: '#d7e5f7' }));
      edges.forEach((edge) => { const from = typeof edge === 'object' ? edge.from : edge[0]; const to = typeof edge === 'object' ? edge.to : edge[1]; const a = nodes.find((node) => node.id === from); const b = nodes.find((node) => node.id === to); if (!a || !b) return; const pa = project(a); const pb = project(b); svg.appendChild(svgEl('line', { x1: pa.x, y1: pa.y, x2: pb.x, y2: pb.y, stroke: '#94a3b8', 'stroke-width': 2 })); });
      nodes.forEach((node) => { const point = project(node); const circle = svgEl('circle', { cx: point.x, cy: point.y, r: selected.has(node.id) ? 8 : 5, fill: node.pinned ? '#64748b' : selected.has(node.id) ? '#f97316' : '#0ea5e9', stroke: '#082f49', 'data-cage-node-id': node.id }); circle.addEventListener('pointerdown', (event) => startSvg(event, node.id)); circle.addEventListener('mousedown', (event) => startSvg(event, node.id)); svg.appendChild(circle); });
    }
    status.textContent = `${tr('phase7.cage.nodes', 'Cage nodes', i18n)}: ${nodes.length} | ${tr('phase7.cage.selected', 'Selected', i18n)}: ${selected.size} | ${tr('phase7.cage.falloffMode', 'Falloff', i18n)}: ${falloff}${viewer ? ` | ${tr('phase7.cage.viewerMode', 'Three.js viewer mode', i18n)}` : ''}`;
  }
  function startSvg(event, id) { if (dragging) { if (event.shiftKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); render(); } return; } event.preventDefault(); if (event.shiftKey) { if (selected.has(id)) selected.delete(id); else selected.add(id); } else selected = new Set([id]); const point = localPoint(event, svg, WIDTH, HEIGHT); snapshot('Move cage nodes'); dragging = { id, point, positions: Object.fromEntries(nodes.map((node) => [node.id, [...(node.positionMm || [0, 0, 0])]])) }; render(); }
  function dragSvg(event) { if (!dragging || !svg) return; event.preventDefault(); const active = nodes.find((node) => node.id === dragging.id); const point = localPoint(event, svg, WIDTH, HEIGHT); const b = bounds(); const dx = ((point.x - dragging.point.x) / (WIDTH - 60)) * (b.maxX - b.minX); const dz = -((point.y - dragging.point.y) / (HEIGHT - 60)) * (b.maxZ - b.minZ); nodes = applyCageDelta(nodes.map((node) => ({ ...node, positionMm: dragging.positions[node.id] })), [...selected], [dx, 0, dz], { falloff, symmetry }); pending.set(dragging.id, active?.pinned ? [0, 0, 0] : [dx, 0, dz]); onPreview?.({ nodes: copy(nodes), falloff }); onDirty?.({ type: 'cage-drag', nodeId: dragging.id }); render(); }
  function stop() { if (!dragging) return; dragging = null; onPreview?.({ nodes: copy(nodes), falloff, settled: true }); render(); }
  function handleViewerChange(event) {
    if (!event?.nodeId) return;
    if (event.type === 'start') {
      selected = new Set([event.nodeId]);
      snapshot('Move cage node');
      dragging = { id: event.nodeId, positions: new Map(nodes.map((node) => [node.id, [...(node.positionMm || [0, 0, 0])]])) };
      status.textContent = 'Dragging cage node';
    } else if (event.type === 'move') {
      const node = nodes.find((item) => item.id === event.nodeId);
      const original = dragging?.positions?.get(event.nodeId);
      if (!node || node.pinned || !original) return;
      const delta = event.deltaMm || [0, 0, 0];
      const base = nodes.map((item) => ({ ...item, positionMm: [...(dragging.positions.get(item.id) || item.positionMm || [0, 0, 0])] }));
      nodes = applyCageDelta(base, [event.nodeId], delta, { falloff, symmetry });
      pending.set(event.nodeId, delta);
      onPreview?.({ nodes: copy(nodes), falloff });
      onDirty?.({ type: 'cage-drag', nodeId: event.nodeId });
    } else if (event.type === 'end') {
      dragging = null;
      onPreview?.({ nodes: copy(nodes), falloff, settled: true });
      render();
    }
  }
  function togglePin() { if (!selected.size) return; dragging = null; snapshot('Toggle cage pins'); nodes = nodes.map((node) => selected.has(node.id) ? { ...node, pinned: !node.pinned } : node); render(); }
  function resetSelected() { if (!selected.size) return; snapshot('Reset cage nodes'); nodes = nodes.map((node) => selected.has(node.id) ? { ...node, positionMm: [...(node.restPositionMm || node.fittedPositionMm || node.positionMm)] } : node); pending.clear(); render(); }
  function undo() { const item = undoStack.pop(); if (!item) return; redoStack.push({ label: item.label, value: copy(nodes) }); nodes = item.value; pending.clear(); render(); }
  function redo() { const item = redoStack.pop(); if (!item) return; undoStack.push({ label: item.label, value: copy(nodes) }); nodes = item.value; pending.clear(); render(); }
  async function apply() { const entries = [...pending.entries()]; const cageNodes = entries.length ? entries.map(([id, deltaMm]) => ({ id, deltaMm })) : [...selected].map((id) => ({ id, deltaMm: [0, 0, 0] })); const result = await onApply?.({ cageNodes, falloff, symmetry, sourceEditor: 'control-cage', operationId: `cage-${Date.now()}` }); pending.clear(); status.textContent = tr('phase7.cage.applied', 'Control cage deformation applied to the mesh.', i18n); return result; }
  svg?.addEventListener('pointermove', dragSvg); svg?.addEventListener('mousemove', dragSvg); window.addEventListener('pointerup', stop); window.addEventListener('mouseup', stop); render();
  return { getNodes: () => copy(nodes), getSelectedIds: () => [...selected], getFalloff: () => falloff, destroy: () => viewer?.clearControlCage?.() };
}
