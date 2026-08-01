// Cinematic splash animation. Loads the real logo PNG as a texture and maps
// it onto the front face of a 3D card (brand-blue on the other 5 faces).
//
// Deviation from window.packlab.logoPath: that would mean loading the texture
// from a file:// path outside this renderer's own directory, which the CSP
// (`default-src 'self'`) blocks — it doesn't match 'self', 'data:', or
// 'blob:'. preload.js instead pre-reads the real PNGs and exposes them as
// `window.packlab.logos.*` base64 data URLs, which TextureLoader can load
// directly and which the CSP already allows. Verified the data URL itself is
// built correctly (path resolution + valid PNG bytes) via a standalone script.
//
// Also: packlab_logo.glb does not exist anywhere in this project (only 7 PNGs
// in the logo pack, confirmed on disk) — GLTFLoader was never a viable path.
import * as THREE from 'three';

const ROTATION_SPEED_Y = 0.001; // ~0.057deg/frame (~3.4deg/sec) — slow enough
const ROTATION_SPEED_X = 0.0005; // that the textured front face stays clearly
// visible for the whole splash duration instead of spinning past the camera
// within ~2 seconds (0.01/0.005 rad/frame, the original speed, did exactly that).

export function startSplashAnimation({ logoDataUrl } = {}) {
  const canvas = document.getElementById('splash-canvas');
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(300, 300);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 6);

  // Intensities below are much higher than the "1.4 / 0.6" a pre-r155 Three.js
  // scene would use. Since r155, PointLight intensity is physically-correct
  // (inverse-square falloff in real units) by default — at ~8 units from the
  // card (light at (5,5,5)), the old values delivered ~1.4/75 ≈ 0.02 effective
  // illumination, rendering the card's white logo background as near-black.
  // Confirmed via an actual screenshot before and after this change.
  const keyLight = new THREE.PointLight(0xffffff, 70);
  keyLight.position.set(5, 5, 5);
  scene.add(keyLight);

  const fillLight = new THREE.PointLight(0x88bbff, 30);
  fillLight.position.set(-3, -2, 4);
  scene.add(fillLight);

  const ambient = new THREE.AmbientLight(0xffffff, 2.5); // distance-independent base brightness
  scene.add(ambient);

  function buildLogoCard(frontMaterial) {
    const geometry = new THREE.BoxGeometry(2.4, 2.4, 0.2);
    const brandBlue = new THREE.MeshStandardMaterial({ color: 0x0057ff, metalness: 0.2, roughness: 0.5 });
    // BoxGeometry material group order is [+x, -x, +y, -y, +z, -z]; the camera
    // sits at +z looking toward the origin, so index 4 (+z) is the face it sees.
    const materials = [brandBlue, brandBlue, brandBlue, brandBlue, frontMaterial, brandBlue];
    const card = new THREE.Mesh(geometry, materials);
    scene.add(card);
    return card;
  }

  function animateCard(card) {
    let t = 0;
    let running = true;
    function frame() {
      if (!running) return;
      t += 0.01;
      camera.position.x = Math.sin(t * 0.7) * 1.2;
      camera.position.y = Math.sin(t * 0.4) * 0.6;
      camera.position.z = 6 - Math.sin(t * 0.2) * 0.5;
      camera.lookAt(0, 0, 0);

      card.rotation.y += ROTATION_SPEED_Y;
      card.rotation.x += ROTATION_SPEED_X;

      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    frame();
    return () => {
      running = false;
    };
  }

function fallbackMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.1, roughness: 0.6 });
}

// The real logo PNG has a transparent background (confirmed: corner pixel is
// (0,0,0,0), not opaque white) — MeshStandardMaterial ignores a map's alpha
// channel by default, so the transparent RGB (black) rendered as an opaque
// black square with the logo mark floating on it. Compositing onto a white
// canvas first — rather than fighting material transparency on a solid box,
// which would make the "transparent" area show whatever's behind the mesh
// instead of a clean white card — guarantees the correct opaque result.
function loadLogoTextureOnWhite(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      resolve(texture);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

if (logoDataUrl) {
    loadLogoTextureOnWhite(logoDataUrl)
      .then((texture) => {
        const frontMaterial = new THREE.MeshStandardMaterial({ map: texture, metalness: 0.05, roughness: 0.7 });
        animateCard(buildLogoCard(frontMaterial));
      })
      .catch((err) => {
        // Previously had no error handler at all — a load failure meant
        // nothing rendered, no cube, no logo, no console signal. Now falls
        // back to a plain white card and logs why.
        console.error('[splash] logo texture failed to load:', err);
        animateCard(buildLogoCard(fallbackMaterial()));
      });
  } else {
    console.warn('[splash] no logo data URL provided — using white fallback card.');
    animateCard(buildLogoCard(fallbackMaterial()));
  }
}
