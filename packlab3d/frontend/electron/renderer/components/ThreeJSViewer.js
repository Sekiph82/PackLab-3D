import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

  function setControlCage(cage, { onChange } = {}) {
    cageController?.destroy?.();
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
    edges.forEach((edge) => {
      const from = typeof edge === 'object' ? edge.from : edge[0];
      const to = typeof edge === 'object' ? edge.to : edge[1];
      const a = nodeById.get(from)?.positionMm;
      const b = nodeById.get(to)?.positionMm;
      if (!a || !b) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x0ea5e9 })));
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
    let active = null;
    let before = null;
    function deformPreview(nodeId, delta) {
      const source = nodeById.get(nodeId)?.positionMm || [0, 0, 0];
      const radius = Math.max(30, currentModel ? new THREE.Box3().setFromObject(currentModel).getSize(new THREE.Vector3()).length() * 0.38 : 120);
      meshBindings.forEach(({ child, position, rest }) => {
        for (let index = 0; index < position.count; index += 1) {
          const offset = index * 3;
          const distance = Math.hypot(rest[offset] - source[0], rest[offset + 1] - source[1], rest[offset + 2] - source[2]);
          const normalized = Math.max(0, 1 - distance / radius);
          const weight = normalized * normalized * (3 - 2 * normalized);
          position.array[offset] = rest[offset] + delta[0] * weight;
          position.array[offset + 1] = rest[offset + 1] + delta[1] * weight;
          position.array[offset + 2] = rest[offset + 2] + delta[2] * weight;
        }
        position.needsUpdate = true;
        child?.geometry?.computeVertexNormals?.();
      });
    }
    function point(event) { const rect = renderer.domElement.getBoundingClientRect(); pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1; pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1; }
    function down(event) {
      point(event); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...nodes.values()])[0];
      if (!hit) return;
      active = hit.object; before = active.position.clone(); controls.enabled = false; renderer.domElement.setPointerCapture?.(event.pointerId); onChange?.({ type: 'start', nodeId: active.userData.cageNodeId, before: before.toArray() });
    }
    function move(event) {
      if (!active) return; point(event);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -before.y); const ray = raycaster.ray; if (!raycaster.setFromCamera(pointer, camera)) return;
      const hit = new THREE.Vector3(); if (!ray.intersectPlane(plane, hit)) return;
      active.position.x = hit.x; active.position.z = hit.z;
      const delta = [hit.x - before.x, 0, hit.z - before.z];
      deformPreview(active.userData.cageNodeId, delta);
      onChange?.({ type: 'move', nodeId: active.userData.cageNodeId, deltaMm: delta, positionMm: active.position.toArray() });
    }
    function up() { if (!active) return; onChange?.({ type: 'end', nodeId: active.userData.cageNodeId }); active = null; controls.enabled = true; }
    renderer.domElement.addEventListener('pointerdown', down); renderer.domElement.addEventListener('pointermove', move); renderer.domElement.addEventListener('pointerup', up);
    cageController = { destroy() { renderer.domElement.removeEventListener('pointerdown', down); renderer.domElement.removeEventListener('pointermove', move); renderer.domElement.removeEventListener('pointerup', up); scene.remove(group); group.traverse((item) => { item.geometry?.dispose?.(); item.material?.dispose?.(); }); cageController = null; }, select(nodeId) { nodes.get(nodeId)?.material?.color.set(0xf97316); }, group };
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
    destroy() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
      cageController?.destroy?.();
    },
  };
}
