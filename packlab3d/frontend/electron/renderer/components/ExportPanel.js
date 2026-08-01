import { parseZip } from '../zip.js';

function arrayBufferToFile(arrayBuffer, name) {
  return new File([arrayBuffer], name);
}

export function mountExportPanel(container, { i18n, store, api, viewer, setStatus }) {
  const buttons = {};

  function currentMeshFile(fallbackName = 'mesh.obj') {
    const pipeline = store.getState().pipeline || {};
    const latest = pipeline.walled || pipeline.cleaned || pipeline.scaled || pipeline.generated;
    if (!latest) return null;
    return arrayBufferToFile(latest, fallbackName);
  }

  function setPipeline(patch) {
    const current = store.getState().pipeline || {};
    store.setState({ pipeline: { ...current, ...patch } });
  }

  async function run(taskName, fn) {
    setStatus(`${taskName}...`);
    setButtonsDisabled(true);
    try {
      // fn() includes pre-flight validation (e.g. "generate a mesh first") —
      // those throws must land here too, not before run() is entered, or the
      // failure is completely silent (found via E2E: clicking a button with
      // an unmet prerequisite updated no visible status at all).
      const result = await fn();
      setStatus(result && result.message ? result.message : `${taskName} OK`);
      return result;
    } catch (err) {
      setStatus(`${taskName} FAILED: ${err.message}`);
      throw err;
    } finally {
      setButtonsDisabled(false);
    }
  }

  function setButtonsDisabled(disabled) {
    Object.values(buttons).forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  async function loadIntoViewer(arrayBuffer) {
    if (viewer) await viewer.loadGlbArrayBuffer(arrayBuffer);
  }

  function makeButton(key, i18nKey, taskName, fn) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = i18n.t(i18nKey, key);
    btn.addEventListener('click', () => run(taskName, fn).catch(() => {}));
    buttons[key] = btn;
    return btn;
  }

  function render() {
    container.innerHTML = '';
    const bar = document.createElement('div');
    bar.className = 'export-bar';

    bar.appendChild(
      makeButton('generateMesh', 'form.generate', 'generate-mesh', async () => {
        const { photo } = store.getState();
        if (!photo) throw new Error('Upload a photo first.');
        const result = await api.generateMesh({ file: photo, language: i18n.language });
        setPipeline({ generated: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('scaleMesh', 'nav.measurements', 'scale-mesh', async () => {
        const mesh = currentMeshFile();
        if (!mesh) throw new Error('Generate a mesh first.');
        const m = store.getState().measurement || {};
        const result = await api.scaleMesh({
          file: mesh,
          dimensions: {
            width_mm: m.widthMm,
            height_mm: m.heightMm,
            depth_mm: m.depthMm,
            diameter_mm: m.diameterMm,
            volume_ml: m.volumeMl,
          },
          language: i18n.language,
        });
        setPipeline({ scaled: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('cleanupMesh', 'common.ok', 'cleanup-mesh', async () => {
        const mesh = currentMeshFile();
        if (!mesh) throw new Error('Generate a mesh first.');
        const result = await api.cleanupMesh({ file: mesh, language: i18n.language });
        setPipeline({ cleaned: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('wallThickness', 'form.material', 'apply-wall-thickness', async () => {
        const mesh = currentMeshFile();
        if (!mesh) throw new Error('Generate a mesh first.');
        const m = store.getState().measurement || {};
        const l = store.getState().label || {};
        const result = await api.applyWallThickness({
          file: mesh,
          packagingType: m.packagingType || 'bottle',
          material: l.material || undefined,
          language: i18n.language,
        });
        setPipeline({ walled: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('generate2d', 'drawing.title', 'generate-2d', async () => {
        const mesh = currentMeshFile();
        if (!mesh) throw new Error('Generate a mesh first.');
        const l = store.getState().label || {};
        const result = await api.generate2d({
          file: mesh,
          material: l.material || undefined,
          language: i18n.language,
        });
        setPipeline({ drawingZip: result.arrayBuffer });
        if (window.packlab) await window.packlab.files.save('technical_drawing.zip', result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('generateLabel', 'label.title', 'generate-label', async () => {
        const l = store.getState().label || {};
        if (!l.style || !l.shape) throw new Error('Pick a label style and shape first.');
        const result = await api.generateLabel({
          style: l.style,
          shape: l.shape,
          widthMm: l.widthMm || 80,
          heightMm: l.heightMm || 50,
          language: i18n.language,
          content: {
            brand_name: l.brandName,
            product_name: l.productName,
            material: l.material,
          },
          logo: l.logoFile,
        });
        const files = await parseZip(result.arrayBuffer);
        const labelPngBytes = files['label.png'];
        setPipeline({ labelZip: result.arrayBuffer, labelPngBytes });

        const previewImg = document.getElementById('label-preview');
        if (previewImg && labelPngBytes) {
          const blob = new Blob([labelPngBytes], { type: 'image/png' });
          previewImg.src = URL.createObjectURL(blob);
        }

        return result;
      })
    );

    bar.appendChild(
      makeButton('applyLabelTo3d', 'export.title', 'apply-label-to-3d', async () => {
        const mesh = currentMeshFile();
        const pipeline = store.getState().pipeline || {};
        if (!mesh || !pipeline.labelPngBytes) throw new Error('Generate a mesh and a label first.');
        const m = store.getState().measurement || {};
        const labelPngBlob = new Blob([pipeline.labelPngBytes], { type: 'image/png' });
        const result = await api.applyLabelTo3d({
          file: mesh,
          packagingType: m.packagingType || 'bottle',
          labelPngBlob,
          language: i18n.language,
        });
        setPipeline({ glb: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        if (window.packlab) await window.packlab.files.save('labeled_model.glb', result.arrayBuffer);
        return result;
      })
    );

    container.appendChild(bar);
  }

  const unsubscribeI18n = i18n.onChange(render);
  render();

  return {
    render,
    destroy() {
      unsubscribeI18n();
    },
  };
}
