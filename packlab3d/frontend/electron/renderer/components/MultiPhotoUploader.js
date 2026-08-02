import { formatFileSize } from './FileUploader.js';

export const MAX_PHOTOS = 10;
export const MAX_FILE_SIZE = 25 * 1024 * 1024;
export const MAX_TOTAL_SIZE = 150 * 1024 * 1024;
export const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export const VIEW_TYPES = [
  ['front', 'Front'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['right', 'Right'],
  ['top', 'Top'],
  ['bottom', 'Bottom'],
  ['front_left', 'Front-Left'],
  ['front_right', 'Front-Right'],
  ['back_left', 'Back-Left'],
  ['back_right', 'Back-Right'],
  ['custom', 'Custom'],
];

function photoId() {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function viewForIndex(index) {
  return VIEW_TYPES[Math.min(index, VIEW_TYPES.length - 1)][0];
}

function readImageMeta(file, url) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => resolve({ width: null, height: null });
    image.src = url;
  });
}

export function validatePhotoSelection(existingPhotos, files) {
  const selected = Array.from(files || []);
  if (selected.length === 0) return { ok: false, error: 'Select at least one photo.' };
  if (existingPhotos.length + selected.length > MAX_PHOTOS) {
    return { ok: false, error: 'PackLab 3D accepts at most 10 photos. Reduce the selection and try again.' };
  }
  let total = existingPhotos.reduce((sum, photo) => sum + photo.file.size, 0);
  for (const file of selected) {
    if (!SUPPORTED_TYPES.includes(file.type)) {
      return { ok: false, error: `Unsupported file type: ${file.type || 'unknown'}. Use JPEG, PNG, or WebP.` };
    }
    if (file.size > MAX_FILE_SIZE) {
      return { ok: false, error: `${file.name} exceeds the 25 MB per-photo limit.` };
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_SIZE) {
    return { ok: false, error: 'Combined photo size exceeds 150 MB.' };
  }
  return { ok: true, files: selected };
}

export function mountMultiPhotoUploader(container, { i18n, store, api, viewer, setStatus }) {
  container.innerHTML = '';

  function t(key, fallback) {
    return i18n.t(key, fallback);
  }

  const state = {
    projectId: null,
    photos: [],
    uploaded: false,
    activeJobId: null,
    report: null,
    editableModel: null,
    versionComparison: null,
    reconstructionMode: 'auto',
    capabilities: null,
  };

  const root = document.createElement('div');
  root.className = 'multi-photo';

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.multiple = true;
  input.className = 'multi-photo__input';
  input.hidden = true;

  const actions = document.createElement('div');
  actions.className = 'multi-photo__actions';
  const addButton = button('photos.add', 'Add Photos', () => input.click());
  const workspaceButton = button('photos.openWorkspace', 'Open Photo Workspace', () => grid.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  const clearButton = button('photos.removeAll', 'Remove All', removeAll);
  const autoAssignButton = button('photos.autoAssignViews', 'Auto-Assign Views', autoAssignViews);
  const analyzeButton = button('photos.reviewQuality', 'Review Photo Quality', () => runAnalysis().catch(showError));
  const reconstructButton = button('reconstruction.createUnifiedDesign', 'Create Unified Design', () => runFullReconstruction().catch(showError));
  actions.append(addButton, workspaceButton, clearButton, autoAssignButton, analyzeButton, reconstructButton);

  const modeField = document.createElement('label');
  modeField.className = 'multi-photo__mode';
  const modeLabel = document.createElement('span');
  modeLabel.textContent = t('reconstruction.mode', 'Reconstruction Mode');
  const modeSelect = document.createElement('select');
  [
    ['auto', t('reconstruction.modes.auto', 'Auto')],
    ['native_reconstruction', t('reconstruction.modes.nativeReconstruction', 'Native Multi-Photo Reconstruction')],
    ['generic_profile_fit', t('reconstruction.modes.genericProfileFit', 'Generic Profile Fit')],
  ].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  });
  modeSelect.value = state.reconstructionMode;
  modeSelect.addEventListener('change', () => {
    state.reconstructionMode = modeSelect.value;
    syncStore();
  });
  modeField.append(modeLabel, modeSelect);

  const counter = document.createElement('div');
  counter.className = 'multi-photo__counter';

  const error = document.createElement('div');
  error.className = 'uploader-error';

  const grid = document.createElement('div');
  grid.className = 'multi-photo__grid';

  const progress = document.createElement('div');
  progress.className = 'multi-photo__progress';
  progress.innerHTML = '<div class="multi-photo__progress-label">No reconstruction job running.</div><div class="multi-photo__progress-bar"><div></div></div>';

  const providerStatus = document.createElement('div');
  providerStatus.className = 'multi-photo__provider-status';

  const report = document.createElement('div');
  report.className = 'multi-photo__report';

  const nativeEditor = document.createElement('div');
  nativeEditor.className = 'native-editor';

  input.addEventListener('change', () => addFiles(input.files));
  root.addEventListener('dragover', (event) => {
    event.preventDefault();
    root.classList.add('dragover');
  });
  root.addEventListener('dragleave', () => root.classList.remove('dragover'));
  root.addEventListener('drop', (event) => {
    event.preventDefault();
    root.classList.remove('dragover');
    addFiles(event.dataTransfer.files);
  });

  root.append(input, actions, modeField, counter, error, providerStatus, grid, progress, report, nativeEditor);
  container.appendChild(root);
  render();

  api.getCapabilities?.()
    .then((capabilities) => {
      state.capabilities = capabilities;
      render();
    })
    .catch(() => {
      state.capabilities = null;
      render();
    });

  function button(key, fallback, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.i18nKey = key;
    btn.dataset.i18nFallback = fallback;
    btn.textContent = t(key, fallback);
    btn.addEventListener('click', onClick);
    return btn;
  }

  function showError(err) {
    const message = err instanceof Error ? err.message : String(err);
    error.textContent = message;
    setStatus(message);
  }

  function clearError() {
    error.textContent = '';
  }

  async function addFiles(files) {
    clearError();
    const validation = validatePhotoSelection(state.photos, files);
    input.value = '';
    if (!validation.ok) {
      showError(validation.error);
      return;
    }
    for (const file of validation.files) {
      const url = URL.createObjectURL(file);
      const photo = {
        id: photoId(),
        file,
        url,
        originalName: file.name,
        size: file.size,
        width: null,
        height: null,
        viewType: viewForIndex(state.photos.length),
        included: true,
        order: state.photos.length,
        rotation: 0,
        uploadedId: null,
        quality: { status: 'not_analyzed' },
        segmentation: { status: 'not_processed' },
      };
      state.photos.push(photo);
      readImageMeta(file, url).then((meta) => {
        photo.width = meta.width;
        photo.height = meta.height;
        render();
      });
    }
    state.uploaded = false;
    syncStore();
    render();
  }

  function removeAll() {
    state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    state.photos = [];
    state.projectId = null;
    state.uploaded = false;
    state.report = null;
    state.editableModel = null;
    state.versionComparison = null;
    syncStore();
    render();
  }

  function removePhoto(photoIdValue) {
    const index = state.photos.findIndex((photo) => photo.id === photoIdValue);
    if (index < 0) return;
    URL.revokeObjectURL(state.photos[index].url);
    state.photos.splice(index, 1);
    state.photos.forEach((photo, order) => {
      photo.order = order;
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function movePhoto(photoIdValue, delta) {
    const index = state.photos.findIndex((photo) => photo.id === photoIdValue);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.photos.length) return;
    const [photo] = state.photos.splice(index, 1);
    state.photos.splice(target, 0, photo);
    state.photos.forEach((item, order) => {
      item.order = order;
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function autoAssignViews() {
    state.photos.forEach((photo, index) => {
      photo.viewType = viewForIndex(index);
    });
    state.uploaded = false;
    syncStore();
    render();
  }

  function rotatePhoto(photo, delta) {
    photo.rotation = (photo.rotation + delta + 360) % 360;
    render();
  }

  function syncStore(extra = {}) {
    const current = store.getState();
    const included = state.photos.filter((photo) => photo.included);
    store.setState({
      ...extra,
      photo: included[0]?.file || null,
      photoSet: {
        projectId: state.projectId,
        photos: state.photos.map((photo) => ({
          id: photo.uploadedId || photo.id,
          originalName: photo.originalName,
          viewType: photo.viewType,
          order: photo.order,
          included: photo.included,
          quality: photo.quality,
          segmentation: photo.segmentation,
          camera: photo.camera,
        })),
        report: state.report,
        editableModel: state.editableModel,
        versionComparison: state.versionComparison,
        reconstructionMode: state.reconstructionMode,
      },
      pipeline: { ...(current.pipeline || {}), ...(extra.pipeline || {}) },
    });
  }

  async function ensureUploaded() {
    if (state.photos.length === 0) throw new Error(t('photos.errors.uploadAtLeastOne', 'Upload at least one photo.'));
    if (!state.photos.some((photo) => photo.included)) throw new Error(t('photos.errors.includeAtLeastOne', 'Include at least one photo.'));
    if (!state.projectId) {
      const measurement = store.getState().measurement || {};
      const project = await api.createProject({ packageType: measurement.packagingType || 'bottle' });
      state.projectId = project.id;
    }
    if (!state.uploaded) {
      setStatus(t('photos.status.uploading', 'Uploading photo set...'));
      const result = await api.uploadProjectPhotos({
        projectId: state.projectId,
        photos: state.photos,
        viewTypes: state.photos.map((photo) => photo.viewType),
      });
      result.project.photos.forEach((serverPhoto, index) => {
        if (state.photos[index]) {
          state.photos[index].uploadedId = serverPhoto.id;
          state.photos[index].quality = serverPhoto.quality;
          state.photos[index].segmentation = serverPhoto.segmentation;
        }
      });
      state.uploaded = true;
    }
    await api.updateProjectPhotos({
      projectId: state.projectId,
      photos: state.photos.map((photo, order) => ({
        photoId: photo.uploadedId,
        viewType: photo.viewType,
        included: photo.included,
        order,
      })),
    });
    syncStore();
  }

  async function waitForJob(job, label) {
    state.activeJobId = job.id;
    let latest = job;
    while (!['succeeded', 'failed', 'cancelled'].includes(latest.state)) {
      renderProgress(latest, label);
      await new Promise((resolve) => setTimeout(resolve, 300));
      latest = await api.getJob(job.id);
    }
    renderProgress(latest, label);
    if (latest.state !== 'succeeded') throw new Error(`${label} ${latest.state}: ${latest.error || latest.message}`);
    return latest;
  }

  async function runAnalysis() {
    clearError();
    await ensureUploaded();
    const job = await api.startPhotoAnalysis({ projectId: state.projectId });
    const done = await waitForJob(job, t('photos.qualityAnalysis', 'Photo quality analysis'));
    mergeServerPhotos(done.result?.photos || []);
    setStatus(t('photos.status.qualityComplete', 'Photo quality analysis complete.'));
    render();
  }

  async function runSegmentation() {
    await ensureUploaded();
    const job = await api.startPhotoSegmentation({ projectId: state.projectId });
    const done = await waitForJob(job, t('photos.segmentation', 'Photo segmentation'));
    mergeServerPhotos(done.result?.photos || []);
    render();
  }

  async function runFullReconstruction() {
    clearError();
    await runAnalysis();
    await runSegmentation();
    const measurement = store.getState().measurement || {};
    const job = await api.startReconstruction({
      projectId: state.projectId,
      packageType: measurement.packagingType || 'bottle',
      reconstructionMode: state.reconstructionMode,
      measurements: {
        heightMm: measurement.heightMm,
        widthMm: measurement.widthMm,
        depthMm: measurement.depthMm,
        diameterMm: measurement.diameterMm,
        volumeMl: measurement.volumeMl,
      },
    });
    const done = await waitForJob(job, t('reconstruction.unified', 'Unified reconstruction'));
    state.report = done.result?.report || null;
    state.editableModel = await api.getEditableModel?.(state.projectId);
    const referenceMesh = await api.getProjectAsset({ projectId: state.projectId, assetName: 'referenceMesh' });
    const cleanMesh = await api.getProjectAsset({ projectId: state.projectId, assetName: 'cleanMesh' });
    const glb = await api.getProjectAsset({ projectId: state.projectId, assetName: 'finalMesh' });
    const drawing = await api.getProjectAsset({ projectId: state.projectId, assetName: 'drawingPackage' });
    if (viewer) await viewer.loadGlbArrayBuffer(glb.arrayBuffer);
    syncStore({
      pipeline: {
        generated: referenceMesh.arrayBuffer,
        cleaned: cleanMesh.arrayBuffer,
        glb: glb.arrayBuffer,
        drawingZip: drawing.arrayBuffer,
        reconstructionReport: state.report,
        editableModel: state.editableModel,
      },
    });
    setStatus(`${t('reconstruction.nativeSuccess', 'Unified design generated with PackLab native reconstruction.')}\n${reconstructionSummary(state.report)}`);
    render();
  }

  function mergeServerPhotos(serverPhotos) {
    serverPhotos.forEach((serverPhoto) => {
      const local = state.photos.find((photo) => photo.uploadedId === serverPhoto.id);
      if (!local) return;
      local.quality = serverPhoto.quality || local.quality;
      local.segmentation = serverPhoto.segmentation || local.segmentation;
      local.camera = serverPhoto.camera || local.camera;
    });
    syncStore();
  }

  function renderProgress(job, label) {
    const pct = Math.max(0, Math.min(100, Number(job.overallProgress) || 0));
    progress.querySelector('.multi-photo__progress-label').textContent = `${label}: ${job.message} (${pct}%)`;
    progress.querySelector('.multi-photo__progress-bar div').style.width = `${pct}%`;
  }

  function reconstructionSummary(item) {
    if (!item) return t('reconstruction.complete', 'Unified reconstruction complete.');
    const fallbackUsed = item.trueMultiViewReconstruction === false || /fallback|parametric/i.test(item.method || '');
    return [
      t('reconstruction.complete', 'Unified reconstruction complete.'),
      `${t('reconstruction.providerUsed', 'Provider used')}: ${providerLabel(item.method)}`,
      `${t('reconstruction.engineAvailable', 'Native engine available')}: ${nativeEngineAvailable() ? t('common.yes', 'Yes') : t('common.no', 'No')}`,
      `${t('reconstruction.fallbackUsed', 'Fallback used')}: ${fallbackUsed ? t('common.yes', 'Yes') : t('common.no', 'No')}`,
      `${t('reconstruction.method', 'Method')}: ${item.method}`,
      `${t('reconstruction.photosUsed', 'Photos used')}: ${(item.photosUsed || []).length}`,
      `${t('reconstruction.photosExcluded', 'Photos excluded')}: ${(item.photosExcluded || []).length}`,
      `${t('reconstruction.confidence', 'Confidence')}: ${item.confidence}`,
      `${t('phase7.optimizer.bestError', 'Best error')}: ${item.optimizationReport?.finalError ?? '?'}`,
      `${t('phase7.optimizer.perViewIou', 'Per-view IoU')}: ${(item.optimizationReport?.perView || []).map((view) => `${view.view} ${view.iou}`).join(', ')}`,
      `SVG: ${item.drawingValidation?.svg?.valid ? t('common.valid', 'Valid') : t('common.invalid', 'Invalid')} | DXF: ${item.drawingValidation?.dxf?.valid ? t('common.valid', 'Valid') : t('common.invalid', 'Invalid')}`,
      ...(item.limitations || []),
    ].join('\n');
  }

  function render() {
    counter.textContent = `${t('photos.counterLabel', 'Photos')}: ${state.photos.length} / ${MAX_PHOTOS}`;
    renderProviderStatus();
    grid.innerHTML = '';
    state.photos.forEach((photo, index) => grid.appendChild(renderCard(photo, index)));
    if (state.report) {
      report.textContent = reconstructionSummary(state.report);
    } else {
      report.textContent = '';
    }
    renderNativeEditor();
  }

  function renderNativeEditor() {
    nativeEditor.innerHTML = '';
    if (!state.report || !state.projectId) return;
    const title = document.createElement('div');
    title.className = 'native-editor__title';
    title.textContent = t('reconstruction.editor.title', 'Editable 3D and Linked 2D');
    nativeEditor.appendChild(title);
    nativeEditor.appendChild(renderOptimizerMonitor());
    const dims = state.report.dimensionsMm || {};
    const heightInput = editorNumber('reconstruction.editor.height', 'Height (mm)', dims.heightMm || 120);
    const widthInput = editorNumber('reconstruction.editor.width', 'Width (mm)', dims.widthMm || 50);
    const depthInput = editorNumber('reconstruction.editor.depth', 'Depth (mm)', dims.depthMm || 35);
    const sectionInput = editorNumber('phase7.section.width', 'Section width (mm)', dims.widthMm || 50);
    const cageInput = editorNumber('phase7.cage.delta', 'Cage delta (mm)', 2);
    const applyButton = button('reconstruction.editor.apply', 'Apply 3D Edit', async () => {
      try {
        const result = await api.updateEditableModel({
          projectId: state.projectId,
          edits: {
            heightMm: Number(heightInput.input.value),
            widthMm: Number(widthInput.input.value),
            depthMm: Number(depthInput.input.value),
          },
        });
        const glb = await api.getProjectAsset({ projectId: state.projectId, assetName: 'finalMesh' });
        if (viewer) await viewer.loadGlbArrayBuffer(glb.arrayBuffer);
        state.report = {
          ...state.report,
          dimensionsMm: {
            heightMm: Number(heightInput.input.value),
            widthMm: Number(widthInput.input.value),
            depthMm: Number(depthInput.input.value),
          },
          reconstructionModel: result.reconstructionModel,
        };
        state.editableModel = result;
        syncStore({ pipeline: { ...(store.getState().pipeline || {}), glb: glb.arrayBuffer } });
        setStatus(t('reconstruction.editor.updated', '3D model updated and linked 2D drawing refreshed.'));
        render();
      } catch (err) {
        showError(err);
      }
    });
    const noteInput = document.createElement('input');
    noteInput.type = 'text';
    noteInput.placeholder = t('reconstruction.editor.notePlaceholder', 'Drawing note');
    const versionNameInput = document.createElement('input');
    versionNameInput.type = 'text';
    versionNameInput.placeholder = t('phase7.version.namePlaceholder', 'Version name');
    const noteButton = button('reconstruction.editor.addNote', 'Add Note', async () => {
      try {
        await api.updateDrawingDocument({
          projectId: state.projectId,
          patch: { notes: [{ text: noteInput.value || t('reconstruction.editor.defaultNote', 'Manual note'), x: 10, y: 10 }] },
        });
        setStatus(t('reconstruction.editor.noteAdded', 'Drawing note added and will persist through model edits.'));
        state.editableModel = await api.getEditableModel?.(state.projectId);
        render();
      } catch (err) {
        showError(err);
      }
    });
    const sectionButton = button('phase7.section.apply', 'Apply Section Edit', async () => applyAdvancedEdit({
      sections: [{ id: firstSectionId(), widthMm: Number(sectionInput.input.value) }],
    }, t('phase7.section.updated', 'Section edit applied and linked drawing updated.')));
    const cageButton = button('phase7.cage.apply', 'Move Cage Node', async () => applyAdvancedEdit({
      cageNodes: [{ id: firstCageNodeId(), deltaMm: [Number(cageInput.input.value), 0, Number(cageInput.input.value)] }],
    }, t('phase7.cage.updated', 'Control cage edit deformed the mesh and refreshed drawings.')));
    const dimensionButton = button('phase7.dimension.move', 'Move Dimension', async () => {
      try {
        await api.updateDrawingDocument({
          projectId: state.projectId,
          patch: { dimensions: [{ id: 'dim-overall-height-front', placement: { offset: 42, textOffset: [3, 2] }, suffix: ' REF' }] },
        });
        state.editableModel = await api.getEditableModel?.(state.projectId);
        setStatus(t('phase7.dimension.updated', 'Dimension placement updated and will persist after 3D changes.'));
        render();
      } catch (err) {
        showError(err);
      }
    });
    const sectionLineButton = button('phase7.sectionLine.add', 'Add Section Line', async () => {
      try {
        await api.updateDrawingDocument({
          projectId: state.projectId,
          patch: { sectionLines: [{ points: [[0, 0], [20, 40]], label: 'A-A' }], referenceLines: [{ type: 'baseline', x1: 0, y1: 0, x2: 40, y2: 0 }] },
        });
        state.editableModel = await api.getEditableModel?.(state.projectId);
        setStatus(t('phase7.sectionLine.updated', 'Section line and linked section view added.'));
        render();
      } catch (err) {
        showError(err);
      }
    });
    const landmarkButton = button('phase7.landmarks.lock', 'Lock Landmark', async () => {
      try {
        const photo = state.photos.find((item) => item.uploadedId);
        if (!photo) return;
        await api.updateLandmarks({
          projectId: state.projectId,
          photoId: photo.uploadedId,
          landmarks: [{ type: 'shoulder-transition', view: photo.viewType, x: 0.5, y: 0.7, confidence: 1, locked: true }],
        });
        setStatus(t('phase7.landmarks.updated', 'Landmark correction saved and locked.'));
      } catch (err) {
        showError(err);
      }
    });
    const versionButton = button('phase7.version.save', 'Save Version', async () => {
      try {
        const result = await api.saveProjectVersion({ projectId: state.projectId, name: versionNameInput.value || t('phase7.version.defaultName', 'Working Version') });
        state.editableModel = { ...(state.editableModel || {}), versions: result.versions };
        setStatus(t('phase7.version.saved', 'Project version saved.'));
        render();
      } catch (err) {
        showError(err);
      }
    });
    const compareButton = button('phase7.version.compare', 'Compare Versions', async () => {
      try {
        const versions = state.editableModel?.versions || [];
        if (versions.length < 2) return;
        state.versionComparison = await api.compareProjectVersions({
          projectId: state.projectId,
          leftVersionId: versions[versions.length - 2].id,
          rightVersionId: versions[versions.length - 1].id,
        });
        setStatus(`${t('phase7.version.compared', 'Versions compared.')}\n${(state.versionComparison.changes || []).join('\n')}`);
        render();
      } catch (err) {
        showError(err);
      }
    });
    const fields = document.createElement('div');
    fields.className = 'native-editor__fields';
    fields.append(
      heightInput.label,
      widthInput.label,
      depthInput.label,
      applyButton,
      sectionInput.label,
      sectionButton,
      cageInput.label,
      cageButton,
      dimensionButton,
      noteInput,
      noteButton,
      sectionLineButton,
      landmarkButton,
      versionNameInput,
      versionButton,
      compareButton
    );
    nativeEditor.appendChild(fields);
    nativeEditor.appendChild(renderDrawingStatus());
  }

  async function applyAdvancedEdit(edits, successMessage) {
    try {
      const result = await api.updateEditableModel({ projectId: state.projectId, edits });
      const glb = await api.getProjectAsset({ projectId: state.projectId, assetName: 'finalMesh' });
      if (viewer) await viewer.loadGlbArrayBuffer(glb.arrayBuffer);
      state.editableModel = result;
      state.report = { ...state.report, reconstructionModel: result.reconstructionModel };
      syncStore({ pipeline: { ...(store.getState().pipeline || {}), glb: glb.arrayBuffer, editableModel: result } });
      setStatus(successMessage);
      render();
    } catch (err) {
      showError(err);
    }
  }

  function renderOptimizerMonitor() {
    const monitor = document.createElement('div');
    monitor.className = 'optimizer-monitor';
    const opt = state.report?.optimizationReport || {};
    const perView = (opt.perView || []).map((view) => `${view.view}: ${view.iou}`).join(' | ');
    const terms = Object.entries(opt.objectiveTerms || {}).slice(0, 6).map(([key, value]) => `${key} ${value.weightedContribution}`).join(' | ');
    monitor.textContent = [
      `${t('phase7.optimizer.monitor', 'Optimizer Monitor')}: ${opt.optimizer || '?'}`,
      `${t('phase7.optimizer.iteration', 'Iteration')}: ${opt.iterationCount || 0}/${opt.settings?.maxIterations || 0}`,
      `${t('phase7.optimizer.bestError', 'Best error')}: ${opt.finalError ?? '?'}`,
      `${t('phase7.optimizer.perViewIou', 'Per-view IoU')}: ${perView || '?'}`,
      `${t('phase7.optimizer.objectiveTerms', 'Objective terms')}: ${terms || '?'}`,
    ].join('\n');
    return monitor;
  }

  function renderDrawingStatus() {
    const status = document.createElement('div');
    status.className = 'drawing-status';
    const drawing = state.editableModel?.drawingDocument || {};
    const versions = state.editableModel?.versions || [];
    status.textContent = [
      `${t('phase7.drawing.dimensions', 'Dimensions')}: ${(drawing.dimensions || []).length}`,
      `${t('phase7.drawing.notes', 'Notes')}: ${(drawing.notes || []).length}`,
      `${t('phase7.drawing.sectionViews', 'Section views')}: ${(drawing.sectionViews || []).length}`,
      `${t('phase7.version.versions', 'Versions')}: ${versions.length}`,
      state.versionComparison ? `${t('phase7.version.changeSummary', 'Change summary')}: ${(state.versionComparison.changes || []).join('; ')}` : '',
    ].filter(Boolean).join('\n');
    return status;
  }

  function firstSectionId() {
    return state.editableModel?.reconstructionModel?.crossSections?.[Math.floor((state.editableModel?.reconstructionModel?.crossSections?.length || 1) / 2)]?.id || 'section-12';
  }

  function firstCageNodeId() {
    return state.editableModel?.controlCage?.nodes?.[0]?.id || state.editableModel?.reconstructionModel?.controlCage?.nodes?.[0]?.id || 'cage-00-front';
  }

  function editorNumber(key, fallback, value) {
    const label = document.createElement('label');
    label.className = 'native-editor__field';
    const span = document.createElement('span');
    span.textContent = t(key, fallback);
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '1';
    input.step = '0.1';
    input.value = String(value);
    label.append(span, input);
    return { label, input };
  }

  function renderProviderStatus() {
    const nativeEngine = state.capabilities?.native_reconstruction;
    providerStatus.textContent = [
      t('reconstruction.nativeEngine', 'PackLab Reconstruction Engine'),
      `${t('reconstruction.nativeMultiPhoto', 'Native multi-photo reconstruction')}: ${nativeEngine?.available ? t('common.available', 'Available') : t('common.unavailable', 'Unavailable')}`,
      `CUDA: ${t('common.notRequired', 'Not required')}`,
      `${t('reconstruction.standardUnifiedDesign', 'Standard unified design')}: ${t('common.available', 'Available')}`,
      `${t('reconstruction.genericEditableModel', 'Generic editable model')}: ${t('common.available', 'Available')}`,
    ].join(' | ');
  }

  function nativeEngineAvailable() {
    return Boolean(state.capabilities?.native_reconstruction?.available);
  }

  function providerLabel(method) {
    if (/native|profile/i.test(method || '')) return t('reconstruction.modes.nativeReconstruction', 'Native Multi-Photo Reconstruction');
    return method || t('reconstruction.modes.auto', 'Auto');
  }

  function renderCard(photo, index) {
    const card = document.createElement('div');
    card.className = `photo-card photo-card--${qualityClass(photo.quality?.status)}`;
    card.draggable = true;
    card.addEventListener('dragstart', (event) => event.dataTransfer.setData('text/plain', photo.id));
    card.addEventListener('dragover', (event) => event.preventDefault());
    card.addEventListener('drop', (event) => {
      event.preventDefault();
      const draggedId = event.dataTransfer.getData('text/plain');
      const fromIndex = state.photos.findIndex((item) => item.id === draggedId);
      if (fromIndex < 0 || fromIndex === index) return;
      const [dragged] = state.photos.splice(fromIndex, 1);
      state.photos.splice(index, 0, dragged);
      state.photos.forEach((item, order) => {
        item.order = order;
      });
      state.uploaded = false;
      syncStore();
      render();
    });

    const image = document.createElement('img');
    image.src = photo.url;
    image.alt = photo.originalName;
    image.style.transform = `rotate(${photo.rotation}deg)`;

    const meta = document.createElement('div');
    meta.className = 'photo-card__meta';
    meta.innerHTML = `<strong>${photo.originalName}</strong><span>${photo.width || '?'}x${photo.height || '?'} px | ${formatFileSize(photo.size)}</span>`;

    const view = document.createElement('select');
    VIEW_TYPES.forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = photo.viewType === value;
      view.appendChild(option);
    });
    view.addEventListener('change', () => {
      photo.viewType = view.value;
      state.uploaded = false;
      syncStore();
    });

    const include = document.createElement('label');
    include.className = 'photo-card__include';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = photo.included;
    checkbox.addEventListener('change', () => {
      photo.included = checkbox.checked;
      state.uploaded = false;
      syncStore();
      render();
    });
    include.append(checkbox, document.createTextNode(t('photos.include', 'Include')));

    const status = document.createElement('div');
    status.className = 'photo-card__status';
    const metrics = photo.quality?.metrics || {};
    const duplicate = photo.quality?.duplicate;
    status.textContent = [
      `${t('photos.quality', 'Quality')}: ${photo.quality?.status || 'not_analyzed'} ${photo.quality?.overallScore ?? photo.quality?.qualityScore ?? ''}`,
      `${t('phase7.quality.sharpness', 'Sharpness')}: ${metrics.sharpness ?? metrics.blurScore ?? '?'}`,
      `${t('phase7.quality.coverage', 'Coverage')}: ${metrics.objectCoverage ?? '?'}`,
      `${t('phase7.view.assigned', 'Assigned view')}: ${photo.camera?.assignedView || photo.viewType}`,
      `${t('photos.mask', 'Mask')}: ${photo.segmentation?.status || 'not_processed'}`,
      duplicate ? `${t('phase7.duplicate.warning', 'Duplicate warning')}: ${duplicate.type} ${duplicate.similarity}` : '',
      ...(photo.quality?.warnings || []).slice(0, 2),
    ].filter(Boolean).join(' | ');

    const controls = document.createElement('div');
    controls.className = 'photo-card__controls';
    controls.append(
      button('common.up', 'Up', () => movePhoto(photo.id, -1)),
      button('common.down', 'Down', () => movePhoto(photo.id, 1)),
      button('photos.rotateLeft', 'Rotate L', () => rotatePhoto(photo, -90)),
      button('photos.rotateRight', 'Rotate R', () => rotatePhoto(photo, 90)),
      button('common.remove', 'Remove', () => removePhoto(photo.id))
    );

    card.append(image, meta, view, include, status, controls);
    return card;
  }

  function qualityClass(status) {
    if (status === 'excellent' || status === 'good') return 'good';
    if (status === 'poor') return 'poor';
    if (status === 'usable_with_warnings') return 'warning';
    return 'pending';
  }

  return {
    addFiles,
    getState: () => state,
    destroy() {
      state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    },
  };
}
