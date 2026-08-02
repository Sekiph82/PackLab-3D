import { formatFileSize } from './FileUploader.js';
import { mountMaskEditor } from './mask-editor/MaskEditor.js';
import { mountLandmarkEditor } from './landmark-editor/LandmarkEditor.js';
import { mountContourEditor } from './contour-editor/ContourEditor.js';
import { mountOptimizerMonitor } from './reconstruction/OptimizerMonitor.js';
import { mountProfileEditor } from './editors/profile/ProfileEditor.js';
import { mountSectionEditor } from './editors/section/SectionEditor.js';
import { mountControlCageEditor } from './editors/cage/ControlCageEditor.js';
import { mountDrawingWorkspace } from './drawing/DrawingWorkspace.js';
import { mountVersionManager } from './versioning/VersionManager.js';
import { mountAutosaveStatus } from './recovery/AutosaveStatus.js';
import { applyEvidenceBasedViewAssignments, mountViewAssignmentEditor, suggestedViewFromPhoto } from './photo-analysis/ViewAssignmentEditor.js';

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
    selectedPhotoId: null,
    dirty: false,
    lastAutosave: null,
    recovery: null,
    geometryWorkspace: null,
    geometryConflict: null,
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

  const geometryWorkspace = document.createElement('div');
  geometryWorkspace.className = 'photo-geometry-workspace';

  const viewAssignmentPanel = document.createElement('div');
  viewAssignmentPanel.className = 'multi-photo__view-assignment';

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

  root.append(input, actions, modeField, counter, error, providerStatus, viewAssignmentPanel, grid, geometryWorkspace, progress, report, nativeEditor);
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
    if (err?.status === 409) {
      state.geometryConflict = err.detail || { message };
      render();
      return;
    }
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
        viewType: suggestedViewFromPhoto({ width: null, height: null, quality: { recommendedRoles: [] } }, state.photos),
        included: true,
        order: state.photos.length,
        rotation: 0,
        uploadedId: null,
        quality: { status: 'not_analyzed' },
        segmentation: { status: 'not_processed' },
      };
      state.photos.push(photo);
      if (!state.selectedPhotoId) state.selectedPhotoId = photo.id;
      readImageMeta(file, url).then((meta) => {
        photo.width = meta.width;
        photo.height = meta.height;
        if (!photo.manualViewOverride) photo.viewType = suggestedViewFromPhoto(photo, state.photos.filter((item) => item.id !== photo.id));
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
    applyEvidenceBasedViewAssignments(state.photos);
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
          geometry: photo.geometry,
          contour: photo.contour,
          landmarks: photo.landmarks,
          camera: photo.camera,
          manualViewOverride: photo.manualViewOverride,
        })),
        report: state.report,
        editableModel: state.editableModel,
        versionComparison: state.versionComparison,
        reconstructionMode: state.reconstructionMode,
      },
      pipeline: { ...(current.pipeline || {}), ...(extra.pipeline || {}) },
    });
  }

  function markDirty(reason) {
    state.dirty = true;
    state.lastDirtyReason = reason;
    scheduleAutosave();
  }

  let autosaveTimer = null;
  function scheduleAutosave() {
    if (!state.projectId || !api.saveRecoverySnapshot) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      try {
        await saveRecoverySnapshot();
      } catch (err) {
        // Recovery failures are shown in the autosave panel instead of interrupting editing.
        state.recovery = { available: false, error: err.message };
        render();
      }
    }, 800);
  }

  async function saveRecoverySnapshot() {
    if (!state.projectId || !api.saveRecoverySnapshot) return null;
    const snapshot = await api.saveRecoverySnapshot({
      projectId: state.projectId,
      state: {
        photoSet: store.getState().photoSet,
        pipeline: store.getState().pipeline,
        dirtyReason: state.lastDirtyReason,
      },
    });
    state.dirty = false;
    state.lastAutosave = snapshot.recovery?.timestamp || new Date().toISOString();
    state.recovery = { available: true, ...(snapshot.recovery || {}) };
    return snapshot;
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
    await refreshGeometryForUploadedPhotos();
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

  async function refreshGeometryForUploadedPhotos() {
    if (!state.projectId || !api.getPhotoGeometry) return;
    await Promise.all(state.photos.filter((photo) => photo.uploadedId).map(async (photo) => {
      try {
        const result = await api.getPhotoGeometry({ projectId: state.projectId, photoId: photo.uploadedId });
        applyGeometryResult(photo, result);
      } catch (_err) {
        // Geometry is optional until segmentation or manual editing exists.
      }
    }));
  }

  function applyGeometryResult(photo, result) {
    photo.geometry = result?.geometry || photo.geometry;
    photo.contour = result?.contour || photo.contour;
    photo.manualMask = result?.mask || photo.manualMask;
    photo.landmarks = result?.landmarks || photo.landmarks || result?.landmarks;
    if (result?.photo?.segmentation) photo.segmentation = result.photo.segmentation;
  }

  async function saveMaskForPhoto(photo, payload) {
    if (!photo.uploadedId) await ensureUploaded();
    const result = await api.updatePhotoMask?.({
      projectId: state.projectId,
      photoId: photo.uploadedId,
      ...payload,
    });
    applyGeometryResult(photo, result);
    markDirty('mask-save');
    setStatus(t('phase7.mask.saved', 'Manual mask saved and contour recalculated.'));
    return result;
  }

  async function saveContourForPhoto(photo, payload) {
    if (!photo.uploadedId) await ensureUploaded();
    const result = await api.updatePhotoContour?.({
      projectId: state.projectId,
      photoId: photo.uploadedId,
      ...payload,
    });
    applyGeometryResult(photo, result);
    markDirty('contour-save');
    setStatus(t('phase7.geometry.contourSaved', 'Manual contour saved and reconstruction marked stale.'));
    return result;
  }

  async function saveLandmarksForPhoto(photo, landmarks, meta = {}) {
    if (!photo.uploadedId) await ensureUploaded();
    const result = await api.updateLandmarks({
      projectId: state.projectId,
      photoId: photo.uploadedId,
      landmarks,
      expectedRevision: meta.expectedRevision ?? photo.geometry?.revisions?.landmarks ?? 0,
    });
    applyGeometryResult(photo, result);
    markDirty('landmark-save');
    setStatus(t('phase7.landmarks.updated', 'Landmark correction saved and locked.'));
    return result;
  }

  function mergeServerPhotos(serverPhotos) {
    serverPhotos.forEach((serverPhoto) => {
      const local = state.photos.find((photo) => photo.uploadedId === serverPhoto.id);
      if (!local) return;
      local.quality = serverPhoto.quality || local.quality;
      local.segmentation = serverPhoto.segmentation || local.segmentation;
      local.camera = serverPhoto.camera || local.camera;
      local.geometry = serverPhoto.geometry || local.geometry;
      if (!local.manualViewOverride && local.camera?.assignedView) {
        local.viewType = local.camera.assignedView;
      }
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
    renderViewAssignmentEditor();
    grid.innerHTML = '';
    state.photos.forEach((photo, index) => grid.appendChild(renderCard(photo, index)));
    renderGeometryWorkspace();
    if (state.report) {
      report.textContent = reconstructionSummary(state.report);
    } else {
      report.textContent = '';
    }
    renderNativeEditor();
  }

  function renderGeometryWorkspace() {
    geometryWorkspace.innerHTML = '';
    if (!state.geometryWorkspace) return;
    const photo = state.photos.find((item) => item.id === state.geometryWorkspace.photoId);
    if (!photo) return;
    const header = document.createElement('div');
    header.className = 'photo-geometry-workspace__header';
    const rev = photo.geometry?.revisions || {};
    const stale = photo.geometry?.stale || {};
    header.textContent = [
      `${t('phase7.geometry.workspace', 'Photo Geometry')}: ${photo.originalName}`,
      `${t('phase7.geometry.maskRevision', 'Mask rev')}: ${rev.activeMask ?? 0}`,
      `${t('phase7.geometry.contourRevision', 'Contour rev')}: ${rev.activeContour ?? 0}`,
      `${t('phase7.geometry.landmarkRevision', 'Landmark rev')}: ${rev.landmarks ?? 0}`,
      stale.reconstruction ? t('phase7.geometry.reconstructionStale', 'Reconstruction stale') : t('phase7.geometry.reconstructionCurrent', 'Reconstruction current'),
    ].join(' | ');
    const tabs = document.createElement('div');
    tabs.className = 'photo-geometry-workspace__tabs';
    ['mask', 'contour', 'landmarks'].forEach((tab) => {
      const btn = button(`phase7.geometry.${tab}`, tab[0].toUpperCase() + tab.slice(1), () => {
        state.geometryWorkspace.tab = tab;
        render();
      });
      if ((state.geometryWorkspace.tab || 'mask') === tab) btn.classList.add('is-active');
      tabs.appendChild(btn);
    });
    const conflict = renderGeometryConflict();
    const body = document.createElement('div');
    body.className = 'photo-geometry-workspace__body';
    const tab = state.geometryWorkspace.tab || 'mask';
    if (tab === 'mask') {
      mountMaskEditor(body, {
        i18n,
        photo,
        onDirty: (event) => markDirty(event.type),
        onSaveMask: async (payload) => saveMaskForPhoto(photo, payload),
      });
    } else if (tab === 'contour') {
      mountContourEditor(body, {
        i18n,
        photo,
        contour: photo.contour,
        landmarks: photo.landmarks || [],
        onDirty: (event) => markDirty(event.type),
        onSaveContour: async (payload) => saveContourForPhoto(photo, payload),
        onConflict: (err) => {
          state.geometryConflict = err.detail || err;
          render();
        },
      });
    } else {
      mountLandmarkEditor(body, {
        i18n,
        photo,
        landmarks: photo.landmarks || [],
        onDirty: (event) => markDirty(event.type),
        onSave: async (landmarks, meta = {}) => saveLandmarksForPhoto(photo, landmarks, meta),
      });
    }
    const close = button('common.close', 'Close', () => {
      state.geometryWorkspace = null;
      render();
    });
    geometryWorkspace.append(header, tabs, conflict, body, close);
  }

  function renderGeometryConflict() {
    const wrap = document.createElement('div');
    if (!state.geometryConflict) return wrap;
    wrap.className = 'photo-geometry-workspace__conflict';
    wrap.textContent = state.geometryConflict.message || t('phase7.geometry.revisionConflict', 'The geometry was updated elsewhere. Reload before saving.');
    wrap.append(
      button('phase7.geometry.reloadServer', 'Reload Server Version', async () => {
        state.geometryConflict = null;
        await refreshActiveGeometry();
      }),
      button('phase7.geometry.keepLocal', 'Keep Local Copy', () => {
        state.geometryConflict = null;
        render();
      })
    );
    return wrap;
  }

  async function refreshActiveGeometry() {
    const photo = state.photos.find((item) => item.id === state.geometryWorkspace?.photoId);
    if (!photo?.uploadedId || !state.projectId) return;
    const result = await api.getPhotoGeometry({ projectId: state.projectId, photoId: photo.uploadedId });
    applyGeometryResult(photo, result);
    render();
  }

  function renderViewAssignmentEditor() {
    viewAssignmentPanel.innerHTML = '';
    if (!state.photos.length) return;
    mountViewAssignmentEditor(viewAssignmentPanel, {
      i18n,
      photos: state.photos,
      onChange: () => {
        state.uploaded = false;
        markDirty('view-assignment');
        syncStore();
        render();
      },
    });
  }

  function renderNativeEditor() {
    nativeEditor.innerHTML = '';
    if (!state.report || !state.projectId) return;
    const title = document.createElement('div');
    title.className = 'native-editor__title';
    title.textContent = t('reconstruction.editor.title', 'Editable 3D and Linked 2D');
    nativeEditor.appendChild(title);
    const optimizerHost = document.createElement('div');
    nativeEditor.appendChild(optimizerHost);
    mountOptimizerMonitor(optimizerHost, {
      i18n,
      report: state.report,
      activeJob: { id: state.activeJobId },
      onCancel: (jobId) => jobId && api.cancelJob?.(jobId),
      onAcceptCheckpoint: (checkpoint) => {
        if (!checkpoint) return;
        setStatus(`${t('phase7.optimizer.checkpointAccepted', 'Checkpoint accepted')}: ${checkpoint.id}`);
      },
    });
    const activePhoto = state.photos.find((photo) => photo.id === state.selectedPhotoId) || state.photos.find((photo) => photo.uploadedId) || state.photos[0];
    const model = state.editableModel?.reconstructionModel || state.report?.reconstructionModel;
    const editorGrid = document.createElement('div');
    editorGrid.className = 'native-editor__grid';
    const maskHost = document.createElement('div');
    const contourHost = document.createElement('div');
    const landmarkHost = document.createElement('div');
    const profileHost = document.createElement('div');
    const sectionHost = document.createElement('div');
    const cageHost = document.createElement('div');
    const drawingHost = document.createElement('div');
    const versionHost = document.createElement('div');
    const autosaveHost = document.createElement('div');
    editorGrid.append(maskHost, contourHost, landmarkHost, profileHost, sectionHost, cageHost, drawingHost, versionHost, autosaveHost);
    nativeEditor.appendChild(editorGrid);

    if (activePhoto) {
      mountMaskEditor(maskHost, {
        i18n,
        photo: activePhoto,
        onDirty: (event) => markDirty(event.type),
        onSaveMask: async (payload) => saveMaskForPhoto(activePhoto, payload).then((result) => { render(); return result; }),
      });
      mountContourEditor(contourHost, {
        i18n,
        photo: activePhoto,
        contour: activePhoto.contour,
        landmarks: activePhoto.landmarks || [],
        onDirty: (event) => markDirty(event.type),
        onSaveContour: async (payload) => saveContourForPhoto(activePhoto, payload).then((result) => { render(); return result; }),
        onConflict: (err) => {
          state.geometryConflict = err.detail || err;
          render();
        },
      });
      mountLandmarkEditor(landmarkHost, {
        i18n,
        photo: activePhoto,
        landmarks: activePhoto.landmarks || [],
        onDirty: (event) => markDirty(event.type),
        onSave: async (landmarks, meta = {}) => saveLandmarksForPhoto(activePhoto, landmarks, meta).then((result) => { render(); return result; }),
      });
    }
    if (model) {
      mountProfileEditor(profileHost, {
        i18n,
        model,
        onDirty: (event) => markDirty(event.type),
        onApply: (edits) => applyAdvancedEdit(edits, t('phase7.profile.applied', 'Profile edit regenerated the 3D model.')),
      });
      mountSectionEditor(sectionHost, {
        i18n,
        model,
        onDirty: (event) => markDirty(event.type),
        onApply: (edits) => applyAdvancedEdit(edits, t('phase7.section.updated', 'Section edit applied and linked drawing updated.')),
      });
      mountControlCageEditor(cageHost, {
        i18n,
        cage: state.editableModel?.controlCage || model.controlCage,
        onDirty: (event) => markDirty(event.type),
        onApply: (edits) => applyAdvancedEdit(edits, t('phase7.cage.updated', 'Control cage edit deformed the mesh and refreshed drawings.')),
      });
    }
    mountDrawingWorkspace(drawingHost, {
      i18n,
      document: state.editableModel?.drawingDocument || {},
      onDirty: (event) => markDirty(event.type),
      onPatch: async (patch) => {
        await api.updateDrawingDocument({ projectId: state.projectId, patch });
        state.editableModel = await api.getEditableModel?.(state.projectId);
        markDirty('drawing-save');
        setStatus(t('phase7.drawing.saved', 'Drawing edits saved and will persist after model changes.'));
        render();
      },
    });
    mountVersionManager(versionHost, {
      i18n,
      versions: state.editableModel?.versions || [],
      comparison: state.versionComparison,
      onDirty: (event) => markDirty(event.type),
      onSave: async ({ name, note }) => {
        const result = await api.saveProjectVersion({ projectId: state.projectId, name: name || t('phase7.version.defaultName', 'Working Version'), note });
        state.editableModel = { ...(state.editableModel || {}), versions: result.versions };
        setStatus(t('phase7.version.saved', 'Project version saved.'));
        render();
      },
      onCompare: async (leftVersionId, rightVersionId) => {
        state.versionComparison = await api.compareProjectVersions({ projectId: state.projectId, leftVersionId, rightVersionId });
        setStatus(`${t('phase7.version.compared', 'Versions compared.')}\n${(state.versionComparison.changes || []).join('\n')}`);
        render();
      },
      onRestore: async (versionId) => {
        state.editableModel = await api.restoreProjectVersion({ projectId: state.projectId, versionId });
        state.report = { ...state.report, reconstructionModel: state.editableModel.reconstructionModel };
        const glb = await api.getProjectAsset({ projectId: state.projectId, assetName: 'finalMesh' });
        if (viewer) await viewer.loadGlbArrayBuffer(glb.arrayBuffer);
        setStatus(t('phase7.version.restored', 'Version restored and linked views regenerated.'));
        render();
      },
    });
    mountAutosaveStatus(autosaveHost, {
      i18n,
      projectId: state.projectId,
      dirty: state.dirty,
      lastSaved: state.lastAutosave,
      recovery: state.recovery,
      onAutosave: saveRecoverySnapshot,
      onRestore: async () => {
        state.recovery = await api.restoreRecoverySnapshot?.({ projectId: state.projectId });
        setStatus(t('phase7.recovery.restored', 'Recovery snapshot restored.'));
        render();
      },
      onDiscard: async () => {
        state.recovery = await api.discardRecoverySnapshot?.({ projectId: state.projectId });
        render();
      },
    });
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
    if (state.selectedPhotoId === photo.id) card.classList.add('photo-card--selected');
    card.addEventListener('click', () => {
      state.selectedPhotoId = photo.id;
      render();
    });
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
      photo.manualViewOverride = true;
      state.uploaded = false;
      markDirty('manual-view-assignment');
      syncStore();
      render();
    });

    const include = document.createElement('label');
    include.className = 'photo-card__include';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = photo.included;
    checkbox.addEventListener('change', () => {
      photo.included = checkbox.checked;
      state.uploaded = false;
      markDirty('photo-include-toggle');
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
      button('phase7.geometry.editGeometry', 'Edit Geometry', async () => {
        state.selectedPhotoId = photo.id;
        if (!photo.uploadedId) await ensureUploaded();
        if (photo.uploadedId && api.getPhotoGeometry) {
          const result = await api.getPhotoGeometry({ projectId: state.projectId, photoId: photo.uploadedId });
          applyGeometryResult(photo, result);
        }
        state.geometryWorkspace = { photoId: photo.id, tab: 'mask' };
        render();
      }),
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
