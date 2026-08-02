import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export function mountThreeJsViewer(container, { i18n }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f5f7fa');

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  camera.position.set(150, 150, 150);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  const key = new THREE.DirectionalLight(0xffffff, 0.8);
  key.position.set(1, 1, 1);
  scene.add(ambient, key);

  const grid = new THREE.GridHelper(400, 20, 0x0057ff, 0xdde3ea);
  scene.add(grid);

  let currentModel = null;
  let wireframeOn = false;
  let cageController = null;

  const overlay = document.createElement('div');
  overlay.className = 'viewer-overlay';
  const wireframeBtn = document.createElement('button');
  wireframeBtn.type = 'button';
  wireframeBtn.textContent = i18n.t('viewer.title', 'Wireframe');
  wireframeBtn.addEventListener('click', () => {
    wireframeOn = !wireframeOn;
    wireframeBtn.classList.toggle('active', wireframeOn);
    applyWireframe();
  });
  overlay.appendChild(wireframeBtn);
  container.appendChild(overlay);

  function applyWireframe() {
    if (!currentModel) return;
    currentModel.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.wireframe = wireframeOn;
      }
    });
  }

  function resize() {
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
  }

  function frameObject(object) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    camera.position.set(center.x + maxDim, center.y + maxDim, center.z + maxDim);
    controls.target.copy(center);
    controls.update();
  }

  function loadGlbArrayBuffer(arrayBuffer) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.parse(
        arrayBuffer,
        '',
        (gltf) => {
          if (currentModel) scene.remove(currentModel);
          currentModel = gltf.scene;
          applyWireframe();
          scene.add(currentModel);
          frameObject(currentModel);
          resolve(gltf);
        },
        (error) => reject(error)
      );
    });
  }

  function setControlCage(cage, { onChange, mode = 'translate', space = 'world', pivotMode = 'centroid' } = {}) {
    cageController?.destroy?.();
    renderer.domElement.dataset.cageSelectedCount = '0';
    renderer.domElement.dataset.cageTransformAttached = 'false';
    renderer.domElement.dataset.cageNodeCount = String(cage?.nodes?.length || 0);
    const group = new THREE.Group();
    group.name = 'PackLabControlCage';
    const nodes = new Map();
    const meshBindings = [];
    const edges = cage?.edges || [];
    const nodeById = new Map((cage?.nodes || []).map((node) => [node.id, node]));
    (cage?.nodes || []).forEach((node) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(2.5, 12, 8), new THREE.MeshBasicMaterial({ color: node.pinned ? 0x64748b : 0xf97316 }));
      mesh.position.fromArray(node.positionMm || [0, 0, 0]);
      mesh.userData.cageNodeId = node.id;
      mesh.userData.startPosition = [...(node.positionMm || [0, 0, 0])];
      nodes.set(node.id, mesh);
      group.add(mesh);
    });
    const edgeLines = [];
    edges.forEach((edge) => {
      const from = typeof edge === 'object' ? edge.from : edge[0];
      const to = typeof edge === 'object' ? edge.to : edge[1];
      const a = nodeById.get(from)?.positionMm;
      const b = nodeById.get(to)?.positionMm;
      if (!a || !b) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x0ea5e9 }));
      line.userData.cageEdgeId = edge.id;
      edgeLines.push({ line, from, to });
      group.add(line);
    });
    scene.add(group);
    if (currentModel) {
      currentModel.traverse((child) => {
        if (!child.isMesh || !child.geometry?.attributes?.position) return;
        const position = child.geometry.attributes.position;
        const rest = Float32Array.from(position.array);
        meshBindings.push({ child, position, rest });
      });
    }
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const selected = new Set();
    const pivot = new THREE.Object3D();
    pivot.name = 'PackLabCageSelectionPivot';
    scene.add(pivot);
    const transform = new TransformControls(camera, renderer.domElement);
    transform.setMode(mode);
    transform.setSpace(space);
    scene.add(transform);
    let active = null;
    let beforePositions = new Map();
    let beforePivot = new THREE.Vector3();
    let beforeScale = new THREE.Vector3(1, 1, 1);
    let beforeQuaternion = new THREE.Quaternion();
    let boxStart = null;
    let boxElement = null;
    function deformPreview(selectedIds, deltas) {
      const sources = selectedIds.map((id) => nodeById.get(id)?.positionMm || [0, 0, 0]);
      const radius = Math.max(30, currentModel ? new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).length() * 0.5 : 160);
      meshBindings.forEach(({ child, position, rest }) => {
        for (let index = 0; index < position.count; index += 1) {
          const offset = index * 3;
          const weighted = [0, 0, 0]; let total = 0;
          selectedIds.forEach((id, index) => {
            const source = sources[index];
            const distance = Math.hypot(rest[offset] - source[0], rest[offset + 1] - source[1], rest[offset + 2] - source[2]);
            const normalized = Math.max(0, 1 - distance / radius);
            const weight = normalized * normalized * (3 - 2 * normalized);
            weighted[0] += (deltas[index]?.[0] || 0) * weight;
            weighted[1] += (deltas[index]?.[1] || 0) * weight;
            weighted[2] += (deltas[index]?.[2] || 0) * weight;
            total += weight;
          });
          if (total) { weighted[0] /= total; weighted[1] /= total; weighted[2] /= total; }
          position.array[offset] = rest[offset] + weighted[0];
          position.array[offset + 1] = rest[offset + 1] + weighted[1];
          position.array[offset + 2] = rest[offset + 2] + weighted[2];
        }
        position.needsUpdate = true;
        child?.geometry?.computeVertexNormals?.();
      });
    }
    function point(event) { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; return rect; }
    function updatePivot() {
      const values = [...selected].map((id) => nodes.get(id)?.position).filter(Boolean);
      renderer.domElement.dataset.cageSelectedCount = String(values.length);
      renderer.domElement.dataset.cageTransformAttached = values.length ? 'true' : 'false';
      if (!values.length) { transform.detach(); return; }
      pivot.position.set(0, 0, 0); values.forEach((value) => pivot.position.add(value)); pivot.position.multiplyScalar(1 / values.length); transform.attach(pivot);
    }
    function setSelection(id, additive = false) {
      if (!additive) selected.clear();
      if (selected.has(id) && additive) selected.delete(id); else selected.add(id);
      nodes.forEach((mesh, nodeId) => mesh.material.color.set(selected.has(nodeId) ? 0xf97316 : (nodeById.get(nodeId)?.pinned ? 0x64748b : 0x0ea5e9)));
      updatePivot();
      onChange?.({ type: 'selection', selectedNodeIds: [...selected] });
    }
    function beginBox(event) { const rect = renderer.domElement.getBoundingClientRect(); boxStart = { x: event.clientX - rect.left, y: event.clientY - rect.top, additive: event.shiftKey }; boxElement = document.createElement('div'); boxElement.className = 'cage-selection-rectangle'; Object.assign(boxElement.style, { position: 'fixed', pointerEvents: 'none', border: '1px solid #f97316', background: 'rgba(249,115,22,.12)', zIndex: 10 }); document.body.appendChild(boxElement); }
    function updateBox(event) { if (!boxStart || !boxElement) return; const rect = renderer.domElement.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top; const left = Math.min(boxStart.x, x); const top = Math.min(boxStart.y, y); Object.assign(boxElement.style, { left: `${rect.left + left}px`, top: `${rect.top + top}px`, width: `${Math.abs(x - boxStart.x)}px`, height: `${Math.abs(y - boxStart.y)}px` }); }
    function finishBox(event) { if (!boxStart) return; const rect = renderer.domElement.getBoundingClientRect(); const endX = event.clientX - rect.left; const endY = event.clientY - rect.top; const minX = Math.min(boxStart.x, endX), maxX = Math.max(boxStart.x, endX), minY = Math.min(boxStart.y, endY), maxY = Math.max(boxStart.y, endY); if (Math.abs(endX - boxStart.x) > 4 || Math.abs(endY - boxStart.y) > 4) { if (!boxStart.additive) selected.clear(); nodes.forEach((mesh, id) => { const screen = mesh.position.clone().project(camera); const sx = (screen.x + 1) * rect.width / 2; const sy = (-screen.y + 1) * rect.height / 2; if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) selected.add(id); }); nodes.forEach((mesh, id) => mesh.material.color.set(selected.has(id) ? 0xf97316 : (nodeById.get(id)?.pinned ? 0x64748b : 0x0ea5e9))); updatePivot(); onChange?.({ type: 'selection', selectedNodeIds: [...selected], selectionMode: 'box' }); } boxElement?.remove(); boxElement = null; boxStart = null; }
    function down(event) {
      if (transform.dragging) return;
      point(event); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...nodes.values()])[0];
      if (!hit) { beginBox(event); return; }
      setSelection(hit.object.userData.cageNodeId, event.shiftKey); active = hit.object; beforePositions = new Map([...selected].map((id) => [id, nodes.get(id).position.clone()])); beforePivot.copy(pivot.position); beforeScale.copy(pivot.scale); beforeQuaternion.copy(pivot.quaternion); renderer.domElement.setPointerCapture?.(event.pointerId);
    }
    function move(event) {
      if (boxStart) { updateBox(event); return; }
      if (transform.dragging) return;
      if (!active) return;
      const deltas = [...selected].map((id) => { const node = nodeById.get(id); const before = beforePositions.get(id); const delta = [pivot.position.x - beforePivot.x, pivot.position.y - beforePivot.y, pivot.position.z - beforePivot.z]; return (node?.pinned ? [0, 0, 0] : ['x', 'y', 'z'].map((axis, index) => (node?.lockedAxes || []).includes(axis) ? 0 : delta[index])); });
      selected.forEach((id, index) => { const node = nodes.get(id); const before = beforePositions.get(id); if (node && before) node.position.set(before.x + deltas[index][0], before.y + deltas[index][1], before.z + deltas[index][2]); });
      edgeLines.forEach(({ line, from, to }) => { const a = nodes.get(from)?.position; const b = nodes.get(to)?.position; if (a && b) line.geometry.setFromPoints([a, b]); });
      deformPreview([...selected], deltas);
      onChange?.({ type: 'move', nodeId: active.userData.cageNodeId, selectedNodeIds: [...selected], deltaMm: deltas[0] || [0, 0, 0], positionMm: active.position.toArray() });
    }
    function up(event) { if (boxStart) { finishBox(event); return; } if (transform.dragging || !active) return; onChange?.({ type: 'end', nodeId: active.userData.cageNodeId, selectedNodeIds: [...selected] }); active = null; }
    transform.addEventListener('dragging-changed', (event) => { controls.enabled = !event.value; if (event.value) { beforePositions = new Map([...selected].map((id) => [id, nodes.get(id).position.clone()])); beforePivot.copy(pivot.position); beforeScale.copy(pivot.scale); beforeQuaternion.copy(pivot.quaternion); onChange?.({ type: 'start', nodeId: [...selected][0], selectedNodeIds: [...selected], before: beforePivot.toArray(), transformMode: transform.getMode?.() || mode, pivotMode }); } else if (selected.size) { onChange?.({ type: 'end', nodeId: [...selected][0], selectedNodeIds: [...selected], transformMode: transform.getMode?.() || mode }); } });
    transform.addEventListener('change', () => { if (!transform.dragging || !selected.size) return; const positionDelta = pivot.position.clone().sub(beforePivot); const scale = pivot.scale.clone(); const rotation = pivot.quaternion.clone(); const deltas = []; const nodePositions = {}; selected.forEach((id) => { const node = nodeById.get(id); const before = beforePositions.get(id); if (!node || !before) return; const target = before.clone().sub(beforePivot).multiply(scale).applyQuaternion(rotation).add(beforePivot).add(positionDelta); const movement = target.sub(before); const constrained = node.pinned ? [0, 0, 0] : ['x', 'y', 'z'].map((axis, index) => (node.lockedAxes || []).includes(axis) ? 0 : movement.getComponent(index)); const next = before.clone().add(new THREE.Vector3(...constrained)); nodes.get(id).position.copy(next); nodePositions[id] = next.toArray(); deltas.push(constrained); }); edgeLines.forEach(({ line, from, to }) => { const a = nodes.get(from)?.position; const b = nodes.get(to)?.position; if (a && b) line.geometry.setFromPoints([a, b]); }); deformPreview([...selected], deltas); onChange?.({ type: 'move', nodeId: [...selected][0], selectedNodeIds: [...selected], deltaMm: deltas[0] || [0, 0, 0], nodePositions, positionMm: nodes.get([...selected][0])?.position.toArray(), transformMode: transform.getMode?.() || mode, scale: scale.toArray(), rotation: new THREE.Euler().setFromQuaternion(rotation).toArray(), pivot: beforePivot.toArray(), pivotMode }); });
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up);
    cageController = { destroy() { renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up); transform.detach(); scene.remove(transform); scene.remove(pivot); scene.remove(group); group.traverse((item) => { item.geometry?.dispose?.(); item.material?.dispose?.(); }); cageController = null; }, select(nodeId, additive = false) { setSelection(nodeId, additive); }, selectRegion(region) { selected.clear(); nodes.forEach((mesh, id) => { if (nodeById.get(id)?.region === region) selected.add(id); }); updatePivot(); }, setMode(nextMode) { transform.setMode(nextMode); }, getSelectedIds() { return [...selected]; }, group };
    return cageController;
  }

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener('resize', resize);
  animate();
  window.dispatchEvent(new CustomEvent('packlab:viewer-ready'));

  return {
    loadGlbArrayBuffer,
    setControlCage,
    clearControlCage() { cageController?.destroy?.(); },
    setWireframe(on) {
      wireframeOn = on;
      wireframeBtn.classList.toggle('active', wireframeOn);
      applyWireframe();
    },
    getCameraState() {
      return { mode: camera.isOrthographicCamera ? 'orthographic' : 'perspective', position: camera.position.toArray(), target: controls.target.toArray(), up: camera.up.toArray(), zoom: camera.zoom, viewPreset: null };
    },
    setCameraState(state = {}) {
      const finiteVector = (value) => Array.isArray(value) && value.length === 3 && value.every((item) => Number.isFinite(Number(item)));
      if (finiteVector(state.position)) camera.position.fromArray(state.position);
      if (finiteVector(state.target)) controls.target.fromArray(state.target);
      if (finiteVector(state.up)) camera.up.fromArray(state.up);
      if (Number.isFinite(Number(state.zoom)) && Number(state.zoom) > 0 && Number(state.zoom) < 100) camera.zoom = Number(state.zoom);
      camera.updateProjectionMatrix(); controls.update();
    },
    destroy() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
      cageController?.destroy?.();
    },
  };
}
