import { parseZip } from '../zip.js';

function arrayBufferToFile(arrayBuffer, name) {
  return new File([arrayBuffer], name);
}

export function mountExportPanel(container, { i18n, store, api, viewer, setStatus }) {
  const buttons = {};
  const labelMapping = {
    uvMode: 'bottle_blend',
    horizontalPosition: 50,
    verticalPosition: 50,
    scale: 100,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    seamPosition: 0,
    textureResolution: 1024,
  };

  function t(key, fallback) {
    return i18n.t(key, fallback);
  }

  function withTimeout(promise, timeoutMs, message) {
    let timeoutId;
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId));
  }

  function currentMeshFile(fallbackName = 'mesh.obj') {
    const pipeline = store.getState().pipeline || {};
    const latest = pipeline.walled || pipeline.cleaned || pipeline.scaled || pipeline.generated;
    if (!latest) return null;
    return arrayBufferToFile(latest, fallbackName);
  }

  function requireUnifiedMesh() {
    const mesh = currentMeshFile();
    if (!mesh) throw new Error(t('reconstruction.errors.createUnifiedFirst', 'Create a unified design from the photo set first.'));
    return mesh;
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
    if (viewer) {
      setStatus(t('labelMapping.progress.viewerLoadStarted', 'Loading viewer...'));
      await withTimeout(
        viewer.loadGlbArrayBuffer(arrayBuffer),
        12000,
        t('labelMapping.errors.viewerTimeout', 'The textured model was generated, but viewer loading took too long.')
      );
      setStatus(t('labelMapping.progress.viewerLoadCompleted', 'Viewer load completed.'));
    }
  }

  function makeButton(key, i18nKey, taskName, fn, labelFallback = key) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = i18n.t(i18nKey, labelFallback);
    btn.addEventListener('click', () => run(taskName, fn).catch(() => {}));
    buttons[key] = btn;
    return btn;
  }

  function render() {
    container.innerHTML = '';
    container.appendChild(renderLabelMappingControls());

    const bar = document.createElement('div');
    bar.className = 'export-bar';

    bar.appendChild(
      makeButton('scaleMesh', 'nav.measurements', 'scale-mesh', async () => {
        const mesh = requireUnifiedMesh();
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
        const mesh = requireUnifiedMesh();
        const result = await api.cleanupMesh({ file: mesh, language: i18n.language });
        setPipeline({ cleaned: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      })
    );

    bar.appendChild(
      makeButton('wallThickness', 'form.material', 'apply-wall-thickness', async () => {
        const mesh = requireUnifiedMesh();
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
        const mesh = requireUnifiedMesh();
        const l = store.getState().label || {};
        const result = await api.generate2d({
          file: mesh,
          material: l.material || undefined,
          language: i18n.language,
        });
        setPipeline({ drawingZip: result.arrayBuffer });
        if (window.packlab) window.packlab.files.save('technical_drawing.zip', result.arrayBuffer).catch(() => {});
        return result;
      })
    );

    bar.appendChild(
      makeButton('generateLabel', 'label.title', 'generate-label', async () => {
        const l = store.getState().label || {};
        if (!l.style || !l.shape) throw new Error(t('labelMapping.errors.pickLabelFirst', 'Pick a label style and shape first.'));
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
      makeButton('applyLabelTo3d', 'labelMapping.applyTo3d', t('labelMapping.applyTo3d', 'Apply Label to 3D'), async () => {
        const mesh = currentMeshFile();
        const pipeline = store.getState().pipeline || {};
        if (!mesh || !pipeline.labelPngBytes) throw new Error(t('labelMapping.errors.requireDesignAndLabel', 'Create a unified design and generate a label first.'));
        const m = store.getState().measurement || {};
        const labelPngBlob = new Blob([pipeline.labelPngBytes], { type: 'image/png' });
        setStatus(t('labelMapping.progress.validatingMesh', 'Validating mesh...'));
        const result = await api.applyLabelTo3d({
          file: mesh,
          packagingType: m.packagingType || 'bottle',
          labelPngBlob,
          uvMode: labelMapping.uvMode,
          textureResolution: Number(labelMapping.textureResolution) || 1024,
          language: i18n.language,
        });
        setStatus(t('labelMapping.progress.responseReceived', 'Frontend received response.'));
        setPipeline({ glb: result.arrayBuffer });
        await loadIntoViewer(result.arrayBuffer);
        return result;
      }, t('labelMapping.applyTo3d', 'Apply Label to 3D'))
    );

    container.appendChild(bar);
  }

  function renderLabelMappingControls() {
    const panel = document.createElement('div');
    panel.className = 'label-mapping';
    const title = document.createElement('div');
    title.className = 'label-mapping__title';
    title.textContent = t('labelMapping.title', 'Label Mapping');
    panel.appendChild(title);

    panel.appendChild(selectField('labelMapping.mappingMode', 'Mapping Mode', 'uvMode', [
      ['cylindrical', t('labelMapping.modes.cylindrical', 'Cylindrical')],
      ['box', t('labelMapping.modes.box', 'Box')],
      ['bottle_blend', t('labelMapping.modes.bottleBlend', 'Bottle Blend')],
    ]));
    panel.appendChild(numberField('labelMapping.horizontalPosition', 'Horizontal Position (%)', 'horizontalPosition', 0, 100, 1));
    panel.appendChild(numberField('labelMapping.verticalPosition', 'Vertical Position (%)', 'verticalPosition', 0, 100, 1));
    panel.appendChild(numberField('labelMapping.scale', 'Scale (%)', 'scale', 10, 300, 1));
    panel.appendChild(numberField('labelMapping.rotation', 'Rotation', 'rotation', -180, 180, 1));
    panel.appendChild(numberField('labelMapping.seamPosition', 'Seam Position (%)', 'seamPosition', 0, 100, 1));
    panel.appendChild(numberField('labelMapping.textureResolution', 'Preview Quality', 'textureResolution', 256, 4096, 256));
    panel.appendChild(checkField('labelMapping.flipHorizontal', 'Flip Horizontal', 'flipHorizontal'));
    panel.appendChild(checkField('labelMapping.flipVertical', 'Flip Vertical', 'flipVertical'));
    return panel;
  }

  function selectField(key, fallback, stateKey, options) {
    const label = document.createElement('label');
    label.className = 'label-mapping__field';
    const span = document.createElement('span');
    span.textContent = t(key, fallback);
    const select = document.createElement('select');
    options.forEach(([value, text]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      option.selected = labelMapping[stateKey] === value;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      labelMapping[stateKey] = select.value;
    });
    label.append(span, select);
    return label;
  }

  function numberField(key, fallback, stateKey, min, max, step) {
    const label = document.createElement('label');
    label.className = 'label-mapping__field';
    const span = document.createElement('span');
    span.textContent = t(key, fallback);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(labelMapping[stateKey]);
    input.addEventListener('input', () => {
      labelMapping[stateKey] = Number(input.value);
    });
    label.append(span, input);
    return label;
  }

  function checkField(key, fallback, stateKey) {
    const label = document.createElement('label');
    label.className = 'label-mapping__check';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(labelMapping[stateKey]);
    input.addEventListener('change', () => {
      labelMapping[stateKey] = input.checked;
    });
    label.append(input, document.createTextNode(t(key, fallback)));
    return label;
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
