// Resolved via the import map in index.html (three.importmap.json) — required
// because three's own addon modules (OrbitControls, GLTFLoader) import the
// bare specifier 'three' internally, which only an import map can resolve
// without a bundler.
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

  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }

  resize();
  window.addEventListener('resize', resize);
  animate();

  return {
    loadGlbArrayBuffer,
    setWireframe(on) {
      wireframeOn = on;
      wireframeBtn.classList.toggle('active', wireframeOn);
      applyWireframe();
    },
    destroy() {
      window.removeEventListener('resize', resize);
      renderer.dispose();
    },
  };
}
